import { Buffer } from 'buffer';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { File, FileMode, Paths } from 'expo-file-system';
import { SQLiteDatabase } from 'expo-sqlite';
import { isTerminalItem, TerminalItem, readTerminalItemsInDatabase, writeTerminalItemsInDatabase } from './terminalItems';
import { TerminalReportingRate } from './terminalRates';
import { loadTerminalRequest, TerminalNetwork } from './terminal';
import { readTerminalExportPage, removeTerminalExportSnapshot, transactTerminalDatabase } from './terminalDatabase';
import { getTerminalSaleInDatabase, insertTerminalSaleInDatabase, isTerminalSale, notifyTerminalSales, TerminalSale } from './terminalSales';
import { insertTerminalRefundInDatabase, isTerminalRefundAttempt, notifyTerminalRefunds, TerminalRefundAttempt } from './terminalRefunds';

export type TerminalBackupScope = Readonly<{ walletId: string; network: TerminalNetwork; xpub: string }>;
export type TerminalBackupPreview = Readonly<{ createdAt: number; sales: number; refunds: number; items: number }>;
type Prepared = { token: string; scope: string; preview: TerminalBackupPreview; items: readonly TerminalItem[]; busy: boolean };
const prepared = new WeakMap<TerminalBackupPreview, Prepared>();
const catalog = (value: unknown): TerminalItem[] => {
  if (!Array.isArray(value) || value.length > 30 || !value.every(isTerminalItem) || new Set(value.map(item => item.id)).size !== value.length) throw new Error('Invalid backup items.');
  return value.map(item => ({ id: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice }));
};
const FORMAT = 'trustless-terminal-records-1';
const MAX_FILE = 100 * 1024 * 1024;
const MAX_LINE = 64 * 1024;
const MAX_ROWS = 200_000;
const CHUNK = 64 * 1024;
const INVALID = 'Incorrect password or damaged Terminal backup.';
const current = (check: () => boolean) => { if (!check()) throw new Error('The active Terminal changed.'); };
const identity = (scope: TerminalBackupScope) => {
  if (!scope.walletId || scope.walletId !== scope.walletId.trim() || !['mainnet', 'testnet'].includes(scope.network) ||
    typeof scope.xpub !== 'string' || !/^[xt]pub[1-9A-HJ-NP-Za-km-z]{90,120}$/.test(scope.xpub)) throw new Error('This wallet cannot create or restore Terminal backups.');
  return createHash('sha256').update(`${FORMAT}:${scope.network}:${scope.xpub}`).digest('hex');
};
const localIdentity = (scope: TerminalBackupScope) => `${scope.walletId}:${identity(scope)}`;
const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 8_640_000_000_000_000;
const keyFor = async (password: string, salt: Buffer): Promise<Buffer> => {
  if (password.length < 12 || password.length > 1024) throw new Error('Use a password between 12 and 1024 characters.');
  const derived = await pbkdf2Async(sha256, password, salt, { c: 210000, dkLen: 32, asyncTick: 8 });
  try { return Buffer.from(derived); } finally { derived.fill(0); }
};
const secureBytes = (size: number): Promise<Buffer> => new Promise((resolve, reject) => {
  // The callback form uses the existing native OS random source rather than its synchronous fallback.
  randomBytes(size, (error, bytes) => error ? reject(error) : resolve(bytes));
});
const reporting = (value: TerminalReportingRate | null | undefined) => value === undefined ? {} : {
  reportingRate: value === null ? null : { currency: value.currency, rate: value.rate, fetchedAt: value.fetchedAt, source: value.source, status: value.status },
};
// Only journal schema fields cross the backup boundary, even if storage contains unrelated extra properties.
function saleRecord(sale: TerminalSale): TerminalSale {
  const r = sale.request;
  return { status: sale.status, updatedAt: sale.updatedAt,
    ...(sale.paymentId !== undefined ? { paymentId: sale.paymentId } : {}),
    ...(sale.receivedAt !== undefined ? { receivedAt: sale.receivedAt } : {}),
    ...(sale.restored ? { restored: true } : {}),
    request: { id: r.id, walletId: r.walletId, network: r.network, invoice: r.invoice, amountSats: r.amountSats, createdAt: r.createdAt, expiresAt: r.expiresAt,
      ...(r.inputUnit ? { inputUnit: r.inputUnit } : {}), ...reporting(r.reportingRate),
      ...(r.fiat ? { fiat: { currency: r.fiat.currency, amountMinor: r.fiat.amountMinor, rate: r.fiat.rate, fetchedAt: r.fiat.fetchedAt } } : {}),
      ...(r.basket ? { basket: { unit: r.basket.unit, total: r.basket.total, lines: r.basket.lines.map(line => ({ itemId: line.itemId, name: line.name, unitPrice: line.unitPrice, quantity: line.quantity, total: line.total })) } } : {}),
    },
  };
}
function refundRecord(r: TerminalRefundAttempt): TerminalRefundAttempt {
  return { id: r.id, walletId: r.walletId, network: r.network, saleId: r.saleId, saleInvoice: r.saleInvoice, invoice: r.invoice,
    amountSats: r.amountSats, feeSats: r.feeSats, quoteExpiresAt: r.quoteExpiresAt, createdAt: r.createdAt, updatedAt: r.updatedAt, status: r.status,
    ...(r.paymentId !== undefined ? { paymentId: r.paymentId } : {}), ...reporting(r.reportingRate) };
}
const removeFile = (uri: string) => { try { const file = new File(uri); if (file.exists) file.delete(); } catch { /* temporary cache only */ } };
export const removeTerminalBackupFile = removeFile;

/** One GCM stream authenticates the header and the entire ordered, length-bounded record stream. */
export async function createTerminalBackup(scope: TerminalBackupScope, password: string, isCurrent: () => boolean): Promise<{ uri: string } & TerminalBackupPreview> {
  const owner = identity(scope); current(isCurrent);
  const salt = await secureBytes(16), iv = await secureBytes(12);
  current(isCurrent);
  const header = Buffer.from(JSON.stringify({ format: FORMAT, salt: salt.toString('hex'), iv: iv.toString('hex') }) + '\n');
  const key = await keyFor(password, salt);
  let snapshot: string | undefined, handle: ReturnType<File['open']> | undefined, uri = '', success = false;
  try {
    current(isCurrent);
    const token = `backup-${(await secureBytes(16)).toString('hex')}`;
    const items = await transactTerminalDatabase(async db => {
      current(isCurrent);
      const saved = catalog(await readTerminalItemsInDatabase(db, scope.walletId, scope.network));
      await db.runAsync(`INSERT INTO terminal_export_rows(export_id,kind,payload)
        SELECT ?,kind,payload FROM (
          SELECT 'sale' AS kind,payload,activity_at AS at,id FROM terminal_sales WHERE wallet_id=? AND network=?
          UNION ALL SELECT 'refund' AS kind,payload,updated_at AS at,id FROM terminal_refunds WHERE wallet_id=? AND network=?
        ) ORDER BY at DESC,id DESC,kind`, [token, scope.walletId, scope.network, scope.walletId, scope.network]);
      return saved;
    });
    snapshot = token;
    current(isCurrent);
    const file = new File(Paths.cache, `terminal-${(await secureBytes(16)).toString('hex')}.trustless`);
    uri = file.uri; file.create(); handle = file.open(FileMode.WriteOnly); handle.writeBytes(Uint8Array.from(header));
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header);
    let written = header.length, sales = 0, refunds = 0;
    const write = (value: unknown) => {
      const line = Buffer.from(JSON.stringify(value) + '\n');
      if (line.length > MAX_LINE) throw new Error('A Terminal record is too large to back up.');
      const bytes = cipher.update(line); written += bytes.length;
      if (written + 16 > MAX_FILE) throw new Error('Terminal backup exceeds the 100 MB limit.');
      handle!.writeBytes(Uint8Array.from(bytes));
    };
    const createdAt = Date.now();
    write({ type: 'scope', owner, walletId: scope.walletId, network: scope.network, createdAt, items });
    let cursor = 0;
    do {
      const page = await readTerminalExportPage(snapshot, cursor); current(isCurrent);
      for (const row of page.rows) {
        const value: unknown = JSON.parse(row.payload);
        if (row.kind === 'sale' ? !isTerminalSale(value, scope.walletId, scope.network) : !isTerminalRefundAttempt(value, scope.walletId, scope.network)) throw new Error('Saved Terminal records are invalid.');
        if (row.kind === 'sale') sales++; else refunds++;
        if (sales + refunds > MAX_ROWS) throw new Error('Terminal backup exceeds the 200,000 record limit.');
        write({ type: row.kind, value: row.kind === 'sale' ? saleRecord(value as TerminalSale) : refundRecord(value as TerminalRefundAttempt) });
      }
      if (page.nextSeq === null) break;
      cursor = page.nextSeq;
    } while (true);
    write({ type: 'end', sales, refunds });
    handle.writeBytes(Uint8Array.from(cipher.final())); handle.writeBytes(Uint8Array.from(cipher.getAuthTag()));
    handle.close(); handle = undefined; current(isCurrent); success = true;
    return { uri, createdAt, sales, refunds, items: items.length };
  } finally {
    key.fill(0); try { handle?.close(); } catch { /* continue cleanup */ }
    if (!success && uri) removeFile(uri);
    if (snapshot) await removeTerminalExportSnapshot(snapshot).catch(() => undefined);
  }
}

/** Decrypted records are staged privately in SQLite; live sales are untouched until authenticated and confirmed. */
export async function inspectTerminalBackup(uri: string, scope: TerminalBackupScope, password: string, isCurrent: () => boolean): Promise<TerminalBackupPreview> {
  const owner = identity(scope); current(isCurrent);
  if (!uri.startsWith('file://')) throw new Error('Choose a local Terminal backup.');
  const file = new File(uri);
  if (!file.exists || file.size < 100 || file.size > MAX_FILE) throw new Error('Choose a Terminal backup up to 100 MB.');
  const token = `restore-${(await secureBytes(16)).toString('hex')}`; current(isCurrent);
  const handle = file.open(FileMode.ReadOnly);
  let key: Buffer | undefined, kept = false;
  try {
    // Header is ASCII and strictly bounded before a potentially expensive password derivation.
    const prefix = Buffer.from(handle.readBytes(Math.min(512, file.size))), end = prefix.indexOf(10);
    if (end < 0) throw new Error(INVALID);
    const header = Buffer.from(prefix.subarray(0, end + 1)), parsed = JSON.parse(header.toString('utf8'));
    if (parsed.format !== FORMAT || typeof parsed.salt !== 'string' || !/^[0-9a-f]{32}$/.test(parsed.salt) ||
      typeof parsed.iv !== 'string' || !/^[0-9a-f]{24}$/.test(parsed.iv)) throw new Error(INVALID);
    key = await keyFor(password, Buffer.from(parsed.salt, 'hex')); current(isCurrent);
    const cipherEnd = file.size - 16;
    handle.offset = cipherEnd;
    const tag = Buffer.from(handle.readBytes(16));
    handle.offset = end + 1;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'hex'));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    let items: TerminalItem[] = [];
    let pending = Buffer.alloc(0), sourceWallet = '', createdAt = 0, sales = 0, refunds = 0, ended = false;
    let batch: { kind: 'sale' | 'refund'; payload: string }[] = [];
    const flush = async () => {
      if (!batch.length) return;
      current(isCurrent); const rows = batch; batch = [];
      await transactTerminalDatabase(async db => {
        for (const row of rows) await db.runAsync('INSERT INTO terminal_export_rows(export_id,kind,payload) VALUES (?,?,?)', [token, row.kind, row.payload]);
      });
    };
    const consume = async (bytes: Buffer) => {
      pending = Buffer.concat([pending, bytes]);
      for (;;) {
        const newline = pending.indexOf(10);
        if (newline < 0) break;
        if (newline > MAX_LINE || ended) throw new Error(INVALID);
        const record = JSON.parse(Buffer.from(pending.subarray(0, newline)).toString('utf8')); pending = Buffer.from(pending.subarray(newline + 1));
        if (!sourceWallet) {
          if (record.type !== 'scope' || record.owner !== owner || record.network !== scope.network || typeof record.walletId !== 'string' || !record.walletId || !validTime(record.createdAt)) throw new Error('Backup belongs to another wallet or network, or is damaged.');
          items = catalog(record.items); sourceWallet = record.walletId; createdAt = record.createdAt;
        } else if (record.type === 'end') {
          if (record.sales !== sales || record.refunds !== refunds) throw new Error(INVALID);
          ended = true;
        } else {
          const value = record.value;
          if (record.type === 'sale' && isTerminalSale(value, sourceWallet, scope.network)) {
            batch.push({ kind: 'sale', payload: JSON.stringify({ ...saleRecord(value), request: { ...saleRecord(value).request, walletId: scope.walletId }, restored: true }) }); sales++;
          } else if (record.type === 'refund' && isTerminalRefundAttempt(value, sourceWallet, scope.network)) {
            batch.push({ kind: 'refund', payload: JSON.stringify({ ...refundRecord(value), walletId: scope.walletId }) }); refunds++;
          } else throw new Error(INVALID);
          if (sales + refunds > MAX_ROWS) throw new Error(INVALID);
          if (batch.length >= 100) await flush();
        }
      }
      if (pending.length > MAX_LINE) throw new Error(INVALID);
    };
    while ((handle.offset ?? cipherEnd) < cipherEnd) {
      current(isCurrent);
      const bytes = handle.readBytes(Math.min(CHUNK, cipherEnd - handle.offset!));
      if (!bytes.length) throw new Error(INVALID);
      await consume(decipher.update(Buffer.from(bytes)));
    }
    await consume(decipher.final());
    if (!ended || pending.length || !sourceWallet) throw new Error(INVALID);
    await flush(); current(isCurrent);
    const preview = Object.freeze({ createdAt, sales, refunds, items: items.length });
    prepared.set(preview, { token, scope: localIdentity(scope), preview, items: Object.freeze(items.map(item => Object.freeze(item))), busy: false }); kept = true;
    return preview;
  } catch (error) {
    if (!isCurrent()) throw new Error('The active Terminal changed.');
    if (error instanceof Error && /password between|another wallet/.test(error.message)) throw error;
    throw new Error(INVALID);
  } finally {
    key?.fill(0); handle.close(); if (!kept) await removeTerminalExportSnapshot(token).catch(() => undefined);
  }
}

export async function disposeTerminalBackup(preview: TerminalBackupPreview): Promise<void> {
  const staged = prepared.get(preview);
  if (!staged || staged.busy) return;
  prepared.delete(preview); await removeTerminalExportSnapshot(staged.token).catch(() => undefined);
}

export async function restoreTerminalBackup(preview: TerminalBackupPreview, scope: TerminalBackupScope, isCurrent: () => boolean): Promise<void> {
  const staged = prepared.get(preview);
  if (!staged || staged.busy || staged.scope !== localIdentity(scope)) throw new Error('Choose and unlock the backup again.');
  current(isCurrent); staged.busy = true;
  try {
    if (await loadTerminalRequest(scope.walletId, scope.network)) throw new Error('Close the active payment request before restoring.');
    await transactTerminalDatabase(async db => {
      current(isCurrent);
      const count = await db.getFirstAsync<{ n: number }>('SELECT (SELECT COUNT(*) FROM terminal_sales WHERE wallet_id=? AND network=?) + (SELECT COUNT(*) FROM terminal_refunds WHERE wallet_id=? AND network=?) AS n', [scope.walletId, scope.network, scope.walletId, scope.network]);
      if (count?.n) throw new Error('Restore requires an empty Terminal history. Existing records are never replaced.');
      if ((await readTerminalItemsInDatabase(db, scope.walletId, scope.network)).length) throw new Error('Restore requires an empty item catalog. Existing items are never replaced.');
      let totalSales = 0, totalRefunds = 0;
      for (const kind of ['sale', 'refund'] as const) {
        let cursor = 0;
        for (;;) {
          current(isCurrent);
          const rows = await db.getAllAsync<{ seq: number; payload: string }>('SELECT seq,payload FROM terminal_export_rows WHERE export_id=? AND kind=? AND seq>? ORDER BY seq LIMIT 100', [staged.token, kind, cursor]);
          if (!rows.length) break;
          for (const row of rows) {
            const value = JSON.parse(row.payload);
            if (kind === 'sale') {
              if (!isTerminalSale(value, scope.walletId, scope.network) || value.restored !== true) throw new Error(INVALID);
              await insertTerminalSaleInDatabase(db, value); totalSales++;
            } else {
              if (!isTerminalRefundAttempt(value, scope.walletId, scope.network)) throw new Error(INVALID);
              const sale = await getTerminalSaleInDatabase(db, scope.walletId, scope.network, value.saleId);
              if (!sale || sale.status !== 'received' || sale.request.invoice !== value.saleInvoice) throw new Error(INVALID);
              await insertTerminalRefundInDatabase(db, value);
              await assertRefundTotal(db, scope, value.saleId, sale.request.amountSats); totalRefunds++;
            }
            cursor = row.seq;
          }
        }
      }
      if (totalSales !== preview.sales || totalRefunds !== preview.refunds) throw new Error(INVALID);
      current(isCurrent);
      await writeTerminalItemsInDatabase(db, scope.walletId, scope.network, catalog(staged.items));
      current(isCurrent);
      await db.runAsync('DELETE FROM terminal_export_rows WHERE export_id=?', [staged.token]);
    });
    notifyTerminalSales(scope.walletId, scope.network); notifyTerminalRefunds(scope.walletId, scope.network);
  } finally {
    prepared.delete(preview); await removeTerminalExportSnapshot(staged.token).catch(() => undefined);
  }
}
async function assertRefundTotal(db: SQLiteDatabase, scope: TerminalBackupScope, saleId: string, amount: number) {
  const total = await db.getFirstAsync<{ hi: string; lo: string }>(`SELECT CAST(COALESCE(SUM(amount_hi),0) AS TEXT) AS hi,CAST(COALESCE(SUM(amount_lo),0) AS TEXT) AS lo FROM terminal_refunds WHERE wallet_id=? AND network=? AND sale_id=? AND status!='failed'`, [scope.walletId, scope.network, saleId]);
  if (BigInt(total?.hi ?? 0) * 1000000000n + BigInt(total?.lo ?? 0) > BigInt(amount)) throw new Error(INVALID);
}

import { Buffer } from 'buffer';
import { saveTerminalItem, listTerminalItems } from '../../services/terminalItems';
import { resetTerminalSqlite, failNextTerminalSqliteWrite } from '../helpers/terminalSqlite';
import { getTerminalDatabase } from '../../services/terminalDatabase';
import { getTerminalSale, listTerminalSalesPage, reconcileTerminalSales, updateTerminalSalePayment } from '../../services/terminalSales';
import { listTerminalRefundsForSale, reserveTerminalRefund, updateTerminalRefund } from '../../services/terminalRefunds';
import { createTerminalBackup, disposeTerminalBackup, inspectTerminalBackup, restoreTerminalBackup } from '../../services/terminalBackup';

jest.mock('uuid', () => ({ v4: () => require('node:crypto').randomUUID() }));
jest.mock('crypto', () => require('node:crypto'));
jest.mock('expo-file-system', () => {
  const { Buffer } = require('buffer');
  const files = new Map<string, any>();
  class File {
    uri: string;
    constructor(...parts: any[]) { this.uri = parts.map(p => typeof p === 'string' ? p : p.uri).join('/'); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    create() { files.set(this.uri, Buffer.alloc(0)); }
    delete() { files.delete(this.uri); }
    open() {
      const uri = this.uri;
      return { offset: 0, close() {}, readBytes(length: number) { const data = files.get(uri).subarray(this.offset, this.offset + length); this.offset += data.length; return data; },
        writeBytes(data: Uint8Array) { const before = files.get(uri) ?? Buffer.alloc(0); files.set(uri, Buffer.concat([before.subarray(0, this.offset), Buffer.from(data), before.subarray(this.offset + data.length)])); this.offset += data.length; } };
    }
  }
  return { File, Paths: { cache: 'file:///cache' }, FileMode: { ReadOnly: 'r', WriteOnly: 'w' }, __files: files };
});
const files: Map<string, Buffer> = require('expo-file-system').__files;
const password = 'correct horse battery staple';
const scope = { walletId: 'source', network: 'mainnet' as const, xpub: 'xpub' + 'A'.repeat(107) };
const target = { ...scope, walletId: 'restored' };
const request = (id = 'one') => ({ id, walletId: scope.walletId, network: scope.network, invoice: `lnbc${id}abc`, amountSats: 1000, createdAt: 1000, expiresAt: 2000 });
const check = () => true;
const quote = { id: 'refund', invoice: 'lnbcrefundabc', amountSats: 100, feeSats: 1, quoteExpiresAt: Date.now() + 60_000 };
beforeEach(async () => { await resetTerminalSqlite(); await (await getTerminalDatabase()).execAsync('DROP TRIGGER IF EXISTS reject_restored_reports'); files.clear(); });
async function backupWithRefund() {
  const sale = await updateTerminalSalePayment(request(), { status: 'received', paymentId: 'received' }, 3000);
  const refund = await reserveTerminalRefund(sale, quote);
  await updateTerminalRefund(refund, { status: 'complete', paymentId: 'sent' }, 4000);
  return createTerminalBackup(scope, password, check);
}
async function stagedCount() { return (await (await getTerminalDatabase()).getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM terminal_export_rows'))?.n; }
it('round-trips exact history to the same wallet under a new local ID and blocks refunds from restored records', async () => {
  const backup = await backupWithRefund();
  expect(files.get(backup.uri)!.includes(Buffer.from('lnbconeabc'))).toBe(false);
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  expect(preview).toMatchObject({ sales: 1, refunds: 1 });
  expect(await getTerminalSale(target.walletId, target.network, 'one')).toBeNull();
  await restoreTerminalBackup(preview, target, check);
  const restored = (await getTerminalSale(target.walletId, target.network, 'one'))!;
  expect(restored).toMatchObject({ restored: true, status: 'received', paymentId: 'received', receivedAt: 3000 });
  expect(await listTerminalRefundsForSale(target.walletId, target.network, 'one')).toMatchObject([{ status: 'complete', paymentId: 'sent', amountSats: 100 }]);
  await expect(reserveTerminalRefund({ ...restored, restored: undefined }, { ...quote, id: 'new', invoice: 'lnbcnewabc' })).rejects.toThrow('Restored sales');
  expect(await stagedCount()).toBe(0);
});
it('retains refund protection when an imported pending sale later completes', async () => {
  await updateTerminalSalePayment(request(), { status: 'pending' }, 2000);
  const backup = await createTerminalBackup(scope, password, check);
  await restoreTerminalBackup(await inspectTerminalBackup(backup.uri, target, password, check), target, check);
  const restored = (await getTerminalSale(target.walletId, target.network, 'one'))!;
  await updateTerminalSalePayment(restored.request, { status: 'received' }, 4000);
  expect((await getTerminalSale(target.walletId, target.network, 'one'))?.restored).toBe(true);
  await reconcileTerminalSales(target.walletId, target.network, [{ invoice: restored.request.invoice, status: 'received', paymentId: 'sdk' }], 5000);
  expect((await getTerminalSale(target.walletId, target.network, 'one'))?.restored).toBe(true);
});
it.each(['wrong password', 'tampered', 'truncated'])('rejects %s without touching history or leaving staging rows', async mode => {
  const backup = await backupWithRefund();
  if (mode === 'tampered') { const bytes = Buffer.from(files.get(backup.uri)!); bytes[bytes.length - 35] ^= 1; files.set(backup.uri, bytes); }
  if (mode === 'truncated') files.set(backup.uri, files.get(backup.uri)!.subarray(0, -16));
  await expect(inspectTerminalBackup(backup.uri, target, mode === 'wrong password' ? 'a different password' : password, check)).rejects.toThrow('password');
  expect((await listTerminalSalesPage(target.walletId, target.network, { range: null })).items).toHaveLength(0);
  expect(await stagedCount()).toBe(0);
});
it('rejects another wallet or network and rejects overwrite of existing financial records', async () => {
  const backup = await backupWithRefund();
  await expect(inspectTerminalBackup(backup.uri, { ...target, xpub: 'xpub' + 'B'.repeat(107) }, password, check)).rejects.toThrow('another wallet');
  await expect(inspectTerminalBackup(backup.uri, { ...target, network: 'testnet' }, password, check)).rejects.toThrow('another wallet');
  const preview = await inspectTerminalBackup(backup.uri, scope, password, check);
  await expect(restoreTerminalBackup(preview, scope, check)).rejects.toThrow('empty Terminal');
  expect((await getTerminalSale(scope.walletId, scope.network, 'one'))?.restored).toBeUndefined();
  expect(await stagedCount()).toBe(0);
});
it('rolls back the entire restore after a database failure and cleans up a discarded preview', async () => {
  const backup = await backupWithRefund();
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  failNextTerminalSqliteWrite();
  await expect(restoreTerminalBackup(preview, target, check)).rejects.toThrow('storage full');
  expect(await getTerminalSale(target.walletId, target.network, 'one')).toBeNull();
  expect(await stagedCount()).toBe(0);
  const discarded = await inspectTerminalBackup(backup.uri, target, password, check);
  await disposeTerminalBackup(discarded);
  await expect(restoreTerminalBackup(discarded, target, check)).rejects.toThrow('again');
});
it('streams multiple encrypted pages, cleans up cancellation, and never reads the entire file', async () => {
  for (let i = 0; i < 125; i++) await updateTerminalSalePayment(request(`sale${i}`), { status: 'received' }, 3000);
  const backup = await createTerminalBackup(scope, password, check);
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  expect(preview.sales).toBe(125);
  let active = true;
  await expect(restoreTerminalBackup(preview, target, () => { const old = active; active = false; return old; })).rejects.toThrow('changed');
  expect(await getTerminalSale(target.walletId, target.network, 'sale0')).toBeNull();
  expect(await stagedCount()).toBe(0);
});

it('rolls back inserted sales when a later refund fails validation', async () => {
  const backup = await backupWithRefund();
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  await (await getTerminalDatabase()).runAsync("UPDATE terminal_export_rows SET payload=REPLACE(payload,'lnbconeabc','lnbcwrongabc') WHERE kind='refund'");
  await expect(restoreTerminalBackup(preview, target, check)).rejects.toThrow('damaged');
  expect(await getTerminalSale(target.walletId, target.network, 'one')).toBeNull();
  expect(await stagedCount()).toBe(0);
});

it('reads files when the runtime returns plain Uint8Array subarray views', async () => {
  const backup = await backupWithRefund();
  const original = Buffer.prototype.subarray;
  const view = jest.spyOn(Buffer.prototype, 'subarray').mockImplementation(function(this: Buffer, ...args: unknown[]) {
    const [start, end] = args as [number | undefined, number | undefined];
    const result = original.call(this, start, end);
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength) as Buffer;
  });
  try {
    const preview = await inspectTerminalBackup(backup.uri, target, password, check);
    expect(preview.sales).toBe(1); await disposeTerminalBackup(preview);
  } finally { view.mockRestore(); }
});

it('restores saved item prices and IDs atomically, while refusing to replace an existing catalog', async () => {
  const item = { id: 'coffee', name: 'Coffee', unit: 'CHF' as const, unitPrice: 350 };
  await saveTerminalItem(scope.walletId, scope.network, item, check);
  const backup = await backupWithRefund();
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  expect(preview.items).toBe(1);
  await restoreTerminalBackup(preview, target, check);
  expect(await listTerminalItems(target.walletId, target.network)).toEqual([item]);
  const other = { ...target, walletId: 'with-items' };
  await saveTerminalItem(other.walletId, other.network, { ...item, name: 'Existing' }, check);
  await expect(restoreTerminalBackup(await inspectTerminalBackup(backup.uri, other, password, check), other, check)).rejects.toThrow('empty item catalog');
  expect(await getTerminalSale(other.walletId, other.network, 'one')).toBeNull();
  expect((await listTerminalItems(other.walletId, other.network))[0].name).toBe('Existing');
});

it('exports only journal fields and interoperates with standard PBKDF2 and AES-GCM without wallet recovery material', async () => {
  await updateTerminalSalePayment(request(), { status: 'received' }, 3000);
  const db = await getTerminalDatabase();
  const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM terminal_sales WHERE wallet_id=?', [scope.walletId]);
  const stored = JSON.parse(row!.payload);
  stored.mnemonic = 'never-export-this-extra-property';
  stored.request.privateKey = 'never-export-this-extra-property';
  await db.runAsync('UPDATE terminal_sales SET payload=? WHERE wallet_id=?', [JSON.stringify(stored), scope.walletId]);
  const backup = await createTerminalBackup(scope, password, check);
  const bytes = files.get(backup.uri)!;
  const boundary = bytes.indexOf(10), header = Buffer.from(bytes.subarray(0, boundary + 1)), metadata = JSON.parse(header.toString('utf8'));
  const crypto = require('node:crypto');
  const key = crypto.pbkdf2Sync(password, Buffer.from(metadata.salt, 'hex'), 210000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex'));
  decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(bytes.subarray(boundary + 1, -16)), decipher.final()]).toString('utf8');
  expect(plaintext).not.toContain('never-export');
  expect(plaintext).not.toContain('mnemonic');
  expect(plaintext).not.toContain('privateKey');
  expect(plaintext).not.toContain(scope.xpub);
  key.fill(0);
});

const branding = { name: 'Corner shop', contact: 'hello@example.com', footer: 'Thank you' };
async function savePreferences() {
  const { saveTerminalReceiptBranding } = require('../../services/terminalReceiptBranding');
  const { createTerminalReceiptTemplate } = require('../../services/terminalReceiptTemplates');
  const { saveTerminalReportPreset } = require('../../services/terminalReportPresets');
  await saveTerminalReceiptBranding(scope.walletId, scope.network, branding, check);
  await createTerminalReceiptTemplate(scope.walletId, scope.network, 'Shop', branding, check);
  await saveTerminalReportPreset(scope.walletId, scope.network, { period: 'week', tab: 'items', unit: 'CHF', sort: 'gross' }, check);
}
async function readPreferencesFor(wallet = target) {
  const { loadTerminalReceiptBranding } = require('../../services/terminalReceiptBranding');
  const { loadTerminalReceiptTemplates } = require('../../services/terminalReceiptTemplates');
  const { listTerminalReportPresets } = require('../../services/terminalReportPresets');
  return { branding: await loadTerminalReceiptBranding(wallet.walletId, wallet.network), templates: await loadTerminalReceiptTemplates(wallet.walletId, wallet.network), presets: await listTerminalReportPresets(wallet.walletId, wallet.network) };
}
function rewriteBackup(uri: string, transform: (records: any[]) => any[], legacy = false) {
  const crypto = require('node:crypto');
  const bytes = files.get(uri)!;
  const boundary = bytes.indexOf(10), oldHeader = bytes.subarray(0, boundary + 1), metadata = JSON.parse(oldHeader.toString('utf8'));
  const key = crypto.pbkdf2Sync(password, Buffer.from(metadata.salt, 'hex'), 210000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex'));
  decipher.setAAD(oldHeader); decipher.setAuthTag(bytes.subarray(-16));
  const records = Buffer.concat([decipher.update(bytes.subarray(boundary + 1, -16)), decipher.final()]).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
  if (legacy) metadata.format = 'trustless-terminal-records-1';
  const header = Buffer.from(JSON.stringify(metadata) + '\n');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex')); cipher.setAAD(header);
  const plaintext = Buffer.from(transform(records).map(record => JSON.stringify(record)).join('\n') + '\n');
  files.set(uri, Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])); key.fill(0);
}
it('restores receipt settings, templates and report presets even without sales or items', async () => {
  await savePreferences();
  // Reading default settings creates empty storage rows, which must not prevent restore.
  await readPreferencesFor();
  const backup = await createTerminalBackup(scope, password, check);
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  expect(preview).toMatchObject({ preferences: true, templates: 1, reportPresets: 1, sales: 0, items: 0 });
  await restoreTerminalBackup(preview, target, check);
  expect(await readPreferencesFor()).toEqual(await readPreferencesFor(scope));
});
it('preserves existing settings when restoring an older journal-only backup', async () => {
  const { saveTerminalReceiptBranding } = require('../../services/terminalReceiptBranding');
  await saveTerminalReceiptBranding(target.walletId, target.network, branding, check);
  const backup = await backupWithRefund();
  rewriteBackup(backup.uri, records => records.filter(record => record.type !== 'preferences'), true);
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  expect(preview.preferences).toBe(false);
  await restoreTerminalBackup(preview, target, check);
  expect((await readPreferencesFor()).branding).toEqual(branding);
});
it('never overwrites receipt settings or restores financial records when the target has preferences', async () => {
  const { saveTerminalReceiptBranding } = require('../../services/terminalReceiptBranding');
  await saveTerminalReceiptBranding(target.walletId, target.network, branding, check);
  const backup = await backupWithRefund();
  await expect(restoreTerminalBackup(await inspectTerminalBackup(backup.uri, target, password, check), target, check)).rejects.toThrow('empty receipt settings');
  expect(await getTerminalSale(target.walletId, target.network, 'one')).toBeNull();
  expect((await readPreferencesFor()).branding).toEqual(branding);
});
it.each(['missing', 'duplicate', 'late', 'invalid', 'oversized'])('rejects %s preferences without changing live settings', async kind => {
  await savePreferences();
  const backup = await backupWithRefund();
  rewriteBackup(backup.uri, records => {
    const settings = records.find(record => record.type === 'preferences');
    if (kind === 'missing') return records.filter(record => record !== settings);
    if (kind === 'duplicate') return [records[0], settings, ...records.slice(1)];
    if (kind === 'late') return [records[0], ...records.slice(2, -1), settings, records[records.length - 1]];
    if (kind === 'invalid') settings.value.templates[0].branding.logo = { mimeType: 'image/png', base64: 'not-an-image', width: 1, height: 1 };
    if (kind === 'oversized') settings.value.receiptSettings.footer = 'é'.repeat(1024 * 1024);
    return records;
  });
  await expect(inspectTerminalBackup(backup.uri, target, password, check)).rejects.toThrow('damaged');
  expect((await readPreferencesFor()).branding.name).toBe('');
  expect(await stagedCount()).toBe(0);
});
it('rolls back preferences and journals together if the final preference write fails', async () => {
  await savePreferences();
  const backup = await backupWithRefund();
  const preview = await inspectTerminalBackup(backup.uri, target, password, check);
  const db = await getTerminalDatabase();
  await db.execAsync("CREATE TRIGGER reject_restored_reports BEFORE INSERT ON terminal_preferences WHEN NEW.wallet_id='restored' AND NEW.kind='reports' AND NEW.payload IS NOT NULL BEGIN SELECT RAISE(ABORT, 'forced preference failure'); END;");
  await expect(restoreTerminalBackup(preview, target, check)).rejects.toThrow('forced preference failure');
  expect(await getTerminalSale(target.walletId, target.network, 'one')).toBeNull();
  expect((await readPreferencesFor()).branding.name).toBe('');
});

function largeLogo() {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.from([0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0]);
  const pixels = require('node:crypto').randomBytes(128 * 513);
  for (let y = 0; y < 128; y++) pixels[y * 513] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', require('node:zlib').deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return require('../../services/terminalReceiptLogo').receiptLogoFromBytes(png);
}
it('streams a validated logo library larger than a financial record through multiple chunks', async () => {
  const { saveTerminalReceiptBranding } = require('../../services/terminalReceiptBranding');
  const { createTerminalReceiptTemplate } = require('../../services/terminalReceiptTemplates');
  const branded = { ...branding, logo: largeLogo() };
  expect(Buffer.byteLength(JSON.stringify(branded))).toBeGreaterThan(64 * 1024);
  await saveTerminalReceiptBranding(scope.walletId, scope.network, branded, check);
  await createTerminalReceiptTemplate(scope.walletId, scope.network, 'Logo', branded, check);
  const backup = await createTerminalBackup(scope, password, check);
  await restoreTerminalBackup(await inspectTerminalBackup(backup.uri, target, password, check), target, check);
  expect(await readPreferencesFor()).toEqual(await readPreferencesFor(scope));
});

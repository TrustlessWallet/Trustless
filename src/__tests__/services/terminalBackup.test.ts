import { Buffer } from 'buffer';
import { saveTerminalItem, listTerminalItems } from '../../services/terminalItems';
import { resetTerminalSqlite, failNextTerminalSqliteWrite } from '../helpers/terminalSqlite';
import { getTerminalDatabase } from '../../services/terminalDatabase';
import { getTerminalSale, listTerminalSalesPage, reconcileTerminalSales, updateTerminalSalePayment } from '../../services/terminalSales';
import { listTerminalRefundsForSale, reserveTerminalRefund, updateTerminalRefund } from '../../services/terminalRefunds';
import { createTerminalBackup, disposeTerminalBackup, inspectTerminalBackup, restoreTerminalBackup } from '../../services/terminalBackup';

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
beforeEach(async () => { await resetTerminalSqlite(); files.clear(); });
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

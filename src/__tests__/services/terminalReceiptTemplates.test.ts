import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import { receiptLogoFromBytes } from '../../services/terminalReceiptLogo';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, TerminalReceiptBranding } from '../../services/terminalReceiptBranding';
import { clearTerminalReceiptTemplates, createTerminalReceiptTemplate, loadTerminalReceiptTemplates, removeTerminalReceiptTemplate,
  replaceTerminalReceiptTemplate, TERMINAL_RECEIPT_TEMPLATES_KEY } from '../../services/terminalReceiptTemplates';
import { deflateSync } from 'zlib';
import { getTerminalDatabase } from '../../services/terminalDatabase';
import { failNextTerminalSqliteWrite, resetTerminalSqlite } from '../helpers/terminalSqlite';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
jest.mock('uuid', () => ({ v4: jest.fn() }));
const storage = new Map<string, string>();
const key = `${TERMINAL_RECEIPT_TEMPLATES_KEY}:mainnet:wallet-a`;
const branding: TerminalReceiptBranding = { name: 'Corner Cafe', contact: 'hello@example.com', footer: 'Thanks' };
const id = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`;
function logo() {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3, 255]))), chunk('IEND', Buffer.alloc(0))]);
  return receiptLogoFromBytes(png);
}
async function stored(wallet = 'wallet-a', network = 'mainnet') {
  return (await (await getTerminalDatabase()).getFirstAsync<{ payload: string | null }>(
    "SELECT payload FROM terminal_preferences WHERE wallet_id=? AND network=? AND kind='templates'", [wallet, network]))?.payload;
}
beforeEach(async () => {
  await resetTerminalSqlite();
  storage.clear(); jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (name, value) => { storage.set(name, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async name => { storage.delete(name); });
  let sequence = 0;
  (uuidv4 as jest.Mock).mockImplementation(() => id(++sequence));
});

it('clears only the selected template library and blocks pending and future edits', async () => {
  const wallet = 'templates-cleanup';
  const mainnetKey = `${TERMINAL_RECEIPT_TEMPLATES_KEY}:mainnet:${wallet}`;
  const testnetKey = `${TERMINAL_RECEIPT_TEMPLATES_KEY}:testnet:${wallet}`;
  const existing = await createTerminalReceiptTemplate(wallet, 'mainnet', 'Cafe', branding, () => true);
  await createTerminalReceiptTemplate(wallet, 'testnet', 'Cafe', branding, () => true);
  storage.set(mainnetKey, (await stored(wallet))!);
  await (await getTerminalDatabase()).runAsync(
    "DELETE FROM terminal_preferences WHERE wallet_id=? AND network='mainnet' AND kind='templates'", [wallet]);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; });
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { started(); await gate; return storage.get(name) ?? null; });
  const replace = replaceTerminalReceiptTemplate(wallet, 'Mainnet', existing[0].id, { ...branding, footer: 'Late' }, () => true);
  await reading;
  const cleanup = clearTerminalReceiptTemplates(wallet, 'Bitcoin');
  release();
  await expect(replace).rejects.toThrow('removed');
  await cleanup;
  expect(await stored(wallet, 'mainnet')).toBeNull();
  expect(await stored(wallet, 'testnet')).not.toBeNull();
  expect(await loadTerminalReceiptTemplates(wallet, 'mainnet')).toEqual([]);
  await expect(createTerminalReceiptTemplate(wallet, 'mainnet', 'New', branding, () => true)).rejects.toThrow('removed');
  await expect(removeTerminalReceiptTemplate(wallet, 'mainnet', existing[0].id, () => true)).rejects.toThrow('removed');
});

it('creates scoped templates and leaves active branding untouched', async () => {
  expect(await loadTerminalReceiptTemplates('wallet-a', 'mainnet')).toEqual([]);
  const list = await createTerminalReceiptTemplate('wallet-a', 'mainnet', '  Cafe  ', branding, () => true);
  expect(list).toEqual([{ id: id(1), name: 'Cafe', branding }]);
  expect(await loadTerminalReceiptTemplates('wallet-a', 'mainnet')).toEqual(list);
  expect(await loadTerminalReceiptTemplates('wallet-b', 'mainnet')).toEqual([]);
  expect(await loadTerminalReceiptTemplates('wallet-a', 'testnet')).toEqual([]);
  expect(JSON.parse((await stored())!)).toEqual({ version: 1, walletId: 'wallet-a', network: 'mainnet', templates: list });
  expect(storage.has('@terminalReceiptBranding:v1:mainnet:wallet-a')).toBe(false);
});

it('snapshots a logo and replaces or removes templates without changing their names', async () => {
  const original = { ...branding, logo: logo() };
  const pending = createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Logo', original, () => true);
  (original as any).name = 'Changed'; (original.logo as any).base64 = 'changed';
  const created = await pending;
  expect(created[0].branding).toEqual({ ...branding, logo: logo() });
  const replaced = await replaceTerminalReceiptTemplate('wallet-a', 'mainnet', created[0].id, { ...DEFAULT_TERMINAL_RECEIPT_BRANDING, name: 'New' }, () => true);
  expect(replaced[0]).toEqual({ id: created[0].id, name: 'Logo', branding: { name: 'New', contact: '', footer: '' } });
  expect(await removeTerminalReceiptTemplate('wallet-a', 'mainnet', created[0].id, () => true)).toEqual([]);
  expect(await removeTerminalReceiptTemplate('wallet-a', 'mainnet', created[0].id, () => true)).toEqual([]);
});

it('rejects duplicate names, unsafe names and a sixth template', async () => {
  await createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Cafe', branding, () => true);
  await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'cafe', branding, () => true)).rejects.toThrow('already exists');
  await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'STANDARD', branding, () => true)).rejects.toThrow('reserved');
  for (const bad of ['', '  ', 'bad\nname', 'bad\u202ename', 'bad\u200bname', 'x'.repeat(41)]) {
    await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', bad, branding, () => true)).rejects.toThrow('Invalid receipt template name');
  }
  for (let number = 2; number <= 5; number++) await createTerminalReceiptTemplate('wallet-a', 'mainnet', `Template ${number}`, branding, () => true);
  await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Sixth', branding, () => true)).rejects.toThrow('limit');
  expect(await loadTerminalReceiptTemplates('wallet-a', 'mainnet')).toHaveLength(5);
});

it('fails closed on malformed storage and does not overwrite it', async () => {
  for (const raw of ['{bad', 'x'.repeat(1_400_001), JSON.stringify({ version: 1, walletId: 'wallet-b', network: 'mainnet', templates: [] }),
    JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', templates: [{ id: id(1), name: 'Cafe', branding: { ...branding, footer: 'bad\nfooter' } }] })]) {
    await resetTerminalSqlite();
    storage.set(key, raw);
    await expect(loadTerminalReceiptTemplates('wallet-a', 'mainnet')).rejects.toThrow();
    await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Fresh', branding, () => true)).rejects.toThrow();
    expect(storage.get(key)).toBe(raw);
  }
});

it('rejects queued stale scope and recovers after storage failure', async () => {
  let current = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { current = false; return storage.get(name) ?? null; });
  await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Cafe', branding, () => current)).rejects.toThrow('Current');
  expect(storage.has(key)).toBe(false);
  current = true;
  failNextTerminalSqliteWrite(new Error('disk full'));
  await expect(createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Cafe', branding, () => current)).rejects.toThrow('disk full');
  expect(await createTerminalReceiptTemplate('wallet-a', 'mainnet', 'Cafe', branding, () => current)).toHaveLength(1);
});

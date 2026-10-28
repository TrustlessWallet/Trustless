import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetTerminalSqlite } from '../helpers/terminalSqlite';
import { getTerminalDatabase, transactTerminalDatabase } from '../../services/terminalDatabase';
import { deleteTerminalItem, listTerminalItems, removeTerminalItems, readTerminalItemsInDatabase, saveTerminalItem,
  TERMINAL_ITEMS_KEY, TerminalItem, writeTerminalItemsInDatabase } from '../../services/terminalItems';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
const storage = new Map<string, string>();
const key = `${TERMINAL_ITEMS_KEY}:mainnet:wallet-a`;
const item: TerminalItem = { id: 'coffee', name: 'Coffee', unit: 'USD', unitPrice: 1 };
const legacy = (items: TerminalItem[], walletId = 'wallet-a') => JSON.stringify({ version: 1, walletId, network: 'mainnet', items });
beforeEach(async () => {
  storage.clear();
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async key => { storage.delete(key); });
  (AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockReset();
  await resetTerminalSqlite();
});

it('stores isolated SQLite catalogs and snapshots input before queued writes', async () => {
  const mutable = { ...item };
  const pending = saveTerminalItem('wallet-a', 'mainnet', mutable, () => true);
  mutable.name = 'Changed'; mutable.unitPrice = 999;
  await pending;
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
  expect(await listTerminalItems('wallet-b', 'mainnet')).toEqual([]);
  expect(await listTerminalItems('wallet-a', 'testnet')).toEqual([]);
  const row = await (await getTerminalDatabase()).getFirstAsync<{ payload: string }>(
    'SELECT payload FROM terminal_catalog WHERE wallet_id=? AND network=?', ['wallet-a', 'mainnet']);
  expect(JSON.parse(row!.payload)).toEqual([item]);
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('migrates legacy catalog exactly once and an empty SQLite row prevents resurrection', async () => {
  storage.set(key, legacy([item]));
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
  storage.set(key, legacy([{ ...item, id: 'stale' }]));
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
  await deleteTerminalItem('wallet-a', 'mainnet', item.id, () => true);
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([]);
  expect((AsyncStorage.getItem as jest.Mock).mock.calls.filter(([name]) => name === key)).toHaveLength(1);
});

it('fails closed on unreadable or wrong-scope legacy catalogs and misleading names', async () => {
  storage.set(key, '{bad');
  await expect(listTerminalItems('wallet-a', 'mainnet')).rejects.toThrow('unreadable');
  await expect(saveTerminalItem('wallet-a', 'mainnet', item, () => true)).rejects.toThrow('unreadable');
  storage.set(key, legacy([], 'wallet-b'));
  await expect(listTerminalItems('wallet-a', 'mainnet')).rejects.toThrow('invalid');
  storage.clear();
  for (const name of [' Coffee', 'Coffee\nFree', 'Coffee\u0085Free', 'Coffee\u2028Free']) {
    await expect(saveTerminalItem('wallet-a', 'mainnet', { ...item, name }, () => true)).rejects.toThrow('Invalid item');
  }
});

it('rolls back a stale owner mutation and allows backup helpers in one transaction', async () => {
  let owner = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => { owner = false; return storage.get(name) ?? null; });
  await expect(saveTerminalItem('wallet-a', 'mainnet', item, () => owner)).rejects.toThrow('Owner access');
  const db = await getTerminalDatabase();
  expect(await db.getFirstAsync('SELECT payload FROM terminal_catalog WHERE wallet_id=? AND network=?', ['wallet-a', 'mainnet'])).toBeNull();
  owner = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => storage.get(name) ?? null);
  await transactTerminalDatabase(async transaction => {
    await writeTerminalItemsInDatabase(transaction, 'wallet-a', 'mainnet', [item]);
    expect(await readTerminalItemsInDatabase(transaction, 'wallet-a', 'mainnet')).toEqual([item]);
  });
  owner = false;
  await expect(deleteTerminalItem('wallet-a', 'mainnet', 'coffee', () => owner)).rejects.toThrow('Owner access');
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
});

it('rejects more than 30 items and corrupt SQLite payloads', async () => {
  const many = Array.from({ length: 31 }, (_, index) => ({ ...item, id: `item-${index}` }));
  await expect(transactTerminalDatabase(db => writeTerminalItemsInDatabase(db, 'wallet-a', 'mainnet', many))).rejects.toThrow('invalid');
  const db = await getTerminalDatabase();
  await db.runAsync('INSERT INTO terminal_catalog(wallet_id,network,payload) VALUES (?,?,?)', ['wallet-a', 'mainnet', '{bad']);
  await expect(listTerminalItems('wallet-a', 'mainnet')).rejects.toThrow('unreadable');
});

it('removes migrated and legacy catalog data when the wallet is deleted', async () => {
  storage.set(key, legacy([item]));
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
  await removeTerminalItems('wallet-a', 'mainnet');
  expect(storage.has(key)).toBe(false);
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([]);
});

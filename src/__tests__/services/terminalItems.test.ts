import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteTerminalItem, listTerminalItems, saveTerminalItem, TERMINAL_ITEMS_KEY, TerminalItem } from '../../services/terminalItems';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));

const storage = new Map<string, string>();
const key = `${TERMINAL_ITEMS_KEY}:mainnet:wallet-a`;
const item: TerminalItem = { id: 'coffee', name: 'Coffee', unit: 'USD', unitPrice: 1 };

beforeEach(() => {
  storage.clear();
  (AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(async (name, value) => { storage.set(name, value); });
});

it('stores isolated versioned catalogs and freezes validated input before queued writes', async () => {
  const mutable = { ...item };
  const pending = saveTerminalItem('wallet-a', 'mainnet', mutable, () => true);
  mutable.name = 'Changed'; mutable.unitPrice = 999;
  await pending;
  expect(await listTerminalItems('wallet-a', 'mainnet')).toEqual([item]);
  expect(await listTerminalItems('wallet-b', 'mainnet')).toEqual([]);
  expect(await listTerminalItems('wallet-a', 'testnet')).toEqual([]);
  expect(JSON.parse(storage.get(key)!)).toEqual({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [item] });
});

it('fails closed on unreadable or wrong-scope catalog and rejects misleading names', async () => {
  storage.set(key, '{bad');
  await expect(listTerminalItems('wallet-a', 'mainnet')).rejects.toThrow('unreadable');
  await expect(saveTerminalItem('wallet-a', 'mainnet', item, () => true)).rejects.toThrow('unreadable');
  storage.set(key, JSON.stringify({ version: 1, walletId: 'wallet-b', network: 'mainnet', items: [] }));
  await expect(listTerminalItems('wallet-a', 'mainnet')).rejects.toThrow('invalid');
  storage.clear();
  for (const name of [' Coffee', 'Coffee\nFree', 'Coffee\u0085Free', 'Coffee\u2028Free']) {
    await expect(saveTerminalItem('wallet-a', 'mainnet', { ...item, name }, () => true)).rejects.toThrow('Invalid item');
  }
});

it('rejects a queued mutation when owner scope changes before storage commit', async () => {
  let owner = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => { owner = false; return storage.get(name) ?? null; });
  await expect(saveTerminalItem('wallet-a', 'mainnet', item, () => owner)).rejects.toThrow('Owner access');
  expect(storage.has(key)).toBe(false);
  owner = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => storage.get(name) ?? null);
  await saveTerminalItem('wallet-a', 'mainnet', item, () => owner);
  owner = false;
  await expect(deleteTerminalItem('wallet-a', 'mainnet', 'coffee', () => owner)).rejects.toThrow('Owner access');
  expect(JSON.parse(storage.get(key)!).items).toEqual([item]);
});

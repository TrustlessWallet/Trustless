import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearTerminalReportPresets, listTerminalReportPresets, removeTerminalReportPreset, reportPresetKey, saveTerminalReportPreset,
  TERMINAL_REPORT_PRESETS_KEY, TerminalReportPresetConfig,
} from '../../services/terminalReportPresets';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
const storage = new Map<string, string>();
const key = `${TERMINAL_REPORT_PRESETS_KEY}:mainnet:wallet-a`;
const itemConfig: TerminalReportPresetConfig = { period: 'week', tab: 'items', unit: 'USD', sort: 'gross' };

beforeEach(() => {
  storage.clear(); jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (name, value) => { storage.set(name, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async name => { storage.delete(name); });
});

it('clears the selected report scope and rejects queued writes after cleanup begins', async () => {
  const wallet = 'reports-cleanup';
  const mainnetKey = `${TERMINAL_REPORT_PRESETS_KEY}:mainnet:${wallet}`;
  const testnetKey = `${TERMINAL_REPORT_PRESETS_KEY}:testnet:${wallet}`;
  await saveTerminalReportPreset(wallet, 'mainnet', itemConfig, () => true);
  await saveTerminalReportPreset(wallet, 'testnet', itemConfig, () => true);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; });
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { started(); await gate; return storage.get(name) ?? null; });
  const save = saveTerminalReportPreset(wallet, 'Mainnet', { ...itemConfig, unit: 'EUR' }, () => true);
  await reading;
  const cleanup = clearTerminalReportPresets(wallet, 'Bitcoin');
  release();
  await expect(save).rejects.toThrow('removed');
  await cleanup;
  expect(storage.has(mainnetKey)).toBe(false);
  expect(storage.has(testnetKey)).toBe(true);
  expect(await listTerminalReportPresets(wallet, 'mainnet')).toEqual([]);
  await expect(removeTerminalReportPreset(wallet, 'mainnet', itemConfig, () => true)).rejects.toThrow('removed');
});

it('stores versioned wallet/network scopes and canonicalizes equivalent overview and preset configs', async () => {
  const overview = { period: 'today' as const, customRange: { startDate: '2020-01-01', endDate: '2020-01-02' }, tab: 'overview' as const, unit: 'EUR' as const, sort: 'gross' as const };
  const first = await saveTerminalReportPreset('wallet-a', 'mainnet', overview, () => true);
  await saveTerminalReportPreset('wallet-a', 'mainnet', { ...overview, customRange: undefined, unit: null, sort: 'quantity' }, () => true);
  expect(await listTerminalReportPresets('wallet-a', 'mainnet')).toEqual(first);
  expect(await listTerminalReportPresets('wallet-b', 'mainnet')).toEqual([]);
  expect(await listTerminalReportPresets('wallet-a', 'testnet')).toEqual([]);
  expect(first[0]).toEqual({ period: 'today', tab: 'overview', unit: null, sort: 'quantity' });
  expect(reportPresetKey(first[0])).toBe(JSON.parse(storage.get(key)!).presets[0].key);
});

it('copies mutable custom input before queued work and rejects reversed, future, or gross-All configs', async () => {
  const mutable = { period: 'custom' as const, customRange: { startDate: '1970-01-01', endDate: '1970-01-01' }, tab: 'items' as const, unit: 'CHF' as 'CHF' | 'USD', sort: 'quantity' as const };
  const pending = saveTerminalReportPreset('wallet-a', 'mainnet', mutable, () => true);
  mutable.customRange.startDate = '2021-01-01'; mutable.unit = 'USD';
  expect((await pending)[0]).toEqual({ period: 'custom', customRange: { startDate: '1970-01-01', endDate: '1970-01-01' }, tab: 'items', unit: 'CHF', sort: 'quantity' });
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, period: 'custom', customRange: { startDate: '2020-02-02', endDate: '2020-02-01' } }, () => true)).rejects.toThrow('Invalid');
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, period: 'custom', customRange: { startDate: '9999-01-01', endDate: '9999-01-02' } }, () => true)).rejects.toThrow('Invalid');
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, unit: null, sort: 'gross' }, () => true)).rejects.toThrow('Invalid');
});

it('fails closed on malformed, oversized, wrong-scope, duplicate, and invalid stored data without overwriting it', async () => {
  for (const raw of [
    '{bad', 'x'.repeat(32_769),
    JSON.stringify({ version: 1, walletId: 'wallet-b', network: 'mainnet', presets: [] }),
    JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', presets: [{ key: 'wrong', config: itemConfig }] }),
  ]) {
    storage.set(key, raw);
    await expect(listTerminalReportPresets('wallet-a', 'mainnet')).rejects.toThrow();
    await expect(saveTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => true)).rejects.toThrow();
    expect(storage.get(key)).toBe(raw);
  }
  const preset = { key: reportPresetKey(itemConfig), config: itemConfig };
  storage.set(key, JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', presets: [preset, preset] }));
  await expect(listTerminalReportPresets('wallet-a', 'mainnet')).rejects.toThrow('invalid');
});

it('serializes concurrent equivalent saves, enforces ten presets, and recovers after a failed write', async () => {
  const same = await Promise.all(Array.from({ length: 5 }, () => saveTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => true)));
  expect(same.every(result => result.length === 1)).toBe(true);
  for (let index = 0; index < 9; index++) await saveTerminalReportPreset('wallet-a', 'mainnet', { period: 'custom', customRange: { startDate: `2020-01-${String(index + 1).padStart(2, '0')}`, endDate: `2020-01-${String(index + 1).padStart(2, '0')}` }, tab: 'items', unit: 'sats', sort: 'quantity' }, () => true);
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, unit: 'EUR' }, () => true)).rejects.toThrow('limit');
  await removeTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => true);
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk failed'));
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, unit: 'EUR' }, () => true)).rejects.toThrow('disk failed');
  await saveTerminalReportPreset('wallet-a', 'mainnet', { ...itemConfig, unit: 'EUR' }, () => true);
  expect(await listTerminalReportPresets('wallet-a', 'mainnet')).toHaveLength(10);
});

it('checks current scope around queued reads and commits, and removed presets can be saved again', async () => {
  let current = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { current = false; return storage.get(name) ?? null; });
  await expect(saveTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => current)).rejects.toThrow('Current');
  expect(storage.has(key)).toBe(false);
  current = true;
  await saveTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => current);
  await removeTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => current);
  expect(await listTerminalReportPresets('wallet-a', 'mainnet')).toEqual([]);
  await saveTerminalReportPreset('wallet-a', 'mainnet', itemConfig, () => current);
  expect(await listTerminalReportPresets('wallet-a', 'mainnet')).toHaveLength(1);
});

it('keeps structural keys and stored custom presets usable after the device clock rolls back', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 21, 12));
  const custom: TerminalReportPresetConfig = { period: 'custom', customRange: { startDate: '2026-10-20', endDate: '2026-10-20' }, tab: 'items', unit: 'USD', sort: 'quantity' };
  try {
    await saveTerminalReportPreset('wallet-a', 'mainnet', custom, () => true);
    const structuralKey = reportPresetKey(custom);
    jest.setSystemTime(new Date(2020, 0, 1, 12));
    expect(reportPresetKey(custom)).toBe(structuralKey);
    expect(await listTerminalReportPresets('wallet-a', 'mainnet')).toEqual([custom]);
    expect(await removeTerminalReportPreset('wallet-a', 'mainnet', custom, () => true)).toEqual([]);
  } finally { jest.useRealTimers(); }
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTerminalDatabase, transactTerminalDatabase } from '../../services/terminalDatabase';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, readTerminalReceiptBrandingInDatabase,
  TERMINAL_RECEIPT_BRANDING_KEY, writeTerminalReceiptBrandingInDatabase } from '../../services/terminalReceiptBranding';
import { readTerminalReceiptTemplatesInDatabase, writeTerminalReceiptTemplatesInDatabase } from '../../services/terminalReceiptTemplates';
import { readTerminalReportPresetsInDatabase, writeTerminalReportPresetsInDatabase } from '../../services/terminalReportPresets';
import { failNextTerminalSqliteWrite, resetTerminalSqlite } from '../helpers/terminalSqlite';

jest.mock('uuid', () => ({ v4: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));

const wallet = 'preferences-atomic';
const branding = { name: 'Coffee', contact: 'coffee@example.com', footer: 'Thanks' };
const template = { id: '00000000-0000-4000-8000-000000000001', name: 'Cafe', branding };
const preset = { period: 'week' as const, tab: 'overview' as const, unit: null, sort: 'quantity' as const };

beforeEach(async () => {
  await resetTerminalSqlite();
  jest.clearAllMocks();
});

it('rolls back all three preferences when the final write fails in a shared transaction', async () => {
  await expect(transactTerminalDatabase(async db => {
    await writeTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet', branding);
    await writeTerminalReceiptTemplatesInDatabase(db, wallet, 'mainnet', [template]);
    failNextTerminalSqliteWrite();
    await writeTerminalReportPresetsInDatabase(db, wallet, 'mainnet', [preset]);
  })).rejects.toThrow('storage full');
  const db = await getTerminalDatabase();
  expect((await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM terminal_preferences WHERE wallet_id=?', [wallet]))?.count).toBe(0);
});

it('validates legacy data before migration and records an empty row only after a valid read', async () => {
  const key = `${TERMINAL_RECEIPT_BRANDING_KEY}:mainnet:${wallet}`;
  await AsyncStorage.setItem(key, '{broken');
  await expect(transactTerminalDatabase(db => readTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet'))).rejects.toThrow('unreadable');
  const db = await getTerminalDatabase();
  expect(await db.getFirstAsync('SELECT payload FROM terminal_preferences WHERE wallet_id=?', [wallet])).toBeNull();
  await AsyncStorage.removeItem(key);
  expect(await transactTerminalDatabase(db => readTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet')))
    .toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  expect(await db.getFirstAsync<{ payload: string | null }>(
    'SELECT payload FROM terminal_preferences WHERE wallet_id=?', [wallet])).toEqual({ payload: null });
  await AsyncStorage.setItem(key, JSON.stringify({ version: 1, walletId: wallet, network: 'mainnet', branding }));
  expect(await transactTerminalDatabase(db => readTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet')))
    .toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
});

it('writes and reads all three kinds directly inside a caller transaction', async () => {
  await transactTerminalDatabase(async db => {
    await writeTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet', branding);
    await writeTerminalReceiptTemplatesInDatabase(db, wallet, 'mainnet', [template]);
    await writeTerminalReportPresetsInDatabase(db, wallet, 'mainnet', [preset]);
    expect(await readTerminalReceiptBrandingInDatabase(db, wallet, 'mainnet')).toEqual(branding);
    expect(await readTerminalReceiptTemplatesInDatabase(db, wallet, 'mainnet')).toEqual([template]);
    expect(await readTerminalReportPresetsInDatabase(db, wallet, 'mainnet')).toEqual([preset]);
  });
});

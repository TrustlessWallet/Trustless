import * as Sharing from 'expo-sharing';
import { buildTerminalItemsCsv, exportTerminalItemsCsv } from '../../services/terminalItemsExport';
import { createTerminalItemPerformanceSnapshot, readTerminalItemPerformancePage, removeTerminalItemPerformanceSnapshot } from '../../services/terminalItemPerformance';

const files: { uri: string; contents: string; exists: boolean; deleted: boolean; close: jest.Mock }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'private-cache' }, FileMode: { WriteOnly: 'w' },
  File: class {
    uri: string; contents = ''; exists = false; deleted = false; close = jest.fn();
    constructor(_cache: string, name: string) { this.uri = `private-cache/${name}`; files.push(this); }
    create() { this.exists = true; }
    open() { return { writeBytes: (bytes: Uint8Array) => { expect(Object.getPrototypeOf(bytes)).toBe(Uint8Array.prototype); this.contents += Buffer.from(bytes).toString('utf8'); }, close: this.close }; }
    delete() { this.exists = false; this.deleted = true; }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/terminalItemPerformance', () => ({
  createTerminalItemPerformanceSnapshot: jest.fn(), readTerminalItemPerformancePage: jest.fn(), removeTerminalItemPerformanceSnapshot: jest.fn(),
}));

const day = new Date(2026, 9, 20, 12);
const options = { walletId: 'wallet-secret', network: 'mainnet' as const, period: 'custom' as const, day,
  customRange: { startDate: '2026-10-19', endDate: '2026-10-20' }, unit: null, sort: 'quantity' as const, isCurrent: () => true };

beforeEach(() => {
  jest.clearAllMocks(); files.length = 0;
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'snapshot-a', totalCount: 0, paidWithoutItems: 3 });
  (readTerminalItemPerformancePage as jest.Mock).mockResolvedValue({ items: [], nextSeq: null });
  (removeTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue(undefined);
});

it('formats exact mixed-unit gross values and formula-safe names with explicit refund treatment', () => {
  const csv = buildTerminalItemsCsv([
    { itemId: '=item', name: '+Latte, "large"\niced', unit: 'USD', quantity: 9007199254740993n, gross: 123456789012345678n },
    { itemId: 'sats-item', name: '@Zap', unit: 'sats', quantity: 2n, gross: 2100000000000001n },
  ], { start: Date.UTC(2026, 9, 19), end: Date.UTC(2026, 9, 21) }, 7);
  expect(csv).toContain('gross_amount,gross_amount_minor,gross_sats,refund_treatment');
  expect(csv).toContain("'=item,\"'+Latte, \"\"large\"\"\niced\",USD,9007199254740993,1234567890123456.78,123456789012345678,,");
  expect(csv).toContain("sats-item,'@Zap,sats,2,2100000000000001,,2100000000000001,");
  expect(csv).toContain('gross_before_refunds_not_allocated');
  expect(csv).toContain('2026-10-19T00:00:00.000Z,2026-10-21T00:00:00.000Z,7');
});

it('streams pages of 100 from one immutable period and names dates and currency without wallet IDs', async () => {
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'fixed', totalCount: 101, paidWithoutItems: 4 });
  (readTerminalItemPerformancePage as jest.Mock)
    .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => ({ itemId: `item-${i}`, name: `Item ${i}`, unit: 'EUR', quantity: 1n, gross: BigInt(i + 1) })), nextSeq: 100 })
    .mockResolvedValueOnce({ items: [{ itemId: 'last', name: 'Last', unit: 'EUR', quantity: 2n, gross: 250n }], nextSeq: null });
  expect(await exportTerminalItemsCsv({ ...options, unit: 'EUR', sort: 'gross' })).toBe(true);
  expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('wallet-secret', 'mainnet', {
    start: new Date(2026, 9, 19).getTime(), end: new Date(2026, 9, 21).getTime(),
  }, { sort: 'gross', unit: 'EUR' });
  expect(readTerminalItemPerformancePage).toHaveBeenNthCalledWith(1, 'fixed', 0, 100);
  expect(readTerminalItemPerformancePage).toHaveBeenNthCalledWith(2, 'fixed', 100, 100);
  expect(files[0].contents.trim().split('\r\n')).toHaveLength(102);
  expect(files[0].uri).toContain('terminal-items-2026-10-19-2026-10-20-EUR-');
  expect(files[0].uri).not.toContain('wallet-secret');
  expect(files[0].deleted).toBe(true);
  expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('fixed');
});

it('cancels stale exports and cleans the snapshot and private file without sharing', async () => {
  let checks = 0;
  expect(await exportTerminalItemsCsv({ ...options, isCurrent: () => ++checks < 4 })).toBe(false);
  expect(files[0].deleted).toBe(true);
  expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('snapshot-a');
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('closes and deletes the file and removes the snapshot after read or sharing errors', async () => {
  (readTerminalItemPerformancePage as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
  await expect(exportTerminalItemsCsv(options)).rejects.toThrow('read failed');
  expect(files[0].close).toHaveBeenCalled();
  expect(files[0].deleted).toBe(true);
  expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledWith('snapshot-a');
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('share cancelled'));
  await expect(exportTerminalItemsCsv(options)).rejects.toThrow('share cancelled');
  expect(files[1].deleted).toBe(true);
  expect(removeTerminalItemPerformanceSnapshot).toHaveBeenCalledTimes(2);
});

it('does not create a snapshot when already stale or sharing is unavailable', async () => {
  expect(await exportTerminalItemsCsv({ ...options, isCurrent: () => false })).toBe(false);
  expect(createTerminalItemPerformanceSnapshot).not.toHaveBeenCalled();
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
  await expect(exportTerminalItemsCsv(options)).rejects.toThrow('Sharing unavailable');
  expect(createTerminalItemPerformanceSnapshot).not.toHaveBeenCalled();
});

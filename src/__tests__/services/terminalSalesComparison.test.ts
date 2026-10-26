import { resetTerminalSqlite } from '../helpers/terminalSqlite';
import { previousTerminalSalesPeriodBounds, terminalSalesPeriodBounds } from '../../services/terminalSalesPeriod';
import { formatTerminalComparisonAmount, getTerminalSalesComparison, terminalComparisonRows } from '../../services/terminalSalesComparison';
import { TerminalSalesSummary, updateTerminalSalePayment } from '../../services/terminalSales';
import { reserveTerminalRefund, updateTerminalRefund } from '../../services/terminalRefunds';

beforeEach(resetTerminalSqlite);
const empty = (): TerminalSalesSummary => ({ activityCount: 0, receivedCount: 0, sats: 0n, bitcoinSats: 0n, fiatMinor: {} });

it('compares local days and rolling weeks without overlapping current boundaries', () => {
  const day = new Date(2026, 0, 2, 12);
  expect(previousTerminalSalesPeriodBounds('today', day)).toEqual({ start: new Date(2026, 0, 1).getTime(), end: new Date(2026, 0, 2).getTime(), shorter: false });
  expect(previousTerminalSalesPeriodBounds('week', day)).toEqual({ start: new Date(2025, 11, 20).getTime(), end: new Date(2025, 11, 27).getTime(), shorter: false });
  expect(previousTerminalSalesPeriodBounds('all', day)).toBeNull();
});

it('compares month-to-date against the same dates last month and discloses clamping', () => {
  expect(previousTerminalSalesPeriodBounds('month', new Date(2024, 2, 31))).toEqual({ start: new Date(2024, 1, 1).getTime(), end: new Date(2024, 2, 1).getTime(), shorter: true });
  expect(previousTerminalSalesPeriodBounds('month', new Date(2026, 0, 15))).toEqual({ start: new Date(2025, 11, 1).getTime(), end: new Date(2025, 11, 16).getTime(), shorter: false });
});

it('counts custom calendar days across DST, leap dates, and the epoch', () => {
  for (const [custom, start, end] of [
    [{ startDate: '2026-03-08', endDate: '2026-03-09' }, new Date(2026, 2, 6), new Date(2026, 2, 8)],
    [{ startDate: '2026-11-01', endDate: '2026-11-02' }, new Date(2026, 9, 30), new Date(2026, 10, 1)],
    [{ startDate: '2024-02-29', endDate: '2024-03-01' }, new Date(2024, 1, 27), new Date(2024, 1, 29)],
    [{ startDate: '1970-01-01', endDate: '1970-01-01' }, new Date(1969, 11, 31), new Date(1970, 0, 1)],
  ] as const) expect(previousTerminalSalesPeriodBounds('custom', new Date(), custom)).toEqual({ start: start.getTime(), end: end.getTime(), shorter: false });
  expect(() => previousTerminalSalesPeriodBounds('custom', new Date(), { startDate: '2026-03-09', endDate: '2026-03-08' })).toThrow();
  const current = terminalSalesPeriodBounds('today', new Date(2026, 2, 9))!;
  expect(previousTerminalSalesPeriodBounds('today', new Date(2026, 2, 9))!.end).toBe(current.start);
});

it('compares each original denomination and completed refunds separately with exact signed deltas', () => {
  const current = { ...empty(), receivedCount: 3, bitcoinSats: 1000n, fiatMinor: { USD: 125n, CHF: 500n } };
  const previous = { ...empty(), receivedCount: 2, bitcoinSats: 2000n, fiatMinor: { USD: 100n, EUR: 900n } };
  expect(terminalComparisonRows(current, 300n, previous, 200n)).toEqual([
    { key: 'count', label: 'Paid sales', previous: '2', change: '+1' },
    { key: 'USD', label: 'USD', previous: '$1.00', change: '+$0.25' },
    { key: 'EUR', label: 'EUR', previous: '€9.00', change: '−€9.00' },
    { key: 'CHF', label: 'CHF', previous: 'CHF 0.00', change: '+CHF 5.00' },
    { key: 'sats', label: 'Sats', previous: '2 000 sats', change: '−1 000 sats' },
    { key: 'refunds', label: 'Refunded', previous: '200 sats', change: '+100 sats' },
  ]);
  expect(terminalComparisonRows(empty(), 0n, empty(), 0n).every(row => row.change === 'No change')).toBe(true);
  expect(formatTerminalComparisonAmount(900719925474099312345n, 'USD')).toBe('$9 007 199 254 740 993 123.45');
});

it('queries observed paid sales and completed refunds independently in the selected wallet and range', async () => {
  const sale = await updateTerminalSalePayment({ id: 'old', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcoldabc', amountSats: 1000, createdAt: 1000, expiresAt: 2000 }, { status: 'received' }, 3000);
  const attempt = await reserveTerminalRefund(sale, { id: 'refund', invoice: 'lnbcrefundabc', amountSats: 200, feeSats: 1, quoteExpiresAt: Date.now() + 60000 });
  await updateTerminalRefund(attempt, { status: 'complete' }, 6000);
  await reserveTerminalRefund(sale, { id: 'pending', invoice: 'lnbcpendingabc', amountSats: 100, feeSats: 1, quoteExpiresAt: Date.now() + 60000 });
  const later = await getTerminalSalesComparison('wallet-a', 'mainnet', { start: 5000, end: 7000 });
  expect(later.summary.receivedCount).toBe(0);
  expect(later.refundedSats).toBe(200n);
  const earlier = await getTerminalSalesComparison('wallet-a', 'mainnet', { start: 3000, end: 5000 });
  expect(earlier.summary.bitcoinSats).toBe(1000n);
  expect(earlier.refundedSats).toBe(0n);
  expect((await getTerminalSalesComparison('wallet-b', 'mainnet', { start: 3000, end: 7000 })).summary.receivedCount).toBe(0);
});

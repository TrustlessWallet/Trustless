import { getTerminalSalesSummary, TerminalSalesSummary } from './terminalSales';
import { getTerminalRefundTotal } from './terminalRefunds';

/** Indexed aggregate queries only; never load previous-period transaction rows. */
export async function getTerminalSalesComparison(walletId: string, network: string, range: { start: number; end: number }) {
  const [summary, refundedSats] = await Promise.all([
    getTerminalSalesSummary(walletId, network, range),
    getTerminalRefundTotal(walletId, network, range),
  ]);
  return { summary, refundedSats };
}

type ComparisonUnit = 'USD' | 'EUR' | 'CHF' | 'sats' | 'count';
export function formatTerminalComparisonAmount(value: bigint, unit: ComparisonUnit): string {
  const digits = value.toString();
  if (unit === 'count' || unit === 'sats') return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${unit === 'sats' ? ' sats' : ''}`;
  const minor = digits.padStart(3, '0');
  const whole = minor.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const prefix = unit === 'USD' ? '$' : unit === 'EUR' ? '€' : 'CHF ';
  return `${prefix}${whole}.${minor.slice(-2)}`;
}

export function terminalComparisonRows(current: TerminalSalesSummary, currentRefunds: bigint, previous: TerminalSalesSummary, previousRefunds: bigint): { key: string; label: string; previous: string; change: string }[] {
  const rows: { key: string; label: string; unit: ComparisonUnit; current: bigint; previous: bigint }[] = [
    { key: 'count', label: 'Paid sales', unit: 'count', current: BigInt(current.receivedCount), previous: BigInt(previous.receivedCount) },
  ];
  for (const currency of ['USD', 'EUR', 'CHF'] as const) {
    const amount = current.fiatMinor[currency] ?? 0n;
    const baseline = previous.fiatMinor[currency] ?? 0n;
    if (amount || baseline) rows.push({ key: currency, label: currency, unit: currency, current: amount, previous: baseline });
  }
  if (current.bitcoinSats || previous.bitcoinSats) rows.push({ key: 'sats', label: 'Sats', unit: 'sats', current: current.bitcoinSats, previous: previous.bitcoinSats });
  rows.push({ key: 'refunds', label: 'Refunded', unit: 'sats', current: currentRefunds, previous: previousRefunds });
  return rows.map(row => {
    const delta = row.current - row.previous;
    return { key: row.key, label: row.label, previous: formatTerminalComparisonAmount(row.previous, row.unit),
      change: delta === 0n ? 'No change' : `${delta > 0n ? '+' : '−'}${formatTerminalComparisonAmount(delta < 0n ? -delta : delta, row.unit)}` };
  });
}

export type SalesPeriod = 'today' | 'week' | 'month' | 'all';

/** Local calendar bounds, inclusive at the start and exclusive at the end. */
export function terminalSalesPeriodBounds(period: SalesPeriod, day: Date): { start: number; end: number } | null {
  if (!(day instanceof Date) || !Number.isFinite(day.getTime())) throw new Error('Invalid sales period date.');
  if (period !== 'today' && period !== 'week' && period !== 'month' && period !== 'all') {
    throw new Error('Invalid sales period.');
  }
  if (period === 'all') return null;

  const start = new Date(day.getTime());
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  if (period === 'week') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(1);

  const bounds = { start: start.getTime(), end: end.getTime() };
  if (!Number.isFinite(bounds.start) || !Number.isFinite(bounds.end)) throw new Error('Invalid sales period date.');
  return bounds;
}

export function isInTerminalSalesPeriod(timestamp: number, period: SalesPeriod, day: Date): boolean {
  if (!Number.isFinite(timestamp)) throw new Error('Invalid sales timestamp.');
  const bounds = terminalSalesPeriodBounds(period, day);
  return bounds === null || (timestamp >= bounds.start && timestamp < bounds.end);
}

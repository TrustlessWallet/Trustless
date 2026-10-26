export type SalesPeriod = 'today' | 'week' | 'month' | 'all' | 'custom';
export type CustomSalesDateRange = Readonly<{ startDate: string; endDate: string }>;

/** Parse a calendar date locally; UTC string parsing would shift the selected day. */
export function parseSalesDate(value: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid sales date.');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1970 || year > 9999) throw new Error('Invalid sales date.');
  const result = new Date(year, month - 1, day);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new Error('Invalid sales date.');
  }
  return result;
}

export function localSalesDateKey(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getFullYear() < 1970 || value.getFullYear() > 9999) {
    throw new Error('Invalid sales date.');
  }
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Inclusive local start day and exclusive midnight after the inclusive end day. */
export function terminalSalesPeriodBounds(period: SalesPeriod, day: Date, customRange?: CustomSalesDateRange): { start: number; end: number } | null {
  if (!(day instanceof Date) || !Number.isFinite(day.getTime())) throw new Error('Invalid sales period date.');
  if (!['today', 'week', 'month', 'all', 'custom'].includes(period)) throw new Error('Invalid sales period.');
  if (period === 'all') return null;
  if (period === 'custom') {
    const start = parseSalesDate(customRange?.startDate as string);
    const last = parseSalesDate(customRange?.endDate as string);
    if (start.getTime() > last.getTime()) throw new Error('End date must be on or after start date.');
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    return { start: start.getTime(), end: end.getTime() };
  }
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

export function isInTerminalSalesPeriod(timestamp: number, period: SalesPeriod, day: Date, customRange?: CustomSalesDateRange): boolean {
  if (!Number.isFinite(timestamp)) throw new Error('Invalid sales timestamp.');
  const bounds = terminalSalesPeriodBounds(period, day, customRange);
  return bounds === null || (timestamp >= bounds.start && timestamp < bounds.end);
}

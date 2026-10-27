import { Buffer } from 'buffer';
import { File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { TerminalNetwork } from './terminal';
import {
  createTerminalItemPerformanceSnapshot, ItemSort, ItemUnit, readTerminalItemPerformancePage,
  removeTerminalItemPerformanceSnapshot, TerminalItemPerformanceRow,
} from './terminalItemPerformance';
import { CustomSalesDateRange, localSalesDateKey, SalesPeriod, terminalSalesPeriodBounds } from './terminalSalesPeriod';

type ExportOptions = {
  walletId: string;
  network: TerminalNetwork;
  period: SalesPeriod;
  day: Date;
  customRange?: CustomSalesDateRange;
  unit: ItemUnit | null;
  sort: ItemSort;
  isCurrent: () => boolean;
};

const columns = [
  'item_id', 'item_name', 'currency', 'quantity', 'gross_amount', 'gross_amount_minor', 'gross_sats',
  'refund_treatment', 'period_start_utc', 'period_end_exclusive_utc',
  'paid_sales_without_item_details_all_currencies',
] as const;

const safeText = (value: string) => /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
const cell = (value: string | number | bigint) => {
  const text = typeof value === 'string' ? safeText(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const grossAmount = (gross: bigint, unit: ItemUnit) => {
  if (unit === 'sats') return gross.toString();
  const digits = gross.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
const utc = (timestamp: number | undefined) => timestamp === undefined ? '' : new Date(timestamp).toISOString();

export function buildTerminalItemsCsv(
  items: readonly TerminalItemPerformanceRow[],
  range: { start: number; end: number } | null,
  paidWithoutItems: number,
): string {
  const start = utc(range?.start), end = utc(range?.end);
  const rows = items.map(item => [
    item.itemId, item.name, item.unit, item.quantity, grossAmount(item.gross, item.unit),
    item.unit === 'sats' ? '' : item.gross, item.unit === 'sats' ? item.gross : '',
    'gross_before_refunds_not_allocated', start, end, paidWithoutItems,
  ].map(cell).join(','));
  return [columns.join(','), ...rows].join('\r\n') + '\r\n';
}

export async function exportTerminalItemsCsv({ walletId, network, period, day, customRange, unit, sort, isCurrent }: ExportOptions): Promise<boolean> {
  const reportDay = new Date(day.getTime());
  const selectedDates = customRange ? { startDate: customRange.startDate, endDate: customRange.endDate } : undefined;
  const range = terminalSalesPeriodBounds(period, reportDay, selectedDates);
  if (!isCurrent()) return false;
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable on this device.');
  if (!isCurrent()) return false;
  const snapshot = await createTerminalItemPerformanceSnapshot(walletId, network, range, { sort, unit });
  let file: File | undefined;
  let handle: ReturnType<File['open']> | undefined;
  try {
    if (!isCurrent()) return false;
    const datePart = range
      ? `${localSalesDateKey(new Date(range.start))}-${localSalesDateKey(new Date(range.end - 1))}`
      : 'all-dates';
    const unitPart = unit ?? 'all-currencies';
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    file = new File(Paths.cache, `trustless-terminal-items-${datePart}-${unitPart}-${stamp}.csv`);
    file.create();
    handle = file.open(FileMode.WriteOnly);
    handle.writeBytes(Uint8Array.from(Buffer.from(columns.join(',') + '\r\n', 'utf8')));
    let afterSeq = 0;
    while (true) {
      if (!isCurrent()) return false;
      const page = await readTerminalItemPerformancePage(snapshot.token, afterSeq, 100);
      if (!isCurrent()) return false;
      if (page.items.length) {
        const body = buildTerminalItemsCsv(page.items, range, snapshot.paidWithoutItems).slice(columns.join(',').length + 2);
        handle.writeBytes(Uint8Array.from(Buffer.from(body, 'utf8')));
      }
      if (page.nextSeq === null) break;
      if (page.nextSeq <= afterSeq) throw new Error('Invalid Terminal item export cursor.');
      afterSeq = page.nextSeq;
    }
    handle.close(); handle = undefined;
    if (!isCurrent()) return false;
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export Terminal items', UTI: 'public.comma-separated-values-text' });
    return true;
  } finally {
    try { handle?.close(); } catch { /* Continue cleanup after a stream failure. */ }
    try { if (file?.exists) file.delete(); } catch { /* Cache cleanup is best effort. */ }
    await removeTerminalItemPerformanceSnapshot(snapshot.token).catch(() => {});
  }
}

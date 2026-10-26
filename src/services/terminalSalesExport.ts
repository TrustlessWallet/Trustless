import { File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatFiatMinor, TerminalFiatQuote, TerminalNetwork } from './terminal';
import { TerminalReportingRate } from './terminalRates';
import { isTerminalSale, TerminalSale } from './terminalSales';
import { isTerminalRefundAttempt, TerminalRefundAttempt } from './terminalRefunds';
import { Buffer } from 'buffer';
import { createTerminalExportSnapshot, readTerminalExportPage, removeTerminalExportSnapshot } from './terminalDatabase';
import { isInTerminalSalesPeriod, CustomSalesDateRange, SalesPeriod, terminalSalesPeriodBounds } from './terminalSalesPeriod';

export type SalesExportPeriod = SalesPeriod;
type ExportOptions = {
  walletId: string;
  network: TerminalNetwork;
  period: SalesExportPeriod;
  day: Date;
  customRange?: CustomSalesDateRange;
  isCurrent: () => boolean;
};

const columns = [
  'record_type', 'record_id', 'sale_id', 'status', 'network',
  'created_at_utc', 'status_observed_at_utc', 'received_observed_at_utc',
  'amount_sats', 'quoted_fee_sats', 'input_unit', 'fiat_currency', 'fiat_amount', 'fiat_amount_minor', 'payment_id',
  'btc_fiat_rate', 'rate_fetched_at_utc', 'rate_currency', 'rate_status', 'rate_source',
] as const;

const utc = (timestamp?: number) => timestamp === undefined ? '' : new Date(timestamp).toISOString();
function rateFields(reportingRate: TerminalReportingRate | null | undefined, fiat?: TerminalFiatQuote): (string | number)[] {
  if (reportingRate) return [reportingRate.rate, utc(reportingRate.fetchedAt), reportingRate.currency, reportingRate.status, reportingRate.source];
  if (reportingRate === null) return ['', '', '', 'unavailable', ''];
  if (fiat) return [fiat.rate, utc(fiat.fetchedAt), fiat.currency, 'quoted', 'coinbase'];
  return ['', '', '', 'not_recorded', ''];
}
const safeText = (value: string) => /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
const cell = (value: string | number) => {
  const text = typeof value === 'string' ? safeText(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function buildTerminalSalesCsv(sales: readonly TerminalSale[], refunds: readonly TerminalRefundAttempt[], period: SalesExportPeriod, day: Date, customRange?: CustomSalesDateRange): string {
  terminalSalesPeriodBounds(period, day, customRange);
  const records = [
    ...sales.filter(sale => isInTerminalSalesPeriod(sale.receivedAt ?? sale.request.createdAt, period, day, customRange)).map(sale => ({
      time: sale.receivedAt ?? sale.request.createdAt,
      fields: [
        'sale', sale.request.id, sale.request.id, sale.status, sale.request.network,
        utc(sale.request.createdAt), utc(sale.updatedAt), utc(sale.receivedAt),
        sale.request.amountSats, '', sale.request.fiat?.currency ?? sale.request.inputUnit ?? 'sats',
        sale.request.fiat?.currency ?? '', sale.request.fiat ? formatFiatMinor(sale.request.fiat.amountMinor) : '', sale.request.fiat?.amountMinor ?? '', sale.paymentId ?? '',
        ...rateFields(sale.request.reportingRate, sale.request.fiat),
      ],
    })),
    ...refunds.filter(refund => isInTerminalSalesPeriod(refund.updatedAt, period, day, customRange)).map(refund => ({
      time: refund.updatedAt,
      fields: [
        'refund', refund.id, refund.saleId, refund.status, refund.network,
        utc(refund.createdAt), utc(refund.updatedAt), '', refund.amountSats, refund.feeSats,
        'sats', '', '', '', refund.paymentId ?? '', ...rateFields(refund.reportingRate),
      ],
    })),
  ].sort((a, b) => b.time - a.time || String(a.fields[1]).localeCompare(String(b.fields[1])));
  return [columns.join(','), ...records.map(record => record.fields.map(cell).join(','))].join('\r\n') + '\r\n';
}

export async function exportTerminalSalesCsv({ walletId, network, period, day, customRange, isCurrent }: ExportOptions): Promise<boolean> {
  const reportDay = new Date(day.getTime());
  const selectedDates = customRange ? { startDate: customRange.startDate, endDate: customRange.endDate } : undefined;
  const range = terminalSalesPeriodBounds(period, reportDay, selectedDates);
  if (!isCurrent()) return false;
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable on this device.');
  if (!isCurrent()) return false;
  // Copy the selected ledger atomically in SQLite, then release its transaction.
  // Payments can continue while the fixed snapshot is streamed into a CSV file.
  const token = await createTerminalExportSnapshot(walletId, network, range);
  let file: File | undefined;
  let handle: ReturnType<File['open']> | undefined;
  try {
    if (!isCurrent()) return false;
    const localDate = `${reportDay.getFullYear()}-${String(reportDay.getMonth() + 1).padStart(2, '0')}-${String(reportDay.getDate()).padStart(2, '0')}`;
    const dates = period === 'custom' ? `${selectedDates!.startDate}-${selectedDates!.endDate}-` : period === 'all' ? '' : `${localDate}-`;
    const stamp = `${dates}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    file = new File(Paths.cache, `trustless-terminal-${period}-${stamp}.csv`);
    file.create();
    handle = file.open(FileMode.WriteOnly);
    handle.writeBytes(Uint8Array.from(Buffer.from(columns.join(',') + '\r\n', 'utf8')));
    let afterSeq = 0;
    while (true) {
      if (!isCurrent()) return false;
      const page = await readTerminalExportPage(token, afterSeq, 100);
      if (!isCurrent()) return false;
      const parts: string[] = [];
      for (const row of page.rows) {
        const record: unknown = JSON.parse(row.payload);
        if (row.kind === 'sale' && isTerminalSale(record, walletId, network)) {
          parts.push(buildTerminalSalesCsv([record], [], 'all', day).slice(columns.join(',').length + 2));
        } else if (row.kind === 'refund' && isTerminalRefundAttempt(record, walletId, network)) {
          parts.push(buildTerminalSalesCsv([], [record], 'all', day).slice(columns.join(',').length + 2));
        } else throw new Error('Saved Terminal export record is invalid.');
      }
      if (parts.length) handle.writeBytes(Uint8Array.from(Buffer.from(parts.join(''), 'utf8')));
      if (page.nextSeq === null) break;
      if (page.nextSeq <= afterSeq) throw new Error('Invalid Terminal export cursor.');
      afterSeq = page.nextSeq;
    }
    handle.close(); handle = undefined;
    if (!isCurrent()) return false;
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export Terminal sales', UTI: 'public.comma-separated-values-text' });
    return true;
  } finally {
    try { handle?.close(); } catch { /* Continue cleanup even if the file handle failed. */ }
    try { if (file?.exists) file.delete(); } catch { /* Cache cleanup is best effort after sharing. */ }
    await removeTerminalExportSnapshot(token).catch(() => {}); // Abandoned snapshots are also cleared on database open.
  }
}

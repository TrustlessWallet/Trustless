import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatFiatMinor, TerminalFiatQuote, TerminalNetwork } from './terminal';
import { TerminalReportingRate } from './terminalRates';
import { listTerminalSales, TerminalSale } from './terminalSales';
import { listTerminalRefunds, TerminalRefundAttempt } from './terminalRefunds';
import { isInTerminalSalesPeriod, SalesPeriod, terminalSalesPeriodBounds } from './terminalSalesPeriod';

export type SalesExportPeriod = SalesPeriod;
type ExportOptions = {
  walletId: string;
  network: TerminalNetwork;
  period: SalesExportPeriod;
  day: Date;
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

export function buildTerminalSalesCsv(sales: readonly TerminalSale[], refunds: readonly TerminalRefundAttempt[], period: SalesExportPeriod, day: Date): string {
  terminalSalesPeriodBounds(period, day);
  const records = [
    ...sales.filter(sale => isInTerminalSalesPeriod(sale.receivedAt ?? sale.request.createdAt, period, day)).map(sale => ({
      time: sale.receivedAt ?? sale.request.createdAt,
      fields: [
        'sale', sale.request.id, sale.request.id, sale.status, sale.request.network,
        utc(sale.request.createdAt), utc(sale.updatedAt), utc(sale.receivedAt),
        sale.request.amountSats, '', sale.request.fiat?.currency ?? sale.request.inputUnit ?? 'sats',
        sale.request.fiat?.currency ?? '', sale.request.fiat ? formatFiatMinor(sale.request.fiat.amountMinor) : '', sale.request.fiat?.amountMinor ?? '', sale.paymentId ?? '',
        ...rateFields(sale.request.reportingRate, sale.request.fiat),
      ],
    })),
    ...refunds.filter(refund => isInTerminalSalesPeriod(refund.updatedAt, period, day)).map(refund => ({
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

export async function exportTerminalSalesCsv({ walletId, network, period, day, isCurrent }: ExportOptions): Promise<boolean> {
  // Read both journals at export time. If either is unreadable, no partial ledger is shared.
  const [sales, refunds] = await Promise.all([listTerminalSales(walletId, network), listTerminalRefunds(walletId, network)]);
  if (!isCurrent()) return false;
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable on this device.');
  if (!isCurrent()) return false;
  const csv = buildTerminalSalesCsv(sales, refunds, period, day);
  const localDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const stamp = `${period === 'all' ? '' : `${localDate}-`}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const file = new File(Paths.cache, `trustless-terminal-${period}-${stamp}.csv`);
  try {
    if (!isCurrent()) return false;
    file.write(csv);
    if (!isCurrent()) return false;
    await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export Terminal sales', UTI: 'public.comma-separated-values-text' });
    return true;
  } finally {
    try { if (file.exists) file.delete(); } catch { /* Sharing has already finished; cache cleanup is best effort. */ }
  }
}

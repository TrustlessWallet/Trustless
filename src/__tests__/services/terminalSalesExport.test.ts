import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sharing from 'expo-sharing';
import { buildTerminalSalesCsv, exportTerminalSalesCsv } from '../../services/terminalSalesExport';
import { TerminalSale } from '../../services/terminalSales';
import { TerminalRefundAttempt } from '../../services/terminalRefunds';

const mockFiles: { uri: string; contents: string; exists: boolean; deleted: boolean }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'private-cache' },
  File: class {
    uri: string;
    contents = '';
    exists = false;
    deleted = false;
    constructor(_cache: string, name: string) { this.uri = `private-cache/${name}`; mockFiles.push(this); }
    write(value: string) { this.contents = value; this.exists = true; }
    delete() { this.exists = false; this.deleted = true; }
  },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const day = new Date(2026, 9, 20, 12);
const today = day.getTime();
const yesterday = today - 24 * 60 * 60 * 1000;
const sale = (id: string, createdAt: number, receivedAt?: number): TerminalSale => ({
  request: {
    id, walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcsensitiveinvoice', amountSats: 2500,
    createdAt, expiresAt: createdAt + 60000,
    fiat: { currency: 'USD', amountMinor: 250, rate: '100000', fetchedAt: createdAt },
  },
  status: receivedAt ? 'received' : 'unknown',
  ...(receivedAt ? { receivedAt, paymentId: '+SUM(1,1)' } : {}),
  updatedAt: receivedAt ?? createdAt,
});
const refund = (updatedAt: number): TerminalRefundAttempt => ({
  id: '@refund', walletId: 'wallet-a', network: 'mainnet', saleId: '=sale', saleInvoice: 'lnbcsensitiveinvoice',
  invoice: 'lnbcsensitiverefund', amountSats: 500, feeSats: 12, quoteExpiresAt: today + 60000,
  createdAt: yesterday, updatedAt, status: 'complete', paymentId: '-payment',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockFiles.length = 0;
  (Sharing.isAvailableAsync as jest.Mock).mockReset().mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockReset().mockResolvedValue(undefined);
});

it('exports separate raw sale and refund rows for the selected local day, with safe textual references', () => {
  const csv = buildTerminalSalesCsv([sale('=sale', yesterday, today), sale('old', yesterday)], [refund(today)], 'today', day);
  const lines = csv.trim().split('\r\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('status_observed_at_utc,received_observed_at_utc,amount_sats,quoted_fee_sats');
  expect(csv).toContain("sale,'=sale,'=sale,received,mainnet");
  expect(csv).toContain("refund,'@refund,'=sale,complete,mainnet");
  expect(csv).toContain('2500,,USD,USD,2.50,250');
  expect(csv).toContain('500,12,sats');
  expect(lines.find(line => line.startsWith("refund,'@refund"))).not.toContain('USD,250');
  expect(csv).toContain("'+SUM(1,1)");
  expect(csv).toContain("'-payment");
  expect(csv).not.toContain('lnbcsensitive');
  expect(buildTerminalSalesCsv([sale('old', yesterday)], [refund(yesterday)], 'today', day).trim().split('\r\n')).toHaveLength(1);
  expect(buildTerminalSalesCsv([sale('old', yesterday)], [refund(yesterday)], 'all', day).trim().split('\r\n')).toHaveLength(3);
});

it('quotes commas, quotes, and line breaks while neutralizing formula-like references', () => {
  const csv = buildTerminalSalesCsv([sale('=HYPERLINK("a,b")\nnext', today)], [], 'all', day);
  expect(csv).toContain('"\'=HYPERLINK(""a,b"")\nnext"');
});

it('filters week and month by observed sale and refund times, excluding future records', () => {
  const at = (month: number, date: number, hour = 12) => new Date(2026, month, date, hour).getTime();
  const sales = [
    sale('late-received', at(8, 30), at(9, 15)),
    sale('month-only', at(9, 2)),
    sale('before-month', at(8, 30)),
    sale('future-received', at(9, 19), at(9, 21)),
  ];
  const refunds = [refund(at(9, 16)), { ...refund(at(9, 3)), id: 'month-refund' }, { ...refund(at(9, 21)), id: 'future-refund' }];
  const weekCsv = buildTerminalSalesCsv(sales, refunds, 'week', day);
  expect(weekCsv).toContain('late-received');
  expect(weekCsv).toContain("'@refund");
  expect(weekCsv).not.toContain('month-only');
  expect(weekCsv).not.toContain('month-refund');
  expect(weekCsv).not.toContain('before-month');
  expect(weekCsv).not.toContain('future-received');
  expect(weekCsv).not.toContain('future-refund');
  const monthCsv = buildTerminalSalesCsv(sales, refunds, 'month', day);
  expect(monthCsv).toContain('late-received');
  expect(monthCsv).toContain('month-only');
  expect(monthCsv).toContain('month-refund');
  expect(monthCsv).not.toContain('before-month');
  expect(monthCsv).not.toContain('future-received');
  expect(monthCsv).not.toContain('future-refund');
});

it('reads both journals before sharing, uses a unique private CSV file, and deletes it after sharing', async () => {
  const request = sale('one', today).request;
  await AsyncStorage.setItem('@terminalSales:v1:mainnet:wallet-a', JSON.stringify({ version: 1, sales: [{ request, status: 'unknown', updatedAt: today }] }));
  await AsyncStorage.setItem('@terminalRefunds:v1:mainnet:wallet-a', JSON.stringify({ version: 1, attempts: [] }));
  const options = { walletId: 'wallet-a', network: 'mainnet' as const, period: 'all' as const, day, isCurrent: () => true };
  expect(await exportTerminalSalesCsv(options)).toBe(true);
  expect(await exportTerminalSalesCsv(options)).toBe(true);
  expect(mockFiles).toHaveLength(2);
  expect(mockFiles[0].uri).not.toBe(mockFiles[1].uri);
  expect(mockFiles.every(file => file.deleted && !file.exists && file.contents.includes('one'))).toBe(true);
  expect(Sharing.shareAsync).toHaveBeenCalledWith(mockFiles[0].uri, expect.objectContaining({ mimeType: 'text/csv' }));
  expect(await exportTerminalSalesCsv({ ...options, period: 'today' })).toBe(true);
  expect(mockFiles[2].uri).toContain('terminal-today-2026-10-20-');
  expect(await exportTerminalSalesCsv({ ...options, period: 'week' })).toBe(true);
  expect(mockFiles[3].uri).toContain('terminal-week-2026-10-20-');
  expect(await exportTerminalSalesCsv({ ...options, period: 'month' })).toBe(true);
  expect(mockFiles[4].uri).toContain('terminal-month-2026-10-20-');
});

it('fails closed on unreadable refunds and never shares a stale scope', async () => {
  const request = sale('one', today).request;
  await AsyncStorage.setItem('@terminalSales:v1:mainnet:wallet-a', JSON.stringify({ version: 1, sales: [{ request, status: 'unknown', updatedAt: today }] }));
  await AsyncStorage.setItem('@terminalRefunds:v1:mainnet:wallet-a', '{broken');
  const options = { walletId: 'wallet-a', network: 'mainnet' as const, period: 'all' as const, day, isCurrent: () => true };
  await expect(exportTerminalSalesCsv(options)).rejects.toThrow();
  expect(mockFiles).toHaveLength(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await AsyncStorage.setItem('@terminalRefunds:v1:mainnet:wallet-a', JSON.stringify({ version: 1, attempts: [] }));
  expect(await exportTerminalSalesCsv({ ...options, isCurrent: () => false })).toBe(false);
  expect(mockFiles).toHaveLength(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('deletes a temporary CSV when sharing fails', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('cancelled'));
  await expect(exportTerminalSalesCsv({ walletId: 'wallet-a', network: 'mainnet', period: 'all', day, isCurrent: () => true })).rejects.toThrow('cancelled');
  expect(mockFiles[0].deleted).toBe(true);
});


it('exports the original charge in normal decimal fiat units without recalculating exchange rates', () => {
  for (const [currency, amountMinor, expected] of [
    ['USD', 1250, '12.50'], ['EUR', 1, '0.01'], ['CHF', 100000, '1000.00'],
  ] as const) {
    const original = sale(currency, today);
    const csv = buildTerminalSalesCsv([{ ...original, request: { ...original.request, amountSats: amountMinor * 10, fiat: { ...original.request.fiat!, currency, amountMinor } } }], [], 'all', day);
    expect(csv.split('\r\n')[0]).toContain('fiat_currency,fiat_amount,fiat_amount_minor');
    expect(csv).toContain(`${currency},${expected},${amountMinor},`);
  }
  const original = sale('sats-only', today);
  const csv = buildTerminalSalesCsv([{ ...original, request: { ...original.request, fiat: undefined } }], [refund(today)], 'all', day);
  for (const row of csv.trim().split('\r\n').slice(1)) expect(row.split(',')).toHaveLength(20);
});

it('exports the exact saved BTC-to-fiat rate and its fetch time per sale', () => {
  const originals = [
    { ...sale('usd-rate', today), request: { ...sale('usd-rate', today).request,
      fiat: { currency: 'USD' as const, amountMinor: 250, rate: '98765.123456789012345678', fetchedAt: today - 45000 } } },
    { ...sale('eur-rate', today), request: { ...sale('eur-rate', today).request,
      fiat: { currency: 'EUR' as const, amountMinor: 250, rate: '85432.10', fetchedAt: today - 15000 } } },
    { ...sale('sats-rate', today), request: { ...sale('sats-rate', today).request, fiat: undefined, inputUnit: 'sats' as const } },
  ];
  const lines = buildTerminalSalesCsv(originals, [{ ...refund(today), id: 'plain-refund', saleId: 'usd-rate', paymentId: 'payment' }], 'all', day).trim().split('\r\n');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(line => Object.fromEntries(line.split(',').map((value, index) => [header[index], value])));
  const usd = rows.find(row => row.record_id === 'usd-rate')!;
  expect(usd.btc_fiat_rate).toBe('98765.123456789012345678');
  expect(usd.rate_fetched_at_utc).toBe(new Date(today - 45000).toISOString());
  const eur = rows.find(row => row.record_id === 'eur-rate')!;
  expect(eur.btc_fiat_rate).toBe('85432.10');
  expect(eur.rate_fetched_at_utc).toBe(new Date(today - 15000).toISOString());
  for (const id of ['sats-rate', 'plain-refund']) {
    const row = rows.find(row => row.record_id === id)!;
    expect(row.btc_fiat_rate).toBe('');
    expect(row.rate_fetched_at_utc).toBe('');
  }
  for (const line of lines) expect(line.split(',')).toHaveLength(20);
});

it('exports recorded rates for fiat, BTC and sats sales and refunds without changing charge fields', () => {
  const reporting = { currency: 'CHF' as const, rate: '91234.56', fetchedAt: today - 1000,
    source: 'coinbase' as const, status: 'stale' as const };
  const original = sale('fiat-new', today);
  const records: TerminalSale[] = [
    { ...original, request: { ...original.request, reportingRate: reporting } },
    { ...sale('btc-new', today), request: { ...sale('btc-new', today).request, fiat: undefined, inputUnit: 'BTC', reportingRate: reporting } },
    { ...sale('sats-unavailable', today), request: { ...sale('sats-unavailable', today).request, fiat: undefined, inputUnit: 'sats', reportingRate: null } },
    { ...sale('legacy-fiat', today) },
  ];
  const refunds = [{ ...refund(today), id: 'refund-new', reportingRate: reporting },
    { ...refund(today), id: 'refund-unavailable', reportingRate: null }];
  const lines = buildTerminalSalesCsv(records, refunds, 'all', day).trim().split('\r\n');
  const header = lines[0].split(',');
  const rows = lines.slice(1).map(line => Object.fromEntries(line.split(',').map((value, index) => [header[index], value])));
  for (const id of ['fiat-new', 'btc-new', 'refund-new']) {
    const row = rows.find(item => item.record_id === id)!;
    expect([row.btc_fiat_rate, row.rate_currency, row.rate_status, row.rate_source]).toEqual(['91234.56', 'CHF', 'stale', 'coinbase']);
    expect(row.rate_fetched_at_utc).toBe(new Date(today - 1000).toISOString());
  }
  expect(rows.find(item => item.record_id === 'fiat-new')?.fiat_amount).toBe('2.50');
  expect(rows.find(item => item.record_id === 'btc-new')?.input_unit).toBe('BTC');
  expect(rows.find(item => item.record_id === 'refund-new')?.fiat_amount).toBe('');
  for (const id of ['sats-unavailable', 'refund-unavailable']) {
    const row = rows.find(item => item.record_id === id)!;
    expect([row.btc_fiat_rate, row.rate_currency, row.rate_status, row.rate_source]).toEqual(['', '', 'unavailable', '']);
  }
  expect(rows.find(item => item.record_id === 'legacy-fiat')?.rate_status).toBe('quoted');
  expect(rows.find(item => item.record_id === 'legacy-fiat')?.rate_source).toBe('coinbase');
});

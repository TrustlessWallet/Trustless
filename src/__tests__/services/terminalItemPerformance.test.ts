import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetTerminalSqlite } from '../helpers/terminalSqlite';
import { getTerminalDatabase } from '../../services/terminalDatabase';
import { getTerminalItemPerformance } from '../../services/terminalItemPerformance';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import { reserveTerminalRefund, updateTerminalRefund } from '../../services/terminalRefunds';
import { saveTerminalItem, deleteTerminalItem } from '../../services/terminalItems';
import { satsFromFiat, TerminalRequest, TerminalUnit } from '../../services/terminal';

type Line = { itemId: string; name: string; unitPrice: number; quantity: number; total: number };
const line = (itemId = 'tea', name = 'Tea', quantity = 1, price = 100): Line => ({ itemId, name, quantity, unitPrice: price, total: quantity * price });
function request(id: string, lines?: Line[], unit: TerminalUnit = 'sats', walletId = 'wallet-a'): TerminalRequest {
  const total = lines?.reduce((sum, row) => sum + row.total, 0) ?? 1000;
  const fiat = unit === 'USD' || unit === 'EUR' || unit === 'CHF';
  const rate = total > 1e12 ? '1000000000' : '100000';
  return { id, walletId, network: 'mainnet', invoice: `lnbc${id}abc`, createdAt: 1000, expiresAt: 2000,
    amountSats: fiat ? satsFromFiat(total, rate) : total,
    ...(fiat ? { fiat: { currency: unit, amountMinor: total, rate, fetchedAt: 1000 } } : { inputUnit: unit }),
    ...(lines ? { basket: { unit, total, lines } } : {}),
  };
}
beforeEach(async () => { await resetTerminalSqlite(); await AsyncStorage.clear(); });

it('merges renamed snapshots by ID, keeps deleted products, and distinguishes same-name IDs', async () => {
  await updateTerminalSalePayment(request('old', [line('tea', 'Old tea', 2)]), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('new', [line('tea', 'Tea renamed')]), { status: 'received' }, 4000);
  await updateTerminalSalePayment(request('other', [line('other', 'Tea renamed')]), { status: 'received' }, 4000);
  await saveTerminalItem('wallet-a', 'mainnet', { id: 'tea', name: 'Catalog-only name', unit: 'sats', unitPrice: 900 }, () => true);
  await deleteTerminalItem('wallet-a', 'mainnet', 'tea', () => true);
  const report = await getTerminalItemPerformance('wallet-a', 'mainnet', null);
  expect(report.items).toEqual([
    { itemId: 'tea', name: 'Tea renamed', unit: 'sats', quantity: 3n, gross: 300n },
    { itemId: 'other', name: 'Tea renamed', unit: 'sats', quantity: 1n, gross: 100n },
  ]);
  expect((await getTerminalItemPerformance('wallet-a', 'mainnet', { start: 3000, end: 4000 })).items[0].name).toBe('Old tea');
});

it('retains original denomination and line totals, combining BTC and sats only in sats', async () => {
  await updateTerminalSalePayment(request('usd', [line('tea', 'Tea', 2, 150), line('cake', 'Cake', 1, 200)], 'USD'), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('eur', [line()], 'EUR'), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('chf', [line()], 'CHF'), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('btc', [line()], 'BTC'), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('sats', [line()]), { status: 'received' }, 3000);
  const report = await getTerminalItemPerformance('wallet-a', 'mainnet', null);
  expect(report.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ itemId: 'tea', unit: 'USD', quantity: 2n, gross: 300n }),
    expect.objectContaining({ itemId: 'cake', unit: 'USD', quantity: 1n, gross: 200n }),
    expect.objectContaining({ itemId: 'tea', unit: 'EUR', quantity: 1n, gross: 100n }),
    expect.objectContaining({ itemId: 'tea', unit: 'CHF', quantity: 1n, gross: 100n }),
    expect.objectContaining({ itemId: 'tea', unit: 'sats', quantity: 2n, gross: 200n }),
  ]));
});

it('leaves fully and partially refunded gross item quantities intact', async () => {
  const sale = await updateTerminalSalePayment(request('paid', [line('tea', 'Tea', 2, 500)]), { status: 'received' }, 3000);
  const quote = (id: string, amountSats: number) => ({ id, invoice: `lnbc${id}abc`, amountSats, feeSats: 1, quoteExpiresAt: Date.now() + 60000 });
  const refund = await reserveTerminalRefund(sale, quote('partial', 300));
  await updateTerminalRefund(refund, { status: 'complete' }, 5000);
  expect((await getTerminalItemPerformance('wallet-a', 'mainnet', null)).items[0]).toMatchObject({ quantity: 2n, gross: 1000n });
  const rest = await reserveTerminalRefund(sale, quote('rest', 700));
  await updateTerminalRefund(rest, { status: 'complete' }, 6000);
  expect((await getTerminalItemPerformance('wallet-a', 'mainnet', null)).items[0]).toMatchObject({ quantity: 2n, gross: 1000n });
});

it('uses scoped paid observation boundaries and reports no-basket coverage separately', async () => {
  await recordTerminalSale(request('unpaid', [line('ignored', 'Unpaid', 99)]));
  await updateTerminalSalePayment(request('pending', [line('pending', 'Pending', 99)]), { status: 'pending' }, 3000);
  await updateTerminalSalePayment(request('otherwallet', [line()], 'sats', 'wallet-b'), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('inside', [line()]), { status: 'received' }, 3000);
  await updateTerminalSalePayment(request('edge', [line('excluded')]), { status: 'received' }, 4000);
  await updateTerminalSalePayment(request('manual'), { status: 'received' }, 3000);
  const report = await getTerminalItemPerformance('wallet-a', 'mainnet', { start: 3000, end: 4000 });
  expect(report.items).toHaveLength(1);
  expect(report.items[0].itemId).toBe('tea');
  expect(report.paidWithoutItems).toBe(1);
  expect(report.hasMore).toBe(false);
  expect((await getTerminalItemPerformance('wallet-a', 'testnet', null)).items).toEqual([]);
  await expect(getTerminalItemPerformance('wallet-a', 'mainnet', { start: 4000, end: 3000 })).rejects.toThrow();
});

it('keeps huge gross totals exact and top-five ties deterministic without returning history', async () => {
  for (const id of ['hugea', 'hugeb']) await updateTerminalSalePayment(request(id, [line('huge', 'Huge', 1, Number.MAX_SAFE_INTEGER)]), { status: 'received' }, 3000);
  for (const id of ['f', 'e', 'd', 'c', 'b', 'a']) await updateTerminalSalePayment(request(id, [line(id, id, 2)]), { status: 'received' }, 3000);
  const report = await getTerminalItemPerformance('wallet-a', 'mainnet', null);
  expect(report.items.map(item => item.itemId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(report.hasMore).toBe(true);
  expect((await getTerminalItemPerformance('wallet-a', 'mainnet', { start: 3000, end: 4000 })).items).toHaveLength(5);
  await resetTerminalSqlite();
  for (const id of ['hugea', 'hugeb']) await updateTerminalSalePayment(request(id, [line('huge', 'Huge', 1, Number.MAX_SAFE_INTEGER)]), { status: 'received' }, 3000);
  expect((await getTerminalItemPerformance('wallet-a', 'mainnet', null)).items[0].gross).toBe(BigInt(Number.MAX_SAFE_INTEGER) * 2n);
});

it('rejects corrupt basket details instead of inventing quantities or gross revenue', async () => {
  await updateTerminalSalePayment(request('corrupt', [line()]), { status: 'received' }, 3000);
  const db = await getTerminalDatabase();
  await db.runAsync("UPDATE terminal_sales SET payload=json_set(payload,'$.request.basket.lines[0].total',1) WHERE id='corrupt'");
  await expect(getTerminalItemPerformance('wallet-a', 'mainnet', null)).rejects.toThrow('invalid');
});

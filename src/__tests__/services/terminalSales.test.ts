import AsyncStorage from '@react-native-async-storage/async-storage';
import { TerminalRequest } from '../../services/terminal';
import {
  listTerminalSales, localDayRange, reconcileTerminalSales, recordTerminalSale,
  removeTerminalSales, subscribeTerminalSales, summarizeTerminalSales, terminalSaleDisplayStatus,
  TERMINAL_SALES_KEY, updateTerminalSalePayment,
} from '../../services/terminalSales';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const storage = new Map<string, string>();
const request: TerminalRequest = {
  id: 'one', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc',
  amountSats: 334, createdAt: 1000, expiresAt: 2000,
  fiat: { currency: 'CHF', amountMinor: 100, rate: '300000', fetchedAt: 1200 },
};
const another: TerminalRequest = {
  id: 'two', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc456def',
  amountSats: 1200, createdAt: 2000, expiresAt: 3000,
};
const key = `${TERMINAL_SALES_KEY}:mainnet:wallet-a`;

beforeEach(() => {
  storage.clear();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async path => storage.get(path) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (path, value) => { storage.set(path, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async path => { storage.delete(path); });
});

it('serializes concurrent additions, retains closed invoices, and returns newest first', async () => {
  await Promise.all([recordTerminalSale(request), recordTerminalSale(another), recordTerminalSale(request)]);
  expect((await listTerminalSales('wallet-a', 'Bitcoin')).map(sale => sale.request.id)).toEqual(['two', 'one']);
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(2);
  expect(await listTerminalSales('wallet-b', 'mainnet')).toEqual([]);
  expect(await listTerminalSales('wallet-a', 'testnet')).toEqual([]);
});

it('keeps the first request snapshot and refuses an identity collision', async () => {
  const mutable = { ...request, fiat: { ...request.fiat! } };
  await recordTerminalSale(mutable);
  mutable.fiat.amountMinor = 200;
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0].request.fiat?.amountMinor).toBe(100);
  await expect(recordTerminalSale({ ...request, id: 'different' })).rejects.toThrow('conflicts');
  await expect(recordTerminalSale({ ...request, invoice: 'lnbc999abc' })).rejects.toThrow('conflicts');
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(1);
});

it('deep-copies the original item basket into a sale snapshot', async () => {
  const mutable = { ...request, basket: { unit: 'CHF' as const, total: 100, lines: [{ itemId: 'tea', name: 'Tea', unitPrice: 50, quantity: 2, total: 100 }] } };
  await recordTerminalSale(mutable);
  mutable.basket.lines[0].name = 'Changed';
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0].request.basket?.lines[0].name).toBe('Tea');
});

it('persists first receipt observation and never downgrades a received sale', async () => {
  const observed = await updateTerminalSalePayment(request, { status: 'received', paymentId: 'sdk-1' }, 4000);
  expect(observed.receivedAt).toBe(4000);
  expect(observed.paymentId).toBe('sdk-1');
  expect(terminalSaleDisplayStatus(observed, 9999)).toBe('received');
  expect(await updateTerminalSalePayment(request, { status: 'pending', paymentId: 'sdk-2' }, 5000)).toEqual(observed);
  expect(await updateTerminalSalePayment(request, { status: 'unknown' }, 6000)).toEqual(observed);
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(1);
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0]).toEqual(observed);
});

it('derives expiry at display time without changing the stored payment status', async () => {
  const sale = await recordTerminalSale(request);
  expect(terminalSaleDisplayStatus(sale, 1999)).toBe('unpaid');
  expect(terminalSaleDisplayStatus(sale, 2000)).toBe('expired');
  const pending = await updateTerminalSalePayment(request, { status: 'pending' }, 2100);
  expect(terminalSaleDisplayStatus(pending, 2100)).toBe('pending');
  expect(pending.status).toBe('pending');
  expect(await updateTerminalSalePayment(request, { status: 'unknown' }, 2200)).toEqual(pending);
});

it('rejects corrupt or cross-scope storage without replacing it', async () => {
  storage.set(key, '{broken');
  await expect(recordTerminalSale(request)).rejects.toThrow('unreadable');
  expect(storage.get(key)).toBe('{broken');
  storage.set(key, JSON.stringify({ version: 1, sales: [{ request: { ...request, walletId: 'wallet-b' }, status: 'unknown', updatedAt: 5000 }] }));
  await expect(updateTerminalSalePayment(request, { status: 'received' }, 6000)).rejects.toThrow('invalid');
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(0);
});

it('reconciles exact invoice matches in one write, ignoring unrelated history and paid downgrades', async () => {
  await recordTerminalSale(request);
  await recordTerminalSale(another);
  (AsyncStorage.setItem as jest.Mock).mockClear();
  const change = await reconcileTerminalSales('wallet-a', 'mainnet', [
    { invoice: 'LNBC123ABC', status: 'pending', paymentId: 'sdk-1' },
    { invoice: 'lnbc123abc', status: 'received', paymentId: 'sdk-1' },
    { invoice: 'lnbc456def', status: 'pending', paymentId: 'sdk-2' },
    { invoice: 'lnbc-no-match', status: 'received', paymentId: 'sdk-3' },
  ], 7000);
  expect(change).toBe(2);
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(1);
  const sales = await listTerminalSales('wallet-a', 'mainnet');
  expect(sales.find(s => s.request.id === 'one')?.receivedAt).toBe(7000);
  expect(sales.find(s => s.request.id === 'two')?.status).toBe('pending');
  expect(await reconcileTerminalSales('wallet-a', 'mainnet', [
    { invoice: request.invoice, status: 'pending', paymentId: 'other' },
    { invoice: another.invoice, status: 'pending', paymentId: 'sdk-2' },
  ], 8000)).toBe(0);
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(1);
});

it('counts observed receipts in the local day and sums original fiat using BigInt', async () => {
  const noon = new Date(2026, 9, 19, 12).getTime();
  const range = localDayRange(noon);
  expect(range.start).toBe(new Date(2026, 9, 19).getTime());
  expect(range.end).toBe(new Date(2026, 9, 20).getTime());
  await updateTerminalSalePayment(request, { status: 'received' }, range.start);
  await updateTerminalSalePayment(another, { status: 'received' }, range.end);
  expect(summarizeTerminalSales(await listTerminalSales('wallet-a', 'mainnet'), range)).toEqual({
    receivedCount: 1, sats: 334n, fiatMinor: { CHF: 100n },
  });
  const large = { request: { ...another, amountSats: Number.MAX_SAFE_INTEGER },
    status: 'received' as const, receivedAt: range.start + 1, updatedAt: range.start + 1 };
  expect(summarizeTerminalSales([large, large], range).sats).toBe(2n * BigInt(Number.MAX_SAFE_INTEGER));
});

it('notifies subscribers only after a successful changed write', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeTerminalSales(listener);
  await recordTerminalSale(request);
  await recordTerminalSale(request);
  await updateTerminalSalePayment(request, { status: 'unknown' }, 5000);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await updateTerminalSalePayment(request, { status: 'received' }, 6000);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('does not expose a failed write and can retry it', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeTerminalSales(listener);
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(recordTerminalSale(request)).rejects.toThrow('disk unavailable');
  expect(await listTerminalSales('wallet-a', 'mainnet')).toEqual([]);
  expect(listener).not.toHaveBeenCalled();
  expect((await recordTerminalSale(request)).request.fiat).toEqual(request.fiat);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('removes only the selected wallet and network history', async () => {
  await recordTerminalSale(request);
  await recordTerminalSale({ ...request, walletId: 'wallet-b' });
  await recordTerminalSale({ ...request, id: 'testnet', network: 'testnet', invoice: 'lntb123abc' });
  const listener = jest.fn();
  const unsubscribe = subscribeTerminalSales(listener);
  await removeTerminalSales('wallet-a', 'Bitcoin');
  expect(await listTerminalSales('wallet-a', 'mainnet')).toEqual([]);
  expect(await listTerminalSales('wallet-b', 'mainnet')).toHaveLength(1);
  expect(await listTerminalSales('wallet-a', 'testnet')).toHaveLength(1);
  expect(listener).toHaveBeenCalledWith('wallet-a', 'mainnet');
  await removeTerminalSales('wallet-a', 'mainnet');
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it.each([100, 1000, 10000])('validates a %i-sale fixture once for unchanged reads', async count => {
  const walletId = `fixture-${count}`;
  storage.set(`${TERMINAL_SALES_KEY}:mainnet:${walletId}`, JSON.stringify({ version: 1, sales:
    Array.from({ length: count }, (_, index) => ({
      request: { ...another, id: `sale-${index}`, walletId, invoice: `lnbc${index}abc`,
        createdAt: index + 1, expiresAt: count + 10000 },
      status: 'unknown', updatedAt: index + 1,
    })),
  }));
  const parse = jest.spyOn(JSON, 'parse');
  try {
    expect(await listTerminalSales(walletId, 'mainnet')).toHaveLength(count);
    expect(await listTerminalSales(walletId, 'mainnet')).toHaveLength(count);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(2);
  } finally { parse.mockRestore(); }
});

it('does not let a caller mutate cached nested sale data or an existing return', async () => {
  const withBasket = { ...request, basket: { unit: 'CHF' as const, total: 100,
    lines: [{ itemId: 'tea', name: 'Tea', unitPrice: 100, quantity: 1, total: 100 }] } };
  await recordTerminalSale(withBasket);
  const listed = await listTerminalSales('wallet-a', 'mainnet');
  (listed[0].request.fiat as any).amountMinor = 999;
  (listed[0].request.basket!.lines[0] as any).name = 'Changed';
  const existing = await recordTerminalSale(withBasket);
  (existing.request.basket!.lines[0] as any).name = 'Again';
  const fresh = (await listTerminalSales('wallet-a', 'mainnet'))[0];
  expect(fresh.request.fiat?.amountMinor).toBe(100);
  expect(fresh.request.basket?.lines[0].name).toBe('Tea');
});

it('revalidates replacement, corruption, duplicates, deletion and recreation', async () => {
  await recordTerminalSale(request);
  await listTerminalSales('wallet-a', 'mainnet');
  storage.set(key, JSON.stringify({ version: 1, sales: [{ request: another, status: 'unknown', updatedAt: 5000 }] }));
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0].request.id).toBe('two');
  storage.set(key, '{broken');
  await expect(listTerminalSales('wallet-a', 'mainnet')).rejects.toThrow('unreadable');
  storage.set(key, JSON.stringify({ version: 1, sales: [
    { request, status: 'unknown', updatedAt: 5000 },
    { request, status: 'unknown', updatedAt: 5000 },
  ] }));
  await expect(listTerminalSales('wallet-a', 'mainnet')).rejects.toThrow('duplicates');
  storage.delete(key);
  expect(await listTerminalSales('wallet-a', 'mainnet')).toEqual([]);
  storage.set(key, JSON.stringify({ version: 1, sales: [{ request, status: 'unknown', updatedAt: 5000 }] }));
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0].request.id).toBe('one');
});

it('propagates a storage read error even with a warm cache', async () => {
  await recordTerminalSale(request);
  await listTerminalSales('wallet-a', 'mainnet');
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
  await expect(listTerminalSales('wallet-a', 'mainnet')).rejects.toThrow('read failed');
  expect(await listTerminalSales('wallet-a', 'mainnet')).toHaveLength(1);
});

it('keeps a warm sale unchanged after a failed update and allows retry', async () => {
  await recordTerminalSale(request);
  await listTerminalSales('wallet-a', 'mainnet');
  const before = storage.get(key);
  const listener = jest.fn();
  const unsubscribe = subscribeTerminalSales(listener);
  try {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(updateTerminalSalePayment(request, { status: 'received' }, 5000))
      .rejects.toThrow('disk unavailable');
    expect(storage.get(key)).toBe(before);
    expect((await listTerminalSales('wallet-a', 'mainnet'))[0].status).toBe('unknown');
    expect(listener).not.toHaveBeenCalled();
    expect((await updateTerminalSalePayment(request, { status: 'received' }, 5000)).status).toBe('received');
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { unsubscribe(); }
});

it('evicts the least recently used scope', async () => {
  for (const walletId of ['evict-a', 'evict-b', 'evict-c']) {
    storage.set(`${TERMINAL_SALES_KEY}:mainnet:${walletId}`, JSON.stringify({ version: 1, sales: [
      { request: { ...request, walletId }, status: 'unknown', updatedAt: 5000 },
    ] }));
  }
  const parse = jest.spyOn(JSON, 'parse');
  try {
    for (const walletId of ['evict-a', 'evict-b', 'evict-a', 'evict-c', 'evict-b']) {
      await listTerminalSales(walletId, 'mainnet');
    }
    expect(parse).toHaveBeenCalledTimes(4);
  } finally { parse.mockRestore(); }
});

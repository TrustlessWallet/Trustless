import AsyncStorage from '@react-native-async-storage/async-storage';
import { TerminalRequest } from '../../services/terminal';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import {
  listTerminalRefunds, reconcileTerminalRefunds, remainingTerminalRefundSats, removeTerminalRefunds,
  reserveTerminalRefund, subscribeTerminalRefunds, TERMINAL_REFUNDS_KEY, updateTerminalRefund,
} from '../../services/terminalRefunds';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const storage = new Map<string, string>();
const request: TerminalRequest = {
  id: 'sale-1', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc',
  amountSats: 1000, createdAt: 1000, expiresAt: 2000,
};
const quote = (id: string, invoice: string, amountSats: number) => ({
  id, invoice, amountSats, feeSats: 5, quoteExpiresAt: Date.now() + 60000,
});

beforeEach(() => {
  storage.clear();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async path => storage.get(path) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (path, value) => { storage.set(path, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async path => { storage.delete(path); });
});

async function paidSale() {
  await recordTerminalSale(request);
  return updateTerminalSalePayment(request, { status: 'received', paymentId: 'receive-sdk' }, 3000);
}

it('requires verified receipt and reserves before sending', async () => {
  const unpaid = await recordTerminalSale(request);
  await expect(reserveTerminalRefund(unpaid, quote('r1', 'lnbc999abc', 400))).rejects.toThrow('not verified');
  const sale = await paidSale();
  const attempt = await reserveTerminalRefund(sale, quote('r1', 'lnbc999abc', 400));
  expect(attempt.status).toBe('unknown');
  expect(remainingTerminalRefundSats(sale, await listTerminalRefunds('wallet-a', 'Bitcoin'))).toBe(600);
  await expect(reserveTerminalRefund(sale, quote('r2', 'lnbc888abc', 100))).rejects.toThrow('unresolved');
});

it('serializes competing reservations and prevents over-refunds', async () => {
  const sale = await paidSale();
  const results = await Promise.allSettled([
    reserveTerminalRefund(sale, quote('r1', 'lnbc111abc', 700)),
    reserveTerminalRefund(sale, quote('r2', 'lnbc222abc', 700)),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await listTerminalRefunds('wallet-a', 'mainnet')).toHaveLength(1);
  const first = (await listTerminalRefunds('wallet-a', 'mainnet'))[0];
  await updateTerminalRefund(first, { status: 'complete', paymentId: 'send-sdk' });
  await expect(reserveTerminalRefund(sale, quote('r3', 'lnbc333abc', 301))).rejects.toThrow('remaining');
  await reserveTerminalRefund(sale, quote('r4', 'lnbc444abc', 300));
  expect(remainingTerminalRefundSats(sale, await listTerminalRefunds('wallet-a', 'mainnet'))).toBe(0);
});

it('retains unknown reservations after restart and releases only failed attempts', async () => {
  const sale = await paidSale();
  const attempt = await reserveTerminalRefund(sale, quote('r1', 'lnbc111abc', 500));
  expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0].status).toBe('unknown');
  await expect(reserveTerminalRefund(sale, quote('r2', 'lnbc222abc', 500))).rejects.toThrow('unresolved');
  const failed = await updateTerminalRefund(attempt, { status: 'failed', paymentId: 'sdk-failed' });
  expect(remainingTerminalRefundSats(sale, [failed])).toBe(1000);
  expect(await updateTerminalRefund(failed, { status: 'pending' })).toEqual(failed);
  await reserveTerminalRefund(sale, quote('r2', 'lnbc222abc', 1000));
});

it('preserves complete status and immutable quote even under later observations', async () => {
  const sale = await paidSale();
  const reservation = quote('r1', 'lnbc111abc', 500);
  const attempt = await reserveTerminalRefund(sale, reservation);
  expect(await reserveTerminalRefund(sale, reservation)).toEqual(attempt);
  await expect(reserveTerminalRefund(sale, { ...reservation, feeSats: 6 })).rejects.toThrow('conflicts');
  const complete = await updateTerminalRefund(attempt, { status: 'complete', paymentId: 'sdk-1' }, 5000);
  expect(await updateTerminalRefund(attempt, { status: 'failed', paymentId: 'sdk-2' }, 6000)).toEqual(complete);
  expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0]).toEqual(complete);
});

it('rejects an expired new quote but returns a previously reserved retry', async () => {
  const sale = await paidSale();
  const reservation = quote('r1', 'lnbc111abc', 500);
  const attempt = await reserveTerminalRefund(sale, reservation);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(reservation.quoteExpiresAt + 1);
  try {
    expect(await reserveTerminalRefund(sale, reservation)).toEqual(attempt);
    await updateTerminalRefund(attempt, { status: 'failed' });
    await expect(reserveTerminalRefund(sale, { ...reservation, id: 'r2', invoice: 'lnbc222abc' }))
      .rejects.toThrow('expired');
  } finally {
    clock.mockRestore();
  }
});

it('reconciles exact outbound invoice matches in one write', async () => {
  const sale = await paidSale();
  const first = await reserveTerminalRefund(sale, quote('r1', 'lnbc111abc', 200));
  await updateTerminalRefund(first, { status: 'complete' });
  await reserveTerminalRefund(sale, quote('r2', 'lnbc222abc', 300));
  (AsyncStorage.setItem as jest.Mock).mockClear();
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: 'LNBC111ABC', status: 'failed', paymentId: 'other' },
    { invoice: 'lnbc222abc', status: 'pending', paymentId: 'sdk-2' },
    { invoice: 'lnbc999abc', status: 'complete', paymentId: 'other' },
  ])).toBe(1);
  expect((AsyncStorage.setItem as jest.Mock).mock.calls).toHaveLength(1);
  expect((await listTerminalRefunds('wallet-a', 'mainnet')).find(item => item.id === 'r1')?.status).toBe('complete');
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: 'lnbc222abc', status: 'pending', paymentId: 'sdk-2' },
  ])).toBe(0);
});

it('rejects corrupt scoped records and preserves other wallets on removal', async () => {
  const sale = await paidSale();
  await reserveTerminalRefund(sale, quote('r1', 'lnbc111abc', 200));
  const otherRequest = { ...request, walletId: 'wallet-b' };
  await recordTerminalSale(otherRequest);
  const otherSale = await updateTerminalSalePayment(otherRequest, { status: 'received' }, 3000);
  await reserveTerminalRefund(otherSale, quote('r2', 'lnbc222abc', 100));
  const listener = jest.fn();
  const unsubscribe = subscribeTerminalRefunds(listener);
  await removeTerminalRefunds('wallet-a', 'mainnet');
  expect(await listTerminalRefunds('wallet-a', 'mainnet')).toEqual([]);
  expect(await listTerminalRefunds('wallet-b', 'mainnet')).toHaveLength(1);
  expect(listener).toHaveBeenCalledWith('wallet-a', 'mainnet');
  unsubscribe();
  const key = `${TERMINAL_REFUNDS_KEY}:mainnet:wallet-a`;
  storage.set(key, '{bad');
  await expect(reserveTerminalRefund(sale, quote('r3', 'lnbc333abc', 100))).rejects.toThrow('unreadable');
  expect(storage.get(key)).toBe('{bad');
});

it('never releases an unknown reservation from an older failed payment to the same invoice', async () => {
  const sale = await paidSale();
  const attempt = await reserveTerminalRefund(sale, quote('old-failure', 'lnbc777abc', 200));
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: attempt.invoice, status: 'failed', paymentId: 'old-sdk' },
  ])).toBe(0);
  expect(remainingTerminalRefundSats(sale, await listTerminalRefunds('wallet-a', 'mainnet'))).toBe(800);
  await updateTerminalRefund(attempt, { status: 'pending', paymentId: 'new-sdk' });
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: attempt.invoice, status: 'failed', paymentId: 'old-sdk' },
  ])).toBe(0);
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: attempt.invoice, status: 'failed', paymentId: 'new-sdk' },
  ])).toBe(1);
});

it.each([false, true])('gives completed evidence priority over failed history regardless of order (%s)', async reverse => {
  const sale = await paidSale();
  const attempt = await reserveTerminalRefund(sale, quote('priority', 'lnbc888abc', 200));
  const payments = [
    { invoice: attempt.invoice, status: 'failed' as const, paymentId: 'old-sdk' },
    { invoice: attempt.invoice, status: 'complete' as const, paymentId: 'new-sdk' },
  ];
  await reconcileTerminalRefunds('wallet-a', 'mainnet', reverse ? payments.reverse() : payments);
  expect((await listTerminalRefunds('wallet-a', 'mainnet'))[0].status).toBe('complete');
});

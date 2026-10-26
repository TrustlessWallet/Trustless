import { resetTerminalSqlite, failNextTerminalSqliteWrite } from '../helpers/terminalSqlite';
import { TerminalRequest } from '../../services/terminal';
import { findTerminalRefundByInvoice, getTerminalRefundTotal, listTerminalRefundsForInvoices,
  listTerminalRefundsForSale, reconcileTerminalRefunds, reserveTerminalRefund, subscribeTerminalRefunds, updateTerminalRefund } from '../../services/terminalRefunds';
import { updateTerminalSalePayment } from '../../services/terminalSales';

const request: TerminalRequest = { id: 'sale', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcsaleabc',
  amountSats: 1000, createdAt: 1000, expiresAt: 2000 };
const quote = (id: string, amountSats: number) => ({ id, invoice: `lnbc${id}abc`, amountSats, feeSats: 1,
  quoteExpiresAt: Date.now() + 60_000 });

beforeEach(resetTerminalSqlite);

async function paidSale() { return updateTerminalSalePayment(request, { status: 'received', paymentId: 'receive' }, 3000); }

it('atomically serializes competing reservations across the shared sales/refund queue', async () => {
  const sale = await paidSale();
  const results = await Promise.allSettled([
    reserveTerminalRefund(sale, quote('one', 700)), reserveTerminalRefund(sale, quote('two', 700)),
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await listTerminalRefundsForSale('wallet-a', 'mainnet', 'sale')).toHaveLength(1);
});

it('keeps retries idempotent and releases only a definitively failed reservation', async () => {
  const sale = await paidSale(), reservation = quote('retry', 400);
  const attempt = await reserveTerminalRefund(sale, reservation);
  expect(await reserveTerminalRefund(sale, reservation)).toEqual(attempt);
  await expect(reserveTerminalRefund(sale, { ...reservation, feeSats: 2 })).rejects.toThrow('conflicts');
  const failed = await updateTerminalRefund(attempt, { status: 'failed', paymentId: 'send' }, 5000);
  expect((await reserveTerminalRefund(sale, quote('next', 1000))).status).toBe('unknown');
  expect(failed.status).toBe('failed');
});

it('looks up bounded invoice batches and sums complete refunds exactly in the updated range', async () => {
  const sale = await paidSale();
  const first = await reserveTerminalRefund(sale, quote('first', 400));
  await updateTerminalRefund(first, { status: 'complete', paymentId: 'p1' }, 5000);
  const second = await reserveTerminalRefund(sale, quote('second', 600));
  await updateTerminalRefund(second, { status: 'complete', paymentId: 'p2' }, 6000);
  expect((await findTerminalRefundByInvoice('wallet-a', 'mainnet', 'LNBCFIRSTABC'))?.id).toBe('first');
  const invoices = Array.from({ length: 205 }, (_, index) => `lnbcmissing${index}abc`).concat(first.invoice, second.invoice);
  expect((await listTerminalRefundsForInvoices('wallet-a', 'mainnet', invoices)).map(item => item.id).sort()).toEqual(['first', 'second']);
  expect(await getTerminalRefundTotal('wallet-a', 'mainnet', { start: 5000, end: 6000 })).toBe(400n);
  expect(await getTerminalRefundTotal('wallet-a', 'mainnet', null)).toBe(1000n);
});

it('rejects non-string refund IDs and payment IDs without writing', async () => {
  const sale = await paidSale();
  await expect(reserveTerminalRefund(sale, { ...quote('bad', 100), id: 123 } as any)).rejects.toThrow('Invalid');
  await expect(reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: 'lnbcbadabc', status: 'pending', paymentId: 123 },
  ] as any)).rejects.toThrow('Invalid Terminal refund history');
  expect(await listTerminalRefundsForSale('wallet-a', 'mainnet', 'sale')).toEqual([]);
  const attempt = await reserveTerminalRefund(sale, quote('valid', 100));
  await expect(updateTerminalRefund(attempt, { status: 'pending', paymentId: 123 } as any, 5000))
    .rejects.toThrow('Invalid Terminal refund update');
  expect((await listTerminalRefundsForSale('wallet-a', 'mainnet', 'sale'))[0].status).toBe('unknown');
});

it('keeps uncertain refunds reserved when unrelated failed payment history arrives', async () => {
  const sale = await paidSale();
  const original = await reserveTerminalRefund(sale, quote('uncertain', 400));
  const pending = await updateTerminalRefund(original, { status: 'pending', paymentId: 'actual-send' }, 4000);
  expect(await reconcileTerminalRefunds('wallet-a', 'mainnet', [
    { invoice: original.invoice, status: 'failed', paymentId: 'old-send' },
  ], 5000)).toBe(0);
  await expect(reserveTerminalRefund(sale, quote('blocked', 100))).rejects.toThrow('unresolved');
  failNextTerminalSqliteWrite(new Error('disk full'));
  const listener = jest.fn(); const stop = subscribeTerminalRefunds(listener);
  try {
    await expect(updateTerminalRefund(pending, { status: 'failed', paymentId: 'actual-send' }, 6000)).rejects.toThrow('disk full');
    expect((await listTerminalRefundsForSale('wallet-a', 'mainnet', 'sale'))[0].status).toBe('pending');
    expect(listener).not.toHaveBeenCalled();
    await updateTerminalRefund(pending, { status: 'complete', paymentId: 'actual-send' }, 6000);
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(reserveTerminalRefund(sale, quote('toolarge', 601))).rejects.toThrow('remaining');
  } finally { stop(); }
});

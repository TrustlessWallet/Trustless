import { resetTerminalSqlite, failNextTerminalSqliteWrite } from '../helpers/terminalSqlite';
import { TerminalRequest } from '../../services/terminal';
import { getTerminalDatabase, setTerminalDatabaseForTests } from '../../services/terminalDatabase';
import { getTerminalSale, getTerminalSalesSummary, listTerminalSalesPage, recordTerminalSale,
  reconcileTerminalSales, subscribeTerminalSales, updateTerminalSalePayment } from '../../services/terminalSales';

const request = (id: string, createdAt: number, amountSats = 1000): TerminalRequest => ({ id, walletId: 'wallet-a',
  network: 'mainnet', invoice: `lnbc${id}abc`, amountSats, createdAt, expiresAt: createdAt + 10_000 });

beforeEach(resetTerminalSqlite);

it('pages activity deterministically across timestamp ties and range boundaries', async () => {
  for (const id of ['a', 'c', 'b']) await recordTerminalSale(request(id, 1000));
  await updateTerminalSalePayment(request('a', 1000), { status: 'received' }, 2000);
  const first = await listTerminalSalesPage('wallet-a', 'mainnet', { range: { start: 1000, end: 3000 }, limit: 2 });
  expect(first.items.map(item => item.request.id)).toEqual(['a', 'c']);
  expect(first.nextCursor).toEqual({ at: 1000, id: 'c' });
  const second = await listTerminalSalesPage('wallet-a', 'mainnet', { range: { start: 1000, end: 3000 }, cursor: first.nextCursor, limit: 2 });
  expect(second.items.map(item => item.request.id)).toEqual(['b']);
  expect(second.nextCursor).toBeNull();
  expect((await listTerminalSalesPage('wallet-a', 'mainnet', { range: { start: 2000, end: 2001 } })).items).toHaveLength(1);
});

it('stores exact MAX_SAFE_INTEGER totals with SQL limbs', async () => {
  const max = Number.MAX_SAFE_INTEGER;
  for (const id of ['maxa', 'maxb']) await updateTerminalSalePayment(request(id, 1000, max), { status: 'received' }, 2000);
  expect(await getTerminalSalesSummary('wallet-a', 'mainnet', null)).toMatchObject({
    activityCount: 2, receivedCount: 2, sats: BigInt(max) * 2n, bitcoinSats: BigInt(max) * 2n,
  });
  const plan = await (await getTerminalDatabase()).getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM terminal_sales
    WHERE wallet_id=? AND network=? AND status='received' AND activity_at>=? AND activity_at<?`, ['wallet-a', 'mainnet', 1000, 3000]);
  expect(plan.map(row => row.detail).join('\n')).toMatch(/SEARCH terminal_sales USING COVERING INDEX terminal_sales_status_activity .*activity_at[<=>]/);
});

it('reconciles only input invoice batches and rejects corrupt payloads on read', async () => {
  await Promise.all([recordTerminalSale(request('one', 1000)), recordTerminalSale(request('two', 1001))]);
  expect(await reconcileTerminalSales('wallet-a', 'mainnet', [
    { invoice: 'LNBCONEABC', status: 'received', paymentId: 'sdk' },
  ], 3000)).toBe(1);
  expect((await getTerminalSale('wallet-a', 'mainnet', 'two'))?.status).toBe('unknown');
  const db = await getTerminalDatabase();
  await db.runAsync("UPDATE terminal_sales SET payload='{bad' WHERE id='two'");
  await expect(getTerminalSale('wallet-a', 'mainnet', 'two')).rejects.toThrow('unreadable');
});

it('returns immutable nested snapshots', async () => {
  const nested: TerminalRequest = { ...request('nested', 1000), basket: { unit: 'sats', total: 1000,
    lines: [{ itemId: 'tea', name: 'Tea', unitPrice: 1000, quantity: 1, total: 1000 }] } };
  const saved = await recordTerminalSale(nested);
  (saved.request.basket!.lines[0] as any).name = 'Changed';
  expect((await getTerminalSale('wallet-a', 'mainnet', 'nested'))?.request.basket?.lines[0].name).toBe('Tea');
});

it('persists rows when the database is closed and reopened', async () => {
  await recordTerminalSale(request('reopen', 1000));
  await setTerminalDatabaseForTests(null);
  expect((await getTerminalSale('wallet-a', 'mainnet', 'reopen'))?.request.id).toBe('reopen');
});

it('uses a bounded composite-index seek and pages a 1000-row fixture 100 at a time', async () => {
  const db = await getTerminalDatabase();
  await db.withExclusiveTransactionAsync(async transaction => {
    for (let index = 0; index < 1000; index++) {
      const id = `bulk${String(index).padStart(4, '0')}`;
      const sale = { request: request(id, 10_000 + index), status: 'unknown', updatedAt: 20_000 + index };
      await transaction.runAsync(`INSERT INTO terminal_sales
        (wallet_id,network,id,normalized_invoice,status,created_at,activity_at,updated_at,amount_hi,amount_lo,input_is_fiat,payload)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, ['wallet-a', 'mainnet', id, sale.request.invoice, sale.status,
        sale.request.createdAt, sale.request.createdAt, sale.updatedAt, 0, 1000, 0, JSON.stringify(sale)]);
    }
  });
  let cursor = null;
  const ids: string[] = [];
  for (let page = 0; page < 10; page++) {
    const result = await listTerminalSalesPage('wallet-a', 'mainnet', { range: null, cursor, limit: 100 });
    ids.push(...result.items.map(item => item.request.id));
    cursor = result.nextCursor;
  }
  expect(ids).toHaveLength(1000);
  expect(new Set(ids).size).toBe(1000);
  expect(cursor).toBeNull();
  const plan = await db.getAllAsync<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT payload,activity_at,id FROM terminal_sales
    WHERE wallet_id=? AND network=? AND activity_at>=? AND activity_at<? AND (activity_at,id)<(?,?)
    ORDER BY activity_at DESC,id DESC LIMIT ?`, ['wallet-a', 'mainnet', 10_000, 20_000, 10_900, 'bulk0900', 101]);
  expect(plan.map(row => row.detail).join('\n')).toMatch(/SEARCH terminal_sales USING INDEX terminal_sales_activity .*activity_at[<=>]/);
});

it('rejects non-string reconciliation fields before writing', async () => {
  const operation = reconcileTerminalSales('wallet-a', 'mainnet', [
    { invoice: 123, status: 'received', paymentId: 'sdk' },
    { invoice: 'lnbcvalidabc', status: 'received', paymentId: 123 },
  ] as any, 3000);
  await expect(operation).rejects.toThrow('Invalid Terminal payment history');
  await expect(updateTerminalSalePayment(request('invalidpayment', 1000),
    { status: 'pending', paymentId: 123 } as any, 3000)).rejects.toThrow('Invalid Terminal payment update');
  expect((await getTerminalSalesSummary('wallet-a', 'mainnet', null)).activityCount).toBe(0);
});

it('rolls back failed writes, preserves identity and never downgrades receipt status', async () => {
  const original = request('safe', 1000);
  const listener = jest.fn();
  const stop = subscribeTerminalSales(listener);
  try {
    await recordTerminalSale(original);
    failNextTerminalSqliteWrite(new Error('disk full'));
    await expect(updateTerminalSalePayment(original, { status: 'received', paymentId: 'paid' }, 3000)).rejects.toThrow('disk full');
    expect((await getTerminalSale('wallet-a', 'mainnet', original.id))?.status).toBe('unknown');
    expect(listener).toHaveBeenCalledTimes(1);
    const paid = await updateTerminalSalePayment(original, { status: 'received', paymentId: 'paid' }, 3000);
    expect(await updateTerminalSalePayment(original, { status: 'pending', paymentId: 'other' }, 4000)).toEqual(paid);
    await expect(recordTerminalSale({ ...original, amountSats: 2000 })).rejects.toThrow('conflicts');
    await expect(recordTerminalSale({ ...original, id: 'other' })).rejects.toThrow('conflicts');
    expect(listener).toHaveBeenCalledTimes(2);
    expect((await getTerminalSalesSummary('wallet-a', 'mainnet', null)).sats).toBe(1000n);
  } finally { stop(); }
});

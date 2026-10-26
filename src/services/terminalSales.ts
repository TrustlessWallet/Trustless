import { SQLiteDatabase } from 'expo-sqlite';
import { isTerminalRequest, normalizeInvoice, terminalNetwork, TerminalNetwork, TerminalRequest } from './terminal';
import { FiatCurrency } from './terminalRates';
import { serializeTerminalDatabase, transactTerminalDatabase } from './terminalDatabase';

export type TerminalSalePaymentStatus = 'unknown' | 'pending' | 'received';
export type TerminalSale = Readonly<{ request: TerminalRequest; status: TerminalSalePaymentStatus; paymentId?: string;
  receivedAt?: number; updatedAt: number }>;
export type TerminalSalesCursor = { at: number; id: string };
export type TerminalRange = { start: number; end: number } | null;
export type TerminalSalesSummary = { activityCount: number; receivedCount: number; sats: bigint; bitcoinSats: bigint;
  fiatMinor: Partial<Record<FiatCurrency, bigint>> };

export const TERMINAL_SALES_KEY = '@terminalSales:v1'; // Compatibility only; never read.
const listeners = new Set<(walletId: string, network: TerminalNetwork) => void>();
const LIMB = 1_000_000_000;
type SaleRow = { payload: string };

function copySale(sale: TerminalSale): TerminalSale {
  const request = sale.request;
  return { ...sale, request: { ...request,
    ...(request.fiat ? { fiat: { ...request.fiat } } : {}),
    ...(request.reportingRate !== undefined ? { reportingRate: request.reportingRate ? { ...request.reportingRate } : null } : {}),
    ...(request.basket ? { basket: { ...request.basket, lines: request.basket.lines.map(line => ({ ...line })) } } : {}),
  } };
}

export function terminalScope(walletId: string, network: string): { walletId: string; network: TerminalNetwork } {
  if (typeof walletId !== 'string' || !walletId.trim() || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
}

function snapshot(request: TerminalRequest): TerminalRequest {
  if (!isTerminalRequest(request)) throw new Error('Invalid Terminal payment request.');
  terminalScope(request.walletId, request.network);
  return copySale({ request, status: 'unknown', updatedAt: 1 }).request;
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isTerminalSale(value: unknown, walletId: string, network: TerminalNetwork): value is TerminalSale {
  if (!value || typeof value !== 'object') return false;
  const sale = value as Record<string, unknown>;
  return isTerminalRequest(sale.request) && sale.request.walletId === walletId && sale.request.network === network &&
    (sale.status === 'unknown' || sale.status === 'pending' || sale.status === 'received') &&
    (sale.paymentId === undefined || (typeof sale.paymentId === 'string' && !!sale.paymentId)) && timestamp(sale.updatedAt) &&
    (sale.receivedAt === undefined || timestamp(sale.receivedAt)) &&
    (sale.status === 'received' ? timestamp(sale.receivedAt) && sale.receivedAt <= sale.updatedAt : sale.receivedAt === undefined);
}

function decodeSale(row: SaleRow, walletId: string, network: TerminalNetwork): TerminalSale {
  let value: unknown;
  try { value = JSON.parse(row.payload); } catch { throw new Error('Saved Terminal sale is unreadable.'); }
  if (!isTerminalSale(value, walletId, network)) throw new Error('Saved Terminal sale is invalid.');
  return copySale(value);
}

function payload(sale: TerminalSale): string { return JSON.stringify(sale); }
function limbs(value: number): [number, number] { return [Math.floor(value / LIMB), value % LIMB]; }

async function selectIdentity(db: SQLiteDatabase, request: TerminalRequest): Promise<TerminalSale | null> {
  const row = await db.getFirstAsync<SaleRow>(`SELECT payload FROM terminal_sales
    WHERE wallet_id=? AND network=? AND (id=? OR normalized_invoice=?) LIMIT 1`,
  [request.walletId, request.network, request.id, normalizeInvoice(request.invoice)]);
  return row ? decodeSale(row, request.walletId, request.network) : null;
}

export async function getTerminalSaleInDatabase(db: SQLiteDatabase, walletId: string, network: TerminalNetwork, id: string): Promise<TerminalSale | null> {
  const row = await db.getFirstAsync<SaleRow>('SELECT payload FROM terminal_sales WHERE wallet_id=? AND network=? AND id=?', [walletId, network, id]);
  return row ? decodeSale(row, walletId, network) : null;
}

async function insertSale(db: SQLiteDatabase, sale: TerminalSale): Promise<void> {
  const [amountHi, amountLo] = limbs(sale.request.amountSats), fiat = sale.request.fiat;
  const [fiatHi, fiatLo] = fiat ? limbs(fiat.amountMinor) : [null, null];
  await db.runAsync(`INSERT INTO terminal_sales
    (wallet_id,network,id,normalized_invoice,status,payment_id,created_at,received_at,activity_at,updated_at,
     amount_hi,amount_lo,fiat_currency,fiat_hi,fiat_lo,input_is_fiat,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [sale.request.walletId, sale.request.network, sale.request.id, normalizeInvoice(sale.request.invoice), sale.status,
    sale.paymentId ?? null, sale.request.createdAt, sale.receivedAt ?? null, sale.receivedAt ?? sale.request.createdAt,
    sale.updatedAt, amountHi, amountLo, fiat?.currency ?? null, fiatHi, fiatLo, fiat ? 1 : 0, payload(sale)]);
}

async function replaceSale(db: SQLiteDatabase, sale: TerminalSale): Promise<void> {
  const result = await db.runAsync(`UPDATE terminal_sales SET status=?,payment_id=?,received_at=?,activity_at=?,updated_at=?,payload=?
    WHERE wallet_id=? AND network=? AND id=?`, [sale.status, sale.paymentId ?? null, sale.receivedAt ?? null,
    sale.receivedAt ?? sale.request.createdAt, sale.updatedAt, payload(sale), sale.request.walletId, sale.request.network, sale.request.id]);
  if (result.changes !== 1) throw new Error('Terminal sale update lost its target.');
}

function notify(walletId: string, network: TerminalNetwork): void {
  for (const listener of listeners) try { listener(walletId, network); } catch { /* committed */ }
}

export function subscribeTerminalSales(listener: (walletId: string, network: TerminalNetwork) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export function getTerminalSale(walletId: string, network: string, id: string): Promise<TerminalSale | null> {
  const identity = terminalScope(walletId, network);
  if (typeof id !== 'string' || !id) return Promise.reject(new Error('Invalid Terminal sale ID.'));
  return serializeTerminalDatabase(db => getTerminalSaleInDatabase(db, identity.walletId, identity.network, id));
}

export function listTerminalSales(walletId: string, network: string): Promise<TerminalSale[]> {
  const identity = terminalScope(walletId, network);
  return serializeTerminalDatabase(async db => (await db.getAllAsync<SaleRow>(
    'SELECT payload FROM terminal_sales WHERE wallet_id=? AND network=? ORDER BY activity_at DESC,id DESC',
    [identity.walletId, identity.network])).map(row => decodeSale(row, identity.walletId, identity.network)));
}

function validRange(range: unknown): range is TerminalRange {
  if (range === null) return true;
  if (!range || typeof range !== 'object') return false;
  const value = range as Record<string, unknown>;
  return Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) &&
    (value.start as number) >= 0 && (value.end as number) > (value.start as number);
}

export function listTerminalSalesPage(walletId: string, network: string,
  options: { range: TerminalRange; cursor?: TerminalSalesCursor | null; limit?: number }): Promise<{ items: TerminalSale[]; nextCursor: TerminalSalesCursor | null }> {
  const identity = terminalScope(walletId, network), range = options?.range, cursor = options?.cursor ?? null, limit = options?.limit ?? 50;
  if (!validRange(range) || !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (cursor !== null && (!timestamp(cursor.at) || typeof cursor.id !== 'string' || !cursor.id))) return Promise.reject(new Error('Invalid Terminal sales page.'));
  return serializeTerminalDatabase(async db => {
    const predicates = ['wallet_id=?', 'network=?'];
    const args: (string | number)[] = [identity.walletId, identity.network];
    if (range) { predicates.push('activity_at>=?', 'activity_at<?'); args.push(range.start, range.end); }
    if (cursor) { predicates.push('(activity_at,id)<(?,?)'); args.push(cursor.at, cursor.id); }
    args.push(limit + 1);
    const rows = await db.getAllAsync<SaleRow & { activity_at: number; id: string }>(`SELECT payload,activity_at,id FROM terminal_sales
      WHERE ${predicates.join(' AND ')} ORDER BY activity_at DESC,id DESC LIMIT ?`, args);
    const page = rows.slice(0, limit), last = page[page.length - 1];
    return { items: page.map(row => decodeSale(row, identity.walletId, identity.network)),
      nextCursor: rows.length > limit && last ? { at: last.activity_at, id: last.id } : null };
  });
}

export function removeTerminalSales(walletId: string, network: string): Promise<void> {
  const identity = terminalScope(walletId, network); let changed = false;
  return transactTerminalDatabase(async db => { changed = (await db.runAsync(
    'DELETE FROM terminal_sales WHERE wallet_id=? AND network=?', [identity.walletId, identity.network])).changes > 0;
  }).then(() => { if (changed) notify(identity.walletId, identity.network); });
}

export function recordTerminalSale(request: TerminalRequest): Promise<TerminalSale> {
  const immutable = snapshot(request); let changed = false;
  return transactTerminalDatabase(async db => {
    const existing = await selectIdentity(db, immutable);
    if (existing) {
      if (JSON.stringify(existing.request) !== JSON.stringify(immutable)) throw new Error('Terminal sale identity conflicts with a saved request.');
      return existing;
    }
    const sale: TerminalSale = { request: immutable, status: 'unknown', updatedAt: Date.now() };
    await insertSale(db, sale); changed = true; return copySale(sale);
  }).then(value => { if (changed) notify(immutable.walletId, immutable.network); return value; });
}

export function updateTerminalSalePayment(request: TerminalRequest,
  payment: { status: TerminalSalePaymentStatus; paymentId?: string }, observedAt = Date.now()): Promise<TerminalSale> {
  const immutable = snapshot(request);
  if (!['unknown', 'pending', 'received'].includes(payment.status) ||
      (payment.paymentId !== undefined && (!payment.paymentId || typeof payment.paymentId !== 'string')) || !timestamp(observedAt)) {
    return Promise.reject(new Error('Invalid Terminal payment update.'));
  }
  let changed = false;
  return transactTerminalDatabase(async db => {
    const existing = await selectIdentity(db, immutable);
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(immutable)) throw new Error('Terminal sale identity conflicts with a saved request.');
    const current: TerminalSale = existing ?? { request: immutable, status: 'unknown', updatedAt: observedAt };
    if (current.status === 'received' || (current.status === 'pending' && payment.status === 'unknown')) return current;
    const paymentId = payment.paymentId ?? current.paymentId;
    if (existing && payment.status === current.status && paymentId === current.paymentId) return current;
    const next: TerminalSale = { request: current.request, status: payment.status, ...(paymentId ? { paymentId } : {}),
      ...(payment.status === 'received' ? { receivedAt: observedAt } : {}), updatedAt: observedAt };
    if (existing) await replaceSale(db, next); else await insertSale(db, next);
    changed = true; return copySale(next);
  }).then(value => { if (changed) notify(immutable.walletId, immutable.network); return value; });
}

export function reconcileTerminalSales(walletId: string, network: string,
  payments: readonly { invoice: string; status: 'received' | 'pending'; paymentId: string }[], observedAt = Date.now()): Promise<number> {
  const identity = terminalScope(walletId, network);
  if (!Array.isArray(payments) || !timestamp(observedAt) || payments.some(p => !p || typeof p.invoice !== 'string' ||
      !p.invoice.trim() || (p.status !== 'received' && p.status !== 'pending') ||
      typeof p.paymentId !== 'string' || !p.paymentId)) return Promise.reject(new Error('Invalid Terminal payment history.'));
  const byInvoice = new Map<string, (typeof payments)[number]>();
  for (const payment of payments) { const key = normalizeInvoice(payment.invoice), prior = byInvoice.get(key);
    if (!prior || (prior.status !== 'received' && payment.status === 'received')) byInvoice.set(key, payment); }
  let changed = 0;
  return transactTerminalDatabase(async db => {
    const entries = [...byInvoice.entries()];
    for (let offset = 0; offset < entries.length; offset += 100) {
      const chunk = entries.slice(offset, offset + 100); if (!chunk.length) continue;
      const rows = await db.getAllAsync<SaleRow>(`SELECT payload FROM terminal_sales WHERE wallet_id=? AND network=?
        AND normalized_invoice IN (${chunk.map(() => '?').join(',')})`, [identity.walletId, identity.network, ...chunk.map(([invoice]) => invoice)]);
      for (const row of rows) {
        const sale = decodeSale(row, identity.walletId, identity.network), payment = byInvoice.get(normalizeInvoice(sale.request.invoice));
        if (!payment || sale.status === 'received') continue;
        const paymentId = payment.paymentId || sale.paymentId;
        if (sale.status === payment.status && sale.paymentId === paymentId) continue;
        await replaceSale(db, { ...sale, status: payment.status, paymentId,
          ...(payment.status === 'received' ? { receivedAt: observedAt } : {}), updatedAt: observedAt }); changed++;
      }
    }
    return changed;
  }).then(value => { if (value) notify(identity.walletId, identity.network); return value; });
}

function exact(row: { hi: string | null; lo: string | null }): bigint {
  try { return BigInt(row.hi ?? '0') * BigInt(LIMB) + BigInt(row.lo ?? '0'); }
  catch { throw new Error('Terminal aggregate overflow.'); }
}

export function getTerminalSalesSummary(walletId: string, network: string, range: TerminalRange): Promise<TerminalSalesSummary> {
  const identity = terminalScope(walletId, network);
  if (!validRange(range)) return Promise.reject(new Error('Invalid Terminal sales range.'));
  return serializeTerminalDatabase(async db => {
    const activityRange = range ? ' AND activity_at>=? AND activity_at<?' : '';
    const rangeArgs = range ? [range.start, range.end] : [];
    const activity = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM terminal_sales
      WHERE wallet_id=? AND network=?${activityRange}`, [identity.walletId, identity.network, ...rangeArgs]);
    const received = await db.getFirstAsync<{ count: number; hi: string | null; lo: string | null; bitcoin_hi: string | null; bitcoin_lo: string | null }>(
      `SELECT COUNT(*) AS count,CAST(COALESCE(SUM(amount_hi),0) AS TEXT) AS hi,CAST(COALESCE(SUM(amount_lo),0) AS TEXT) AS lo,
       CAST(COALESCE(SUM(CASE WHEN input_is_fiat=0 THEN amount_hi ELSE 0 END),0) AS TEXT) AS bitcoin_hi,
       CAST(COALESCE(SUM(CASE WHEN input_is_fiat=0 THEN amount_lo ELSE 0 END),0) AS TEXT) AS bitcoin_lo
       FROM terminal_sales WHERE wallet_id=? AND network=? AND status='received'${activityRange}`,
    [identity.walletId, identity.network, ...rangeArgs]);
    const fiatRows = await db.getAllAsync<{ fiat_currency: FiatCurrency; hi: string | null; lo: string | null }>(
      `SELECT fiat_currency,CAST(COALESCE(SUM(fiat_hi),0) AS TEXT) AS hi,CAST(COALESCE(SUM(fiat_lo),0) AS TEXT) AS lo
       FROM terminal_sales WHERE wallet_id=? AND network=? AND status='received' AND fiat_currency IS NOT NULL
       ${activityRange} GROUP BY fiat_currency`, [identity.walletId, identity.network, ...rangeArgs]);
    const fiatMinor: Partial<Record<FiatCurrency, bigint>> = {};
    for (const row of fiatRows) fiatMinor[row.fiat_currency] = exact(row);
    return { activityCount: activity?.count ?? 0, receivedCount: received?.count ?? 0,
      sats: exact({ hi: received?.hi ?? null, lo: received?.lo ?? null }),
      bitcoinSats: exact({ hi: received?.bitcoin_hi ?? null, lo: received?.bitcoin_lo ?? null }), fiatMinor };
  });
}

export function terminalSaleDisplayStatus(sale: TerminalSale, now = Date.now()): 'received' | 'pending' | 'unpaid' | 'expired' {
  if (sale.status === 'received') return 'received'; if (sale.status === 'pending') return 'pending';
  return sale.request.expiresAt <= now ? 'expired' : 'unpaid';
}

export function localDayRange(now = Date.now()): { start: number; end: number } {
  const date = new Date(now); if (!Number.isFinite(date.getTime())) throw new Error('Invalid date.');
  return { start: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() };
}

export function summarizeTerminalSales(sales: readonly TerminalSale[], range: { start: number; end: number }):
  { receivedCount: number; sats: bigint; fiatMinor: Partial<Record<FiatCurrency, bigint>> } {
  const result = { receivedCount: 0, sats: 0n, fiatMinor: {} as Partial<Record<FiatCurrency, bigint>> };
  for (const sale of sales) if (sale.status === 'received' && sale.receivedAt !== undefined && sale.receivedAt >= range.start && sale.receivedAt < range.end) {
    result.receivedCount++; result.sats += BigInt(sale.request.amountSats);
    if (sale.request.fiat) result.fiatMinor[sale.request.fiat.currency] =
      (result.fiatMinor[sale.request.fiat.currency] ?? 0n) + BigInt(sale.request.fiat.amountMinor);
  }
  return result;
}

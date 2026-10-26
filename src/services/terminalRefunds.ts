import { SQLiteDatabase } from 'expo-sqlite';
import { normalizeInvoice, TerminalNetwork } from './terminal';
import { getTerminalSaleInDatabase, terminalScope, TerminalRange, TerminalSale } from './terminalSales';
import { isTerminalReportingRate, TerminalReportingRate } from './terminalRates';
import { serializeTerminalDatabase, transactTerminalDatabase } from './terminalDatabase';

export type TerminalRefundStatus = 'unknown' | 'pending' | 'complete' | 'failed';
export type TerminalRefundAttempt = Readonly<{ id: string; walletId: string; network: TerminalNetwork; saleId: string;
  saleInvoice: string; invoice: string; amountSats: number; feeSats: number; quoteExpiresAt: number; createdAt: number;
  status: TerminalRefundStatus; paymentId?: string; reportingRate?: TerminalReportingRate | null; updatedAt: number }>;
export type TerminalRefundReservation = Readonly<{ id: string; invoice: string; amountSats: number; feeSats: number;
  quoteExpiresAt: number; reportingRate?: TerminalReportingRate | null }>;

export const TERMINAL_REFUNDS_KEY = '@terminalRefunds:v1'; // Compatibility only; never read.
const listeners = new Set<(walletId: string, network: TerminalNetwork) => void>();
const LIMB = 1_000_000_000;
type RefundRow = { payload: string };

function timestamp(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function sats(value: unknown, zero = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (zero ? value >= 0 : value > 0);
}
function validInvoice(value: unknown, network: TerminalNetwork): value is string {
  return typeof value === 'string' && new RegExp(`^ln${network === 'mainnet' ? 'bc' : 'tb'}[a-z0-9]+$`, 'i').test(value);
}

export function isTerminalRefundAttempt(value: unknown, walletId: string, network: TerminalNetwork): value is TerminalRefundAttempt {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return typeof a.id === 'string' && !!a.id && a.walletId === walletId && a.network === network &&
    typeof a.saleId === 'string' && !!a.saleId && validInvoice(a.saleInvoice, network) && validInvoice(a.invoice, network) &&
    sats(a.amountSats) && sats(a.feeSats, true) && timestamp(a.quoteExpiresAt) && timestamp(a.createdAt) && timestamp(a.updatedAt) &&
    (a.status === 'unknown' || a.status === 'pending' || a.status === 'complete' || a.status === 'failed') &&
    (a.paymentId === undefined || (typeof a.paymentId === 'string' && !!a.paymentId)) &&
    (a.reportingRate === undefined || a.reportingRate === null || isTerminalReportingRate(a.reportingRate));
}

function copyAttempt(attempt: TerminalRefundAttempt): TerminalRefundAttempt {
  return { ...attempt, ...(attempt.reportingRate !== undefined ?
    { reportingRate: attempt.reportingRate ? { ...attempt.reportingRate } : null } : {}) };
}
function decodeAttempt(row: RefundRow, walletId: string, network: TerminalNetwork): TerminalRefundAttempt {
  let value: unknown;
  try { value = JSON.parse(row.payload); } catch { throw new Error('Saved Terminal refund is unreadable.'); }
  if (!isTerminalRefundAttempt(value, walletId, network)) throw new Error('Saved Terminal refund is invalid.');
  return copyAttempt(value);
}
function limbs(value: number): [number, number] { return [Math.floor(value / LIMB), value % LIMB]; }
function payload(attempt: TerminalRefundAttempt): string { return JSON.stringify(attempt); }

async function findIdentity(db: SQLiteDatabase, walletId: string, network: TerminalNetwork, id: string, invoice?: string): Promise<TerminalRefundAttempt | null> {
  const row = invoice ? await db.getFirstAsync<RefundRow>(`SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=?
    AND (id=? OR normalized_invoice=?) LIMIT 1`, [walletId, network, id, normalizeInvoice(invoice)]) :
    await db.getFirstAsync<RefundRow>('SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=? AND id=?', [walletId, network, id]);
  return row ? decodeAttempt(row, walletId, network) : null;
}

async function insertAttempt(db: SQLiteDatabase, attempt: TerminalRefundAttempt): Promise<void> {
  const [hi, lo] = limbs(attempt.amountSats);
  await db.runAsync(`INSERT INTO terminal_refunds
    (wallet_id,network,id,sale_id,normalized_invoice,status,payment_id,amount_hi,amount_lo,created_at,updated_at,payload)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [attempt.walletId, attempt.network, attempt.id, attempt.saleId,
    normalizeInvoice(attempt.invoice), attempt.status, attempt.paymentId ?? null, hi, lo, attempt.createdAt, attempt.updatedAt, payload(attempt)]);
}
async function replaceAttempt(db: SQLiteDatabase, attempt: TerminalRefundAttempt): Promise<void> {
  const result = await db.runAsync(`UPDATE terminal_refunds SET status=?,payment_id=?,updated_at=?,payload=?
    WHERE wallet_id=? AND network=? AND id=?`, [attempt.status, attempt.paymentId ?? null, attempt.updatedAt, payload(attempt),
    attempt.walletId, attempt.network, attempt.id]);
  if (result.changes !== 1) throw new Error('Terminal refund update lost its target.');
}

function notify(walletId: string, network: TerminalNetwork): void {
  for (const listener of listeners) try { listener(walletId, network); } catch { /* committed */ }
}
export function subscribeTerminalRefunds(listener: (walletId: string, network: TerminalNetwork) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export function getTerminalRefund(walletId: string, network: string, id: string): Promise<TerminalRefundAttempt | null> {
  const identity = terminalScope(walletId, network);
  if (typeof id !== 'string' || !id) return Promise.reject(new Error('Invalid Terminal refund ID.'));
  return serializeTerminalDatabase(db => findIdentity(db, identity.walletId, identity.network, id));
}
export function findTerminalRefundByInvoice(walletId: string, network: string, invoice: string): Promise<TerminalRefundAttempt | null> {
  const identity = terminalScope(walletId, network);
  if (!validInvoice(invoice, identity.network)) return Promise.reject(new Error('Invalid Terminal refund invoice.'));
  return serializeTerminalDatabase(async db => {
    const row = await db.getFirstAsync<RefundRow>('SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=? AND normalized_invoice=?',
      [identity.walletId, identity.network, normalizeInvoice(invoice)]);
    return row ? decodeAttempt(row, identity.walletId, identity.network) : null;
  });
}
export function listTerminalRefunds(walletId: string, network: string): Promise<TerminalRefundAttempt[]> {
  const identity = terminalScope(walletId, network);
  return serializeTerminalDatabase(async db => (await db.getAllAsync<RefundRow>(
    'SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=? ORDER BY updated_at DESC,id DESC',
    [identity.walletId, identity.network])).map(row => decodeAttempt(row, identity.walletId, identity.network)));
}
export function listTerminalRefundsForSale(walletId: string, network: string, saleId: string): Promise<TerminalRefundAttempt[]> {
  const identity = terminalScope(walletId, network);
  if (typeof saleId !== 'string' || !saleId) return Promise.reject(new Error('Invalid Terminal sale ID.'));
  return serializeTerminalDatabase(async db => (await db.getAllAsync<RefundRow>(`SELECT payload FROM terminal_refunds
    WHERE wallet_id=? AND network=? AND sale_id=? ORDER BY updated_at DESC,id DESC`, [identity.walletId, identity.network, saleId]))
    .map(row => decodeAttempt(row, identity.walletId, identity.network)));
}
export function listTerminalRefundsForInvoices(walletId: string, network: string, invoices: readonly string[]): Promise<TerminalRefundAttempt[]> {
  const identity = terminalScope(walletId, network);
  if (!Array.isArray(invoices) || invoices.some(invoice => !validInvoice(invoice, identity.network))) return Promise.reject(new Error('Invalid Terminal refund invoices.'));
  const normalized = [...new Set(invoices.map(normalizeInvoice))];
  return serializeTerminalDatabase(async db => {
    const result: TerminalRefundAttempt[] = [];
    for (let offset = 0; offset < normalized.length; offset += 100) {
      const chunk = normalized.slice(offset, offset + 100); if (!chunk.length) continue;
      const rows = await db.getAllAsync<RefundRow>(`SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=?
        AND normalized_invoice IN (${chunk.map(() => '?').join(',')}) ORDER BY updated_at DESC,id DESC`, [identity.walletId, identity.network, ...chunk]);
      result.push(...rows.map(row => decodeAttempt(row, identity.walletId, identity.network)));
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  });
}

export function remainingTerminalRefundSats(sale: TerminalSale, attempts: readonly TerminalRefundAttempt[]): number {
  if (sale.status !== 'received') throw new Error('Only received Terminal sales can be refunded.');
  const used = attempts.reduce((sum, attempt) => attempt.walletId === sale.request.walletId && attempt.network === sale.request.network &&
    attempt.saleId === sale.request.id && attempt.status !== 'failed' ? sum + BigInt(attempt.amountSats) : sum, 0n);
  const remaining = BigInt(sale.request.amountSats) - used;
  if (remaining < 0n) throw new Error('Terminal refunds exceed the sale amount.');
  return Number(remaining);
}

export function reserveTerminalRefund(sale: TerminalSale, reservation: TerminalRefundReservation): Promise<TerminalRefundAttempt> {
  const identity = terminalScope(sale.request.walletId, sale.request.network);
  if (!reservation || typeof reservation.id !== 'string' || !reservation.id || !validInvoice(reservation.invoice, identity.network) || !sats(reservation.amountSats) ||
      !sats(reservation.feeSats, true) || !timestamp(reservation.quoteExpiresAt) ||
      (reservation.reportingRate !== undefined && reservation.reportingRate !== null && !isTerminalReportingRate(reservation.reportingRate))) {
    return Promise.reject(new Error('Invalid or expired Terminal refund quote.'));
  }
  const now = Date.now();
  const attempt: TerminalRefundAttempt = { id: reservation.id, walletId: identity.walletId, network: identity.network,
    saleId: sale.request.id, saleInvoice: sale.request.invoice, invoice: reservation.invoice, amountSats: reservation.amountSats,
    feeSats: reservation.feeSats, quoteExpiresAt: reservation.quoteExpiresAt,
    ...(reservation.reportingRate !== undefined ? { reportingRate: reservation.reportingRate ? { ...reservation.reportingRate } : null } : {}),
    createdAt: now, status: 'unknown', updatedAt: now };
  let changed = false;
  return transactTerminalDatabase(async db => {
    const existing = await findIdentity(db, identity.walletId, identity.network, attempt.id, attempt.invoice);
    if (existing) {
      if (existing.id !== attempt.id || existing.saleId !== attempt.saleId || existing.invoice !== attempt.invoice ||
          existing.amountSats !== attempt.amountSats || existing.feeSats !== attempt.feeSats || existing.quoteExpiresAt !== attempt.quoteExpiresAt) {
        throw new Error('Terminal refund identity conflicts with a saved attempt.');
      }
      return existing;
    }
    const paidSale = await getTerminalSaleInDatabase(db, identity.walletId, identity.network, sale.request.id);
    if (!paidSale || paidSale.request.invoice !== sale.request.invoice || paidSale.status !== 'received') throw new Error('Terminal sale is not verified as received.');
    const rows = await db.getAllAsync<RefundRow>('SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=? AND sale_id=?',
      [identity.walletId, identity.network, attempt.saleId]);
    const attempts = rows.map(row => decodeAttempt(row, identity.walletId, identity.network));
    if (attempts.some(item => item.status === 'unknown' || item.status === 'pending')) throw new Error('A Terminal refund for this sale is still unresolved.');
    if (attempt.amountSats > remainingTerminalRefundSats(paidSale, attempts)) throw new Error('Refund exceeds the remaining sale amount.');
    if (attempt.quoteExpiresAt <= Date.now()) throw new Error('Terminal refund quote expired.');
    await insertAttempt(db, attempt); changed = true; return copyAttempt(attempt);
  }).then(value => { if (changed) notify(identity.walletId, identity.network); return value; });
}

function immutableFields(attempt: TerminalRefundAttempt): string {
  const rate = attempt.reportingRate;
  return JSON.stringify({ id: attempt.id, walletId: attempt.walletId, network: attempt.network, saleId: attempt.saleId,
    saleInvoice: attempt.saleInvoice, invoice: attempt.invoice, amountSats: attempt.amountSats, feeSats: attempt.feeSats,
    quoteExpiresAt: attempt.quoteExpiresAt, createdAt: attempt.createdAt,
    reportingRate: rate ? { currency: rate.currency, rate: rate.rate, fetchedAt: rate.fetchedAt, source: rate.source, status: rate.status } : rate });
}

export function updateTerminalRefund(attempt: TerminalRefundAttempt,
  payment: { status: TerminalRefundStatus; paymentId?: string }, observedAt = Date.now()): Promise<TerminalRefundAttempt> {
  const identity = terminalScope(attempt.walletId, attempt.network);
  if (!isTerminalRefundAttempt(attempt, identity.walletId, identity.network) || !['unknown', 'pending', 'complete', 'failed'].includes(payment.status) ||
      (payment.paymentId !== undefined && (!payment.paymentId || typeof payment.paymentId !== 'string')) || !timestamp(observedAt)) {
    return Promise.reject(new Error('Invalid Terminal refund update.'));
  }
  let changed = false;
  return transactTerminalDatabase(async db => {
    const existing = await findIdentity(db, identity.walletId, identity.network, attempt.id);
    if (!existing || immutableFields(existing) !== immutableFields(attempt)) throw new Error('Terminal refund attempt does not match saved history.');
    if (existing.status === 'complete' || existing.status === 'failed' || (existing.status === 'pending' && payment.status === 'unknown')) return existing;
    const paymentId = payment.paymentId ?? existing.paymentId;
    if (existing.status === payment.status && existing.paymentId === paymentId) return existing;
    const updated = { ...existing, status: payment.status, ...(paymentId ? { paymentId } : {}), updatedAt: observedAt } as TerminalRefundAttempt;
    await replaceAttempt(db, updated); changed = true; return copyAttempt(updated);
  }).then(value => { if (changed) notify(identity.walletId, identity.network); return value; });
}

export function reconcileTerminalRefunds(walletId: string, network: string,
  payments: readonly { invoice: string; status: 'complete' | 'pending' | 'failed'; paymentId: string }[], observedAt = Date.now()): Promise<number> {
  const identity = terminalScope(walletId, network);
  if (!Array.isArray(payments) || !timestamp(observedAt) || payments.some(p => !p || !validInvoice(p.invoice, identity.network) ||
      !['complete', 'pending', 'failed'].includes(p.status) || typeof p.paymentId !== 'string' || !p.paymentId)) {
    return Promise.reject(new Error('Invalid Terminal refund history.'));
  }
  const byInvoice = new Map<string, (typeof payments)[number]>();
  for (const payment of payments) { const key = normalizeInvoice(payment.invoice), prior = byInvoice.get(key);
    if (!prior || payment.status === 'complete' || (prior.status !== 'complete' && prior.status === 'pending' && payment.status === 'failed')) byInvoice.set(key, payment); }
  let changed = 0;
  return transactTerminalDatabase(async db => {
    const invoices = [...byInvoice.keys()];
    for (let offset = 0; offset < invoices.length; offset += 100) {
      const chunk = invoices.slice(offset, offset + 100); if (!chunk.length) continue;
      const rows = await db.getAllAsync<RefundRow>(`SELECT payload FROM terminal_refunds WHERE wallet_id=? AND network=?
        AND normalized_invoice IN (${chunk.map(() => '?').join(',')})`, [identity.walletId, identity.network, ...chunk]);
      for (const row of rows) {
        const attempt = decodeAttempt(row, identity.walletId, identity.network), payment = byInvoice.get(normalizeInvoice(attempt.invoice));
        if (!payment || attempt.status === 'complete') continue;
        if (payment.status === 'failed' && (!attempt.paymentId || attempt.paymentId !== payment.paymentId)) continue;
        if (attempt.status === 'failed' && (payment.status !== 'complete' || !attempt.paymentId || attempt.paymentId !== payment.paymentId)) continue;
        if (attempt.status === payment.status && attempt.paymentId === payment.paymentId) continue;
        await replaceAttempt(db, { ...attempt, status: payment.status, paymentId: payment.paymentId, updatedAt: observedAt }); changed++;
      }
    }
    return changed;
  }).then(value => { if (value) notify(identity.walletId, identity.network); return value; });
}

export function removeTerminalRefunds(walletId: string, network: string): Promise<void> {
  const identity = terminalScope(walletId, network); let changed = false;
  return transactTerminalDatabase(async db => { changed = (await db.runAsync(
    'DELETE FROM terminal_refunds WHERE wallet_id=? AND network=?', [identity.walletId, identity.network])).changes > 0;
  }).then(() => { if (changed) notify(identity.walletId, identity.network); });
}

export function getTerminalRefundTotal(walletId: string, network: string, range: TerminalRange): Promise<bigint> {
  const identity = terminalScope(walletId, network);
  const validRange = range === null || (!!range && typeof range === 'object' && Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) && range.start >= 0 && range.end > range.start);
  if (!validRange) {
    return Promise.reject(new Error('Invalid Terminal refund range.'));
  }
  return serializeTerminalDatabase(async db => {
    const rangeSql = range ? ' AND updated_at>=? AND updated_at<?' : '';
    const rangeArgs = range ? [range.start, range.end] : [];
    const row = await db.getFirstAsync<{ hi: string | null; lo: string | null }>(`SELECT
      CAST(COALESCE(SUM(amount_hi),0) AS TEXT) AS hi,CAST(COALESCE(SUM(amount_lo),0) AS TEXT) AS lo
      FROM terminal_refunds WHERE wallet_id=? AND network=? AND status='complete'${rangeSql}`,
    [identity.walletId, identity.network, ...rangeArgs]);
    try { return BigInt(row?.hi ?? '0') * BigInt(LIMB) + BigInt(row?.lo ?? '0'); }
    catch { throw new Error('Terminal aggregate overflow.'); }
  });
}

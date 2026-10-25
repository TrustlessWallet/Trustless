import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeInvoice, terminalNetwork, TerminalNetwork } from './terminal';
import { listTerminalSales, TerminalSale } from './terminalSales';
import { isTerminalReportingRate, TerminalReportingRate } from './terminalRates';

export type TerminalRefundStatus = 'unknown' | 'pending' | 'complete' | 'failed';
export type TerminalRefundAttempt = Readonly<{
  id: string;
  walletId: string;
  network: TerminalNetwork;
  saleId: string;
  saleInvoice: string;
  invoice: string;
  amountSats: number;
  feeSats: number;
  quoteExpiresAt: number;
  createdAt: number;
  status: TerminalRefundStatus;
  paymentId?: string;
  reportingRate?: TerminalReportingRate | null;
  updatedAt: number;
}>;
export type TerminalRefundReservation = Readonly<{
  id: string;
  invoice: string;
  amountSats: number;
  feeSats: number;
  quoteExpiresAt: number;
  reportingRate?: TerminalReportingRate | null;
}>;

export const TERMINAL_REFUNDS_KEY = '@terminalRefunds:v1';
const scopedKey = (walletId: string, network: TerminalNetwork) => `${TERMINAL_REFUNDS_KEY}:${network}:${walletId}`;
const listeners = new Set<(walletId: string, network: TerminalNetwork) => void>();
let storageQueue: Promise<unknown> = Promise.resolve();
const validated = new Map<string, { raw: string; attempts: TerminalRefundAttempt[] }>();
const CACHE_LIMIT = 2;

function copyAttempt(attempt: TerminalRefundAttempt): TerminalRefundAttempt {
  return { ...attempt,
    ...(attempt.reportingRate !== undefined ? { reportingRate: attempt.reportingRate ? { ...attempt.reportingRate } : null } : {}),
  };
}

function remember(key: string, raw: string, attempts: TerminalRefundAttempt[]): void {
  validated.delete(key);
  validated.set(key, { raw, attempts });
  if (validated.size > CACHE_LIMIT) validated.delete(validated.keys().next().value!);
}

function newestFirst(a: TerminalRefundAttempt, b: TerminalRefundAttempt): number {
  return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.catch(() => undefined);
  return result;
}

function scope(walletId: string, network: string): { walletId: string; network: TerminalNetwork } {
  if (typeof walletId !== 'string' || !walletId.trim() || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function sats(value: unknown, zeroAllowed = false): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && (zeroAllowed ? value >= 0 : value > 0);
}

function validInvoice(value: unknown, network: TerminalNetwork): value is string {
  return typeof value === 'string' && new RegExp(`^ln${network === 'mainnet' ? 'bc' : 'tb'}[a-z0-9]+$`, 'i').test(value);
}

function isAttempt(value: unknown, walletId: string, network: TerminalNetwork): value is TerminalRefundAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Record<string, unknown>;
  return typeof attempt.id === 'string' && !!attempt.id &&
    attempt.walletId === walletId && attempt.network === network &&
    typeof attempt.saleId === 'string' && !!attempt.saleId &&
    validInvoice(attempt.saleInvoice, network) && validInvoice(attempt.invoice, network) &&
    sats(attempt.amountSats) && sats(attempt.feeSats, true) &&
    timestamp(attempt.quoteExpiresAt) && timestamp(attempt.createdAt) && timestamp(attempt.updatedAt) &&
    (attempt.status === 'unknown' || attempt.status === 'pending' || attempt.status === 'complete' || attempt.status === 'failed') &&
    (attempt.paymentId === undefined || (typeof attempt.paymentId === 'string' && !!attempt.paymentId)) &&
    (attempt.reportingRate === undefined || attempt.reportingRate === null || isTerminalReportingRate(attempt.reportingRate));
}

async function readAttempts(walletId: string, network: TerminalNetwork): Promise<TerminalRefundAttempt[]> {
  const key = scopedKey(walletId, network);
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) {
    validated.delete(key);
    return [];
  }
  const hit = validated.get(key);
  if (hit?.raw === raw) {
    remember(key, raw, hit.attempts);
    return hit.attempts.map(copyAttempt);
  }
  validated.delete(key);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved Terminal refunds are unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 || !Array.isArray((parsed as any).attempts)) {
    throw new Error('Saved Terminal refunds are invalid.');
  }
  const attempts = (parsed as { attempts: unknown[] }).attempts;
  if (!attempts.every(value => isAttempt(value, walletId, network))) throw new Error('Saved Terminal refunds are invalid.');
  const ids = new Set<string>();
  const invoices = new Set<string>();
  const unresolved = new Set<string>();
  for (const attempt of attempts as TerminalRefundAttempt[]) {
    const invoice = normalizeInvoice(attempt.invoice);
    if (ids.has(attempt.id) || invoices.has(invoice)) throw new Error('Saved Terminal refunds contain duplicates.');
    ids.add(attempt.id);
    invoices.add(invoice);
    if (attempt.status === 'unknown' || attempt.status === 'pending') {
      if (unresolved.has(attempt.saleId)) throw new Error('Saved Terminal refunds have concurrent attempts.');
      unresolved.add(attempt.saleId);
    }
  }
  const sorted = (attempts as TerminalRefundAttempt[]).sort(newestFirst);
  remember(key, raw, sorted);
  return sorted.map(copyAttempt);
}

function notify(walletId: string, network: TerminalNetwork): void {
  for (const listener of listeners) {
    try { listener(walletId, network); } catch { /* A listener cannot undo a committed refund record. */ }
  }
}

async function writeAttempts(walletId: string, network: TerminalNetwork, attempts: TerminalRefundAttempt[]): Promise<void> {
  const key = scopedKey(walletId, network);
  await AsyncStorage.setItem(key, JSON.stringify({ version: 1, attempts }));
  validated.delete(key);
  notify(walletId, network);
}

function immutableFields(attempt: TerminalRefundAttempt): string {
  const rate = attempt.reportingRate;
  return JSON.stringify({
    id: attempt.id, walletId: attempt.walletId, network: attempt.network,
    saleId: attempt.saleId, saleInvoice: attempt.saleInvoice, invoice: attempt.invoice,
    amountSats: attempt.amountSats, feeSats: attempt.feeSats,
    quoteExpiresAt: attempt.quoteExpiresAt, createdAt: attempt.createdAt,
    reportingRate: rate ? { currency: rate.currency, rate: rate.rate, fetchedAt: rate.fetchedAt,
      source: rate.source, status: rate.status } : rate,
  });
}

export function subscribeTerminalRefunds(listener: (walletId: string, network: TerminalNetwork) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function listTerminalRefunds(walletId: string, network: string): Promise<TerminalRefundAttempt[]> {
  const identity = scope(walletId, network);
  return serial(() => readAttempts(identity.walletId, identity.network));
}

export function remainingTerminalRefundSats(sale: TerminalSale, attempts: readonly TerminalRefundAttempt[]): number {
  if (sale.status !== 'received') throw new Error('Only received Terminal sales can be refunded.');
  const used = attempts.reduce((total, attempt) => {
    if (attempt.walletId !== sale.request.walletId || attempt.network !== sale.request.network ||
        attempt.saleId !== sale.request.id || attempt.status === 'failed') return total;
    return total + BigInt(attempt.amountSats);
  }, 0n);
  const remaining = BigInt(sale.request.amountSats) - used;
  if (remaining < 0n) throw new Error('Terminal refunds exceed the sale amount.');
  return Number(remaining);
}

export function reserveTerminalRefund(sale: TerminalSale, reservation: TerminalRefundReservation): Promise<TerminalRefundAttempt> {
  const identity = scope(sale.request.walletId, sale.request.network);
  if (typeof reservation.id !== 'string' || !reservation.id || !validInvoice(reservation.invoice, identity.network) ||
      !sats(reservation.amountSats) || !sats(reservation.feeSats, true) ||
      !timestamp(reservation.quoteExpiresAt) ||
      (reservation.reportingRate !== undefined && reservation.reportingRate !== null && !isTerminalReportingRate(reservation.reportingRate))) {
    return Promise.reject(new Error('Invalid or expired Terminal refund quote.'));
  }
  const now = Date.now();
  const attempt: TerminalRefundAttempt = {
    id: reservation.id, walletId: identity.walletId, network: identity.network,
    saleId: sale.request.id, saleInvoice: sale.request.invoice,
    invoice: reservation.invoice, amountSats: reservation.amountSats,
    feeSats: reservation.feeSats, quoteExpiresAt: reservation.quoteExpiresAt,
    ...(reservation.reportingRate !== undefined ? { reportingRate: reservation.reportingRate ? { ...reservation.reportingRate } : null } : {}),
    createdAt: now, status: 'unknown', updatedAt: now,
  };
  return serial(async () => {
    const attempts = await readAttempts(identity.walletId, identity.network);
    const existing = attempts.find(item => item.id === attempt.id ||
      normalizeInvoice(item.invoice) === normalizeInvoice(attempt.invoice));
    if (existing) {
      if (existing.id !== attempt.id || existing.saleId !== attempt.saleId ||
          existing.invoice !== attempt.invoice || existing.amountSats !== attempt.amountSats ||
          existing.feeSats !== attempt.feeSats || existing.quoteExpiresAt !== attempt.quoteExpiresAt) {
        throw new Error('Terminal refund identity conflicts with a saved attempt.');
      }
      return existing;
    }
    const paidSale = (await listTerminalSales(identity.walletId, identity.network)).find(item =>
      item.request.id === sale.request.id && item.request.invoice === sale.request.invoice);
    if (!paidSale || paidSale.status !== 'received') throw new Error('Terminal sale is not verified as received.');
    if (attempts.some(item => item.saleId === attempt.saleId && (item.status === 'unknown' || item.status === 'pending'))) {
      throw new Error('A Terminal refund for this sale is still unresolved.');
    }
    if (attempt.amountSats > remainingTerminalRefundSats(paidSale, attempts)) throw new Error('Refund exceeds the remaining sale amount.');
    if (attempt.quoteExpiresAt <= Date.now()) throw new Error('Terminal refund quote expired.');
    await writeAttempts(identity.walletId, identity.network, [...attempts, attempt]);
    return attempt;
  });
}

export function updateTerminalRefund(
  attempt: TerminalRefundAttempt,
  payment: { status: TerminalRefundStatus; paymentId?: string },
  observedAt = Date.now(),
): Promise<TerminalRefundAttempt> {
  const identity = scope(attempt.walletId, attempt.network);
  if (!isAttempt(attempt, identity.walletId, identity.network) ||
      (payment.status !== 'unknown' && payment.status !== 'pending' && payment.status !== 'complete' && payment.status !== 'failed') ||
      (payment.paymentId !== undefined && (typeof payment.paymentId !== 'string' || !payment.paymentId)) ||
      !timestamp(observedAt)) return Promise.reject(new Error('Invalid Terminal refund update.'));
  return serial(async () => {
    const attempts = await readAttempts(identity.walletId, identity.network);
    const existing = attempts.find(item => item.id === attempt.id);
    if (!existing || immutableFields(existing) !== immutableFields(attempt)) throw new Error('Terminal refund attempt does not match saved history.');
    if (existing.status === 'complete' || existing.status === 'failed' ||
        (existing.status === 'pending' && payment.status === 'unknown')) return existing;
    const paymentId = payment.paymentId ?? existing.paymentId;
    if (existing.status === payment.status && existing.paymentId === paymentId) return existing;
    const updated: TerminalRefundAttempt = {
      ...existing, status: payment.status, ...(paymentId ? { paymentId } : {}), updatedAt: observedAt,
    };
    await writeAttempts(identity.walletId, identity.network, attempts.map(item => item === existing ? updated : item));
    return updated;
  });
}

export function reconcileTerminalRefunds(
  walletId: string,
  network: string,
  payments: readonly { invoice: string; status: 'complete' | 'pending' | 'failed'; paymentId: string }[],
  observedAt = Date.now(),
): Promise<number> {
  const identity = scope(walletId, network);
  if (!Array.isArray(payments) || !timestamp(observedAt) || payments.some(payment =>
    !payment || !validInvoice(payment.invoice, identity.network) ||
    (payment.status !== 'complete' && payment.status !== 'pending' && payment.status !== 'failed') ||
    typeof payment.paymentId !== 'string' || !payment.paymentId)) {
    return Promise.reject(new Error('Invalid Terminal refund history.'));
  }
  return serial(async () => {
    const attempts = await readAttempts(identity.walletId, identity.network);
    if (!attempts.length || !payments.length) return 0;
    const byInvoice = new Map<string, (typeof payments)[number]>();
    for (const payment of payments) {
      const invoice = normalizeInvoice(payment.invoice);
      const prior = byInvoice.get(invoice);
      if (!prior || payment.status === 'complete' ||
          (prior.status !== 'complete' && prior.status === 'pending' && payment.status === 'failed')) byInvoice.set(invoice, payment);
    }
    let changed = 0;
    const next = attempts.map(attempt => {
      const payment = byInvoice.get(normalizeInvoice(attempt.invoice));
      if (!payment || attempt.status === 'complete') return attempt;
      // An old failed send to the same invoice cannot prove this attempt failed.
      // Only the payment ID returned for this attempt may release its reservation.
      if (payment.status === 'failed' && (!attempt.paymentId || attempt.paymentId !== payment.paymentId)) return attempt;
      if (attempt.status === 'failed' && (payment.status !== 'complete' || !attempt.paymentId || attempt.paymentId !== payment.paymentId)) return attempt;
      if (attempt.status === payment.status && attempt.paymentId === payment.paymentId) return attempt;
      changed++;
      return { ...attempt, status: payment.status, paymentId: payment.paymentId, updatedAt: observedAt };
    });
    if (changed) await writeAttempts(identity.walletId, identity.network, next);
    return changed;
  });
}

export function removeTerminalRefunds(walletId: string, network: string): Promise<void> {
  const identity = scope(walletId, network);
  return serial(async () => {
    const key = scopedKey(identity.walletId, identity.network);
    if (await AsyncStorage.getItem(key) === null) {
      validated.delete(key);
      return;
    }
    await AsyncStorage.removeItem(key);
    validated.delete(key);
    notify(identity.walletId, identity.network);
  });
}

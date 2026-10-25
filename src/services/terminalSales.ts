import AsyncStorage from '@react-native-async-storage/async-storage';
import { isTerminalRequest, normalizeInvoice, terminalNetwork, TerminalNetwork, TerminalRequest } from './terminal';
import { FiatCurrency } from './terminalRates';

export type TerminalSalePaymentStatus = 'unknown' | 'pending' | 'received';
export type TerminalSale = Readonly<{
  request: TerminalRequest;
  status: TerminalSalePaymentStatus;
  paymentId?: string;
  // Time the completed payment was first observed locally; the SDK does not
  // supply a settlement timestamp here.
  receivedAt?: number;
  updatedAt: number;
}>;

export const TERMINAL_SALES_KEY = '@terminalSales:v1';
const scopedKey = (walletId: string, network: TerminalNetwork) => `${TERMINAL_SALES_KEY}:${network}:${walletId}`;
const listeners = new Set<(walletId: string, network: TerminalNetwork) => void>();
let storageQueue: Promise<unknown> = Promise.resolve();
// Keep only recently used scopes. The raw value is checked against storage on every read.
const validated = new Map<string, { raw: string; sales: TerminalSale[] }>();
const CACHE_LIMIT = 2;

function copySale(sale: TerminalSale): TerminalSale {
  const request = sale.request;
  return {
    ...sale,
    request: {
      ...request,
      ...(request.fiat ? { fiat: { ...request.fiat } } : {}),
      ...(request.reportingRate !== undefined ? { reportingRate: request.reportingRate ? { ...request.reportingRate } : null } : {}),
      ...(request.basket ? { basket: {
        ...request.basket,
        lines: request.basket.lines.map(line => ({ ...line })),
      } } : {}),
    },
  };
}

function remember(key: string, raw: string, sales: TerminalSale[]): void {
  validated.delete(key);
  validated.set(key, { raw, sales });
  if (validated.size > CACHE_LIMIT) validated.delete(validated.keys().next().value!);
}

function newestFirst(a: TerminalSale, b: TerminalSale): number {
  return b.request.createdAt - a.request.createdAt || b.request.id.localeCompare(a.request.id);
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.catch(() => undefined);
  return result;
}

function scope(walletId: string, network: string): { walletId: string; network: TerminalNetwork } {
  if (typeof walletId !== 'string' || !walletId.trim() || walletId !== walletId.trim()) {
    throw new Error('Invalid Terminal wallet.');
  }
  return { walletId, network: terminalNetwork(network) };
}

function snapshot(request: TerminalRequest): TerminalRequest {
  if (!isTerminalRequest(request)) throw new Error('Invalid Terminal payment request.');
  scope(request.walletId, request.network);
  return {
    id: request.id,
    walletId: request.walletId,
    network: request.network,
    invoice: request.invoice,
    amountSats: request.amountSats,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    ...(request.fiat ? { fiat: { ...request.fiat } } : {}),
    ...(request.reportingRate !== undefined ? { reportingRate: request.reportingRate ? { ...request.reportingRate } : null } : {}),
    ...(request.inputUnit ? { inputUnit: request.inputUnit } : {}),
    ...(request.basket ? { basket: {
      unit: request.basket.unit,
      total: request.basket.total,
      lines: request.basket.lines.map(line => ({ itemId: line.itemId, name: line.name, unitPrice: line.unitPrice, quantity: line.quantity, total: line.total })),
    } } : {}),
  };
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isSale(value: unknown, walletId: string, network: TerminalNetwork): value is TerminalSale {
  if (!value || typeof value !== 'object') return false;
  const sale = value as Record<string, unknown>;
  const request = sale.request;
  return isTerminalRequest(request) && request.walletId === walletId && request.network === network &&
    (sale.status === 'unknown' || sale.status === 'pending' || sale.status === 'received') &&
    (sale.paymentId === undefined || (typeof sale.paymentId === 'string' && !!sale.paymentId)) &&
    isTimestamp(sale.updatedAt) &&
    (sale.receivedAt === undefined || isTimestamp(sale.receivedAt)) &&
    (sale.status === 'received' ? isTimestamp(sale.receivedAt) && sale.receivedAt <= sale.updatedAt : sale.receivedAt === undefined);
}

async function readSales(walletId: string, network: TerminalNetwork): Promise<TerminalSale[]> {
  const key = scopedKey(walletId, network);
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) {
    validated.delete(key);
    return [];
  }
  const hit = validated.get(key);
  if (hit?.raw === raw) {
    remember(key, raw, hit.sales);
    return hit.sales.map(copySale);
  }
  validated.delete(key);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved Terminal sales are unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 || !Array.isArray((parsed as any).sales)) {
    throw new Error('Saved Terminal sales are invalid.');
  }
  const sales = (parsed as { sales: unknown[] }).sales;
  if (!sales.every(sale => isSale(sale, walletId, network))) throw new Error('Saved Terminal sales are invalid.');
  const ids = new Set<string>();
  const invoices = new Set<string>();
  for (const sale of sales as TerminalSale[]) {
    const invoice = normalizeInvoice(sale.request.invoice);
    if (ids.has(sale.request.id) || invoices.has(invoice)) throw new Error('Saved Terminal sales contain duplicates.');
    ids.add(sale.request.id);
    invoices.add(invoice);
  }
  const sorted = (sales as TerminalSale[]).sort(newestFirst);
  remember(key, raw, sorted);
  return sorted.map(copySale);
}

async function writeSales(walletId: string, network: TerminalNetwork, sales: TerminalSale[]): Promise<void> {
  const key = scopedKey(walletId, network);
  await AsyncStorage.setItem(key, JSON.stringify({ version: 1, sales }));
  validated.delete(key);
  notify(walletId, network);
}

function notify(walletId: string, network: TerminalNetwork): void {
  for (const listener of listeners) {
    try { listener(walletId, network); } catch { /* A UI listener cannot undo a committed sale. */ }
  }
}

function findSale(sales: TerminalSale[], request: TerminalRequest): TerminalSale | undefined {
  const match = sales.find(sale => sale.request.id === request.id ||
    normalizeInvoice(sale.request.invoice) === normalizeInvoice(request.invoice));
  if (match && JSON.stringify(match.request) !== JSON.stringify(request)) {
    throw new Error('Terminal sale identity conflicts with a saved request.');
  }
  return match;
}

export function subscribeTerminalSales(listener: (walletId: string, network: TerminalNetwork) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function listTerminalSales(walletId: string, network: string): Promise<TerminalSale[]> {
  const identity = scope(walletId, network);
  return serial(async () => {
    const sales = await readSales(identity.walletId, identity.network);
    return sales;
  });
}

export function removeTerminalSales(walletId: string, network: string): Promise<void> {
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

export function recordTerminalSale(request: TerminalRequest): Promise<TerminalSale> {
  const immutableRequest = snapshot(request);
  return serial(async () => {
    const sales = await readSales(immutableRequest.walletId, immutableRequest.network);
    const existing = findSale(sales, immutableRequest);
    if (existing) return existing;
    const sale: TerminalSale = { request: immutableRequest, status: 'unknown', updatedAt: Date.now() };
    await writeSales(immutableRequest.walletId, immutableRequest.network, [...sales, sale]);
    return sale;
  });
}

export function updateTerminalSalePayment(
  request: TerminalRequest,
  payment: { status: TerminalSalePaymentStatus; paymentId?: string },
  observedAt = Date.now(),
): Promise<TerminalSale> {
  const immutableRequest = snapshot(request);
  if (payment.status !== 'unknown' && payment.status !== 'pending' && payment.status !== 'received') {
    return Promise.reject(new Error('Invalid Terminal payment status.'));
  }
  if (payment.paymentId !== undefined && (typeof payment.paymentId !== 'string' || !payment.paymentId)) {
    return Promise.reject(new Error('Invalid Terminal payment ID.'));
  }
  if (!isTimestamp(observedAt)) return Promise.reject(new Error('Invalid observation time.'));
  return serial(async () => {
    const sales = await readSales(immutableRequest.walletId, immutableRequest.network);
    const existing = findSale(sales, immutableRequest);
    const current: TerminalSale = existing ?? { request: immutableRequest, status: 'unknown', updatedAt: observedAt };
    if (current.status === 'received' || (current.status === 'pending' && payment.status === 'unknown')) return current;
    const paymentId = payment.paymentId ?? current.paymentId;
    const changed = !existing || payment.status !== current.status || paymentId !== current.paymentId;
    if (!changed) return current;
    const next: TerminalSale = {
      request: current.request,
      status: payment.status,
      ...(paymentId ? { paymentId } : {}),
      ...(payment.status === 'received' ? { receivedAt: observedAt } : {}),
      updatedAt: observedAt,
    };
    const nextSales = existing ? sales.map(sale => sale === existing ? next : sale) : [...sales, next];
    await writeSales(immutableRequest.walletId, immutableRequest.network, nextSales);
    return next;
  });
}

export function reconcileTerminalSales(
  walletId: string,
  network: string,
  payments: readonly { invoice: string; status: 'received' | 'pending'; paymentId: string }[],
  observedAt = Date.now(),
): Promise<number> {
  const identity = scope(walletId, network);
  if (!Array.isArray(payments) || !isTimestamp(observedAt) || payments.some(payment =>
    !payment || typeof payment.invoice !== 'string' || !payment.invoice.trim() ||
    (payment.status !== 'received' && payment.status !== 'pending') ||
    typeof payment.paymentId !== 'string' || !payment.paymentId)) {
    return Promise.reject(new Error('Invalid Terminal payment history.'));
  }
  return serial(async () => {
    const sales = await readSales(identity.walletId, identity.network);
    if (!sales.length || !payments.length) return 0;
    const byInvoice = new Map<string, (typeof payments)[number]>();
    for (const payment of payments) {
      const invoice = normalizeInvoice(payment.invoice);
      const prior = byInvoice.get(invoice);
      if (!prior || (prior.status !== 'received' && payment.status === 'received')) byInvoice.set(invoice, payment);
    }
    let changed = 0;
    const next = sales.map(sale => {
      const payment = byInvoice.get(normalizeInvoice(sale.request.invoice));
      if (!payment || sale.status === 'received') return sale;
      const paymentId = payment.paymentId || sale.paymentId;
      if (sale.status === payment.status && sale.paymentId === paymentId) return sale;
      changed++;
      return {
        ...sale,
        status: payment.status,
        paymentId,
        ...(payment.status === 'received' ? { receivedAt: observedAt } : {}),
        updatedAt: observedAt,
      };
    });
    if (changed) await writeSales(identity.walletId, identity.network, next);
    return changed;
  });
}

export function terminalSaleDisplayStatus(sale: TerminalSale, now = Date.now()): 'received' | 'pending' | 'unpaid' | 'expired' {
  if (sale.status === 'received') return 'received';
  if (sale.status === 'pending') return 'pending';
  if (sale.request.expiresAt <= now) return 'expired';
  return 'unpaid';
}

export function localDayRange(now = Date.now()): { start: number; end: number } {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date.');
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  return { start, end };
}

export function summarizeTerminalSales(
  sales: readonly TerminalSale[],
  range: { start: number; end: number },
): { receivedCount: number; sats: bigint; fiatMinor: Partial<Record<FiatCurrency, bigint>> } {
  const result: { receivedCount: number; sats: bigint; fiatMinor: Partial<Record<FiatCurrency, bigint>> } = {
    receivedCount: 0, sats: 0n, fiatMinor: {},
  };
  for (const sale of sales) {
    if (sale.status !== 'received' || sale.receivedAt === undefined ||
        sale.receivedAt < range.start || sale.receivedAt >= range.end) continue;
    result.receivedCount++;
    result.sats += BigInt(sale.request.amountSats);
    if (sale.request.fiat) {
      const { currency, amountMinor } = sale.request.fiat;
      result.fiatMinor[currency] = (result.fiatMinor[currency] ?? 0n) + BigInt(amountMinor);
    }
  }
  return result;
}

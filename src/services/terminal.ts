import AsyncStorage from '@react-native-async-storage/async-storage';
import { FiatCurrency, isRateString, isTerminalReportingRate, TerminalReportingRate } from './terminalRates';

export type TerminalUnit = 'sats' | 'BTC' | FiatCurrency;
export type TerminalNetwork = 'mainnet' | 'testnet';
export type TerminalFiatQuote = Readonly<{ currency: FiatCurrency; amountMinor: number; rate: string; fetchedAt: number }>;
export type TerminalBasketLine = Readonly<{ itemId: string; name: string; unitPrice: number; quantity: number; total: number }>;
export type TerminalBasket = Readonly<{ unit: TerminalUnit; lines: readonly TerminalBasketLine[]; total: number }>;
export const isTerminalItemName = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 60 && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
export type TerminalRequest = Readonly<{
  id: string;
  walletId: string;
  network: TerminalNetwork;
  invoice: string;
  amountSats: number;
  createdAt: number;
  expiresAt: number;
  fiat?: TerminalFiatQuote;
  reportingRate?: TerminalReportingRate | null;
  inputUnit?: 'sats' | 'BTC';
  basket?: TerminalBasket;
}>;

export const TERMINAL_REQUEST_KEY = '@terminalActiveRequest';
const scopedKey = (walletId: string, network: string) => `${TERMINAL_REQUEST_KEY}:${network}:${walletId}`;
const legacyKeys = (walletId: string, network: TerminalNetwork) => network === 'mainnet'
  ? [scopedKey(walletId, 'Mainnet'), scopedKey(walletId, 'Bitcoin')]
  : [scopedKey(walletId, 'Testnet')];
const MAX_SATS = BigInt(Number.MAX_SAFE_INTEGER);

export function terminalNetwork(network: string): TerminalNetwork {
  if (network === 'Bitcoin' || network === 'Mainnet' || network === 'mainnet') return 'mainnet';
  if (network === 'Testnet' || network === 'testnet') return 'testnet';
  throw new Error('Unsupported Bitcoin network.');
}

export function parseTerminalAmount(input: string, unit: 'sats' | 'BTC'): number {
  if (unit === 'sats') {
    if (!/^[0-9]+$/.test(input)) throw new Error('Enter a whole number of sats.');
    const value = BigInt(input);
    if (value <= 0n || value > MAX_SATS) throw new Error('Enter a valid amount.');
    return Number(value);
  }
  if (!/^(?:[0-9]+)(?:\.[0-9]{1,8})?$/.test(input)) throw new Error('Enter BTC with up to 8 decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const value = BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0') || '0');
  if (value <= 0n || value > MAX_SATS) throw new Error('Enter a valid amount.');
  return Number(value);
}

export function formatTerminalAmount(sats: number, unit: 'sats' | 'BTC'): string {
  if (unit === 'sats') return String(sats);
  const whole = Math.floor(sats / 100000000);
  const fraction = String(sats % 100000000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

// Display formatting stays separate from exact amount parsing and saved quotes.
export function formatTerminalSats(sats: number): string {
  return String(sats).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function parseFiatMinor(input: string): number {
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(input)) throw new Error('Enter an amount with up to 2 decimal places.');
  const [whole, fraction = ''] = input.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (minor <= 0n || minor > MAX_SATS) throw new Error('Enter a valid amount.');
  return Number(minor);
}

export function formatFiatMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('Invalid fiat amount.');
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}

export function formatTerminalBasketAmount(value: number, unit: TerminalUnit): string {
  if (unit === 'sats') return `${formatTerminalSats(value)} sats`;
  if (unit === 'BTC') return `${formatTerminalAmount(value, 'BTC')} BTC`;
  return `${unit} ${formatFiatMinor(value)}`;
}

export function satsFromFiat(amountMinor: number, rate: string): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !isRateString(rate)) throw new Error('Invalid fiat quote.');
  const fractionLength = rate.includes('.') ? rate.length - rate.indexOf('.') - 1 : 0;
  const numerator = BigInt(rate.replace('.', ''));
  const denominator = 100n * numerator;
  const sats = (BigInt(amountMinor) * 100000000n * 10n ** BigInt(fractionLength) + denominator - 1n) / denominator;
  if (sats <= 0n || sats > MAX_SATS) throw new Error('Converted amount is too large.');
  return Number(sats);
}

export function normalizeInvoice(invoice: string): string {
  return invoice.trim().toLowerCase();
}

export function matchTerminalPayment(
  payment: { id: string; paymentType: number; status: number; details?: { tag: string; inner?: unknown } },
  invoice: string,
  receiveType: number,
  completedStatus: number,
  lightningTag: string,
): { status: 'received' | 'pending'; paymentId: string } | null {
  const candidate = payment.details?.inner as { invoice?: unknown } | undefined;
  if (payment.paymentType !== receiveType || payment.details?.tag !== lightningTag ||
      typeof candidate?.invoice !== 'string' ||
      normalizeInvoice(candidate.invoice) !== normalizeInvoice(invoice)) return null;
  return { status: payment.status === completedStatus ? 'received' : 'pending', paymentId: payment.id };
}

export function isTerminalRequest(value: unknown): value is TerminalRequest {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const fiat = r.fiat as Record<string, unknown> | undefined;
  const validFiat = fiat === undefined || (fiat && typeof fiat === 'object' &&
    (fiat.currency === 'USD' || fiat.currency === 'EUR' || fiat.currency === 'CHF') &&
    typeof fiat.amountMinor === 'number' && Number.isSafeInteger(fiat.amountMinor) && fiat.amountMinor > 0 &&
    isRateString(fiat.rate) && typeof fiat.fetchedAt === 'number' && Number.isSafeInteger(fiat.fetchedAt) && fiat.fetchedAt > 0 &&
    (() => { try { return satsFromFiat(fiat.amountMinor as number, fiat.rate as string) === r.amountSats; } catch { return false; } })());
  const basket = r.basket as Record<string, unknown> | undefined;
  const basketUnit = fiat ? fiat.currency : r.inputUnit ?? 'sats';
  const basketAmount = fiat ? fiat.amountMinor : r.amountSats;
  const validBasket = basket === undefined || (() => {
    if (!basket || typeof basket !== 'object' || basket.unit !== basketUnit || !Array.isArray(basket.lines) || basket.lines.length < 1 || basket.lines.length > 20 ||
      typeof basket.total !== 'number' || !Number.isSafeInteger(basket.total) || basket.total <= 0 || basket.total !== basketAmount) return false;
    let sum = 0n;
    const ids = new Set<string>();
    for (const value of basket.lines as unknown[]) {
      if (!value || typeof value !== 'object') return false;
      const line = value as Record<string, unknown>;
      if (typeof line.itemId !== 'string' || !line.itemId || line.itemId.length > 128 || line.itemId !== line.itemId.trim() || ids.has(line.itemId) ||
        !isTerminalItemName(line.name) ||
        typeof line.unitPrice !== 'number' || !Number.isSafeInteger(line.unitPrice) || line.unitPrice <= 0 ||
        typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 ||
        typeof line.total !== 'number' || !Number.isSafeInteger(line.total) || BigInt(line.unitPrice) * BigInt(line.quantity) !== BigInt(line.total)) return false;
      ids.add(line.itemId);
      sum += BigInt(line.total);
    }
    return sum === BigInt(basket.total);
  })();
  return !!validFiat && validBasket && (r.reportingRate === undefined || r.reportingRate === null || isTerminalReportingRate(r.reportingRate)) &&
    (r.inputUnit === undefined || r.inputUnit === 'sats' || r.inputUnit === 'BTC') &&
    !(fiat && r.inputUnit !== undefined) && typeof r.id === 'string' && !!r.id && typeof r.walletId === 'string' && !!r.walletId &&
    (r.network === 'mainnet' || r.network === 'testnet') &&
    typeof r.invoice === 'string' && /^ln(bc|tb)[a-z0-9]+$/i.test(r.invoice) &&
    typeof r.amountSats === 'number' && Number.isSafeInteger(r.amountSats) && r.amountSats > 0 &&
    typeof r.createdAt === 'number' && Number.isSafeInteger(r.createdAt) && r.createdAt > 0 &&
    typeof r.expiresAt === 'number' && Number.isSafeInteger(r.expiresAt) && r.expiresAt > r.createdAt;
}

let storageQueue: Promise<unknown> = Promise.resolve();
function serial<T>(op: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(op, op);
  storageQueue = result.catch(() => undefined);
  return result;
}

export function loadTerminalRequest(walletId: string, network: string): Promise<TerminalRequest | null> {
  return serial(async () => {
    const canonical = terminalNetwork(network);
    const key = scopedKey(walletId, canonical);
    const existing = await AsyncStorage.getItem(key);
    const oldKeys = legacyKeys(walletId, canonical);
    let raw = existing;
    let oldKey: string | undefined;
    if (!raw) {
      for (const candidate of oldKeys) {
        raw = await AsyncStorage.getItem(candidate);
        if (raw) { oldKey = candidate; break; }
      }
    }
    if (!raw) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Saved payment request is unreadable.'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('Saved payment request is invalid.');
    const normalized = { ...(parsed as Record<string, unknown>), network: terminalNetwork(String((parsed as Record<string, unknown>).network)) };
    if (!isTerminalRequest(normalized) || normalized.walletId !== walletId || normalized.network !== canonical) {
      throw new Error('Saved payment request does not match this wallet or network.');
    }
    if (oldKey) {
      await AsyncStorage.setItem(key, JSON.stringify(normalized));
    }
    // Remove every old copy of this same request. If cleanup fails, keep the
    // canonical copy and fail loading; a later retry can complete cleanup.
    for (const candidate of oldKeys) {
      const oldRaw = await AsyncStorage.getItem(candidate);
      if (!oldRaw) continue;
      let old: any;
      try { old = JSON.parse(oldRaw); } catch { continue; }
      if (old?.id === normalized.id) await AsyncStorage.removeItem(candidate);
    }
    return normalized;
  });
}

export function saveTerminalRequest(request: TerminalRequest): Promise<void> {
  if (!isTerminalRequest(request)) return Promise.reject(new Error('Invalid payment request.'));
  return serial(() => AsyncStorage.setItem(scopedKey(request.walletId, request.network), JSON.stringify(request)));
}

export function clearTerminalRequest(request: TerminalRequest): Promise<void> {
  return serial(async () => {
    const key = scopedKey(request.walletId, request.network);
    for (const candidate of legacyKeys(request.walletId, request.network)) {
      const oldRaw = await AsyncStorage.getItem(candidate);
      if (!oldRaw) continue;
      let old: any;
      try { old = JSON.parse(oldRaw); } catch { continue; }
      if (old?.id === request.id) await AsyncStorage.removeItem(candidate);
    }
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (isTerminalRequest(parsed) && parsed.id === request.id) await AsyncStorage.removeItem(key);
  });
}

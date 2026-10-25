import AsyncStorage from '@react-native-async-storage/async-storage';

export type FiatCurrency = 'USD' | 'EUR' | 'CHF';
export type TerminalRates = Readonly<{ fetchedAt: number; rates: Record<FiatCurrency, string> }>;
export type TerminalReportingRate = Readonly<{
  currency: FiatCurrency; rate: string; fetchedAt: number; source: 'coinbase'; status: 'fresh' | 'stale';
}>;

const URL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC';
const STORAGE_KEY = '@terminalRateCache:v1';
const MAX_AGE_MS = 60_000;
const REPORTING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 6_000;
let cached: TerminalRates | null = null;
let inFlight: Promise<TerminalRates> | null = null;
let hydration: Promise<void> | null = null;
let retryAt = 0;
let failures = 0;
let epoch = 0;

export function isRateString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) &&
    BigInt(value.replace('.', '')) > 0n;
}

export function isTerminalReportingRate(value: unknown): value is TerminalReportingRate {
  if (!value || typeof value !== 'object') return false;
  const rate = value as Record<string, unknown>;
  return (rate.currency === 'USD' || rate.currency === 'EUR' || rate.currency === 'CHF') && isRateString(rate.rate) &&
    typeof rate.fetchedAt === 'number' && Number.isSafeInteger(rate.fetchedAt) && rate.fetchedAt > 0 &&
    rate.source === 'coinbase' && (rate.status === 'fresh' || rate.status === 'stale');
}

function validRates(value: any): value is TerminalRates {
  return value && Number.isSafeInteger(value.fetchedAt) && value.fetchedAt > 0 &&
    isRateString(value.rates?.USD) && isRateString(value.rates?.EUR) && isRateString(value.rates?.CHF);
}
const copy = (value: TerminalRates): TerminalRates => ({ fetchedAt: value.fetchedAt, rates: { ...value.rates } });
const usable = (value: TerminalRates | null, age: number) => !!value && Date.now() >= value.fetchedAt && Date.now() - value.fetchedAt < age;

function hydrate(): Promise<void> {
  if (!hydration) {
    const current = epoch;
    hydration = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || current !== epoch) return;
        const value = JSON.parse(raw);
        if (validRates(value) && usable(value, REPORTING_MAX_AGE_MS) && !cached) cached = copy(value);
      } catch { /* An optional reporting cache cannot prevent payment. */ }
    })();
  }
  return hydration;
}

async function waitForHydration(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([hydrate(), new Promise<void>(resolve => { timer = setTimeout(resolve, 100); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function cooldown(response?: Response): number {
  const fallback = Math.min(300_000, 15_000 * 2 ** Math.min(failures - 1, 5));
  const header = response?.headers?.get?.('Retry-After');
  if (!header) return fallback;
  const seconds = /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(fallback, Math.min(seconds, REPORTING_MAX_AGE_MS)) : fallback;
}

export async function getTerminalRates(): Promise<TerminalRates> {
  await waitForHydration();
  if (usable(cached, MAX_AGE_MS)) return copy(cached!);
  if (inFlight) return copy(await inFlight);
  if (Date.now() < retryAt) throw new Error('Exchange rates are temporarily unavailable. Try again later.');
  const current = epoch;
  const task = (async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Exchange rate request timed out.')); }, TIMEOUT_MS);
      });
      // The deadline covers fetching and JSON decoding, even if a transport ignores abort.
      const result = await Promise.race([timeout, (async () => {
        response = await fetch(URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(response.status === 429 ? 'Exchange rates are rate limited. Try again later.' : 'Exchange rates are unavailable.');
        const body: unknown = await response.json();
        const data = (body as any)?.data;
        if (data?.currency !== 'BTC' || !isRateString(data?.rates?.USD) ||
            !isRateString(data?.rates?.EUR) || !isRateString(data?.rates?.CHF)) {
          throw new Error('Exchange rate response is invalid.');
        }
        return { fetchedAt: Date.now(), rates: { USD: data.rates.USD, EUR: data.rates.EUR, CHF: data.rates.CHF } };
      })()]);
      if (current === epoch) {
        cached = copy(result); failures = 0; retryAt = 0;
        // Reporting cache persistence is optional; the immutable sale itself is stored separately.
        void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(result)).catch(() => {});
      }
      return result;
    } catch (error) {
      if (current === epoch) { ++failures; retryAt = Date.now() + cooldown(response); }
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  })();
  inFlight = task;
  try { return copy(await task); }
  finally { if (inFlight === task) inFlight = null; }
}

/** Reporting must not gate Bitcoin-denominated payments on a price provider. */
export async function getTerminalReportingRate(currency: FiatCurrency): Promise<TerminalReportingRate | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getTerminalRates().catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1000); }),
    ]);
    if (!usable(cached, REPORTING_MAX_AGE_MS)) return null;
    return { currency, rate: cached!.rates[currency], fetchedAt: cached!.fetchedAt,
      source: 'coinbase', status: usable(cached, MAX_AGE_MS) ? 'fresh' : 'stale' };
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}

export function clearTerminalRateCacheForTests() {
  ++epoch; cached = null; inFlight = null; hydration = null; retryAt = 0; failures = 0;
}

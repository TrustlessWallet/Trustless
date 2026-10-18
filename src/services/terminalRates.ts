export type FiatCurrency = 'USD' | 'EUR' | 'CHF';
export type TerminalRates = Readonly<{ fetchedAt: number; rates: Record<FiatCurrency, string> }>;

const URL = 'https://api.coinbase.com/v2/exchange-rates?currency=BTC';
const MAX_AGE_MS = 60_000;
const TIMEOUT_MS = 6_000;
let cached: TerminalRates | null = null;
let inFlight: Promise<TerminalRates> | null = null;

export function isRateString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) &&
    BigInt(value.replace('.', '')) > 0n;
}

export async function getTerminalRates(): Promise<TerminalRates> {
  if (cached && Date.now() >= cached.fetchedAt && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Exchange rates are unavailable.');
      const body: unknown = await response.json();
      const data = (body as any)?.data;
      if (data?.currency !== 'BTC' || !isRateString(data?.rates?.USD) ||
          !isRateString(data?.rates?.EUR) || !isRateString(data?.rates?.CHF)) {
        throw new Error('Exchange rate response is invalid.');
      }
      cached = { fetchedAt: Date.now(), rates: { USD: data.rates.USD, EUR: data.rates.EUR, CHF: data.rates.CHF } };
      return cached;
    } finally { clearTimeout(timer); }
  })();
  try { return await inFlight; }
  finally { inFlight = null; }
}

export function clearTerminalRateCacheForTests() { cached = null; inFlight = null; }

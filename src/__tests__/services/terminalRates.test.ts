import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTerminalRateCacheForTests, getTerminalRates, getTerminalReportingRate, isTerminalReportingRate } from '../../services/terminalRates';

beforeEach(async () => { await AsyncStorage.clear(); clearTerminalRateCacheForTests(); jest.restoreAllMocks(); });
afterEach(() => { jest.useRealTimers(); });

it('uses authenticated-free BTC rates only while the local cache is fresh', async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000.12345678' } } }) });
  (global as any).fetch = fetchMock;
  const now = jest.spyOn(Date, 'now').mockReturnValue(100000);
  expect((await getTerminalRates()).rates.CHF).toBe('80000.12345678');
  expect(fetchMock).toHaveBeenCalledWith('https://api.coinbase.com/v2/exchange-rates?currency=BTC', expect.objectContaining({ signal: expect.anything() }));
  await getTerminalRates();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  now.mockReturnValue(160001);
  await getTerminalRates();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  now.mockReturnValue(50000);
  await getTerminalRates();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('rejects malformed or unavailable rates instead of using stale values', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'USD', rates: { USD: '1' } } }) });
  await expect(getTerminalRates()).rejects.toThrow('invalid');
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300000);
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(getTerminalRates()).rejects.toThrow('offline');
});

const response = () => ({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });

it('shares a concurrent request and returns independent rate copies', async () => {
  const fetch = jest.fn().mockResolvedValue(response());
  (global as any).fetch = fetch;
  const [first, second] = await Promise.all([getTerminalRates(), getTerminalRates()]);
  expect(fetch).toHaveBeenCalledTimes(1);
  first.rates.USD = '1';
  expect(second.rates.USD).toBe('100000');
  expect((await getTerminalRates()).rates.USD).toBe('100000');
});

it('backs off on 429 and honors Retry-After seconds without repeated network calls', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '120' } }).mockResolvedValue(response());
  (global as any).fetch = fetch;
  await expect(getTerminalRates()).rejects.toThrow('rate limited');
  now.mockReturnValue(1119999);
  await expect(getTerminalRates()).rejects.toThrow('temporarily');
  expect(fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1120000);
  expect((await getTerminalRates()).rates.USD).toBe('100000');
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('honors a Retry-After HTTP date', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => new Date(1300000).toUTCString() } });
  (global as any).fetch = fetch;
  await expect(getTerminalRates()).rejects.toThrow();
  now.mockReturnValue(1299999);
  await expect(getTerminalRates()).rejects.toThrow('temporarily');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('uses a persisted stale snapshot for reporting but never for fiat pricing', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  (global as any).fetch = jest.fn().mockResolvedValue(response());
  await getTerminalRates();
  clearTerminalRateCacheForTests();
  now.mockReturnValue(1060001);
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(getTerminalRates()).rejects.toThrow('offline');
  expect(await getTerminalReportingRate('EUR')).toEqual({ currency: 'EUR', rate: '90000', fetchedAt: 1000000, source: 'coinbase', status: 'stale' });
  expect((global as any).fetch).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1000000 + 24 * 60 * 60 * 1000);
  expect(await getTerminalReportingRate('USD')).toBeNull();
});

it('does not trust corrupt or future persisted rate caches', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(1000000);
  for (const raw of ['{broken', JSON.stringify({ fetchedAt: 1000001, rates: { USD: '100000', EUR: '90000', CHF: '80000' } })]) {
    clearTerminalRateCacheForTests();
    await AsyncStorage.setItem('@terminalRateCache:v1', raw);
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await getTerminalReportingRate('USD')).toBeNull();
  }
});

it('limits optional reporting wait to one second and strict network requests to six', async () => {
  jest.useFakeTimers();
  (global as any).fetch = jest.fn().mockImplementation(() => new Promise(() => {}));
  const report = getTerminalReportingRate('USD');
  await jest.advanceTimersByTimeAsync(1000);
  expect(await report).toBeNull();
  const strict = getTerminalRates();
  const rejected = expect(strict).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(5000);
  await rejected;
  expect((global as any).fetch).toHaveBeenCalledTimes(1);
});

it('does not let stalled optional storage hydration block fresh network rates', async () => {
  jest.useFakeTimers();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(() => new Promise(() => {}));
  (global as any).fetch = jest.fn().mockResolvedValue(response());
  const result = getTerminalRates();
  await jest.advanceTimersByTimeAsync(100);
  expect((await result).rates.USD).toBe('100000');
});

it('rejects non-string reporting currencies', () => {
  expect(isTerminalReportingRate({ currency: ['USD'], rate: '100000', fetchedAt: 1000000, source: 'coinbase', status: 'fresh' })).toBe(false);
});

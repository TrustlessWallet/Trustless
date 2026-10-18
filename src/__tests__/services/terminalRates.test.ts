import { clearTerminalRateCacheForTests, getTerminalRates } from '../../services/terminalRates';

beforeEach(() => { clearTerminalRateCacheForTests(); jest.restoreAllMocks(); });

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
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(getTerminalRates()).rejects.toThrow('offline');
});

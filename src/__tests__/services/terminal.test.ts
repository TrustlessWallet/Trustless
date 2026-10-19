import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTerminalRequest, formatFiatMinor, formatTerminalAmount, formatTerminalSats, isTerminalRequest, loadTerminalRequest, matchTerminalPayment, parseFiatMinor, parseTerminalAmount, satsFromFiat, saveTerminalRequest, terminalNetwork, TerminalRequest } from '../../services/terminal';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const storage = new Map<string, string>();
const request: TerminalRequest = { id: 'one', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200, createdAt: 1000, expiresAt: 2000 };

beforeEach(() => {
  storage.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => storage.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => { storage.set(key, value); });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async key => { storage.delete(key); });
});

it('accepts only exact positive amounts and preserves value across units', () => {
  expect(parseTerminalAmount('1200', 'sats')).toBe(1200);
  expect(parseTerminalAmount('0.00001200', 'BTC')).toBe(1200);
  expect(formatTerminalAmount(1200, 'BTC')).toBe('0.000012');
  for (const input of ['0', '-1', '1.2', '1e3', '12foo', '9007199254740992']) {
    expect(() => parseTerminalAmount(input, 'sats')).toThrow();
  }
  for (const input of ['0', '-0.1', '1.000000001', '1e-8', '.1', '2junk']) {
    expect(() => parseTerminalAmount(input, 'BTC')).toThrow();
  }
});

it('converts exact fiat minor units at the frozen decimal rate, rounding up sats', () => {
  expect(parseFiatMinor('1.23')).toBe(123);
  expect(formatFiatMinor(123)).toBe('1.23');
  expect(satsFromFiat(100, '100000')).toBe(1000);
  expect(satsFromFiat(100, '300000')).toBe(334);
  expect(satsFromFiat(100, '100000.12345678')).toBe(1000);
  for (const input of ['0', '-1', '1.234', '1e2', '.50', '2junk']) expect(() => parseFiatMinor(input)).toThrow();
  expect(() => satsFromFiat(100, '0')).toThrow();
  expect(() => satsFromFiat(100, 'NaN')).toThrow();
  const quoted = { ...request, amountSats: 334, fiat: { currency: 'CHF' as const, amountMinor: 100, rate: '300000', fetchedAt: 1234 } };
  expect(isTerminalRequest(quoted)).toBe(true);
  expect(isTerminalRequest({ ...quoted, amountSats: 333 })).toBe(false);
});

it('recognizes only the exact completed receive invoice, irrespective of SDK payment ID', () => {
  const payment = { id: 'sdk-id-not-payment-hash', paymentType: 1, status: 0, details: { tag: 'Lightning', inner: { invoice: 'LNBC123ABC' } } };
  expect(matchTerminalPayment(payment, request.invoice, 1, 0, 'Lightning')).toEqual({ status: 'received', paymentId: payment.id });
  expect(matchTerminalPayment({ ...payment, status: 1 }, request.invoice, 1, 0, 'Lightning')?.status).toBe('pending');
  expect(matchTerminalPayment({ ...payment, paymentType: 0 }, request.invoice, 1, 0, 'Lightning')).toBeNull();
  expect(matchTerminalPayment({ ...payment, details: { tag: 'Lightning', inner: { invoice: 'lnbcOTHER' } } }, request.invoice, 1, 0, 'Lightning')).toBeNull();
});

it('stores one request per wallet and network, clears only matching identity, and rejects corrupt entries', async () => {
  await saveTerminalRequest(request);
  expect(await loadTerminalRequest('wallet-a', 'Mainnet')).toEqual(request);
  expect(await loadTerminalRequest('wallet-b', 'mainnet')).toBeNull();
  expect(await loadTerminalRequest('wallet-a', 'testnet')).toBeNull();
  await clearTerminalRequest({ ...request, id: 'different' });
  expect(await loadTerminalRequest('wallet-a', 'mainnet')).toEqual(request);
  await clearTerminalRequest(request);
  expect(await loadTerminalRequest('wallet-a', 'mainnet')).toBeNull();
  storage.set('@terminalActiveRequest:mainnet:wallet-a', '{bad json');
  await expect(loadTerminalRequest('wallet-a', 'mainnet')).rejects.toThrow('unreadable');
});

it('uses one canonical mainnet identity and migrates an old Bitcoin request', async () => {
  expect(terminalNetwork('Bitcoin')).toBe('mainnet');
  expect(terminalNetwork('Mainnet')).toBe('mainnet');
  storage.set('@terminalActiveRequest:Bitcoin:wallet-a', JSON.stringify({ ...request, network: 'Bitcoin' }));
  expect(await loadTerminalRequest('wallet-a', 'Mainnet')).toEqual(request);
  expect(storage.has('@terminalActiveRequest:mainnet:wallet-a')).toBe(true);
  expect(storage.has('@terminalActiveRequest:Bitcoin:wallet-a')).toBe(false);
});

it('cleans up residual legacy copies before ending a migrated request', async () => {
  storage.set('@terminalActiveRequest:Bitcoin:wallet-a', JSON.stringify({ ...request, network: 'Bitcoin' }));
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('cleanup failed'));
  await expect(loadTerminalRequest('wallet-a', 'Mainnet')).rejects.toThrow('cleanup failed');
  expect(storage.has('@terminalActiveRequest:mainnet:wallet-a')).toBe(true);
  storage.set('@terminalActiveRequest:Mainnet:wallet-a', JSON.stringify({ ...request, network: 'Mainnet' }));
  expect(await loadTerminalRequest('wallet-a', 'mainnet')).toEqual(request);
  await clearTerminalRequest(request);
  expect(await loadTerminalRequest('wallet-a', 'mainnet')).toBeNull();
});

it('does not make a failed write visible as a saved request', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(saveTerminalRequest(request)).rejects.toThrow('disk unavailable');
  expect(await loadTerminalRequest('wallet-a', 'mainnet')).toBeNull();
});


it('groups displayed sats without changing payment amounts', () => {
  expect(formatTerminalSats(0)).toBe('0');
  expect(formatTerminalSats(999)).toBe('999');
  expect(formatTerminalSats(100000)).toBe('100 000');
  expect(formatTerminalSats(123456789)).toBe('123 456 789');
});

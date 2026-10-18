import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTerminalRequest, formatTerminalAmount, loadTerminalRequest, matchTerminalPayment, parseTerminalAmount, saveTerminalRequest, TerminalRequest } from '../../services/terminal';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

const storage = new Map<string, string>();
const request: TerminalRequest = { id: 'one', walletId: 'wallet-a', network: 'Bitcoin', invoice: 'lnbc123abc', amountSats: 1200, createdAt: 1000, expiresAt: 2000 };

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

it('recognizes only the exact completed receive invoice, irrespective of SDK payment ID', () => {
  const payment = { id: 'sdk-id-not-payment-hash', paymentType: 1, status: 0, details: { tag: 'Lightning', inner: { invoice: 'LNBC123ABC' } } };
  expect(matchTerminalPayment(payment, request.invoice, 1, 0, 'Lightning')).toEqual({ status: 'received', paymentId: payment.id });
  expect(matchTerminalPayment({ ...payment, status: 1 }, request.invoice, 1, 0, 'Lightning')?.status).toBe('pending');
  expect(matchTerminalPayment({ ...payment, paymentType: 0 }, request.invoice, 1, 0, 'Lightning')).toBeNull();
  expect(matchTerminalPayment({ ...payment, details: { tag: 'Lightning', inner: { invoice: 'lnbcOTHER' } } }, request.invoice, 1, 0, 'Lightning')).toBeNull();
});

it('stores one request per wallet and network, clears only matching identity, and rejects corrupt entries', async () => {
  await saveTerminalRequest(request);
  expect(await loadTerminalRequest('wallet-a', 'Bitcoin')).toEqual(request);
  expect(await loadTerminalRequest('wallet-b', 'Bitcoin')).toBeNull();
  expect(await loadTerminalRequest('wallet-a', 'Testnet')).toBeNull();
  await clearTerminalRequest({ ...request, id: 'different' });
  expect(await loadTerminalRequest('wallet-a', 'Bitcoin')).toEqual(request);
  await clearTerminalRequest(request);
  expect(await loadTerminalRequest('wallet-a', 'Bitcoin')).toBeNull();
  storage.set('@terminalActiveRequest:Bitcoin:wallet-a', '{bad json');
  expect(await loadTerminalRequest('wallet-a', 'Bitcoin')).toBeNull();
});

it('does not make a failed write visible as a saved request', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(saveTerminalRequest(request)).rejects.toThrow('disk unavailable');
  expect(await loadTerminalRequest('wallet-a', 'Bitcoin')).toBeNull();
});

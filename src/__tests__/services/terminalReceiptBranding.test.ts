import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share } from 'react-native';
import { formatTerminalReceipt, shareTerminalReceipt } from '../../services/terminalReceipt';
import {
  DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, saveTerminalReceiptBranding,
  TERMINAL_RECEIPT_BRANDING_KEY, TerminalReceiptBranding,
} from '../../services/terminalReceiptBranding';
import { TerminalSale } from '../../services/terminalSales';
import { TerminalRefundAttempt } from '../../services/terminalRefunds';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
const storage = new Map<string, string>();
const key = `${TERMINAL_RECEIPT_BRANDING_KEY}:mainnet:wallet-a`;
const branding: TerminalReceiptBranding = { name: 'Trustless Coffee', contact: 'hello@example.com', footer: 'Thanks for visiting.' };
const sale: TerminalSale = { request: { id: 'sale-1', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc', amountSats: 500, createdAt: 100, expiresAt: 200 }, status: 'received', receivedAt: 150, updatedAt: 150, paymentId: 'payment-1' };
const refund: TerminalRefundAttempt = { id: 'refund-1', walletId: 'wallet-a', network: 'mainnet', saleId: 'sale-1', saleInvoice: 'lnbc', invoice: 'refund', amountSats: 100, feeSats: 1, quoteExpiresAt: 300, createdAt: 200, updatedAt: 250, status: 'complete', paymentId: 'refund-payment' };

beforeEach(() => {
  storage.clear(); jest.restoreAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(async (name, value) => { storage.set(name, value); });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

it('loads empty defaults per scope and saves a trimmed immutable snapshot', async () => {
  expect(await loadTerminalReceiptBranding('wallet-a', 'mainnet')).toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  const mutable = { name: '  Trustless Coffee  ', contact: ' hello@example.com ', footer: ' Thanks. ' };
  const pending = saveTerminalReceiptBranding('wallet-a', 'mainnet', mutable, () => true);
  mutable.name = 'Changed';
  expect(await pending).toEqual({ name: 'Trustless Coffee', contact: 'hello@example.com', footer: 'Thanks.' });
  expect(await loadTerminalReceiptBranding('wallet-b', 'mainnet')).toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  expect(await loadTerminalReceiptBranding('wallet-a', 'testnet')).toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  expect(JSON.parse(storage.get(key)!)).toEqual({ version: 1, walletId: 'wallet-a', network: 'mainnet', branding: { name: 'Trustless Coffee', contact: 'hello@example.com', footer: 'Thanks.' } });
  await saveTerminalReceiptBranding('wallet-a', 'mainnet', DEFAULT_TERMINAL_RECEIPT_BRANDING, () => true);
  expect(await loadTerminalReceiptBranding('wallet-a', 'mainnet')).toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
});

it('rejects injection controls, newlines, bidi overrides, separators, and excessive lengths', async () => {
  for (const bad of ['line\nsecond', 'tab\tvalue', `rtl\u202Evalue`, `split\u2028value`, `control\u0085value`]) {
    await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, footer: bad }, () => true)).rejects.toThrow('Invalid');
  }
  await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, name: 'x'.repeat(81) }, () => true)).rejects.toThrow('Invalid');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  expect(() => formatTerminalReceipt(sale, [], { ...branding, footer: 'Injected\nPayment receipt' })).toThrow('Invalid receipt branding');
});

it('rejects a serialized write above the readable bound without overwriting storage', async () => {
  const longWallet = `wallet-${'x'.repeat(950)}`;
  await expect(saveTerminalReceiptBranding(longWallet, 'mainnet', branding, () => true)).rejects.toThrow('too large');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

it('fails closed on corrupt or wrong-scope storage without overwriting it', async () => {
  for (const raw of ['{bad', 'x'.repeat(1_025), JSON.stringify({ version: 1, walletId: 'wallet-b', network: 'mainnet', branding })]) {
    storage.set(key, raw);
    await expect(loadTerminalReceiptBranding('wallet-a', 'mainnet')).rejects.toThrow();
    await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', branding, () => true)).rejects.toThrow();
    expect(storage.get(key)).toBe(raw);
  }
});

it('serializes writes, rejects a queued stale scope, and recovers after storage failure', async () => {
  let current = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { current = false; return storage.get(name) ?? null; });
  await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', branding, () => current)).rejects.toThrow('Current');
  expect(storage.has(key)).toBe(false);
  current = true;
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk failed'));
  await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', branding, () => current)).rejects.toThrow('disk failed');
  expect(await saveTerminalReceiptBranding('wallet-a', 'mainnet', branding, () => current)).toEqual(branding);
});

it('preserves the exact default receipt and places branding around basket and refund details', () => {
  expect(formatTerminalReceipt(sale, [refund], DEFAULT_TERMINAL_RECEIPT_BRANDING)).toBe(formatTerminalReceipt(sale, [refund]));
  const withDetails: TerminalSale = { ...sale, request: { ...sale.request,
    fiat: { currency: 'USD', amountMinor: 500, rate: '100000', fetchedAt: 100 },
    basket: { unit: 'USD', total: 500, lines: [{ itemId: 'coffee', name: 'Original coffee', quantity: 2, unitPrice: 250, total: 500 }] },
  } };
  const text = formatTerminalReceipt(withDetails, [refund], branding);
  expect(text.startsWith('Trustless Coffee\nhello@example.com\n\nPayment receipt')).toBe(true);
  expect(text).toContain('Original price: USD 5.00');
  expect(text).toContain('Original coffee × 2 @ USD 2.50 = USD 5.00');
  expect(text).toContain('Refund refund-1: 100 sats (complete)\nRefund payment reference: refund-payment');
  expect(text.endsWith('\n\nThanks for visiting.')).toBe(true);
});

it('validates payment before loading branding and cancels stale shares before and after the read', async () => {
  await expect(shareTerminalReceipt({ ...sale, status: 'pending', receivedAt: undefined })).rejects.toThrow('verified paid');
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  await shareTerminalReceipt(sale, [], () => false);
  expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  let current = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => { current = false; return null; });
  await shareTerminalReceipt(sale, [], () => current);
  expect(Share.share).not.toHaveBeenCalled();
  current = true;
  storage.set(key, JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', branding }));
  await shareTerminalReceipt(sale, [refund], () => current);
  expect(Share.share).toHaveBeenCalledWith({ message: formatTerminalReceipt(sale, [refund], branding) });
  storage.set(key, '{corrupt');
  await expect(shareTerminalReceipt(sale)).rejects.toThrow('unreadable');
  expect(Share.share).toHaveBeenCalledTimes(1);
});

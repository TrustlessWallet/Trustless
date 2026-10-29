import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share } from 'react-native';
import { formatTerminalReceipt, shareTerminalReceipt } from '../../services/terminalReceipt';
import {
  clearTerminalReceiptBranding, DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, saveTerminalReceiptBranding,
  TERMINAL_RECEIPT_BRANDING_KEY, TerminalReceiptBranding,
} from '../../services/terminalReceiptBranding';
import { TerminalSale } from '../../services/terminalSales';
import { TerminalRefundAttempt } from '../../services/terminalRefunds';
import { deflateSync } from 'zlib';
import { normalizeTerminalReceiptLogo, receiptLogoFromBytes } from '../../services/terminalReceiptLogo';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() } }));
const storage = new Map<string, string>();
const key = `${TERMINAL_RECEIPT_BRANDING_KEY}:mainnet:wallet-a`;
const branding: TerminalReceiptBranding = { name: 'Trustless Coffee', contact: 'hello@example.com', footer: 'Thanks for visiting.' };
const sale: TerminalSale = { request: { id: 'sale-1', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc', amountSats: 500, createdAt: 100, expiresAt: 200 }, status: 'received', receivedAt: 150, updatedAt: 150, paymentId: 'payment-1' };
const refund: TerminalRefundAttempt = { id: 'refund-1', walletId: 'wallet-a', network: 'mainnet', saleId: 'sale-1', saleInvoice: 'lnbc', invoice: 'refund', amountSats: 100, feeSats: 1, quoteExpiresAt: 300, createdAt: 200, updatedAt: 250, status: 'complete', paymentId: 'refund-payment' };

beforeEach(() => {
  storage.clear(); jest.restoreAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(async name => storage.get(name) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(async (name, value) => { storage.set(name, value); });
  (AsyncStorage.removeItem as jest.Mock).mockReset().mockImplementation(async name => { storage.delete(name); });
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

it('clears only the requested branding scope and blocks an in-flight save from restoring it', async () => {
  const wallet = 'branding-cleanup';
  const mainnetKey = `${TERMINAL_RECEIPT_BRANDING_KEY}:mainnet:${wallet}`;
  const testnetKey = `${TERMINAL_RECEIPT_BRANDING_KEY}:testnet:${wallet}`;
  await saveTerminalReceiptBranding(wallet, 'mainnet', branding, () => true);
  await saveTerminalReceiptBranding(wallet, 'testnet', branding, () => true);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; });
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async name => { started(); await gate; return storage.get(name) ?? null; });
  const save = saveTerminalReceiptBranding(wallet, 'Mainnet', { ...branding, footer: 'Late' }, () => true);
  await reading;
  const cleanup = clearTerminalReceiptBranding(wallet, 'Bitcoin');
  release();
  await expect(save).rejects.toThrow('removed');
  await cleanup;
  expect(storage.has(mainnetKey)).toBe(false);
  expect(storage.has(testnetKey)).toBe(true);
  expect(await loadTerminalReceiptBranding(wallet, 'mainnet')).toEqual(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  await expect(saveTerminalReceiptBranding(wallet, 'mainnet', branding, () => true)).rejects.toThrow('removed');
});

it('allows cleanup to be retried after storage removal fails', async () => {
  const wallet = 'branding-cleanup-retry';
  const scopedKey = `${TERMINAL_RECEIPT_BRANDING_KEY}:mainnet:${wallet}`;
  await saveTerminalReceiptBranding(wallet, 'mainnet', branding, () => true);
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(clearTerminalReceiptBranding(wallet, 'mainnet')).rejects.toThrow('disk unavailable');
  expect(storage.has(scopedKey)).toBe(true);
  await saveTerminalReceiptBranding(wallet, 'mainnet', { ...branding, footer: 'Updated' }, () => true);
  await clearTerminalReceiptBranding(wallet, 'mainnet');
  expect(storage.has(scopedKey)).toBe(false);
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

function pngChunk(type: string, data: Buffer) {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
    return (value ^ 0xffffffff) >>> 0;
  };
  const body = Buffer.concat([Buffer.from(type), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
  return Buffer.concat([header, body, tail]);
}
function png(width = 1, height = 1, pixels = Buffer.from([0, 255, 0, 0, 255])) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

it('stores an optional validated logo and keeps legacy profiles unchanged', async () => {
  const logo = receiptLogoFromBytes(png());
  expect(normalizeTerminalReceiptLogo(logo)).toEqual(logo);
  await saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, logo }, () => true);
  expect(await loadTerminalReceiptBranding('wallet-a', 'mainnet')).toEqual({ ...branding, logo });
  expect(JSON.parse(storage.get(key)!).branding.logo).toEqual(logo);
  await saveTerminalReceiptBranding('wallet-a', 'mainnet', branding, () => true);
  expect(JSON.parse(storage.get(key)!).branding).toEqual(branding);
});

it('removes malformed PNG text metadata before it can reach the PDF decoder', async () => {
  const clean = png();
  const malformedText = Buffer.concat([
    clean.subarray(0, 33),
    pngChunk('tEXt', Buffer.from('missing separator')),
    pngChunk('iTXt', Buffer.from([1, 2, 3])),
    clean.subarray(33),
  ]);
  const logo = receiptLogoFromBytes(malformedText);
  expect(Buffer.from(logo.base64, 'base64')).toEqual(clean);
  await saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, logo }, () => true);
  expect((await loadTerminalReceiptBranding('wallet-a', 'mainnet')).logo).toEqual(logo);
  const unsafeStoredLogo = { mimeType: 'image/png' as const, base64: malformedText.toString('base64') };
  await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, logo: unsafeStoredLogo }, () => true)).rejects.toThrow('Invalid receipt logo');
});

it('rejects oversized dimensions, corrupt chunks, decompression bombs, and malformed base64', async () => {
  const good = png();
  expect(() => receiptLogoFromBytes(png(1025))).toThrow('Invalid receipt logo');
  expect(() => receiptLogoFromBytes(png(1, 1, Buffer.alloc(200)))).toThrow('Invalid receipt logo');
  const corrupted = Buffer.from(good); corrupted[30] ^= 1;
  expect(() => receiptLogoFromBytes(corrupted)).toThrow('Invalid receipt logo');
  const logo = receiptLogoFromBytes(good);
  await expect(saveTerminalReceiptBranding('wallet-a', 'mainnet', { ...branding, logo: { ...logo, base64: `${logo.base64}junk` } }, () => true)).rejects.toThrow('Invalid receipt logo');
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

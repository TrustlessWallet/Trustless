import AsyncStorage from '@react-native-async-storage/async-storage';

export type TerminalUnit = 'sats' | 'BTC';
export type TerminalRequest = Readonly<{
  id: string;
  walletId: string;
  network: string;
  invoice: string;
  amountSats: number;
  createdAt: number;
  expiresAt: number;
}>;

export const TERMINAL_REQUEST_KEY = '@terminalActiveRequest';
const scopedKey = (walletId: string, network: string) => `${TERMINAL_REQUEST_KEY}:${network}:${walletId}`;
const MAX_SATS = BigInt(Number.MAX_SAFE_INTEGER);

export function parseTerminalAmount(input: string, unit: TerminalUnit): number {
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

export function formatTerminalAmount(sats: number, unit: TerminalUnit): string {
  if (unit === 'sats') return String(sats);
  const whole = Math.floor(sats / 100000000);
  const fraction = String(sats % 100000000).padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
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
  return typeof r.id === 'string' && !!r.id && typeof r.walletId === 'string' && !!r.walletId &&
    (r.network === 'Bitcoin' || r.network === 'Testnet') &&
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
    const raw = await AsyncStorage.getItem(scopedKey(walletId, network));
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isTerminalRequest(parsed) && parsed.walletId === walletId && parsed.network === network ? parsed : null;
    } catch { return null; }
  });
}

export function saveTerminalRequest(request: TerminalRequest): Promise<void> {
  if (!isTerminalRequest(request)) return Promise.reject(new Error('Invalid payment request.'));
  return serial(() => AsyncStorage.setItem(scopedKey(request.walletId, request.network), JSON.stringify(request)));
}

export function clearTerminalRequest(request: TerminalRequest): Promise<void> {
  return serial(async () => {
    const key = scopedKey(request.walletId, request.network);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (isTerminalRequest(parsed) && parsed.id === request.id) await AsyncStorage.removeItem(key);
  });
}

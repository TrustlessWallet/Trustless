import AsyncStorage from '@react-native-async-storage/async-storage';
import { terminalNetwork, TerminalNetwork } from './terminal';
import { normalizeTerminalReceiptLogo, TerminalReceiptLogo } from './terminalReceiptLogo';

export const TERMINAL_RECEIPT_BRANDING_KEY = '@terminalReceiptBranding:v1';
export type TerminalReceiptBranding = Readonly<{ name: string; contact: string; footer: string; logo?: TerminalReceiptLogo }>;
export const DEFAULT_TERMINAL_RECEIPT_BRANDING: TerminalReceiptBranding = Object.freeze({ name: '', contact: '', footer: '' });

const MAX_RAW_LENGTH = 280_000;
const limits = { name: 80, contact: 120, footer: 160 } as const;
const unsafe = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
let queue: Promise<unknown> = Promise.resolve();
const deletedScopes = new Set<string>();
const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
};

function scope(walletId: string, network: string) {
  if (typeof walletId !== 'string' || !walletId || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
}
const keyFor = (walletId: string, network: TerminalNetwork) => `${TERMINAL_RECEIPT_BRANDING_KEY}:${network}:${walletId}`;
function assertNotDeleted(walletId: string, network: TerminalNetwork): void {
  if (deletedScopes.has(keyFor(walletId, network))) throw new Error('Terminal receipt wallet was removed.');
}

export function normalizeTerminalReceiptBranding(value: unknown): TerminalReceiptBranding {
  if (!value || typeof value !== 'object') throw new Error('Invalid receipt branding.');
  const input = value as Record<string, unknown>;
  const result = {} as { name: string; contact: string; footer: string; logo?: TerminalReceiptLogo };
  for (const field of ['name', 'contact', 'footer'] as const) {
    if (typeof input[field] !== 'string') throw new Error('Invalid receipt branding.');
    const text = input[field].trim();
    if (text.length > limits[field] || unsafe.test(text)) throw new Error('Invalid receipt branding.');
    result[field] = text;
  }
  if (input.logo !== undefined) result.logo = normalizeTerminalReceiptLogo(input.logo);
  return result;
}

async function read(walletId: string, network: TerminalNetwork): Promise<TerminalReceiptBranding> {
  const raw = await AsyncStorage.getItem(keyFor(walletId, network));
  if (raw === null) return { ...DEFAULT_TERMINAL_RECEIPT_BRANDING };
  if (raw.length > MAX_RAW_LENGTH) throw new Error('Saved receipt branding is invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved receipt branding is unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 || (parsed as any).walletId !== walletId ||
    (parsed as any).network !== network || !('branding' in parsed)) throw new Error('Saved receipt branding is invalid.');
  const branding = normalizeTerminalReceiptBranding((parsed as any).branding);
  if (!branding.logo && raw.length > 1_024) throw new Error('Saved receipt branding is invalid.');
  if (JSON.stringify((parsed as any).branding) !== JSON.stringify(branding)) throw new Error('Saved receipt branding is invalid.');
  return branding;
}

export function loadTerminalReceiptBranding(walletId: string, network: string): Promise<TerminalReceiptBranding> {
  const identity = scope(walletId, network);
  return serial(() => read(identity.walletId, identity.network));
}

export function saveTerminalReceiptBranding(walletId: string, network: string, branding: TerminalReceiptBranding, isCurrent: () => boolean): Promise<TerminalReceiptBranding> {
  const identity = scope(walletId, network);
  let frozen: TerminalReceiptBranding;
  try { frozen = normalizeTerminalReceiptBranding(branding); } catch (error) { return Promise.reject(error); }
  return serial(async () => {
    assertNotDeleted(identity.walletId, identity.network);
    if (!isCurrent()) throw new Error('Current Terminal receipt scope is required.');
    await read(identity.walletId, identity.network);
    assertNotDeleted(identity.walletId, identity.network);
    if (!isCurrent()) throw new Error('Current Terminal receipt scope is required.');
    const raw = JSON.stringify({ version: 1, walletId: identity.walletId, network: identity.network, branding: frozen });
    if (raw.length > (frozen.logo ? MAX_RAW_LENGTH : 1_024)) throw new Error('Saved receipt branding is too large.');
    assertNotDeleted(identity.walletId, identity.network);
    await AsyncStorage.setItem(keyFor(identity.walletId, identity.network), raw);
    if (!isCurrent()) throw new Error('Current Terminal receipt scope is required.');
    return frozen;
  });
}

export function clearTerminalReceiptBranding(walletId: string, network: string): Promise<void> {
  const identity = scope(walletId, network);
  const key = keyFor(identity.walletId, identity.network);
  deletedScopes.add(key);
  return serial(() => AsyncStorage.removeItem(key)).catch(error => {
    deletedScopes.delete(key);
    throw error;
  });
}

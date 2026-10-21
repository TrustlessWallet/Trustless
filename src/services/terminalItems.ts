import AsyncStorage from '@react-native-async-storage/async-storage';
import { isTerminalItemName, terminalNetwork, TerminalNetwork, TerminalUnit } from './terminal';

export const TERMINAL_ITEMS_KEY = '@terminalItems:v1';
export type TerminalItem = Readonly<{ id: string; name: string; unit: TerminalUnit; unitPrice: number }>;
const MAX_ITEMS = 30;
const units: TerminalUnit[] = ['sats', 'BTC', 'USD', 'EUR', 'CHF'];
const keyFor = (walletId: string, network: TerminalNetwork) => `${TERMINAL_ITEMS_KEY}:${network}:${walletId}`;

let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
};

const scope = (walletId: string, network: string) => {
  if (typeof walletId !== 'string' || !walletId || walletId !== walletId.trim()) throw new Error('Invalid Terminal wallet.');
  return { walletId, network: terminalNetwork(network) };
};

export function isTerminalItem(value: unknown): value is TerminalItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128 && item.id === item.id.trim() &&
    isTerminalItemName(item.name) &&
    units.includes(item.unit as TerminalUnit) && typeof item.unitPrice === 'number' && Number.isSafeInteger(item.unitPrice) && item.unitPrice > 0;
}

async function read(walletId: string, network: TerminalNetwork): Promise<TerminalItem[]> {
  const raw = await AsyncStorage.getItem(keyFor(walletId, network));
  if (raw === null) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved items are unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 || (parsed as any).walletId !== walletId || (parsed as any).network !== network || !Array.isArray((parsed as any).items)) throw new Error('Saved items are invalid.');
  const items = (parsed as { items: unknown[] }).items;
  if (items.length > MAX_ITEMS || !items.every(isTerminalItem) || new Set((items as TerminalItem[]).map(item => item.id)).size !== items.length) throw new Error('Saved items are invalid.');
  return items as TerminalItem[];
}

export function listTerminalItems(walletId: string, network: string): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  return serial(() => read(identity.walletId, identity.network));
}

export function saveTerminalItem(walletId: string, network: string, item: TerminalItem, isOwnerCurrent: () => boolean): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  if (!isTerminalItem(item)) return Promise.reject(new Error('Invalid item.'));
  const frozen: TerminalItem = { id: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice };
  return serial(async () => {
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const items = await read(identity.walletId, identity.network);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const existing = items.findIndex(entry => entry.id === frozen.id);
    if (existing < 0 && items.length >= MAX_ITEMS) throw new Error('Item limit reached.');
    const next = existing < 0 ? [...items, frozen] : items.map(entry => entry.id === frozen.id ? frozen : entry);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    await AsyncStorage.setItem(keyFor(identity.walletId, identity.network), JSON.stringify({ version: 1, walletId: identity.walletId, network: identity.network, items: next }));
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    return next;
  });
}

export function deleteTerminalItem(walletId: string, network: string, id: string, isOwnerCurrent: () => boolean): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  return serial(async () => {
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const items = await read(identity.walletId, identity.network);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const next = items.filter(item => item.id !== id);
    if (next.length === items.length) return items;
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    await AsyncStorage.setItem(keyFor(identity.walletId, identity.network), JSON.stringify({ version: 1, walletId: identity.walletId, network: identity.network, items: next }));
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    return next;
  });
}

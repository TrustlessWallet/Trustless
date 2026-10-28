import AsyncStorage from '@react-native-async-storage/async-storage';
import { SQLiteDatabase } from 'expo-sqlite';
import { isTerminalItemName, terminalNetwork, TerminalNetwork, TerminalUnit } from './terminal';
import { transactTerminalDatabase } from './terminalDatabase';

export const TERMINAL_ITEMS_KEY = '@terminalItems:v1';
export type TerminalItem = Readonly<{ id: string; name: string; unit: TerminalUnit; unitPrice: number }>;
const MAX_ITEMS = 30;
const MAX_LEGACY_LENGTH = 64 * 1024;
const units: TerminalUnit[] = ['sats', 'BTC', 'USD', 'EUR', 'CHF'];
const keyFor = (walletId: string, network: TerminalNetwork) => `${TERMINAL_ITEMS_KEY}:${network}:${walletId}`;
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
function validateItems(value: unknown): TerminalItem[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || !value.every(isTerminalItem) ||
    new Set((value as TerminalItem[]).map(item => item.id)).size !== value.length) throw new Error('Saved items are invalid.');
  return value.map(item => ({ id: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice }));
}
async function readLegacy(walletId: string, network: TerminalNetwork): Promise<TerminalItem[]> {
  const raw = await AsyncStorage.getItem(keyFor(walletId, network));
  if (raw === null) return [];
  if (raw.length > MAX_LEGACY_LENGTH) throw new Error('Saved items are invalid.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved items are unreadable.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as any).version !== 1 ||
    (parsed as any).walletId !== walletId || (parsed as any).network !== network) throw new Error('Saved items are invalid.');
  return validateItems((parsed as Record<string, unknown>).items);
}

/** Reads and migrates legacy catalogs inside the caller's SQLite transaction. */
export async function readTerminalItemsInDatabase(db: SQLiteDatabase, walletId: string, network: string): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  const row = await db.getFirstAsync<{ payload: string }>(
    'SELECT payload FROM terminal_catalog WHERE wallet_id=? AND network=?', [identity.walletId, identity.network]);
  if (row) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.payload); } catch { throw new Error('Saved items are unreadable.'); }
    return validateItems(parsed);
  }
  const items = await readLegacy(identity.walletId, identity.network);
  await db.runAsync('INSERT INTO terminal_catalog(wallet_id,network,payload) VALUES (?,?,?)',
    [identity.walletId, identity.network, JSON.stringify(items)]);
  return items;
}

/** Replaces one catalog inside the caller's SQLite transaction. An empty row blocks legacy resurrection. */
export async function writeTerminalItemsInDatabase(db: SQLiteDatabase, walletId: string, network: string, items: readonly TerminalItem[]): Promise<void> {
  const identity = scope(walletId, network), validated = validateItems(items);
  await db.runAsync(`INSERT INTO terminal_catalog(wallet_id,network,payload) VALUES (?,?,?)
    ON CONFLICT(wallet_id,network) DO UPDATE SET payload=excluded.payload`,
  [identity.walletId, identity.network, JSON.stringify(validated)]);
}

export function listTerminalItems(walletId: string, network: string): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  return transactTerminalDatabase(db => readTerminalItemsInDatabase(db, identity.walletId, identity.network));
}

export function saveTerminalItem(walletId: string, network: string, item: TerminalItem, isOwnerCurrent: () => boolean): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  if (!isTerminalItem(item)) return Promise.reject(new Error('Invalid item.'));
  const frozen: TerminalItem = { id: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice };
  return transactTerminalDatabase(async db => {
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const items = await readTerminalItemsInDatabase(db, identity.walletId, identity.network);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const existing = items.findIndex(entry => entry.id === frozen.id);
    if (existing < 0 && items.length >= MAX_ITEMS) throw new Error('Item limit reached.');
    const next = existing < 0 ? [...items, frozen] : items.map(entry => entry.id === frozen.id ? frozen : entry);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    await writeTerminalItemsInDatabase(db, identity.walletId, identity.network, next);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    return next;
  });
}

export function deleteTerminalItem(walletId: string, network: string, id: string, isOwnerCurrent: () => boolean): Promise<TerminalItem[]> {
  const identity = scope(walletId, network);
  return transactTerminalDatabase(async db => {
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const items = await readTerminalItemsInDatabase(db, identity.walletId, identity.network);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    const next = items.filter(item => item.id !== id);
    if (next.length === items.length) return items;
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    await writeTerminalItemsInDatabase(db, identity.walletId, identity.network, next);
    if (!isOwnerCurrent()) throw new Error('Owner access to this wallet is required.');
    return next;
  });
}

/** Erases both stores when the owning wallet is removed; no legacy catalog can reappear. */
export function removeTerminalItems(walletId: string, network: string): Promise<void> {
  const identity = scope(walletId, network);
  return transactTerminalDatabase(async db => {
    await AsyncStorage.removeItem(keyFor(identity.walletId, identity.network));
    await db.runAsync('DELETE FROM terminal_catalog WHERE wallet_id=? AND network=?', [identity.walletId, identity.network]);
  });
}

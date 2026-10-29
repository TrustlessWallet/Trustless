import AsyncStorage from '@react-native-async-storage/async-storage';
import { SQLiteDatabase } from 'expo-sqlite';
import { terminalNetwork } from './terminal';

export type TerminalPreferenceKind = 'receipt' | 'templates' | 'reports';

/** Reads validated legacy data once. A NULL row records an empty preference and blocks resurrection. */
export async function readTerminalPreferenceInDatabase<T>(db: SQLiteDatabase, walletId: string, network: string,
  kind: TerminalPreferenceKind, legacyKey: string, parse: (raw: string | null) => T): Promise<T> {
  const canonicalNetwork = terminalNetwork(network);
  const row = await db.getFirstAsync<{ payload: string | null }>(
    'SELECT payload FROM terminal_preferences WHERE wallet_id=? AND network=? AND kind=?',
    [walletId, canonicalNetwork, kind]);
  if (row) return parse(row.payload);
  const raw = await AsyncStorage.getItem(legacyKey);
  const value = parse(raw);
  await writeTerminalPreferenceInDatabase(db, walletId, canonicalNetwork, kind, raw);
  return value;
}

/** Upserts a preference inside the caller's transaction. NULL is an explicit empty value. */
export async function writeTerminalPreferenceInDatabase(db: SQLiteDatabase, walletId: string, network: string,
  kind: TerminalPreferenceKind, raw: string | null): Promise<void> {
  await db.runAsync(`INSERT INTO terminal_preferences(wallet_id,network,kind,payload) VALUES (?,?,?,?)
    ON CONFLICT(wallet_id,network,kind) DO UPDATE SET payload=excluded.payload`,
  [walletId, terminalNetwork(network), kind, raw]);
}

/** Removes the old key before replacing the SQL row with an explicit empty value. */
export async function clearTerminalPreferenceInDatabase(db: SQLiteDatabase, walletId: string, network: string,
  kind: TerminalPreferenceKind, legacyKey: string): Promise<void> {
  await AsyncStorage.removeItem(legacyKey);
  await writeTerminalPreferenceInDatabase(db, walletId, network, kind, null);
}

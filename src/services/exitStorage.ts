import * as SQLite from 'expo-sqlite';
import * as Keychain from 'react-native-keychain';
import { randomBytes } from 'crypto';
import { Buffer } from 'buffer';
import { decodeExit, decryptExit, encodeExit, encryptExit } from './exitCodec';
import type { ExitRecord } from './unilateralExit';

// Separate from the wallet cache: a multi-day exit must survive routine cache resets.
let database: Promise<SQLite.SQLiteDatabase> | undefined;
function db() {
    if (!database) database = (async () => {
        const result = await SQLite.openDatabaseAsync('trustless-recovery.db');
        await result.execAsync('CREATE TABLE IF NOT EXISTS exits (wallet TEXT PRIMARY KEY, payload TEXT NOT NULL, active INTEGER NOT NULL)');
        return result;
    })();
    return database;
}
async function storageKey(wallet: string, create: boolean): Promise<Buffer> {
    const service = `com.btc.trustless.exit.${wallet}`;
    const saved = await Keychain.getGenericPassword({ service });
    if (saved) return Buffer.from(saved.password, 'hex');
    if (!create) throw new Error('Recovery encryption key is missing. Import your recovery backup.');
    const key = randomBytes(32);
    await Keychain.setGenericPassword('exit', key.toString('hex'), { service, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return key;
}
export async function loadExit(wallet: string): Promise<ExitRecord | null> {
    const row = await (await db()).getFirstAsync<{ payload: string }>('SELECT payload FROM exits WHERE wallet = ?', wallet);
    if (!row) return null;
    const key = await storageKey(wallet, false);
    try { return decodeExit<ExitRecord>(decryptExit(row.payload, key)); } finally { key.fill(0); }
}
export async function saveExit(wallet: string, record: ExitRecord): Promise<void> {
    const key = await storageKey(wallet, true);
    try {
        const payload = encryptExit(encodeExit(record), key);
        await (await db()).runAsync('INSERT OR REPLACE INTO exits(wallet, payload, active) VALUES (?, ?, ?)', wallet, payload, record.phase === 'done' ? 0 : 1);
    } finally { key.fill(0); }
}
export async function assertNoActiveExit(wallet?: string): Promise<void> {
    const row = wallet
        ? await (await db()).getFirstAsync('SELECT wallet FROM exits WHERE active = 1 AND wallet = ?', wallet)
        : await (await db()).getFirstAsync('SELECT wallet FROM exits WHERE active = 1 LIMIT 1');
    if (row) throw new Error('A unilateral exit is in progress. Open Unilateral exit to continue it before spending or deleting this wallet.');
}

import { openDatabaseAsync, SQLiteDatabase } from 'expo-sqlite';

export const TERMINAL_DATABASE_NAME = 'trustless_terminal.db';

let databasePromise: Promise<SQLiteDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS terminal_sales (
  wallet_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('mainnet','testnet')),
  id TEXT NOT NULL,
  normalized_invoice TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('unknown','pending','received')),
  payment_id TEXT,
  created_at INTEGER NOT NULL,
  received_at INTEGER,
  activity_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  amount_hi INTEGER NOT NULL,
  amount_lo INTEGER NOT NULL,
  fiat_currency TEXT,
  fiat_hi INTEGER,
  fiat_lo INTEGER,
  input_is_fiat INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(wallet_id, network, id),
  UNIQUE(wallet_id, network, normalized_invoice)
);
CREATE INDEX IF NOT EXISTS terminal_sales_activity
  ON terminal_sales(wallet_id, network, activity_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS terminal_sales_status_activity
  ON terminal_sales(wallet_id, network, status, activity_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS terminal_refunds (
  wallet_id TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('mainnet','testnet')),
  id TEXT NOT NULL,
  sale_id TEXT NOT NULL,
  normalized_invoice TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('unknown','pending','complete','failed')),
  payment_id TEXT,
  amount_hi INTEGER NOT NULL,
  amount_lo INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(wallet_id, network, id),
  UNIQUE(wallet_id, network, normalized_invoice)
);
CREATE INDEX IF NOT EXISTS terminal_refunds_updated
  ON terminal_refunds(wallet_id, network, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS terminal_refunds_sale
  ON terminal_refunds(wallet_id, network, sale_id);
CREATE UNIQUE INDEX IF NOT EXISTS terminal_refunds_one_unresolved
  ON terminal_refunds(wallet_id, network, sale_id)
  WHERE status IN ('unknown','pending');
CREATE TABLE IF NOT EXISTS terminal_item_report_rows (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity TEXT NOT NULL,
  gross_hi TEXT NOT NULL,
  gross_lo TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_item_report_page ON terminal_item_report_rows(snapshot_id,seq);
CREATE TABLE IF NOT EXISTS terminal_export_rows (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('sale','refund')),
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_export_page ON terminal_export_rows(export_id, seq);
`;

async function openDatabase(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(TERMINAL_DATABASE_NAME);
  try {
    await db.execAsync(SCHEMA);
    // Snapshots are deliberately ephemeral; a process that did not remove one
    // cannot have a consumer left that can resume it.
    await db.runAsync('DELETE FROM terminal_export_rows');
    await db.runAsync('DELETE FROM terminal_item_report_rows');
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => undefined);
    throw error;
  }
}

export function getTerminalDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) databasePromise = openDatabase().catch(error => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export function serializeTerminalDatabase<T>(operation: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const result = queue.then(async () => operation(await getTerminalDatabase()), async () => operation(await getTerminalDatabase()));
  queue = result.catch(() => undefined);
  return result;
}

export function transactTerminalDatabase<T>(operation: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  return serializeTerminalDatabase(async db => {
    let value!: T;
    await db.withExclusiveTransactionAsync(async transaction => { value = await operation(transaction); });
    return value;
  });
}

export type TerminalExportRow = { seq: number; kind: 'sale' | 'refund'; payload: string };

function exportToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function createTerminalExportSnapshot(
  walletId: string,
  network: string,
  range: { start: number; end: number } | null,
): Promise<string> {
  const validRange = range === null || (!!range && typeof range === 'object' &&
    Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.end > range.start);
  if (typeof walletId !== 'string' || !walletId || walletId !== walletId.trim() ||
      (network !== 'mainnet' && network !== 'testnet') ||
      !validRange) {
    return Promise.reject(new Error('Invalid Terminal export scope.'));
  }
  const token = exportToken();
  return transactTerminalDatabase(async db => {
    const saleRange = range ? ' AND activity_at>=? AND activity_at<?' : '';
    const refundRange = range ? ' AND updated_at>=? AND updated_at<?' : '';
    const saleArgs: (string | number)[] = [walletId, network];
    const refundArgs: (string | number)[] = [walletId, network];
    if (range) { saleArgs.push(range.start, range.end); refundArgs.push(range.start, range.end); }
    await db.runAsync(`INSERT INTO terminal_export_rows(export_id, kind, payload)
      SELECT ?, kind, payload FROM (
        SELECT 'sale' AS kind, payload, activity_at AS at, id FROM terminal_sales
          WHERE wallet_id=? AND network=?${saleRange}
        UNION ALL
        SELECT 'refund' AS kind, payload, updated_at AS at, id FROM terminal_refunds
          WHERE wallet_id=? AND network=?${refundRange}
      ) ORDER BY at DESC, id DESC, kind`, [token, walletId, network,
        ...saleArgs.slice(2), ...refundArgs]);
    return token;
  });
}

export function readTerminalExportPage(token: string, afterSeq: number, limit = 100): Promise<{
  rows: TerminalExportRow[]; nextSeq: number | null;
}> {
  if (!token || !Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return Promise.reject(new Error('Invalid Terminal export page.'));
  }
  // Snapshot rows are immutable, so page reads need no place in the mutation queue.
  return getTerminalDatabase().then(async db => {
    const rows = await db.getAllAsync<TerminalExportRow>(
      'SELECT seq, kind, payload FROM terminal_export_rows WHERE export_id=? AND seq>? ORDER BY seq LIMIT ?',
      [token, afterSeq, limit + 1]);
    const page = rows.slice(0, limit);
    return { rows: page, nextSeq: rows.length > limit ? page[page.length - 1].seq : null };
  });
}

export function removeTerminalExportSnapshot(token: string): Promise<void> {
  if (!token) return Promise.reject(new Error('Invalid Terminal export token.'));
  return serializeTerminalDatabase(async db => { await db.runAsync('DELETE FROM terminal_export_rows WHERE export_id=?', [token]); });
}

/** Test-only database replacement; callers should supply an already-open adapter. */
export async function setTerminalDatabaseForTests(database: SQLiteDatabase | null): Promise<void> {
  await queue.catch(() => undefined);
  if (databasePromise) {
    const current = await databasePromise.catch(() => null);
    if (current && current !== database) await current.closeAsync();
  }
  databasePromise = database ? Promise.resolve(database) : null;
  queue = Promise.resolve();
  if (database) {
    await database.execAsync(SCHEMA);
    await database.runAsync('DELETE FROM terminal_export_rows');
  }
}

/** Clears application rows while retaining the current test database handle and schema. */
export function resetTerminalDatabaseForTests(): Promise<void> {
  return serializeTerminalDatabase(db => db.withExclusiveTransactionAsync(async transaction => {
    await transaction.execAsync(`DELETE FROM terminal_refunds;
      DELETE FROM terminal_sales;
      DELETE FROM terminal_export_rows;
      DELETE FROM terminal_item_report_rows;
      DELETE FROM sqlite_sequence WHERE name='terminal_export_rows';`);
  }));
}

import * as SQLite from 'expo-sqlite';
import { BitcoinAddress, UTXO, Wallet, DerivedAddress, DerivedAddressInfo, Transaction } from '../types';

// Singleton database instance
let db: SQLite.SQLiteDatabase | null = null;

/**
 * INITIALIZATION & SCHEMA DEFINITION
 * This function creates the relational tables if they don't exist.
 * * Architecture Note:
 * We use a relational SQLite setup with Foreign Keys enabled.
 * - 'wallets' is the parent table.
 * - 'addresses', 'utxos', and 'transactions' are children.
 * - ON DELETE CASCADE is used: deleting a wallet automatically wipes its 
 * addresses, UTXOs, and history, keeping the DB clean.
 */
export const initDatabase = async () => {
  db = await SQLite.openDatabaseAsync('trustless_wallet.db');

  // Critical: SQLite does not enforce foreign keys by default. We must enable it.
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // Write-Ahead Logging (WAL) improves concurrency and performance.
  await db.execAsync('PRAGMA journal_mode = WAL;');

  await db.execAsync(`
    -- TABLE: WALLETS
    -- The core identity of a wallet.
    -- 'type': 'standard' (BIP39 mnemonic) or 'watch-only' (xpub/zpub).
    -- 'scriptType': Determines address format (p2wpkh = bc1q, p2sh-p2wpkh = 3...).
    -- 'nextUtxoCount': An incrementing integer used to label UTXOs strictly for UI ordering.
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      type TEXT DEFAULT 'standard',
      xpub TEXT,
      scriptType TEXT DEFAULT 'p2wpkh',
      network TEXT NOT NULL,
      changeAddressIndex INTEGER DEFAULT 0,
      nextUtxoCount INTEGER DEFAULT 1,
      fingerprint TEXT,
      derivation_path TEXT
    );

    -- TABLE: ADDRESSES
    -- Stores all derived addresses (both Receive and Change chains).
    -- 'chain': 0 = External/Receive, 1 = Internal/Change.
    -- 'idx': The BIP32 derivation index (e.g., m/84'/0'/0'/0/5 -> idx 5).
    CREATE TABLE IF NOT EXISTS addresses (
      address TEXT PRIMARY KEY NOT NULL,
      wallet_id TEXT NOT NULL,
      chain INTEGER NOT NULL, 
      idx INTEGER NOT NULL,
      balance INTEGER DEFAULT 0,
      tx_count INTEGER DEFAULT 0,
      network TEXT NOT NULL,
      FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
    );

    -- TABLE: UTXOS (Unspent Transaction Outputs)
    -- Represents the actual "money" the wallet owns.
    -- Composite Primary Key (txid + vout) ensures uniqueness.
    -- 'status_json': Stores block height/hash as a JSON string to avoid complex join tables.
    CREATE TABLE IF NOT EXISTS utxos (
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL,
      wallet_id TEXT NOT NULL,
      address TEXT NOT NULL,
      value INTEGER NOT NULL,
      label TEXT,
      status_json TEXT, 
      network TEXT NOT NULL,
      PRIMARY KEY (txid, vout),
      FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
    );

    -- TABLE: TRANSACTIONS
    -- Stores the full history. 
    -- 'json_content': We store the full Transaction object as a JSON blob. 
    -- This is a "NoSQL in SQL" approach, allowing flexible data structure without 20 columns.
    CREATE TABLE IF NOT EXISTS transactions (
      txid TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      json_content TEXT NOT NULL,
      block_time INTEGER,
      network TEXT NOT NULL,
      PRIMARY KEY (txid, wallet_id),
      FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
    );

    -- TABLE: ADDRESS BOOK (Saved Addresses)
    -- Contacts the user manually saves.
    CREATE TABLE IF NOT EXISTS saved_addresses (
      id TEXT PRIMARY KEY NOT NULL,
      address TEXT NOT NULL,
      name TEXT,
      balance INTEGER DEFAULT 0,
      lastUpdated INTEGER,
      network TEXT NOT NULL
    );
  `);
};

// Helper: access the DB instance safely
export const getDB = () => {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
};

// ------------------------------------------------------------------
// WALLET OPERATIONS
// ------------------------------------------------------------------

/**
 * Fetch all wallets for the current network.
 * We hydrate the basic object; derived addresses are fetched separately for performance.
 */
export const dbGetWallets = async (network: string): Promise<Wallet[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM wallets WHERE network = ?',
    [network]
  );
  
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    type: row.type || 'standard',
    xpub: row.xpub,
    scriptType: row.scriptType || 'p2wpkh',
    changeAddressIndex: row.changeAddressIndex,
    nextUtxoCount: row.nextUtxoCount,
    fingerprint: row.fingerprint,
    derivation_path: row.derivation_path,
    // These arrays are populated in memory by the Context, not strictly from this query
    derivedReceiveAddresses: [],
    derivedChangeAddresses: [],
    derivedAddressInfoCache: [],
    utxoLabels: {}
  }));
};

/**
 * Creates a new wallet entry.
 * 'scriptType' defaults to 'p2wpkh' (Native SegWit / bc1q) if not specified.
 */
export const dbCreateWallet = async (
    id: string, 
    name: string, 
    network: string, 
    type: string = 'standard', 
    xpub: string | null = null,
    script_type: string = 'p2wpkh',
    fingerprint: string | null = null,
    derivation_path: string | null = null
) => {
  const d = getDB();
  await d.runAsync(
    'INSERT INTO wallets (id, name, network, changeAddressIndex, nextUtxoCount, type, xpub, scriptType, fingerprint, derivation_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, network, 0, 1, type, xpub, script_type, fingerprint, derivation_path]
  );
};

// Deletes a wallet. Because of ON DELETE CASCADE defined in schema, 
// this single command wipes all related addresses, UTXOs, and transactions.
export const dbDeleteWallet = async (id: string) => {
  const d = getDB();
  await d.runAsync('DELETE FROM wallets WHERE id = ?', [id]);
};

export const dbUpdateWalletName = async (id: string, name: string) => {
  const d = getDB();
  await d.runAsync('UPDATE wallets SET name = ? WHERE id = ?', [name, id]);
};

// Updates the pointer for the next change address to prevent address reuse.
export const dbUpdateChangeIndex = async (id: string, index: number) => {
  const d = getDB();
  await d.runAsync('UPDATE wallets SET changeAddressIndex = ? WHERE id = ?', [index, id]);
};

// ------------------------------------------------------------------
// ADDRESS OPERATIONS
// ------------------------------------------------------------------

/**
 * Saves a derived address (e.g., m/84'/0'/0'/0/5).
 * We use INSERT OR IGNORE because generating the same address twice is harmless,
 * but crashing on duplicate key is bad.
 */
export const dbSaveAddress = async (wallet_id: string, addr: { address: string, index: number }, chain: number, network: string) => {
  const d = getDB();
  await d.runAsync(
    'INSERT OR IGNORE INTO addresses (address, wallet_id, chain, idx, network) VALUES (?, ?, ?, ?, ?)',
    [addr.address, wallet_id, chain, addr.index, network]
  );
};

// Reverse lookup: Given an address, find which wallet owns it.
// Used during import to prevent duplicate wallets.
export const dbFindWalletByAddress = async (address: string): Promise<string | null> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT wallet_id FROM addresses WHERE address = ? LIMIT 1',
    [address]
  );
  return rows.length > 0 ? rows[0].wallet_id : null;
};

export const dbFindWalletByXpub = async (xpub: string): Promise<string | null> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT id FROM wallets WHERE xpub = ? LIMIT 1',
    [xpub]
  );
  return rows.length > 0 ? rows[0].id : null;
};

// Fetches addresses sorted by derivation index (0, 1, 2...)
export const dbGetDerivedAddresses = async (wallet_id: string, chain: number): Promise<DerivedAddress[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT address, idx FROM addresses WHERE wallet_id = ? AND chain = ? ORDER BY idx ASC',
    [wallet_id, chain]
  );
  return rows.map((r: any) => ({ address: r.address, index: r.idx }));
};

// Fetches the cached balance/tx_count for addresses to display instantly on load.
export const dbGetAddressCache = async (wallet_id: string): Promise<DerivedAddressInfo[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT address, idx, balance, tx_count FROM addresses WHERE wallet_id = ?',
    [wallet_id]
  );
  return rows.map((r: any) => ({
    address: r.address,
    index: r.idx,
    balance: r.balance,
    tx_count: r.tx_count
  }));
};

// Bulk update of address balances after a network sync.
export const dbUpdateAddressInfoBatch = async (updates: { address: string; balance: number; tx_count: number }[]) => {
  const d = getDB();
  // Note: For very large batches (1000+), this should be wrapped in a transaction.
  for (const update of updates) {
    await d.runAsync(
      'UPDATE addresses SET balance = ?, tx_count = ? WHERE address = ?',
      [update.balance, update.tx_count, update.address]
    );
  }
};

// ------------------------------------------------------------------
// UTXO OPERATIONS
// ------------------------------------------------------------------

export const dbGetUtxoLabels = async (wallet_id: string): Promise<Record<string, string>> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT txid, vout, label FROM utxos WHERE wallet_id = ? AND label IS NOT NULL',
    [wallet_id]
  );
  const labels: Record<string, string> = {};
  rows.forEach((r: any) => {
    labels[`${r.txid}:${r.vout}`] = r.label;
  });
  return labels;
};

export const dbUpdateUtxoLabel = async (txid: string, vout: number, label: string) => {
    const d = getDB();
    await d.runAsync(
        'UPDATE utxos SET label = ? WHERE txid = ? AND vout = ?',
        [label, txid, vout]
    );
}

/**
 * Full UTXO Sync
 * This is a "Resync" operation:
 * 1. Fetch user's existing custom labels (so we don't lose them).
 * 2. Delete ALL existing UTXOs for this wallet.
 * 3. Insert the fresh UTXO set from the network.
 * 4. Re-apply labels if the UTXO still exists.
 */
export const dbSyncUtxos = async (wallet_id: string, network: string, utxos: UTXO[], next_utxo_count: number) => {
  const d = getDB();
  
  const existing_labels = await dbGetUtxoLabels(wallet_id);
  
  // Clear old state
  await d.runAsync('DELETE FROM utxos WHERE wallet_id = ?', [wallet_id]);

  for (const u of utxos) {
    const key = `${u.txid}:${u.vout}`;
    let label = existing_labels[key] || null;
    
    // Auto-labeling: If it's a new UTXO, give it a sequential ID (e.g., "UTXO #5")
    if (!label) {
       label = `UTXO #${next_utxo_count}`;
       next_utxo_count++; 
    }

    await d.runAsync(
      `INSERT INTO utxos (txid, vout, wallet_id, address, value, label, status_json, network) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.txid, u.vout, wallet_id, u.address, u.value, label, JSON.stringify(u.status), network]
    );
  }

  // Save the counter so the next UTXO gets the next number
  await d.runAsync('UPDATE wallets SET nextUtxoCount = ? WHERE id = ?', [next_utxo_count, wallet_id]);
  
  return next_utxo_count;
};

// ------------------------------------------------------------------
// TRANSACTION HISTORY
// ------------------------------------------------------------------

export const dbGetTransactions = async (wallet_id: string): Promise<Transaction[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT json_content FROM transactions WHERE wallet_id = ? ORDER BY block_time DESC',
    [wallet_id]
  );
  
  // Rehydrate the JSON string back into a Transaction object
  return rows.map(r => JSON.parse(r.json_content));
};

export const dbSaveTransactions = async (wallet_id: string, transactions: Transaction[], network: string) => {
  const d = getDB();
  for (const tx of transactions) {
     // If unconfirmed, place it at the top of the list (future timestamp)
     const block_time = tx.status.block_time || Date.now() / 1000 + 100000; 
     
     await d.runAsync(
       `INSERT OR REPLACE INTO transactions (txid, wallet_id, json_content, block_time, network)
        VALUES (?, ?, ?, ?, ?)`,
       [tx.txid, wallet_id, JSON.stringify(tx), block_time, network]
     );
  }
};

// ------------------------------------------------------------------
// ADDRESS BOOK & WATCHLIST
// ------------------------------------------------------------------

export const dbGetSavedAddresses = async (network: string, table: 'saved_addresses') => {
    const d = getDB();
    const rows = await d.getAllAsync<any>(`SELECT * FROM ${table} WHERE network = ?`, [network]);
    return rows.map((r: any) => ({
        id: r.id,
        address: r.address,
        name: r.name,
        balance: r.balance,
        lastUpdated: new Date(r.lastUpdated)
    }));
};

export const dbAddSavedAddress = async (table: 'saved_addresses', item: BitcoinAddress, network: string) => {
    const d = getDB();
    await d.runAsync(
        `INSERT INTO ${table} (id, address, name, balance, lastUpdated, network) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.address, item.name || '', item.balance, item.lastUpdated.getTime(), network]
    );
};

export const dbRemoveSavedAddress = async (table: 'saved_addresses', id: string) => {
    const d = getDB();
    await d.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
};

export const dbUpdateSavedAddress = async (table: 'saved_addresses', item: BitcoinAddress) => {
    const d = getDB();
    await d.runAsync(
        `UPDATE ${table} SET name = ?, balance = ?, lastUpdated = ? WHERE id = ?`,
        [item.name || '', item.balance, item.lastUpdated.getTime(), item.id]
    );
};
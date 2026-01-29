import * as SQLite from 'expo-sqlite';
import { BitcoinAddress, UTXO, Wallet, DerivedAddress, DerivedAddressInfo, Transaction } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

export const initDatabase = async () => {
  db = await SQLite.openDatabaseAsync('trustless_wallet.db');

  // Enable foreign keys for data integrity
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // WAL mode for better performance
  await db.execAsync('PRAGMA journal_mode = WAL;');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      network TEXT NOT NULL,
      changeAddressIndex INTEGER DEFAULT 0,
      nextUtxoCount INTEGER DEFAULT 1,
      mnemonic_enc TEXT 
    );

    CREATE TABLE IF NOT EXISTS addresses (
      address TEXT PRIMARY KEY NOT NULL,
      wallet_id TEXT NOT NULL,
      chain INTEGER NOT NULL, -- 0 = Receive, 1 = Change
      idx INTEGER NOT NULL,
      balance INTEGER DEFAULT 0,
      tx_count INTEGER DEFAULT 0,
      network TEXT NOT NULL,
      FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
    );

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

    -- NEW: Transactions Table
    CREATE TABLE IF NOT EXISTS transactions (
      txid TEXT NOT NULL,
      wallet_id TEXT NOT NULL,
      json_content TEXT NOT NULL,
      block_time INTEGER,
      network TEXT NOT NULL,
      PRIMARY KEY (txid, wallet_id),
      FOREIGN KEY (wallet_id) REFERENCES wallets (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS saved_addresses (
      id TEXT PRIMARY KEY NOT NULL,
      address TEXT NOT NULL,
      name TEXT,
      balance INTEGER DEFAULT 0,
      lastUpdated INTEGER,
      network TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracked_addresses (
      id TEXT PRIMARY KEY NOT NULL,
      address TEXT NOT NULL,
      name TEXT,
      balance INTEGER DEFAULT 0,
      lastUpdated INTEGER,
      network TEXT NOT NULL
    );
  `);
};

export const getDB = () => {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
};

// --- Wallet Helpers ---

export const dbGetWallets = async (network: string): Promise<Wallet[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT * FROM wallets WHERE network = ?',
    [network]
  );
  
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    changeAddressIndex: row.changeAddressIndex,
    nextUtxoCount: row.nextUtxoCount,
    derivedReceiveAddresses: [],
    derivedChangeAddresses: [],
    derivedAddressInfoCache: [],
    utxoLabels: {}
  }));
};

export const dbCreateWallet = async (id: string, name: string, network: string) => {
  const d = getDB();
  await d.runAsync(
    'INSERT INTO wallets (id, name, network, changeAddressIndex, nextUtxoCount) VALUES (?, ?, ?, ?, ?)',
    [id, name, network, 0, 1]
  );
};

export const dbDeleteWallet = async (id: string) => {
  const d = getDB();
  await d.runAsync('DELETE FROM wallets WHERE id = ?', [id]);
};

export const dbUpdateWalletName = async (id: string, name: string) => {
  const d = getDB();
  await d.runAsync('UPDATE wallets SET name = ? WHERE id = ?', [name, id]);
};

export const dbUpdateChangeIndex = async (id: string, index: number) => {
  const d = getDB();
  await d.runAsync('UPDATE wallets SET changeAddressIndex = ? WHERE id = ?', [index, id]);
};

// --- Address Helpers ---

export const dbSaveAddress = async (walletId: string, addr: { address: string, index: number }, chain: number, network: string) => {
  const d = getDB();
  await d.runAsync(
    'INSERT OR IGNORE INTO addresses (address, wallet_id, chain, idx, network) VALUES (?, ?, ?, ?, ?)',
    [addr.address, walletId, chain, addr.index, network]
  );
};

export const dbGetDerivedAddresses = async (walletId: string, chain: number): Promise<DerivedAddress[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT address, idx FROM addresses WHERE wallet_id = ? AND chain = ? ORDER BY idx ASC',
    [walletId, chain]
  );
  return rows.map((r: any) => ({ address: r.address, index: r.idx }));
};

export const dbGetAddressCache = async (walletId: string): Promise<DerivedAddressInfo[]> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT address, idx, balance, tx_count FROM addresses WHERE wallet_id = ?',
    [walletId]
  );
  return rows.map((r: any) => ({
    address: r.address,
    index: r.idx,
    balance: r.balance,
    tx_count: r.tx_count
  }));
};

export const dbUpdateAddressInfoBatch = async (updates: { address: string; balance: number; tx_count: number }[]) => {
  const d = getDB();
  for (const update of updates) {
    await d.runAsync(
      'UPDATE addresses SET balance = ?, tx_count = ? WHERE address = ?',
      [update.balance, update.tx_count, update.address]
    );
  }
};

// --- UTXO Helpers ---

export const dbGetUtxoLabels = async (walletId: string): Promise<Record<string, string>> => {
  const d = getDB();
  const rows = await d.getAllAsync<any>(
    'SELECT txid, vout, label FROM utxos WHERE wallet_id = ? AND label IS NOT NULL',
    [walletId]
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

export const dbSyncUtxos = async (walletId: string, network: string, utxos: UTXO[], nextUtxoCount: number) => {
  const d = getDB();
  
  const existingLabels = await dbGetUtxoLabels(walletId);
  
  await d.runAsync('DELETE FROM utxos WHERE wallet_id = ?', [walletId]);

  for (const u of utxos) {
    const key = `${u.txid}:${u.vout}`;
    let label = existingLabels[key] || null;
    
    if (!label) {
       label = `UTXO #${nextUtxoCount}`;
       nextUtxoCount++; 
    }

    await d.runAsync(
      `INSERT INTO utxos (txid, vout, wallet_id, address, value, label, status_json, network) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.txid, u.vout, walletId, u.address, u.value, label, JSON.stringify(u.status), network]
    );
  }

  await d.runAsync('UPDATE wallets SET nextUtxoCount = ? WHERE id = ?', [nextUtxoCount, walletId]);
  
  return nextUtxoCount;
};

// --- Transaction Helpers (NEW) ---

export const dbGetTransactions = async (walletId: string): Promise<Transaction[]> => {
  const d = getDB();
  // Sort by block_time desc (newest first). Unconfirmed (null block_time) usually comes first or last depending on need, 
  // but here we just grab them and let the UI sort if needed, though SQL sort is faster.
  // We'll sort by block_time DESC. Nulls (pending) usually should be at top. 
  const rows = await d.getAllAsync<any>(
    'SELECT json_content FROM transactions WHERE wallet_id = ? ORDER BY block_time DESC',
    [walletId]
  );
  
  return rows.map(r => JSON.parse(r.json_content));
};

export const dbSaveTransactions = async (walletId: string, transactions: Transaction[], network: string) => {
  const d = getDB();
  for (const tx of transactions) {
     // For sorting: if confirmed, use block_time. If pending, use a future timestamp or max int to keep at top.
     const blockTime = tx.status.block_time || Date.now() / 1000 + 100000; 
     
     await d.runAsync(
       `INSERT OR REPLACE INTO transactions (txid, wallet_id, json_content, block_time, network)
        VALUES (?, ?, ?, ?, ?)`,
       [tx.txid, walletId, JSON.stringify(tx), blockTime, network]
     );
  }
};


// --- Saved / Tracked Helpers ---

export const dbGetSavedAddresses = async (network: string, table: 'saved_addresses' | 'tracked_addresses') => {
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

export const dbAddSavedAddress = async (table: 'saved_addresses' | 'tracked_addresses', item: BitcoinAddress, network: string) => {
    const d = getDB();
    await d.runAsync(
        `INSERT INTO ${table} (id, address, name, balance, lastUpdated, network) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.address, item.name || '', item.balance, item.lastUpdated.getTime(), network]
    );
};

export const dbRemoveSavedAddress = async (table: 'saved_addresses' | 'tracked_addresses', id: string) => {
    const d = getDB();
    await d.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
};

export const dbUpdateSavedAddress = async (table: 'saved_addresses' | 'tracked_addresses', item: BitcoinAddress) => {
    const d = getDB();
    await d.runAsync(
        `UPDATE ${table} SET name = ?, balance = ?, lastUpdated = ? WHERE id = ?`,
        [item.name || '', item.balance, item.lastUpdated.getTime(), item.id]
    );
};
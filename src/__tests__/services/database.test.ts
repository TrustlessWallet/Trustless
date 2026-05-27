import { UTXO, Transaction, BitcoinAddress } from '../../types';

const mockExecAsync = jest.fn();
const mockGetAllAsync = jest.fn();
const mockRunAsync = jest.fn();
const mockOpenDatabaseAsync = jest.fn().mockResolvedValue({
  execAsync: (...args: any[]) => mockExecAsync(...args),
  getAllAsync: (...args: any[]) => mockGetAllAsync(...args),
  runAsync: (...args: any[]) => mockRunAsync(...args),
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: (...args: any[]) => mockOpenDatabaseAsync(...args),
}));

describe('Database Service', () => {
  let dbService: typeof import('../../services/database');

  beforeEach(() => {
    // Reset module registry to clear the singleton `db` instance in database.ts
    jest.resetModules();
    jest.clearAllMocks();

    // Re-import the module fresh for every test
    dbService = require('../../services/database');
  });

  describe('Initialization & State', () => {
    it('throws if getDB is called before initialization', () => {
      expect(() => dbService.getDB()).toThrow('Database not initialized');
    });

    it('initializes the database and enables foreign keys', async () => {
      await dbService.initDatabase();

      expect(mockOpenDatabaseAsync).toHaveBeenCalledWith('trustless_wallet.db');
      expect(mockExecAsync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
      expect(mockExecAsync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');

      // Should create tables
      expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS wallets'));
      expect(mockExecAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS transactions'));

      expect(() => dbService.getDB()).not.toThrow();
    });
  });

  describe('Wallet Operations', () => {
    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('dbGetWallets fetches and formats wallets', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { id: '1', name: 'Main', type: 'standard', xpub: null, scriptType: 'p2wpkh', changeAddressIndex: 2, nextUtxoCount: 5, fingerprint: 'fp123', derivation_path: "m/84'/0'/0'" }
      ]);

      const wallets = await dbService.dbGetWallets('testnet');

      expect(mockGetAllAsync).toHaveBeenCalledWith(
        'SELECT * FROM wallets WHERE network = ?',
        ['testnet']
      );
      expect(wallets[0]).toEqual({
        id: '1',
        name: 'Main',
        type: 'standard',
        xpub: null,
        scriptType: 'p2wpkh',
        changeAddressIndex: 2,
        nextUtxoCount: 5,
        fingerprint: 'fp123',
        derivation_path: "m/84'/0'/0'",
        derivedReceiveAddresses: [],
        derivedChangeAddresses: [],
        derivedAddressInfoCache: [],
        utxoLabels: {}
      });
    });

    it('dbCreateWallet creates a new wallet with defaults', async () => {
      await dbService.dbCreateWallet('w1', 'My Wallet', 'mainnet');

      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallets'),
        ['w1', 'My Wallet', 'mainnet', 0, 1, 'standard', null, 'p2wpkh', null, null]
      );
    });

    it('dbDeleteWallet deletes a wallet', async () => {
      await dbService.dbDeleteWallet('w1');
      expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM wallets WHERE id = ?', ['w1']);
    });

    it('dbUpdateWalletName updates name', async () => {
      await dbService.dbUpdateWalletName('w1', 'New Name');
      expect(mockRunAsync).toHaveBeenCalledWith('UPDATE wallets SET name = ? WHERE id = ?', ['New Name', 'w1']);
    });

    it('dbUpdateChangeIndex updates index', async () => {
      await dbService.dbUpdateChangeIndex('w1', 5);
      expect(mockRunAsync).toHaveBeenCalledWith('UPDATE wallets SET changeAddressIndex = ? WHERE id = ?', [5, 'w1']);
    });
  });

  describe('Address Operations', () => {
    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('dbSaveAddress saves a derived address', async () => {
      await dbService.dbSaveAddress('w1', { address: 'bc1q...', index: 3 }, 0, 'mainnet');
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR IGNORE INTO addresses'),
        ['bc1q...', 'w1', 0, 3, 'mainnet', null]
      );
    });

    it('dbFindWalletByAddress finds wallet id', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ wallet_id: 'w1' }]);
      const result = await dbService.dbFindWalletByAddress('bc1q...');
      expect(result).toBe('w1');
    });

    it('dbFindWalletByXpub finds wallet id', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ id: 'w1' }]);
      const result = await dbService.dbFindWalletByXpub('xpub123');
      expect(result).toBe('w1');
    });

    it('dbGetDerivedAddresses fetches and orders addresses', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ address: 'addr1', idx: 0 }, { address: 'addr2', idx: 1 }]);
      const addresses = await dbService.dbGetDerivedAddresses('w1', 1);

      expect(mockGetAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY idx ASC'),
        ['w1', 1]
      );
      expect(addresses).toEqual([{ address: 'addr1', index: 0 }, { address: 'addr2', index: 1 }]);
    });

    it('dbGetAddressCache fetches balances and tx counts', async () => {
      mockGetAllAsync.mockResolvedValueOnce([{ address: 'addr1', idx: 0, balance: 100, tx_count: 2 }]);
      const cache = await dbService.dbGetAddressCache('w1');
      expect(cache).toEqual([{ address: 'addr1', index: 0, balance: 100, tx_count: 2 }]);
    });

    it('dbUpdateAddressInfoBatch runs batch updates', async () => {
      await dbService.dbUpdateAddressInfoBatch([
        { address: 'addr1', balance: 500, tx_count: 3 },
        { address: 'addr2', balance: 0, tx_count: 0 }
      ]);
      expect(mockRunAsync).toHaveBeenCalledTimes(2);
      expect(mockRunAsync).toHaveBeenNthCalledWith(1, expect.any(String), [500, 3, 'addr1']);
      expect(mockRunAsync).toHaveBeenNthCalledWith(2, expect.any(String), [0, 0, 'addr2']);
    });
  });

  describe('UTXO Operations', () => {
    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('dbGetUtxoLabels maps txid:vout to labels', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { txid: 'tx1', vout: 0, label: 'Custom' },
        { txid: 'tx2', vout: 1, label: 'Gift' }
      ]);
      const labels = await dbService.dbGetUtxoLabels('w1');
      expect(labels).toEqual({ 'tx1:0': 'Custom', 'tx2:1': 'Gift' });
    });

    it('dbUpdateUtxoLabel updates label', async () => {
      await dbService.dbUpdateUtxoLabel('tx1', 0, 'New Label');
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE utxos SET label = ?'),
        ['New Label', 'tx1', 0]
      );
    });

    it('dbSyncUtxos replaces utxos, preserves labels, and assigns new labels', async () => {
      // Mock existing labels
      mockGetAllAsync.mockResolvedValueOnce([{ txid: 'txOld', vout: 0, label: 'Kept Label' }]);

      const utxos: UTXO[] = [
        { txid: 'txOld', vout: 0, address: 'addr1', value: 100, status: { confirmed: true } } as any, // Existing
        { txid: 'txNew', vout: 1, address: 'addr2', value: 200, status: { confirmed: false } } as any // New
      ];

      const newCount = await dbService.dbSyncUtxos('w1', 'mainnet', utxos, 5);

      // Verify deletion of old state
      expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM utxos WHERE wallet_id = ?', ['w1']);

      // Verify insertions
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO utxos'),
        ['txOld', 0, 'w1', 'addr1', 100, 'Kept Label', '{"confirmed":true}', 'mainnet']
      );
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO utxos'),
        ['txNew', 1, 'w1', 'addr2', 200, 'UTXO #5', '{"confirmed":false}', 'mainnet']
      );

      // Verify nextUtxoCount update
      expect(mockRunAsync).toHaveBeenCalledWith('UPDATE wallets SET nextUtxoCount = ? WHERE id = ?', [6, 'w1']);
      expect(newCount).toBe(6);
    });
  });

  describe('Transaction Operations', () => {
    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('dbGetTransactions parses JSON content', async () => {
      const mockTx = { txid: 'tx1', fee: 100 };
      mockGetAllAsync.mockResolvedValueOnce([{ json_content: JSON.stringify(mockTx) }]);

      const txs = await dbService.dbGetTransactions('w1');
      expect(txs).toEqual([mockTx]);
      expect(mockGetAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY block_time DESC'),
        ['w1']
      );
    });

    it('dbSaveTransactions inserts transactions and handles unconfirmed block times', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1000000); // 1000 seconds

      const txs: Transaction[] = [
        { txid: 'tx1', status: { block_time: 5000 } } as any, // Confirmed
        { txid: 'tx2', status: { block_time: undefined } } as any // Unconfirmed
      ];

      await dbService.dbSaveTransactions('w1', txs, 'mainnet');

      expect(mockRunAsync).toHaveBeenCalledTimes(2);

      // Confirmed uses exact block_time
      expect(mockRunAsync).toHaveBeenNthCalledWith(1,
        expect.stringContaining('INSERT OR REPLACE INTO transactions'),
        ['tx1', 'w1', JSON.stringify(txs[0]), 5000, 'mainnet']
      );

      // Unconfirmed assigns future block time (1000 + 100000 = 101000)
      expect(mockRunAsync).toHaveBeenNthCalledWith(2,
        expect.stringContaining('INSERT OR REPLACE INTO transactions'),
        ['tx2', 'w1', JSON.stringify(txs[1]), 101000, 'mainnet']
      );

      jest.restoreAllMocks();
    });
  });

  describe('Address Book & Watchlist Operations', () => {
    const mockDate = new Date('2024-01-01T00:00:00.000Z');

    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('dbGetSavedAddresses maps data correctly', async () => {
      mockGetAllAsync.mockResolvedValueOnce([
        { id: '1', address: 'addr1', name: 'Alice', balance: 100, lastUpdated: mockDate.getTime() }
      ]);

      const items = await dbService.dbGetSavedAddresses('mainnet', 'saved_addresses');
      expect(items[0]).toEqual({
        id: '1', address: 'addr1', name: 'Alice', balance: 100, lastUpdated: mockDate
      });
    });

    it('dbRemoveSavedAddress deletes item', async () => {
      await dbService.dbRemoveSavedAddress('saved_addresses', '1');
      expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM saved_addresses WHERE id = ?', ['1']);
    });

    it('dbUpdateSavedAddress updates fields', async () => {
      const item: BitcoinAddress = { id: '1', address: 'addr1', name: 'Bob', balance: 200, lastUpdated: mockDate };
      await dbService.dbUpdateSavedAddress('saved_addresses', item);

      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE saved_addresses SET name = ?, balance = ?, lastUpdated = ? WHERE id = ?'),
        ['Bob', 200, mockDate.getTime(), '1']
      );
    });
  });

  describe('Advanced Scenarios', () => {
    beforeEach(async () => {
      await dbService.initDatabase();
    });

    it('cascade_deletion_integrity_clears_related_tables', async () => {
      // Provide a default empty array to prevent undefined errors in sub-queries like dbGetUtxoLabels
      mockGetAllAsync.mockResolvedValue([]);

      // Setup mock state
      await dbService.dbCreateWallet('w1', 'Wallet', 'mainnet');
      await dbService.dbSaveAddress('w1', { address: 'addr1', index: 0 }, 0, 'mainnet');
      await dbService.dbSyncUtxos('w1', 'mainnet', [{ txid: 'tx1', vout: 0, address: 'addr1', value: 100, status: { confirmed: true } } as any], 1);
      await dbService.dbSaveTransactions('w1', [{ txid: 'tx1', status: { block_time: 5000 } } as any], 'mainnet');

      // Execute deletion
      await dbService.dbDeleteWallet('w1');

      // Verify the DELETE query was dispatched to the wallet table
      expect(mockRunAsync).toHaveBeenCalledWith('DELETE FROM wallets WHERE id = ?', ['w1']);

      const db = dbService.getDB();
      const addresses = await (db as any).getAllAsync('SELECT * FROM addresses WHERE wallet_id = ?', ['w1']);
      const utxos = await (db as any).getAllAsync('SELECT * FROM utxos WHERE wallet_id = ?', ['w1']);
      const txs = await (db as any).getAllAsync('SELECT * FROM transactions WHERE wallet_id = ?', ['w1']);

      expect(addresses.length).toBe(0);
      expect(utxos.length).toBe(0);
      expect(txs.length).toBe(0);
    });

    it('transaction_sorting_prioritizes_unconfirmed_blocks', async () => {
      const nowSeconds = Math.floor(Date.now() / 1000);
      jest.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);

      const confirmedTx = { txid: 'tx1', status: { block_time: 5000 } };
      const unconfirmedTx = { txid: 'tx2', status: { block_time: null } };

      await dbService.dbSaveTransactions('w1', [confirmedTx, unconfirmedTx] as any, 'mainnet');

      // Verify unconfirmed transaction gets the future timestamp offset
      const expectedFutureTimestamp = nowSeconds + 100000;
      expect(mockRunAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO transactions'),
        ['tx2', 'w1', JSON.stringify(unconfirmedTx), expectedFutureTimestamp, 'mainnet']
      );

      // Mock database returning them ordered by block_time DESC
      mockGetAllAsync.mockResolvedValueOnce([
        { json_content: JSON.stringify(unconfirmedTx) }, // High future timestamp
        { json_content: JSON.stringify(confirmedTx) }    // 5000
      ]);

      const txs = await dbService.dbGetTransactions('w1');

      // Verify unconfirmed is strictly at the top
      expect(txs[0].txid).toBe('tx2');
      expect(txs[1].txid).toBe('tx1');

      jest.restoreAllMocks();
    });

    it('address_cache_batch_updates_handles_massive_arrays', async () => {
      const massiveArray = Array.from({ length: 2000 }, (_, i) => ({
        address: `bc1q_test_addr_${i}`,
        balance: 1000,
        tx_count: 5
      }));

      const startTime = performance.now();
      await dbService.dbUpdateAddressInfoBatch(massiveArray);
      const executionTime = performance.now() - startTime;

      expect(mockRunAsync).toHaveBeenCalledTimes(2000);

      expect(executionTime).toBeLessThan(1000);
    });
  });
});
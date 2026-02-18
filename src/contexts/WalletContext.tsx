import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from 'react';
import 'react-native-get-random-values';
import * as bip39 from 'bip39';
import * as Keychain from 'react-native-keychain';
import { v4 as uuidv4 } from 'uuid';
import * as secp from '@bitcoinerlab/secp256k1';
import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { payments } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { useQueryClient } from '@tanstack/react-query'; 
import { Alert } from 'react-native';

import { Wallet, DerivedAddress, BitcoinAddress, DerivedAddressInfo, UTXO } from '../types';
import { 
    calculateTransactionMetrics,
    fetchUTXOs,
    getBip32Node,
    inferScriptType
} from '../services/bitcoin';
import { NETWORK, DERIVATION_PARENT_PATH, NETWORK_NAME } from '../constants/network'; 
import { 
    dbGetWallets, dbCreateWallet, dbDeleteWallet, dbUpdateWalletName, 
    dbGetDerivedAddresses, dbGetAddressCache, dbSaveAddress, 
    dbUpdateAddressInfoBatch, dbGetUtxoLabels, dbSyncUtxos, dbUpdateUtxoLabel,
    dbGetSavedAddresses, dbAddSavedAddress, dbRemoveSavedAddress, dbUpdateSavedAddress,
    dbUpdateChangeIndex,
    dbFindWalletByAddress,
    dbFindWalletByXpub
} from '../services/database';

import { useWalletBalanceSync, useAddressListSync } from '../hooks/useBalance'; 

// Initialize cryptographic libraries
const bip32 = BIP32Factory(secp);
const ECPair = ECPairFactory(secp);
bitcoin.initEccLib(secp);

// ------------------------------------------------------------------
// STORAGE CONSTANTS
// ------------------------------------------------------------------

// Keychain Service Name: Used to securely namespace the mnemonics in the OS secure storage.
const KEYCHAIN_SERVICE_PREFIX = 'com.btc.trustless.mnemonic';

// Stores the ID of the currently open wallet so the app remembers where you left off.
const KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE = 'com.btc.trustless.activeWalletId';

// The BIP-44 "Gap Limit". 
// We stop generating new addresses if we find 20 unused addresses in a row.
const GAP_LIMIT = 20;

const getStorageKey = (base: string) => `${base}.${NETWORK_NAME}`;

// Extended interface for the currently active wallet, including its runtime cache.
interface ActiveWallet extends Wallet {
  address: string; // The current "next" receiving address
  receiveAddressIndex: number;
}

interface WalletContextType {
  wallets: Wallet[];
  activeWallet: ActiveWallet | null;
  loading: boolean;
  lastRefreshTime: number;
  triggerRefresh: () => void;
  generateMnemonic: (strength?: number) => Promise<string | null>;
  addWallet: (params: { mnemonic?: string; xpub?: string; type?: 'standard' | 'watch-only'; name?: string }) => Promise<Wallet | null>;
  switchWallet: (walletId: string) => Promise<void>;
  updateWalletName: (walletId: string, newName: string) => Promise<void>;
  removeWallet: (walletId: string) => Promise<void>;
  getMnemonicForWallet: (walletId: string) => Promise<string | null>;
  resetWallet: () => Promise<void>;
  createAndSignTransaction: (
    recipient: string,
    amount: number,
    utxos: any[],
    feeRate: number
  ) => Promise<{ txHex: string | null; usedChangeIndex: number | null }>;
  incrementChangeIndex: (walletId: string, lastUsedIndex: number) => Promise<void>;
  getOrCreateNextUnusedReceiveAddress: (currentAddress: string, currentIndex: number) => Promise<{ address: string, index: number } | null>;
  
  updateUtxoLabel: (txid: string, vout: number, label: string) => Promise<void>;
  scanAndNameUtxos: () => Promise<void>;
  getUtxoLabel: (txid: string, vout: number) => string;

  savedAddresses: BitcoinAddress[];
  loadingSavedAddresses: boolean;
  addSavedAddress: (address: Omit<BitcoinAddress, 'id'>) => Promise<void>;
  removeSavedAddress: (addressId: string) => Promise<void>;
  updateSavedAddressName: (addressId: string, newName: string) => Promise<void>;
  refreshSavedAddressBalances: () => Promise<void>;

  trackedAddresses: BitcoinAddress[];
  loadingTrackedAddresses: boolean;
  addTrackedAddress: (address: Omit<BitcoinAddress, 'id'>) => Promise<void>;
  removeTrackedAddress: (addressId: string) => Promise<void>;
  updateTrackedAddressName: (addressId: string, newName: string) => Promise<void>;
  refreshTrackedAddressBalances: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  
  // ------------------------------------------------------------------
  // STATE MANAGEMENT
  // ------------------------------------------------------------------
  
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<ActiveWallet | null>(null);
  const [loading, setLoading] = useState(true);
  // Used to force React Query to re-fetch data
  const [lastRefreshTime, setLastRefreshTime] = useState(() => Date.now());
  
  // Address Book state
  const [savedAddresses, setSavedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingSavedAddresses, setLoadingSavedAddresses] = useState(true);

  // Watchlist state (Tracked Addresses)
  const [trackedAddresses, setTrackedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingTrackedAddresses, setLoadingTrackedAddresses] = useState(true);

  const ACTIVE_WALLET_KEY = getStorageKey(KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE);

  // ------------------------------------------------------------------
  // SYNC HOOKS (Background Data Fetching)
  // ------------------------------------------------------------------

  // Memoize the list of addresses needed for the current wallet to avoid infinite loops
  const activeWalletAddresses = useMemo(() => {
    if (!activeWallet) return [];
    return [
      ...activeWallet.derivedReceiveAddresses,
      ...activeWallet.derivedChangeAddresses
    ].map(a => a.address);
  }, [
    activeWallet?.id, 
    activeWallet?.derivedReceiveAddresses.length, 
    activeWallet?.derivedChangeAddresses.length
  ]);

  // Hook 1: Sync Balance for Active Wallet
  const { data: syncedWalletData } = useWalletBalanceSync(activeWallet?.id, activeWalletAddresses);

  // When new balance data arrives from the network:
  useEffect(() => {
    if (syncedWalletData && activeWallet) {
        // 1. Update the local SQLite database
        dbUpdateAddressInfoBatch(syncedWalletData);
        
        // 2. Update the in-memory state so the UI reflects changes instantly
        setActiveWallet(prev => {
            if (!prev || prev.id !== activeWallet.id) return prev;
            
            const newCache = prev.derivedAddressInfoCache.map(cachedItem => {
                const fresh = syncedWalletData.find(f => f.address === cachedItem.address);
                if (fresh) {
                    return { ...cachedItem, balance: fresh.balance, tx_count: fresh.tx_count };
                }
                return cachedItem;
            });

            return { ...prev, derivedAddressInfoCache: newCache };
        });
        
        // 3. Scan for new UTXOs since balances have changed
        scanAndNameUtxos();
    }
  }, [syncedWalletData]);

  // Hook 2: Sync Balance for Saved Addresses
  const { data: syncedSavedBalances } = useAddressListSync('saved', savedAddresses);
  
  useEffect(() => {
    if (syncedSavedBalances && savedAddresses.length > 0) {
        const updated = savedAddresses.map((addr, index) => ({
            ...addr,
            balance: syncedSavedBalances[index] ?? addr.balance,
            lastUpdated: new Date()
        }));
        const hasChanged = updated.some((u, i) => u.balance !== savedAddresses[i].balance);
        if (hasChanged) {
            updated.forEach(u => dbUpdateSavedAddress('saved_addresses', u));
            setSavedAddresses(updated);
        }
    }
  }, [syncedSavedBalances]);

  // Hook 3: Sync Balance for Tracked Addresses
  const { data: syncedTrackedBalances } = useAddressListSync('tracked', trackedAddresses);

  useEffect(() => {
    if (syncedTrackedBalances && trackedAddresses.length > 0) {
        const updated = trackedAddresses.map((addr, index) => ({
            ...addr,
            balance: syncedTrackedBalances[index] ?? addr.balance,
            lastUpdated: new Date()
        }));
        const hasChanged = updated.some((u, i) => u.balance !== trackedAddresses[i].balance);
        if (hasChanged) {
            updated.forEach(u => dbUpdateSavedAddress('tracked_addresses', u));
            setTrackedAddresses(updated);
        }
    }
  }, [syncedTrackedBalances]);

  // ------------------------------------------------------------------
  // WALLET HYDRATION & LOGIC
  // ------------------------------------------------------------------

  /**
   * Constructs the full `ActiveWallet` object from the database.
   * This involves fetching the wallet record + all derived addresses + UTXO labels.
   * It also determines the "current" receive address (the first one with 0 txs).
   */
  const buildActiveWallet = async (walletId: string): Promise<ActiveWallet | null> => {
      const allWallets = await dbGetWallets(NETWORK_NAME);
      const basicWallet = allWallets.find(w => w.id === walletId);
      if (!basicWallet) return null;

      const derivedReceiveAddresses = await dbGetDerivedAddresses(walletId, 0);
      const derivedChangeAddresses = await dbGetDerivedAddresses(walletId, 1);
      const derivedAddressInfoCache = await dbGetAddressCache(walletId);
      const utxoLabels = await dbGetUtxoLabels(walletId);

      const receiveSet = new Set(derivedReceiveAddresses.map(a => a.address));
      
      // Find the first unused receive address (Gap Limit logic)
      const maxIndex = derivedReceiveAddresses.length > 0 ? derivedReceiveAddresses[derivedReceiveAddresses.length - 1].index : -1;
      let firstUnusedIndex = -1;
      
      for (let i = 0; i <= maxIndex; i++) {
        const info = derivedAddressInfoCache.find(c => c.index === i && receiveSet.has(c.address));
        if (!info || info.tx_count === 0) {
            firstUnusedIndex = i;
            break;
        }
      }
      if (firstUnusedIndex === -1) firstUnusedIndex = maxIndex + 1;

      const currentReceiveAddress = derivedReceiveAddresses.find(a => a.index === firstUnusedIndex)?.address || '';

      return {
          ...basicWallet,
          derivedReceiveAddresses,
          derivedChangeAddresses,
          derivedAddressInfoCache,
          utxoLabels,
          address: currentReceiveAddress,
          receiveAddressIndex: firstUnusedIndex
      };
  };

  /**
   * Derives a specific Receive Address at a given index.
   * Handles both Standard (p2wpkh) and Nested Segwit (p2sh-p2wpkh).
   */
  const deriveReceiveAddress = (root: any, index: number, isWatchOnly: boolean, scriptType: string = 'p2wpkh'): DerivedAddress | null => {
    try {
      // If watch-only (xpub), the path is relative (0/x). If full wallet, it's absolute (m/84'/0'/0'/0/x).
      const derivationPath = isWatchOnly ? `0/${index}` : `${DERIVATION_PARENT_PATH}/0/${index}`;
      const child = root.derivePath(derivationPath);
      
      let address;
      if (scriptType === 'p2sh-p2wpkh') {
          const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
          const p2sh = payments.p2sh({ redeem: p2wpkh, network: NETWORK });
          address = p2sh.address;
      } else {
          const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
          address = p2wpkh.address;
      }

      return address ? { address, index } : null;
    } catch (error) {
      console.error(`Failed to derive receive address at index ${index}:`, error);
      return null;
    }
  };

  /**
   * Derives a specific Change Address (Internal Chain).
   * Used for sending the "change" back to ourselves during a transaction.
   */
  const deriveChangeAddress = (root: any, index: number, isWatchOnly: boolean, scriptType: string = 'p2wpkh'): DerivedAddress | null => {
    try {
      const derivationPath = isWatchOnly ? `1/${index}` : `${DERIVATION_PARENT_PATH}/1/${index}`;
      const child = root.derivePath(derivationPath);
      
      let address;
      if (scriptType === 'p2sh-p2wpkh') {
          const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
          const p2sh = payments.p2sh({ redeem: p2wpkh, network: NETWORK });
          address = p2sh.address;
      } else {
          const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
          address = p2wpkh.address;
      }
      
      return address ? { address, index } : null;
    } catch (error) {
      console.error(`Failed to derive change address at index ${index}:`, error);
      return null;
    }
  };

  const getUtxoLabel = useCallback((txid: string, vout: number): string => {
      if (!activeWallet) return '';
      const key = `${txid}:${vout}`;
      return activeWallet.utxoLabels[key] || '';
  }, [activeWallet]);

  const updateUtxoLabel = async (txid: string, vout: number, label: string) => {
      if (!activeWallet) return;
      await dbUpdateUtxoLabel(txid, vout, label);
      
      const key = `${txid}:${vout}`;
      const newLabels = { ...activeWallet.utxoLabels, [key]: label };
      setActiveWallet({ ...activeWallet, utxoLabels: newLabels });
  };

  /**
   * Scans all addresses for UTXOs (Unspent Transaction Outputs).
   * This is how we know what coins are available to spend.
   * If a new UTXO is found, we assign it a human-readable label (e.g., "UTXO #5").
   */
  const scanAndNameUtxos = async () => {
    if (!activeWallet) return;
    const infoCache = activeWallet.derivedAddressInfoCache ?? [];
    
    // Only scan addresses that actually have a positive balance
    const receiveForUtxos = infoCache.filter(i => i.balance > 0).map(i => i.address);
    
    // Scan recent change addresses too
    const changeIndex = activeWallet.changeAddressIndex ?? 0;
    const changeAddresses = (activeWallet.derivedChangeAddresses ?? [])
        .filter(a => a.index <= changeIndex + 1)
        .map(a => a.address);
    
    const targetAddresses = [...new Set([...receiveForUtxos, ...changeAddresses])];
    if (targetAddresses.length === 0) return;

    try {
        const fetchedUtxos = await fetchUTXOs(targetAddresses);
        const newCount = await dbSyncUtxos(activeWallet.id, NETWORK_NAME, fetchedUtxos, activeWallet.nextUtxoCount);
        const updatedLabels = await dbGetUtxoLabels(activeWallet.id);

        setActiveWallet(prev => prev ? ({ 
            ...prev, 
            utxoLabels: updatedLabels,
            nextUtxoCount: newCount 
        }) : null);
    } catch (error) {
        console.error("Failed to scan and name UTXOs:", error);
    }
  };

  const triggerRefresh = () => {
    setLastRefreshTime(Date.now());
    queryClient.invalidateQueries({ queryKey: ['wallet-balances'] });
    queryClient.invalidateQueries({ queryKey: ['saved', 'balances'] });
    queryClient.invalidateQueries({ queryKey: ['tracked', 'balances'] });
  };

  // Helper to get the root BIP32 node from either an xpub (watch-only) or seed (standard).
  const getRootNode = async (wallet: Wallet) => {
    if (wallet.type === 'watch-only') {
      if (!wallet.xpub) throw new Error("Watch-only wallet missing xpub");
      try {
          return getBip32Node(wallet.xpub, NETWORK);
      } catch (e) {
          throw new Error("Invalid Network Key");
      }
    } else {
      // Securely retrieve the mnemonic from the device KeyChain
      const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${wallet.id}` });
      if (!credentials) throw new Error(`Mnemonic not found for wallet ${wallet.id}`);
      const mnemonic = credentials.password;
      const seed = bip39.mnemonicToSeedSync(mnemonic);
      return bip32.fromSeed(seed, NETWORK);
    }
  };

  /**
   * LOAD WALLET (Critical)
   * This function loads a wallet ID into the 'activeWallet' state.
   * It ensures we have derived enough addresses (Gap Limit) so the user doesn't
   * miss any funds if they restored from an old backup.
   */
  const loadAndSetActiveWallet = async (walletId: string): Promise<boolean> => {
    let wallet = await buildActiveWallet(walletId);
    if (!wallet) return false;

    try {
        const root = await getRootNode(wallet);
        const isWatchOnly = wallet.type === 'watch-only';
        const scriptType = wallet.scriptType || 'p2wpkh'; 
        let derivedNew = false;
        
        // Ensure we have change addresses up to the gap limit
        for (let i = 0; i < GAP_LIMIT; i++) {
            if (!wallet.derivedChangeAddresses.find(a => a.index === i)) {
                const derived = deriveChangeAddress(root, i, isWatchOnly, scriptType);
                if (derived) {
                    await dbSaveAddress(walletId, derived, 1, NETWORK_NAME);
                    derivedNew = true;
                }
            }
        }

        // Ensure we have receive addresses up to the gap limit
        const currentMax = wallet.derivedReceiveAddresses.length > 0 
            ? wallet.derivedReceiveAddresses[wallet.derivedReceiveAddresses.length - 1].index 
            : -1;
        
        if (wallet.derivedReceiveAddresses.length < GAP_LIMIT) {
            for (let i = currentMax + 1; i < GAP_LIMIT; i++) {
                 const derived = deriveReceiveAddress(root, i, isWatchOnly, scriptType);
                 if (derived) {
                     await dbSaveAddress(walletId, derived, 0, NETWORK_NAME);
                     derivedNew = true;
                 }
            }
        }

        if (derivedNew) {
            // Re-fetch if we added new addresses
            wallet = await buildActiveWallet(walletId);
        }
        
        if(wallet) {
            setActiveWallet(wallet);
            return true;
        }
        return false;
    } catch (e) {
        console.warn(`Failed to load wallet ${wallet?.name}:`, e);
        setActiveWallet(null);
        return false;
    }
  };

  // INITIALIZATION
  // On app start, load all wallets and select the last active one.
  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setLoadingSavedAddresses(true);
      setLoadingTrackedAddresses(true);
      try {
        const walletsFromDb = await dbGetWallets(NETWORK_NAME);
        setWallets(walletsFromDb);

        let activeId: string | null = null;
        const activeIdCreds = await Keychain.getGenericPassword({ service: ACTIVE_WALLET_KEY });
        if (activeIdCreds) activeId = activeIdCreds.password;

        if (walletsFromDb.length > 0) {
            let currentId = activeId;
            // Fallback to first wallet if saved ID is invalid
            if (!currentId || !walletsFromDb.find(w => w.id === currentId)) {
                currentId = walletsFromDb[0].id;
            }

            let success = await loadAndSetActiveWallet(currentId);
            
            // If the active wallet is corrupted/unloadable, try others
            if (!success) {
                console.warn("Active wallet failed to load. Attempting fallback...");
                for (const w of walletsFromDb) {
                    if (w.id === currentId) continue;
                    success = await loadAndSetActiveWallet(w.id);
                    if (success) {
                        await Keychain.setGenericPassword('user', w.id, { service: ACTIVE_WALLET_KEY });
                        break;
                    }
                }
            }
        } else {
            setWallets([]);
            setActiveWallet(null);
        }

        const saved = await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses');
        setSavedAddresses(saved);
        const tracked = await dbGetSavedAddresses(NETWORK_NAME, 'tracked_addresses');
        setTrackedAddresses(tracked);

      } catch (error) {
        console.error("DEBUG: Failed to bootstrap wallet:", error);
      } finally {
        setLoading(false);
        setLoadingSavedAddresses(false);
        setLoadingTrackedAddresses(false);
      }
    };
    bootstrap();
  }, []);

  /**
   * Creates a new Receive Address.
   * Called when the user hits "Receive" and needs a fresh QR code.
   */
  const getOrCreateNextUnusedReceiveAddress = async (currentAddress: string, currentIndex: number): Promise<{ address: string, index: number } | null> => {
    if (!activeWallet) return null;
    
    const addresses = activeWallet.derivedReceiveAddresses;
    const currentPos = addresses.findIndex(a => a.index === currentIndex);
    
    // If there is already a pre-generated address ahead, return that.
    if (currentPos !== -1 && currentPos < addresses.length - 1) {
        return addresses[currentPos + 1];
    }

    // Otherwise, derive a new one from the seed
    try {
        const root = await getRootNode(activeWallet);
        const isWatchOnly = activeWallet.type === 'watch-only';
        const scriptType = activeWallet.scriptType || 'p2wpkh';
        const nextIndex = addresses[addresses.length - 1].index + 1;
        const derived = deriveReceiveAddress(root, nextIndex, isWatchOnly, scriptType);
        
        if (derived) {
            await dbSaveAddress(activeWallet.id, derived, 0, NETWORK_NAME);
            setActiveWallet(prev => {
                 if(!prev) return null;
                 return {
                     ...prev,
                     derivedReceiveAddresses: [...prev.derivedReceiveAddresses, derived],
                     derivedAddressInfoCache: [...prev.derivedAddressInfoCache, { address: derived.address, index: derived.index, balance: 0, tx_count: 0 }]
                 }
            });
            return derived;
        }
    } catch (e) {
        console.error("Failed to get next unused address", e);
    }

    return null;
  };

  const generateMnemonic = async (strength: number = 128): Promise<string | null> => {
    try {
      return bip39.generateMnemonic(strength);
    } catch (error) {
      console.error("Failed to create mnemonic", error);
      return null;
    }
  };

  /**
   * ADD WALLET
   * Handles creating a new wallet from:
   * 1. A new seed (Standard).
   * 2. An imported mnemonic (Standard).
   * 3. An xpub (Watch-only).
   */
  const addWallet = async (params: { mnemonic?: string; xpub?: string; type?: 'standard' | 'watch-only'; name?: string }): Promise<Wallet | null> => {
    const { mnemonic, name } = params;
    const type = params.type || 'standard';
    let walletXpub = params.xpub;
    
    let scriptType: 'p2wpkh' | 'p2sh-p2wpkh' = 'p2wpkh';

    try {
        if (walletXpub) {
             scriptType = inferScriptType(walletXpub);
        }

        // If standard, we need to derive the Account xpub for duplication checking
        if (type === 'standard' && mnemonic) {
             const seed = bip39.mnemonicToSeedSync(mnemonic);
             const root = bip32.fromSeed(seed, NETWORK);
             try {
                const accountNode = root.derivePath(DERIVATION_PARENT_PATH);
                walletXpub = accountNode.neutered().toBase58();
                scriptType = 'p2wpkh'; 
             } catch(err) {
                console.warn("Could not derive account xpub for standard wallet check", err);
             }
        }

        // DUPLICATE CHECKS
        if (walletXpub) {
             const existingId = await dbFindWalletByXpub(walletXpub);
             if (existingId) {
                 Alert.alert("Wallet Exists", "This wallet has already been added.");
                 return null;
             }
        }
        
        // Secondary check using address derivation
        let root;
        if (type === 'watch-only' && walletXpub) {
             root = getBip32Node(walletXpub, NETWORK);
        } else if (type === 'standard' && mnemonic) {
             const seed = bip39.mnemonicToSeedSync(mnemonic);
             root = bip32.fromSeed(seed, NETWORK);
        }

        if (root) {
             const isWatchOnly = type === 'watch-only';
             const firstAddressObj = deriveReceiveAddress(root, 0, isWatchOnly, scriptType);
             
             if (firstAddressObj) {
                 const existingId = await dbFindWalletByAddress(firstAddressObj.address);
                 if (existingId) {
                     Alert.alert("Wallet Exists", "This wallet has already been added.");
                     return null;
                 }
             }
        }
    } catch (e) {
        console.warn("Duplicate check failed", e);
    }

    const isFirstWallet = wallets.length === 0;
    const defaultName = name || `Wallet ${wallets.length + 1}`;
    const newWalletId = uuidv4();

    // Store sensitive mnemonic in Keychain, everything else in SQLite
    if (type === 'standard' && mnemonic) {
        await Keychain.setGenericPassword('user', mnemonic, { service: `${KEYCHAIN_SERVICE_PREFIX}.${newWalletId}` });
    }
    
    await dbCreateWallet(newWalletId, defaultName, NETWORK_NAME, type, walletXpub, scriptType);

    const newWallets = await dbGetWallets(NETWORK_NAME);
    setWallets(newWallets);
    
    if (isFirstWallet) {
        await Keychain.setGenericPassword('user', newWalletId, { service: ACTIVE_WALLET_KEY });
        await loadAndSetActiveWallet(newWalletId);
    } else {
        await switchWallet(newWalletId);
    }
    return newWallets.find(w => w.id === newWalletId) || null;
  };

  const switchWallet = async (walletId: string) => {
    if (activeWallet?.id === walletId) return;
    try {
      await Keychain.setGenericPassword('user', walletId, { service: ACTIVE_WALLET_KEY });
      await loadAndSetActiveWallet(walletId);
    } catch (error) {
        console.error("Failed to switch wallet:", error);
    }
  };

  const updateWalletName = async (walletId: string, newName: string) => {
    await dbUpdateWalletName(walletId, newName);
    const newWallets = await dbGetWallets(NETWORK_NAME);
    setWallets(newWallets);
    if (activeWallet?.id === walletId) {
      setActiveWallet(prev => (prev ? { ...prev, name: newName } : null));
    }
  };

  const removeWallet = async (walletId: string) => {
    // Delete from DB (cascades to addresses/txs)
    await dbDeleteWallet(walletId);
    // Delete from Keychain
    await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
    
    const remaining = await dbGetWallets(NETWORK_NAME);
    setWallets(remaining);
    
    if (activeWallet?.id === walletId) {
        if (remaining.length > 0) {
            await switchWallet(remaining[0].id);
        } else {
            setActiveWallet(null);
            await Keychain.resetGenericPassword({ service: ACTIVE_WALLET_KEY });
        }
    }
  };

  const getMnemonicForWallet = async (walletId: string): Promise<string | null> => {
    try {
        const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
        return credentials ? credentials.password : null;
    } catch (error) { return null; }
  };

  // Nuke everything (Debug/Dev tool)
  const resetWallet = async () => {
    const d = await dbGetWallets(NETWORK_NAME);
    for (const w of d) {
        await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${w.id}` });
        await dbDeleteWallet(w.id);
    }
    await Keychain.resetGenericPassword({ service: ACTIVE_WALLET_KEY });
    setWallets([]);
    setActiveWallet(null);
  };

  /**
   * CREATE TRANSACTION (The "Send" Logic)
   * 1. Fetches Private Key from Keychain.
   * 2. Selects UTXOs (Coin Control).
   * 3. Calculates Change (Total Input - Send Amount - Fee).
   * 4. Signs inputs with PSBT.
   */
  const createAndSignTransaction = async (
    recipient: string, amount: number, utxos: any[], feeRate: number
  ): Promise<{ txHex: string | null; usedChangeIndex: number | null }> => {
    if (!activeWallet) throw new Error("No active wallet.");
    if (activeWallet.type === 'watch-only') throw new Error("Watch-only wallets cannot sign transactions.");

    // Retrieve sensitive keys
    const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${activeWallet.id}` });
    if (!credentials) throw new Error("Could not retrieve credentials.");
    const mnemonic = credentials.password;
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, NETWORK);

    // Prepare Change Address
    const nextChangeIndex = activeWallet.changeAddressIndex ?? 0;
    const scriptType = activeWallet.scriptType || 'p2wpkh'; 
    
    let changeAddress = activeWallet.derivedChangeAddresses.find(a => a.index === nextChangeIndex)?.address;
    if (!changeAddress) {
        const derived = deriveChangeAddress(root, nextChangeIndex, false, scriptType);
        if (derived) {
            await dbSaveAddress(activeWallet.id, derived, 1, NETWORK_NAME);
            changeAddress = derived.address;
        }
    }

    if (!changeAddress) throw new Error("Failed to get change address.");

    try {
      const psbt = new bitcoin.Psbt({ network: NETWORK });
      let totalInput = 0;

      // Add Inputs
      for (const utxo of utxos) {
        totalInput += utxo.value;
        
        // Find the derivation path for this UTXO so we can sign it
        const recvInfo = activeWallet.derivedReceiveAddresses.find(a => a.address === utxo.address);
        const changeInfo = recvInfo ? null : activeWallet.derivedChangeAddresses.find(a => a.address === utxo.address);

        if (!recvInfo && !changeInfo) {
          throw new Error(`Could not find derivation info for UTXO address ${utxo.address}`);
        }

        const chain = changeInfo ? 1 : 0;
        const indexForPath = changeInfo ? changeInfo.index : recvInfo!.index;
        const derivationPath = `${DERIVATION_PARENT_PATH}/${chain}/${indexForPath}`;
        
        const child = root.derivePath(derivationPath);
        
        if (scriptType === 'p2sh-p2wpkh') {
            const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
            const p2sh = payments.p2sh({ redeem: p2wpkh, network: NETWORK });
            
            psbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              witnessUtxo: { script: p2sh.output!, value: utxo.value },
              redeemScript: p2wpkh.output,
            });
        } else {
            const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
            psbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              witnessUtxo: { script: p2wpkh.output!, value: utxo.value },
            });
        }
      };

      // Calculate Fees and Change
      const { vsize, fee, change, numOutputs } = calculateTransactionMetrics(
        utxos.length,
        amount,
        totalInput,
        feeRate
      );

      if (change < 0) {
        throw new Error(`Insufficient funds. You need ${amount + fee} sats but only have ${totalInput}.`);
      }

      // Add Outputs
      psbt.addOutput({ address: recipient, value: amount });
      
      let usedChangeIndex: number | null = null;
      if (numOutputs === 2) {
        psbt.addOutput({ address: changeAddress, value: change });
        usedChangeIndex = nextChangeIndex;
      }

      // Sign Inputs
      utxos.forEach((utxo, index) => {
        // Re-derive key for signing
        const recvInfo = activeWallet.derivedReceiveAddresses.find(a => a.address === utxo.address);
        const changeInfo = recvInfo ? null : activeWallet.derivedChangeAddresses.find(a => a.address === utxo.address);
        const chain = changeInfo ? 1 : 0;
        const indexForPath = changeInfo ? changeInfo.index : recvInfo!.index;
        const derivationPath = `${DERIVATION_PARENT_PATH}/${chain}/${indexForPath}`;
        const child = root.derivePath(derivationPath);
        const keyPair = ECPair.fromPrivateKey(child.privateKey!);
        
        psbt.signInput(index, keyPair);
      });

      psbt.finalizeAllInputs();
      return { txHex: psbt.extractTransaction().toHex(), usedChangeIndex };
    } catch (error) {
      console.error("Failed to create or sign transaction:", error);
      throw error;
    }
  };

  // Called AFTER a transaction is broadcast to prevent address reuse
  const incrementChangeIndex = async (walletId: string, lastUsedIndex: number) => {
    if (activeWallet?.changeAddressIndex === lastUsedIndex) {
        const next = lastUsedIndex + 1;
        await dbUpdateChangeIndex(walletId, next);
        
        if (activeWallet.id === walletId) {
            setActiveWallet({ ...activeWallet, changeAddressIndex: next });
        }
        const newWallets = await dbGetWallets(NETWORK_NAME);
        setWallets(newWallets);
    }
  };

  // ------------------------------------------------------------------
  // ADDRESS BOOK UTILITIES
  // ------------------------------------------------------------------

  const addSavedAddress = async (address: Omit<BitcoinAddress, 'id'>) => {
    const item = { ...address, id: uuidv4() };
    await dbAddSavedAddress('saved_addresses', item, NETWORK_NAME);
    setSavedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses'));
  };

  const removeSavedAddress = async (addressId: string) => {
    await dbRemoveSavedAddress('saved_addresses', addressId);
    setSavedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses'));
  };

  const updateSavedAddressName = async (addressId: string, newName: string) => {
    const item = savedAddresses.find(a => a.id === addressId);
    if(item) {
        await dbUpdateSavedAddress('saved_addresses', { ...item, name: newName });
        setSavedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses'));
    }
  };

  const refreshSavedAddressBalances = async () => {
    queryClient.invalidateQueries({ queryKey: ['saved', 'balances'] });
  };

  const addTrackedAddress = async (address: Omit<BitcoinAddress, 'id'>) => {
    const item = { ...address, id: uuidv4() };
    await dbAddSavedAddress('tracked_addresses', item, NETWORK_NAME);
    setTrackedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'tracked_addresses'));
  };

  const removeTrackedAddress = async (addressId: string) => {
    await dbRemoveSavedAddress('tracked_addresses', addressId);
    setTrackedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'tracked_addresses'));
  };

  const updateTrackedAddressName = async (addressId: string, newName: string) => {
    const item = trackedAddresses.find(a => a.id === addressId);
    if(item) {
        await dbUpdateSavedAddress('tracked_addresses', { ...item, name: newName });
        setTrackedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'tracked_addresses'));
    }
  };

  const refreshTrackedAddressBalances = async () => {
    queryClient.invalidateQueries({ queryKey: ['tracked', 'balances'] });
  };

  const value = {
    wallets,
    activeWallet,
    loading,
    lastRefreshTime,
    triggerRefresh,
    generateMnemonic,
    addWallet,
    switchWallet,
    updateWalletName,
    removeWallet,
    getMnemonicForWallet,
    resetWallet,
    createAndSignTransaction,
    incrementChangeIndex,
    getOrCreateNextUnusedReceiveAddress,
    
    updateUtxoLabel,
    scanAndNameUtxos,
    getUtxoLabel,
    
    savedAddresses,
    loadingSavedAddresses,
    addSavedAddress,
    removeSavedAddress,
    updateSavedAddressName,
    refreshSavedAddressBalances,

    trackedAddresses,
    loadingTrackedAddresses,
    addTrackedAddress,
    removeTrackedAddress,
    updateTrackedAddressName,
    refreshTrackedAddressBalances,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
};

export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
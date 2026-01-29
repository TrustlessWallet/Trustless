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

import { Wallet, DerivedAddress, BitcoinAddress, DerivedAddressInfo, UTXO } from '../types';
import { 
    calculateTransactionMetrics,
    fetchUTXOs,
} from '../services/bitcoin';
import { NETWORK, DERIVATION_PARENT_PATH, NETWORK_NAME } from '../constants/network'; 
import { 
    dbGetWallets, dbCreateWallet, dbDeleteWallet, dbUpdateWalletName, 
    dbGetDerivedAddresses, dbGetAddressCache, dbSaveAddress, 
    dbUpdateAddressInfoBatch, dbGetUtxoLabels, dbSyncUtxos, dbUpdateUtxoLabel,
    dbGetSavedAddresses, dbAddSavedAddress, dbRemoveSavedAddress, dbUpdateSavedAddress,
    dbUpdateChangeIndex
} from '../services/database';
// Migration import removed
import { useWalletBalanceSync, useAddressListSync } from '../hooks/useBalance'; 

const bip32 = BIP32Factory(secp);
const ECPair = ECPairFactory(secp);
bitcoin.initEccLib(secp);

const KEYCHAIN_SERVICE_PREFIX = 'com.btc.trustless.mnemonic';
const KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE = 'com.btc.trustless.activeWalletId';
const GAP_LIMIT = 20;

const getStorageKey = (base: string) => `${base}.${NETWORK_NAME}`;

interface ActiveWallet extends Wallet {
  address: string;
  receiveAddressIndex: number;
}

interface WalletContextType {
  wallets: Wallet[];
  activeWallet: ActiveWallet | null;
  loading: boolean;
  lastRefreshTime: number;
  triggerRefresh: () => void;
  generateMnemonic: (strength?: number) => Promise<string | null>;
  addWallet: (params: { mnemonic: string; name?: string }) => Promise<Wallet | null>;
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
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<ActiveWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState(() => Date.now());
  
  const [savedAddresses, setSavedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingSavedAddresses, setLoadingSavedAddresses] = useState(true);

  const [trackedAddresses, setTrackedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingTrackedAddresses, setLoadingTrackedAddresses] = useState(true);

  const ACTIVE_WALLET_KEY = getStorageKey(KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE);

  // --- AUTOMATED SYNC HOOKS ---

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

  const { data: syncedWalletData } = useWalletBalanceSync(activeWallet?.id, activeWalletAddresses);

  useEffect(() => {
    if (syncedWalletData && activeWallet) {
        // DB Update now accepts the data without index
        dbUpdateAddressInfoBatch(syncedWalletData);
        
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
        
        scanAndNameUtxos();
    }
  }, [syncedWalletData]);

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

  // --- END SYNC HOOKS ---

  const buildActiveWallet = async (walletId: string): Promise<ActiveWallet | null> => {
      const allWallets = await dbGetWallets(NETWORK_NAME);
      const basicWallet = allWallets.find(w => w.id === walletId);
      if (!basicWallet) return null;

      const derivedReceiveAddresses = await dbGetDerivedAddresses(walletId, 0);
      const derivedChangeAddresses = await dbGetDerivedAddresses(walletId, 1);
      const derivedAddressInfoCache = await dbGetAddressCache(walletId);
      const utxoLabels = await dbGetUtxoLabels(walletId);

      const receiveSet = new Set(derivedReceiveAddresses.map(a => a.address));
      
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

  const deriveReceiveAddress = (root: any, index: number): DerivedAddress | null => {
    try {
      const derivationPath = `${DERIVATION_PARENT_PATH}/0/${index}`;
      const child = root.derivePath(derivationPath);
      const { address } = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
      return address ? { address, index } : null;
    } catch (error) {
      console.error(`Failed to derive receive address at index ${index}:`, error);
      return null;
    }
  };

  const deriveChangeAddress = (root: any, index: number): DerivedAddress | null => {
    try {
      const derivationPath = `${DERIVATION_PARENT_PATH}/1/${index}`; 
      const child = root.derivePath(derivationPath);
      const { address } = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });
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

  const scanAndNameUtxos = async () => {
    if (!activeWallet) return;
    const infoCache = activeWallet.derivedAddressInfoCache ?? [];
    const receiveForUtxos = infoCache.filter(i => i.balance > 0).map(i => i.address);
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

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setLoadingSavedAddresses(true);
      setLoadingTrackedAddresses(true);
      try {
        // Migration call removed
        
        const walletsFromDb = await dbGetWallets(NETWORK_NAME);
        setWallets(walletsFromDb);

        let activeId: string | null = null;
        const activeIdCreds = await Keychain.getGenericPassword({ service: ACTIVE_WALLET_KEY });
        if (activeIdCreds) activeId = activeIdCreds.password;

        if (walletsFromDb.length > 0) {
            if (!activeId || !walletsFromDb.find(w => w.id === activeId)) {
                activeId = walletsFromDb[0].id;
                await Keychain.setGenericPassword('user', activeId, { service: ACTIVE_WALLET_KEY });
            }
            await loadAndSetActiveWallet(activeId);
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

  const getRootNode = async (walletId: string) => {
    const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
    if (!credentials) throw new Error(`Mnemonic not found for wallet ${walletId}`);
    const mnemonic = credentials.password;
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    return bip32.fromSeed(seed, NETWORK);
  }

  const loadAndSetActiveWallet = async (walletId: string) => {
    let wallet = await buildActiveWallet(walletId);
    if (!wallet) return;

    const root = await getRootNode(walletId);
    let derivedNew = false;
    
    for (let i = 0; i < GAP_LIMIT; i++) {
        if (!wallet.derivedChangeAddresses.find(a => a.index === i)) {
            const derived = deriveChangeAddress(root, i);
            if (derived) {
                await dbSaveAddress(walletId, derived, 1, NETWORK_NAME);
                derivedNew = true;
            }
        }
    }

    const currentMax = wallet.derivedReceiveAddresses.length > 0 
        ? wallet.derivedReceiveAddresses[wallet.derivedReceiveAddresses.length - 1].index 
        : -1;
    
    if (wallet.derivedReceiveAddresses.length < GAP_LIMIT) {
        for (let i = currentMax + 1; i < GAP_LIMIT; i++) {
             const derived = deriveReceiveAddress(root, i);
             if (derived) {
                 await dbSaveAddress(walletId, derived, 0, NETWORK_NAME);
                 derivedNew = true;
             }
        }
    }

    if (derivedNew) {
        wallet = await buildActiveWallet(walletId);
    }
    
    if(wallet) {
        setActiveWallet(wallet);
    }
  };

  const getOrCreateNextUnusedReceiveAddress = async (currentAddress: string, currentIndex: number): Promise<{ address: string, index: number } | null> => {
    if (!activeWallet) return null;
    
    const addresses = activeWallet.derivedReceiveAddresses;
    const currentPos = addresses.findIndex(a => a.index === currentIndex);
    
    if (currentPos !== -1 && currentPos < addresses.length - 1) {
        return addresses[currentPos + 1];
    }

    const root = await getRootNode(activeWallet.id);
    const nextIndex = addresses[addresses.length - 1].index + 1;
    const derived = deriveReceiveAddress(root, nextIndex);
    
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

  const addWallet = async (params: { mnemonic: string; name?: string }): Promise<Wallet | null> => {
    const { mnemonic, name } = params;
    const isFirstWallet = wallets.length === 0;
    const defaultName = `Wallet ${wallets.length + 1}`;
    const newWalletId = uuidv4();

    await Keychain.setGenericPassword('user', mnemonic, { service: `${KEYCHAIN_SERVICE_PREFIX}.${newWalletId}` });
    await dbCreateWallet(newWalletId, name || defaultName, NETWORK_NAME);

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
    await dbDeleteWallet(walletId);
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

  const createAndSignTransaction = async (
    recipient: string, amount: number, utxos: any[], feeRate: number
  ): Promise<{ txHex: string | null; usedChangeIndex: number | null }> => {
    if (!activeWallet) throw new Error("No active wallet.");

    const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${activeWallet.id}` });
    if (!credentials) throw new Error("Could not retrieve credentials.");
    const mnemonic = credentials.password;
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, NETWORK);

    const nextChangeIndex = activeWallet.changeAddressIndex ?? 0;
    
    let changeAddress = activeWallet.derivedChangeAddresses.find(a => a.index === nextChangeIndex)?.address;
    if (!changeAddress) {
        const derived = deriveChangeAddress(root, nextChangeIndex);
        if (derived) {
            await dbSaveAddress(activeWallet.id, derived, 1, NETWORK_NAME);
            changeAddress = derived.address;
        }
    }

    if (!changeAddress) throw new Error("Failed to get change address.");

    try {
      const psbt = new bitcoin.Psbt({ network: NETWORK });
      let totalInput = 0;

      for (const utxo of utxos) {
        totalInput += utxo.value;
        const recvInfo = activeWallet.derivedReceiveAddresses.find(a => a.address === utxo.address);
        const changeInfo = recvInfo ? null : activeWallet.derivedChangeAddresses.find(a => a.address === utxo.address);

        if (!recvInfo && !changeInfo) {
          throw new Error(`Could not find derivation info for UTXO address ${utxo.address}`);
        }

        const chain = changeInfo ? 1 : 0;
        const indexForPath = changeInfo ? changeInfo.index : recvInfo!.index;
        const derivationPath = `${DERIVATION_PARENT_PATH}/${chain}/${indexForPath}`;
        
        const child = root.derivePath(derivationPath);
        const p2wpkh = payments.p2wpkh({ pubkey: child.publicKey, network: NETWORK });

        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: { script: p2wpkh.output!, value: utxo.value, },
        });
      };

      const { vsize, fee, change, numOutputs } = calculateTransactionMetrics(
        utxos.length,
        amount,
        totalInput,
        feeRate
      );

      if (change < 0) {
        throw new Error(`Insufficient funds. You need ${amount + fee} sats but only have ${totalInput}.`);
      }

      psbt.addOutput({ address: recipient, value: amount });
      
      let usedChangeIndex: number | null = null;
      if (numOutputs === 2) {
        psbt.addOutput({ address: changeAddress, value: change });
        usedChangeIndex = nextChangeIndex;
      }

      utxos.forEach((utxo, index) => {
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
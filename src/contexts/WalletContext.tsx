import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import 'react-native-get-random-values';
import * as bip39 from 'bip39';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { v4 as uuidv4 } from 'uuid';
import * as secp from '@bitcoinerlab/secp256k1';
import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { payments } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import { Wallet, DerivedAddress, BitcoinAddress, DerivedAddressInfo, UTXO } from '../types';
import { 
    fetchAddressBalances, 
    fetchAddressInfoBatch, 
    calculateTransactionMetrics,
    fetchUTXOs,
} from '../services/bitcoin';
import { NETWORK, DERIVATION_PARENT_PATH, NETWORK_NAME } from '../constants/network'; 

const bip32 = BIP32Factory(secp);
const ECPair = ECPairFactory(secp);
bitcoin.initEccLib(secp);

const getStorageKey = (base: string) => `${base}.${NETWORK_NAME}`;

const KEYCHAIN_SERVICE_PREFIX = 'com.btc.trustless.mnemonic';
const KEYCHAIN_WALLETS_METADATA_KEY_BASE = 'com.btc.trustless.wallets';
const KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE = 'com.btc.trustless.activeWalletId';
const KEYCHAIN_SAVED_ADDRESSES_KEY_BASE = 'com.btc.trustless.savedAddresses';
const KEYCHAIN_TRACKED_ADDRESSES_KEY_BASE = 'com.btc.trustless.trackedAddresses';
const ASYNC_STORAGE_ONBOARDING_KEY = '@hasCompletedOnboarding';
const GAP_LIMIT = 20;

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
  switchWallet: (walletId: string, currentWallets: Wallet[]) => Promise<void>;
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
  
  // UTXO Management
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
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<ActiveWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState(() => Date.now());
  
  const [savedAddresses, setSavedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingSavedAddresses, setLoadingSavedAddresses] = useState(true);

  const [trackedAddresses, setTrackedAddresses] = useState<BitcoinAddress[]>([]);
  const [loadingTrackedAddresses, setLoadingTrackedAddresses] = useState(true);

  const WALLETS_KEY = getStorageKey(KEYCHAIN_WALLETS_METADATA_KEY_BASE);
  const ACTIVE_WALLET_KEY = getStorageKey(KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE);
  const SAVED_ADDR_KEY = getStorageKey(KEYCHAIN_SAVED_ADDRESSES_KEY_BASE);
  const TRACKED_ADDR_KEY = getStorageKey(KEYCHAIN_TRACKED_ADDRESSES_KEY_BASE);

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

  // --- UTXO Management Methods (Defined early to be used in effects) ---
  const getUtxoLabel = useCallback((txid: string, vout: number): string => {
      if (!activeWallet) return '';
      const key = `${txid}:${vout}`;
      return activeWallet.utxoLabels[key] || '';
  }, [activeWallet]);

  const updateUtxoLabel = async (txid: string, vout: number, label: string) => {
      if (!activeWallet) return;
      const key = `${txid}:${vout}`;
      const newLabels = { ...activeWallet.utxoLabels, [key]: label };
      
      const updatedWallet = { ...activeWallet, utxoLabels: newLabels };
      
      const updatedWallets = wallets.map(w => w.id === activeWallet.id ? { ...w, utxoLabels: newLabels } : w);
      
      setActiveWallet(updatedWallet);
      setWallets(updatedWallets);
      await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY });
  };

  const scanAndNameUtxos = async () => {
    if (!activeWallet) return;

    // 1. Fetch all UTXOs for known active addresses
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
        
        let labels = { ...activeWallet.utxoLabels };
        let nextCount = activeWallet.nextUtxoCount;
        let changed = false;

        // 2. Identify new UTXOs that don't have a label yet
        const newUtxos = fetchedUtxos.filter(u => !labels[`${u.txid}:${u.vout}`]);

        if (newUtxos.length > 0) {
            // 3. Sort them: Block Height (asc) -> TxID (asc) -> Vout (asc)
            newUtxos.sort((a, b) => {
                const heightA = a.status.block_height || Number.MAX_SAFE_INTEGER;
                const heightB = b.status.block_height || Number.MAX_SAFE_INTEGER;
                if (heightA !== heightB) return heightA - heightB;
                if (a.txid !== b.txid) return a.txid.localeCompare(b.txid);
                return a.vout - b.vout;
            });

            // 4. Assign names
            for (const utxo of newUtxos) {
                const key = `${utxo.txid}:${utxo.vout}`;
                labels[key] = `UTXO #${nextCount++}`;
                changed = true;
            }
        }

        if (changed) {
            const updatedWallet = { ...activeWallet, utxoLabels: labels, nextUtxoCount: nextCount };
            const updatedWallets = wallets.map(w => w.id === activeWallet.id ? { 
                ...w, 
                utxoLabels: labels, 
                nextUtxoCount: nextCount 
            } : w);

            setActiveWallet(updatedWallet);
            setWallets(updatedWallets);
            await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY });
        }

    } catch (error) {
        console.error("Failed to scan and name UTXOs:", error);
    }
  };

  const triggerRefresh = () => {
    setLastRefreshTime(Date.now());
    scanAndNameUtxos(); // Also scan for new UTXOs when refreshing
  };

  // Automatically scan for UTXO names when active wallet changes
  useEffect(() => {
    if (activeWallet) {
        scanAndNameUtxos();
    }
  }, [activeWallet?.id]);


  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      setLoadingSavedAddresses(true);
      setLoadingTrackedAddresses(true);
      try {
        const walletsCreds = await Keychain.getGenericPassword({ service: WALLETS_KEY });
        const walletsFromStorage: Wallet[] = walletsCreds ? JSON.parse(walletsCreds.password) : [];
        let activeId: string | null = null;
        
        const activeIdCreds = await Keychain.getGenericPassword({ service: ACTIVE_WALLET_KEY });
        if (activeIdCreds) {
            activeId = activeIdCreds.password;
        }

        if (walletsFromStorage.length > 0) {
            if (!activeId || !walletsFromStorage.find(w => w.id === activeId)) {
                activeId = walletsFromStorage[0].id;
                await Keychain.setGenericPassword('user', activeId, { service: ACTIVE_WALLET_KEY });
            }
            await loadAndSetActiveWallet(activeId, walletsFromStorage);
        } else {
            setWallets([]);
            setActiveWallet(null);
        }

        const savedAddressesCreds = await Keychain.getGenericPassword({ service: SAVED_ADDR_KEY });
        if (savedAddressesCreds) {
            setSavedAddresses(JSON.parse(savedAddressesCreds.password));
        } else {
            setSavedAddresses([]);
        }

        const trackedAddressesCreds = await Keychain.getGenericPassword({ service: TRACKED_ADDR_KEY });
        if (trackedAddressesCreds) {
            setTrackedAddresses(JSON.parse(trackedAddressesCreds.password));
        } else {
            setTrackedAddresses([]);
        }

      } catch (error) {
        console.error("Failed to bootstrap wallet:", error);
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

  const findFirstUnusedIndex = (cache: DerivedAddressInfo[], maxIndex: number): number => {
    const infoMap = new Map(cache.map(info => [info.index, info.tx_count]));
    for (let i = 0; i <= maxIndex; i++) {
        if ((infoMap.get(i) ?? 0) === 0) {
            return i;
        }
    }
    return maxIndex + 1;
  }

  const loadAndSetActiveWallet = async (walletId: string, currentWallets: Wallet[]) => {
    const walletMetadata = currentWallets.find(w => w.id === walletId);
    if (!walletMetadata) throw new Error("Wallet not found in metadata");
    const root = await getRootNode(walletId);

    const initialDerivationIndex = walletMetadata.derivedReceiveAddresses.length > 0
        ? walletMetadata.derivedReceiveAddresses.length - 1
        : -1;
    
    let derivedReceiveAddresses: DerivedAddress[] = walletMetadata.derivedReceiveAddresses;
    let derivedChangeAddresses: DerivedAddress[] = [];
    let derivedAddressInfoCache: DerivedAddressInfo[] = walletMetadata.derivedAddressInfoCache || [];

    // Init legacy wallets that don't have these fields
    const utxoLabels = walletMetadata.utxoLabels || {};
    const nextUtxoCount = walletMetadata.nextUtxoCount || 1;

    for (let i = 0; i < GAP_LIMIT; i++) {
        const derived = deriveChangeAddress(root, i);
        if (derived) derivedChangeAddresses.push(derived);
    }
    
    if (derivedReceiveAddresses.length < GAP_LIMIT) {
        const startIndex = derivedReceiveAddresses.length;
        for (let i = startIndex; i < GAP_LIMIT; i++) {
            const derived = deriveReceiveAddress(root, i);
            if (derived) derivedReceiveAddresses.push(derived);
        }
    }

    const refreshCache = derivedAddressInfoCache.length === 0 || new Date().getTime() - lastRefreshTime > 300000;

    if (refreshCache) {
      try {
        const allDerivedAddresses = [...derivedReceiveAddresses, ...derivedChangeAddresses];
        const addressStrings = allDerivedAddresses.map(a => a.address);
        const addressInfo = await fetchAddressInfoBatch(addressStrings);
        
        derivedAddressInfoCache = addressInfo.map(info => {
            const receiveMatch = derivedReceiveAddresses.find(d => d.address === info.address);
            const changeMatch = derivedChangeAddresses.find(d => d.address === info.address);
            const match = receiveMatch || changeMatch;
            return {
                address: info.address,
                index: match?.index ?? -1,
                balance: info.balance,
                tx_count: info.tx_count,
            };
        }).filter(info => info.index !== -1);
      } catch (e) {
        console.error("Failed to fetch address info for cache:", e);
      }
    }

    const receiveAddressSet = new Set(derivedReceiveAddresses.map(a => a.address));
    let lastUsedIndex = -1;
    for (const info of derivedAddressInfoCache) {
        if (receiveAddressSet.has(info.address) && info.tx_count > 0 && info.index > lastUsedIndex) {
            lastUsedIndex = info.index;
        }
    }

    let targetIndexToDerive = lastUsedIndex + GAP_LIMIT;
    const currentMaxIndex = derivedReceiveAddresses.length > 0 ? derivedReceiveAddresses[derivedReceiveAddresses.length - 1].index : -1;
    
    if (targetIndexToDerive < currentMaxIndex) {
        targetIndexToDerive = currentMaxIndex;
    }

    for (let i = currentMaxIndex + 1; i <= targetIndexToDerive; i++) {
        const derived = deriveReceiveAddress(root, i);
        if (derived) derivedReceiveAddresses.push(derived);
    }

    const cacheByIndex = new Map(derivedAddressInfoCache.map(ci => [ci.address, ci]));
    for (const addr of derivedReceiveAddresses) {
      if (!cacheByIndex.has(addr.address)) {
        cacheByIndex.set(addr.address, {
          address: addr.address,
          index: addr.index,
          balance: 0,
          tx_count: 0,
        });
      }
    }
    derivedAddressInfoCache = Array.from(cacheByIndex.values());

    const receiveCache = derivedAddressInfoCache.filter(info => receiveAddressSet.has(info.address));
    const firstUnusedIndex = findFirstUnusedIndex(receiveCache, derivedReceiveAddresses[derivedReceiveAddresses.length - 1].index);
    const currentReceiveAddress = derivedReceiveAddresses.find(a => a.index === firstUnusedIndex)?.address;

    if (currentReceiveAddress) {
      const fullWalletData: ActiveWallet = { 
        ...walletMetadata,
        changeAddressIndex: walletMetadata.changeAddressIndex ?? 0, 
        derivedReceiveAddresses, 
        derivedChangeAddresses,
        derivedAddressInfoCache, 
        address: currentReceiveAddress,
        receiveAddressIndex: firstUnusedIndex,
        utxoLabels,
        nextUtxoCount,
      };

      const updatedWallets = currentWallets.map(w => w.id === walletId ? {
          ...w,
          changeAddressIndex: w.changeAddressIndex ?? 0,
          derivedReceiveAddresses, 
          derivedChangeAddresses, 
          derivedAddressInfoCache,
          utxoLabels,
          nextUtxoCount,
      } : w);

      setWallets(updatedWallets);
      setActiveWallet(fullWalletData);
      
      await Keychain.setGenericPassword('user', walletId, { service: ACTIVE_WALLET_KEY });
      await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY }); 
      triggerRefresh();
    }
  };

  const getOrCreateNextUnusedReceiveAddress = async (currentAddress: string, currentIndex: number): Promise<{ address: string, index: number } | null> => {
    if (!activeWallet) return null;
    
    let updatedDerivedAddresses = activeWallet.derivedReceiveAddresses;
    let updatedCache = activeWallet.derivedAddressInfoCache;
    let maxDerivedIndex = updatedDerivedAddresses.length - 1;

    const receiveSet = new Set(updatedDerivedAddresses.map(a => a.address));
    let receiveCache = updatedCache.filter(info => receiveSet.has(info.address));

    let lastUsedIndex = -1;
    for (const info of receiveCache) {
      if (info.tx_count > 0 && info.index > lastUsedIndex) lastUsedIndex = info.index;
    }

    const windowStart = lastUsedIndex + 1;
    const windowEnd = windowStart + (GAP_LIMIT - 1);

    let nextIndex: number;
    if (currentIndex < windowStart || currentIndex >= windowEnd) {
      nextIndex = windowStart;
    } else {
      nextIndex = currentIndex + 1;
      if (nextIndex > windowEnd) nextIndex = windowStart;
    }

    if (maxDerivedIndex < windowEnd) {
      const root = await getRootNode(activeWallet.id);
      const newDerived: DerivedAddress[] = [];
      for (let i = maxDerivedIndex + 1; i <= windowEnd; i++) {
        const d = deriveReceiveAddress(root, i);
        if (d) newDerived.push(d);
      }
      if (newDerived.length > 0) {
        updatedDerivedAddresses = [...updatedDerivedAddresses, ...newDerived];
        const newInfo: DerivedAddressInfo[] = newDerived.map(d => ({ address: d.address, index: d.index, balance: 0, tx_count: 0 }));
        updatedCache = [...updatedCache, ...newInfo];
        receiveCache = [...receiveCache, ...newInfo];
        newDerived.forEach(d => receiveSet.add(d.address));
        maxDerivedIndex = updatedDerivedAddresses.length - 1;
      }
    }

    const byIndex = new Map(receiveCache.map(c => [c.index, c]));
    for (let i = windowStart; i <= windowEnd; i++) {
      if (!byIndex.has(i)) {
        const addr = updatedDerivedAddresses.find(a => a.index === i)?.address;
        if (addr) {
           const info = { address: addr, index: i, balance: 0, tx_count: 0 };
           updatedCache.push(info);
        }
      }
    }

    const nextAddress = updatedDerivedAddresses.find(a => a.index === nextIndex)?.address;
    return nextAddress ? { address: nextAddress, index: nextIndex } : null;
  };

  const createWallet = async (mnemonic: string, name: string, currentWallets: Wallet[]): Promise<{ newWallet: Wallet, updatedWallets: Wallet[] }> => {
    if (!bip39.validateMnemonic(mnemonic)) throw new Error("Invalid mnemonic provided");
    
    const newWalletId = uuidv4();
    const newWallet: Wallet = { 
      id: newWalletId, 
      name, 
      changeAddressIndex: 0,
      derivedReceiveAddresses: [], 
      derivedChangeAddresses: [],
      derivedAddressInfoCache: [],
      utxoLabels: {},
      nextUtxoCount: 1,
    };
    
    await Keychain.setGenericPassword('user', mnemonic, { service: `${KEYCHAIN_SERVICE_PREFIX}.${newWalletId}` });
    const updatedWallets = [...currentWallets, newWallet];
    await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY });
    setWallets(updatedWallets);
    return { newWallet, updatedWallets };
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
    
    const { newWallet, updatedWallets } = await createWallet(mnemonic, name || defaultName, wallets);
    
    if (isFirstWallet) {
        await loadAndSetActiveWallet(newWallet.id, updatedWallets);
    } else {
        await switchWallet(newWallet.id, updatedWallets);
    }
    return newWallet;
  };

  const switchWallet = async (walletId: string, currentWallets: Wallet[]) => {
    if (activeWallet?.id === walletId) return;
    try {
      await loadAndSetActiveWallet(walletId, currentWallets);
    } catch (error) {
        console.error("Failed to switch wallet:", error);
    }
  };

  const updateWalletName = async (walletId: string, newName: string) => {
    const updatedWallets = wallets.map(w => w.id === walletId ? { ...w, name: newName } : w);
    setWallets(updatedWallets);
    await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY });
    if (activeWallet?.id === walletId) {
      setActiveWallet(prev => (prev ? { ...prev, name: newName } : null));
    }
  };

  const removeWallet = async (walletId: string) => {
    const remainingWallets = wallets.filter(w => w.id !== walletId);
    await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
    await Keychain.setGenericPassword('user', JSON.stringify(remainingWallets), { service: WALLETS_KEY });
    
    if (activeWallet?.id === walletId) {
        if (remainingWallets.length > 0) {
            await loadAndSetActiveWallet(remainingWallets[0].id, remainingWallets);
        } else {
            setActiveWallet(null);
            setWallets([]);
            await Keychain.resetGenericPassword({ service: ACTIVE_WALLET_KEY });
        }
    } else {
        setWallets(remainingWallets);
    }
  };

  const getMnemonicForWallet = async (walletId: string): Promise<string | null> => {
    try {
        const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
        return credentials ? credentials.password : null;
    } catch (error) {
        console.error("Failed to retrieve mnemonic:", error);
        return null;
    }
  };

  const resetWallet = async () => {
    for (const wallet of wallets) {
        await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${wallet.id}` });
    }
    await Keychain.resetGenericPassword({ service: WALLETS_KEY });
    await Keychain.resetGenericPassword({ service: ACTIVE_WALLET_KEY });
    await Keychain.resetGenericPassword({ service: SAVED_ADDR_KEY });
    await Keychain.resetGenericPassword({ service: TRACKED_ADDR_KEY }); 
    await AsyncStorage.removeItem(ASYNC_STORAGE_ONBOARDING_KEY);
    
    setWallets([]);
    setActiveWallet(null);
    setSavedAddresses([]);
    setTrackedAddresses([]);
  };

  const createAndSignTransaction = async (
    recipient: string, amount: number, utxos: any[], feeRate: number
  ): Promise<{ txHex: string | null; usedChangeIndex: number | null }> => {
    if (!activeWallet) throw new Error("No active wallet.");

    const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${activeWallet.id}` });
    if (!credentials) {
      throw new Error("Could not retrieve credentials to sign transaction.");
    }
    const mnemonic = credentials.password;
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, NETWORK);

    const nextChangeIndex = activeWallet.changeAddressIndex ?? 0;
    const changeAddress = activeWallet.derivedChangeAddresses.find(a => a.index === nextChangeIndex)?.address;

    if (!changeAddress) {
        throw new Error("Failed to get next change address. Wallet may be out of addresses.");
    }

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
      const transaction = psbt.extractTransaction();
      return { txHex: transaction.toHex(), usedChangeIndex };
    } catch (error) {
      console.error("Failed to create or sign transaction:", error);
      if (error instanceof Error) throw error;
      throw new Error("An unknown error occurred during transaction creation.");
    }
  };

  const incrementChangeIndex = async (walletId: string, lastUsedIndex: number) => {
    const walletToUpdate = wallets.find(w => w.id === walletId);
    if (!walletToUpdate) return;
    
    const currentIndex = walletToUpdate.changeAddressIndex ?? 0;
    if (currentIndex === lastUsedIndex) {
      const nextIndex = lastUsedIndex + 1;
      const updatedWallets = wallets.map(w => 
        w.id === walletId ? { ...w, changeAddressIndex: nextIndex } : w
      );
      setWallets(updatedWallets);
      if (activeWallet?.id === walletId) {
        setActiveWallet(prev => (prev ? { ...prev, changeAddressIndex: nextIndex } : null));
      }
      await Keychain.setGenericPassword('user', JSON.stringify(updatedWallets), { service: WALLETS_KEY });
    }
  };

  // --- Address Book Methods ---
  const addSavedAddress = async (address: Omit<BitcoinAddress, 'id'>) => {
    const addressWithId = { ...address, id: uuidv4() };
    const newAddresses = [...savedAddresses, addressWithId];
    setSavedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: SAVED_ADDR_KEY });
  };

  const removeSavedAddress = async (addressId: string) => {
    const newAddresses = savedAddresses.filter(a => a.id !== addressId);
    setSavedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: SAVED_ADDR_KEY });
  };

  const updateSavedAddressName = async (addressId: string, newName: string) => {
    const newAddresses = savedAddresses.map(a => a.id === addressId ? { ...a, name: newName } : a);
    setSavedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: SAVED_ADDR_KEY });
  };

  const refreshSavedAddressBalances = async () => {
    const addressesToRefresh = savedAddresses.map(a => a.address);
    if (addressesToRefresh.length === 0) return;
    try {
      const balances = await fetchAddressBalances(addressesToRefresh);
      const updatedAddresses = savedAddresses.map((addr, index) => ({
        ...addr,
        balance: balances[index] ?? addr.balance,
        lastUpdated: new Date(),
      }));
      setSavedAddresses(updatedAddresses);
      await Keychain.setGenericPassword('user', JSON.stringify(updatedAddresses), { service: SAVED_ADDR_KEY });
    } catch (error) {
      console.error("Failed to refresh saved address balances:", error);
    }
  };

  // --- Tracker Methods ---
  const addTrackedAddress = async (address: Omit<BitcoinAddress, 'id'>) => {
    const addressWithId = { ...address, id: uuidv4() };
    const newAddresses = [...trackedAddresses, addressWithId];
    setTrackedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: TRACKED_ADDR_KEY });
  };

  const removeTrackedAddress = async (addressId: string) => {
    const newAddresses = trackedAddresses.filter(a => a.id !== addressId);
    setTrackedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: TRACKED_ADDR_KEY });
  };

  const updateTrackedAddressName = async (addressId: string, newName: string) => {
    const newAddresses = trackedAddresses.map(a => a.id === addressId ? { ...a, name: newName } : a);
    setTrackedAddresses(newAddresses);
    await Keychain.setGenericPassword('user', JSON.stringify(newAddresses), { service: TRACKED_ADDR_KEY });
  };

  const refreshTrackedAddressBalances = async () => {
    const addressesToRefresh = trackedAddresses.map(a => a.address);
    if (addressesToRefresh.length === 0) return;
    try {
      const balances = await fetchAddressBalances(addressesToRefresh);
      const updatedAddresses = trackedAddresses.map((addr, index) => ({
        ...addr,
        balance: balances[index] ?? addr.balance,
        lastUpdated: new Date(),
      }));
      setTrackedAddresses(updatedAddresses);
      await Keychain.setGenericPassword('user', JSON.stringify(updatedAddresses), { service: TRACKED_ADDR_KEY });
    } catch (error) {
      console.error("Failed to refresh tracked address balances:", error);
    }
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
    
    // UTXO Methods
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
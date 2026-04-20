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
import * as breezSdk from '@breeztech/breez-sdk-spark-react-native';
import * as FileSystem from 'expo-file-system';

import { Wallet, DerivedAddress, BitcoinAddress, LightningTransaction } from '../types';
import {
    calculateTransactionMetrics,
    fetchUTXOs,
    getBip32Node,
    inferScriptType,
    fetchAddressInfoBatch
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
import { InteractionManager } from 'react-native';
import { useWalletBalanceSync, useAddressListSync } from '../hooks/useBalance';

let activeSdkInstance: any = null;

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
    addWallet: (params: { mnemonic?: string; xpub?: string; type?: 'standard' | 'watch-only'; name?: string; fingerprint?: string; derivation_path?: string; }) => Promise<Wallet | null>;
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

    isLightningInitialized: boolean;
    lightningBalance: number;
    lightningTransactions: LightningTransaction[];
    getLightningInvoice: (amountSats: number) => Promise<string>;
    payLightningInvoice: (invoiceStr: string, amountSats?: number) => Promise<void>;
    estimateLightningFee: (invoiceStr: string, amountSats?: number) => Promise<number | null>;
    getLightningTopUpAddress: () => Promise<string>;
    prepareWithdrawToOnchain: (address: string, amountSats: number, feeTier: 'fast' | 'normal' | 'slow') => Promise<{ senderFeeMsat: number; recipientFeeMsat: number; prepareResponse: any }>;
    withdrawToOnchain: (prepareResponse: any, feeTier: 'fast' | 'normal' | 'slow') => Promise<void>;
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

    // Phase 1 Lightning state
    const [isLightningInitialized, setIsLightningInitialized] = useState(false);
    const [lightningBalance, setLightningBalance] = useState(0);
    const [lightningTransactions, setLightningTransactions] = useState<LightningTransaction[]>([]);

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

    // ------------------------------------------------------------------
    // LIGHTNING NETWORK LOGIC (PHASE 1)
    // ------------------------------------------------------------------

    const refreshLightningState = async () => {
        if (!activeSdkInstance) return;
        try {
            const info = await activeSdkInstance.getInfo({ ensureSynced: true });
            // CAST TO NUMBER HERE
            setLightningBalance(Number(info.balanceSats ?? 0));

            const paymentsResponse = await activeSdkInstance.listPayments({ limit: 100 });
            const paymentsList = Array.isArray(paymentsResponse) ? paymentsResponse : (paymentsResponse?.payments || []);

            const u128ToNumber = (v: any): number => {
                try {
                    if (typeof v === 'bigint') {
                        if (v > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
                        return Number(v);
                    }
                    const n = Number(v);
                    return Number.isFinite(n) ? n : 0;
                } catch {
                    return 0;
                }
            };

            const formattedTxs: LightningTransaction[] = paymentsList.map((p: any) => {
                const SDK_STATUS = breezSdk.PaymentStatus as any;
                const SDK_TYPE = breezSdk.PaymentType as any;

                // Strictly evaluate against the SDK's exported enums to guarantee accuracy
                const isComplete = p.status === SDK_STATUS.COMPLETED ||
                    p.status === SDK_STATUS.Completed ||
                    p.status === SDK_STATUS.COMPLETE;

                const isPending = p.status === SDK_STATUS.PENDING ||
                    p.status === SDK_STATUS.Pending;

                const isReceive = p.paymentType === SDK_TYPE.RECEIVE ||
                    p.paymentType === SDK_TYPE.Receive ||
                    p.paymentType === SDK_TYPE.RECEIVED;

                // Priority fallback resolution
                let finalStatus: 'complete' | 'pending' = 'pending';
                if (isComplete) {
                    finalStatus = 'complete';
                } else if (isPending) {
                    finalStatus = 'pending';
                } else if (String(p.status).toLowerCase().includes('complete') || p.status === 1) {
                    finalStatus = 'complete';
                }

                let finalType: 'receive' | 'send' = 'send';
                if (isReceive) {
                    finalType = 'receive';
                } else if (String(p.paymentType).toLowerCase().includes('receive') || p.paymentType === 1) {
                    finalType = 'receive';
                }

                const amountSats = u128ToNumber(p.amount ?? p.amountSat ?? p.amountSats ?? 0);
                const feeSats = u128ToNumber(p.fees ?? p.fee ?? p.feeSat ?? p.feeSats ?? 0);
                const amountMsat = p.amountMsat !== undefined ? Number(p.amountMsat) : amountSats * 1000;
                const feeMsat = p.feeMsat !== undefined ? Number(p.feeMsat) : feeSats * 1000;

                const paymentTime = Number(p.paymentTime ?? p.timestamp ?? p.time ?? 0);

                const detailsTag = p.details?.tag;
                const detailsInner = p.details?.inner;
                const description =
                    p.description ||
                    detailsInner?.description ||
                    detailsInner?.invoiceDetails?.description ||
                    (detailsTag === 'Deposit' ? 'Top-up' : '') ||
                    (detailsTag === 'Withdraw' ? 'Withdraw' : '') ||
                    '';

                return {
                    paymentHash: p.id || p.paymentHash || '',
                    paymentTime: paymentTime,
                    amountMsat: amountMsat,
                    feeMsat: feeMsat,
                    status: finalStatus,
                    type: finalType,
                    description,
                    paymentMethod: typeof p.method === 'number' ? p.method : Number(p.method)
                };
            });

            setLightningTransactions(formattedTxs);
        } catch (error) {
            console.error("Failed to fetch Lightning state:", error);
        }
    };

    const initLightningNode = async (mnemonic: string) => {
        try {
            const apiKey = process.env.EXPO_PUBLIC_BREEZ_API_KEY;

            let config = breezSdk.defaultConfig(breezSdk.Network.Mainnet);

            if (apiKey) {
                config.apiKey = apiKey;
            }
            config.maxDepositClaimFee = new breezSdk.MaxFee.NetworkRecommended({
                leewaySatPerVbyte: BigInt(1)
            });

            const basePath = FileSystem.documentDirectory ? FileSystem.documentDirectory.replace('file://', '') : '';
            const storageDir = `${basePath}breezSdkSpark`;

            const dirInfo = await FileSystem.getInfoAsync(FileSystem.documentDirectory + 'breezSdkSpark');
            if (!dirInfo.exists) {
                await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + 'breezSdkSpark', { intermediates: true });
            }

            const seed = breezSdk.Seed.Mnemonic.new({
                mnemonic: mnemonic.toLowerCase().trim()
            } as any);

            const sdk = await breezSdk.connect({
                config,
                seed,
                storageDir
            });

            activeSdkInstance = sdk;
            setIsLightningInitialized(true);
            if (sdk && typeof sdk.addEventListener === 'function') {
                sdk.addEventListener({
                    onEvent: async (e: any) => {
                        if (e && (e.type === "invoicePaid" || e.type === "paymentSucceed" || e.type === "swapUpdated")) {
                            await refreshLightningState();
                        }
                    }
                });
            }

            await refreshLightningState();
        } catch (error: any) {
            console.error("Breez initialization failed:", error.message || JSON.stringify(error));
            setIsLightningInitialized(false);
        }
    };

    const getLightningInvoice = async (amountSats: number) => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        // In getLightningInvoice:
        const req = await activeSdkInstance.receivePayment({
            paymentMethod: breezSdk.ReceivePaymentMethod.Bolt11Invoice.new({
                description: "Send to Trustless Wallet",
                amountSats: BigInt(amountSats)
            } as any)
        });
        return req.paymentRequest;
    };

    const payLightningInvoice = async (invoiceStr: string, amountSats?: number) => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");

        const cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();

        let parsedInput;
        try {
            parsedInput = await activeSdkInstance.parse(cleanStr);
        } catch (error: any) {
            if (cleanStr.toLowerCase().startsWith('lnbc')) {
                parsedInput = { type: 'bolt11Invoice' };
            } else {
                throw new Error(`Parse failed: ${error.message}`);
            }
        }

        const type = parsedInput.type || parsedInput.tag;

        if (type === 'bolt11Invoice' || type === 'Bolt11' || type === 'bolt11') {
            const prepareRequest: any = {
                paymentRequest: cleanStr
            };

            if (amountSats && amountSats > 0) {
                prepareRequest.amount = amountSats;
            }

            let prepareResponse;
            try {
                prepareResponse = await activeSdkInstance.prepareSendPayment(prepareRequest);
            } catch (error: any) {
                throw new Error(`Prepare Error (${error.message}). Ensure you are not overriding a fixed-amount invoice or missing an amount for a 0-amount invoice. Zero balance also triggers this.`);
            }

            try {
                await activeSdkInstance.sendPayment({
                    prepareResponse: prepareResponse
                } as any);
            } catch (error: any) {
                throw new Error(`Send Error (${error.message}).`);
            }

        } else if (type === 'LightningAddress' && parsedInput.inner && parsedInput.inner[0]) {
            const lightningAddressDetails = parsedInput.inner[0];
            const payRequestDetails = lightningAddressDetails.payRequest;
            
            // Prepare LNURL pay request with the extracted payRequest details
            const prepareLnurlPayRequest: any = {
                amountSats: BigInt(amountSats || 0),
                payRequest: payRequestDetails,
                comment: undefined,
                validateSuccessActionUrl: undefined,
                conversionOptions: undefined,
                feePolicy: undefined
            };

            let prepareResponse;
            try {
                prepareResponse = await activeSdkInstance.prepareLnurlPay(prepareLnurlPayRequest);
            } catch (error: any) {
                throw new Error(`Prepare LNURL Error (${error.message}).`);
            }

            try {
                // For LNURL payments, use the LNURL-specific sendPayment method
                await activeSdkInstance.lnurlPay({
                    prepareResponse: prepareResponse,
                    idempotencyKey: undefined
                } as any);
            } catch (error: any) {
                throw new Error(`Send LNURL Error (${error.message}).`);
            }

        } else {
            throw new Error(`Unsupported lightning format. Parsed type: ${type}`);
        }

        await refreshLightningState();
    };

    const estimateLightningFee = async (invoiceStr: string, amountSats?: number): Promise<number | null> => {
        if (!activeSdkInstance) return null;

        let cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();

        // Check if it's a Lightning address (contains @)
        if (cleanStr.includes('@')) {
            try {
                // First parse the Lightning address to get LnurlPayRequestDetails
                const parsedInput = await activeSdkInstance.parse(cleanStr);
                
                if (parsedInput.tag === 'LightningAddress' && parsedInput.inner && parsedInput.inner[0]) {
                    const lightningAddressDetails = parsedInput.inner[0];
                    const payRequestDetails = lightningAddressDetails.payRequest;
                    
                    // Now prepare the LNURL pay request with the extracted payRequest details
                    const prepareLnurlPayRequest: any = {
                        amountSats: BigInt(amountSats || 0),
                        payRequest: payRequestDetails,
                        comment: undefined,
                        validateSuccessActionUrl: undefined,
                        conversionOptions: undefined,
                        feePolicy: undefined
                    };
                    
                    const prepareResponse = await activeSdkInstance.prepareLnurlPay(prepareLnurlPayRequest);
                    
                    if (prepareResponse && prepareResponse.feeSats) {
                        // Convert fee from BigInt to number
                        return Number(prepareResponse.feeSats);
                    }
                }
            } catch (error) {
                return null;
            }
            return null;
        }

        // Now handle as bolt11 invoice
        const prepareRequest: any = {
            paymentRequest: cleanStr
        };

        if (amountSats && amountSats > 0) {
            prepareRequest.amount = amountSats;
        }

        try {
            const prepareResponse = await activeSdkInstance.prepareSendPayment(prepareRequest);
            let totalFeeSats = 0;

            if (prepareResponse.paymentMethod) {
                // Handle both direct paymentMethod and nested paymentMethod.inner structure
                const paymentMethod = prepareResponse.paymentMethod.inner || prepareResponse.paymentMethod;
                
                if (prepareResponse.paymentMethod.tag === 'Bolt11Invoice' || paymentMethod.lightningFeeSats !== undefined) {
                    const lightningFee = Number(paymentMethod.lightningFeeSats || 0);
                    const sparkFee = Number(paymentMethod.sparkTransferFeeSats || 0);
                    totalFeeSats = lightningFee + sparkFee;
                } else if (paymentMethod.fee !== undefined) {
                    totalFeeSats = Number(paymentMethod.fee || 0);
                }
            }

            return totalFeeSats;
        } catch (error) {
            return null;
        }
    };

    const getLightningTopUpAddress = async (): Promise<string> => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        try {
            // Attempt 1: Standard UniFFI lowerCamelCase object mapping
            const response = await activeSdkInstance.receivePayment({
                paymentMethod: { type: 'bitcoinAddress' }
            });
            const address = response.paymentRequest || response.bitcoinAddress || response.address;
            if (address) return address;
            throw new Error("Address empty");
        } catch (error: any) {
            try {
                // Attempt 2: Direct JS Class instantiation (Spark SDK standard)
                const response = await activeSdkInstance.receivePayment({
                    paymentMethod: new (breezSdk.ReceivePaymentMethod as any).BitcoinAddress()
                });
                const address = response.paymentRequest || response.bitcoinAddress || response.address;
                if (address) return address;
                throw new Error("Address empty");
            } catch (fallbackError) {
                throw new Error("Could not generate on-chain address. Ensure node is synced.");
            }
        }
    };

    const prepareWithdrawToOnchain = async (address: string, amountSats: number, feeTier: 'fast' | 'normal' | 'slow') => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        try {
            const prepareRequest = {
                paymentRequest: address,
                amount: BigInt(amountSats)
            };
            const res = await activeSdkInstance.prepareSendPayment(prepareRequest as any);

            let feeSats = 0;
            if (res.paymentMethod && res.paymentMethod.type === 'bitcoinAddress') {
                const quote = res.paymentMethod.feeQuote;
                if (feeTier === 'fast') {
                    feeSats = Number(quote?.speedFast?.totalFeeSat || 0);
                } else if (feeTier === 'slow') {
                    feeSats = Number(quote?.speedSlow?.totalFeeSat || 0);
                } else {
                    feeSats = Number(quote?.speedMedium?.totalFeeSat || 0);
                }
            }

            return {
                senderFeeMsat: feeSats * 1000,
                recipientFeeMsat: 0,
                prepareResponse: res
            };
        } catch (error: any) {
            throw new Error(`Preparation failed: ${error.message}`);
        }
    };

    const withdrawToOnchain = async (prepareResponse: any, feeTier: 'fast' | 'normal' | 'slow') => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");

        let speed = 'medium';
        if (feeTier === 'fast') speed = 'fast';
        if (feeTier === 'slow') speed = 'slow';

        try {
            await activeSdkInstance.sendPayment({
                prepareResponse: prepareResponse,
                options: {
                    type: 'bitcoinAddress',
                    confirmationSpeed: speed
                }
            } as any);

            await refreshLightningState();
        } catch (error: any) {
            throw new Error(`Withdrawal failed: ${error.message}`);
        }
    };

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

        // Verify change address index to prevent reuse on restoration
        const change_set = new Set(derivedChangeAddresses.map(a => a.address));
        const max_change_index = derivedChangeAddresses.length > 0 ? derivedChangeAddresses[derivedChangeAddresses.length - 1].index : -1;
        let first_unused_change = -1;

        for (let i = 0; i <= max_change_index; i++) {
            const info = derivedAddressInfoCache.find(c => c.index === i && change_set.has(c.address));
            if (!info || info.tx_count === 0) {
                first_unused_change = i;
                break;
            }
        }

        if (first_unused_change === -1) {
            first_unused_change = max_change_index + 1;
        }

        return {
            ...basicWallet,
            derivedReceiveAddresses,
            derivedChangeAddresses,
            derivedAddressInfoCache,
            utxoLabels,
            address: currentReceiveAddress,
            receiveAddressIndex: firstUnusedIndex,
            changeAddressIndex: Math.max(basicWallet.changeAddressIndex || 0, first_unused_change)
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
        if (isLightningInitialized) refreshLightningState();
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
            const is_watch_only = wallet.type === 'watch-only';
            const script_type = wallet.scriptType || 'p2wpkh';
            let derived_new = false;

            // --- LIGHTNING INIT ---
            if (!is_watch_only) {
                const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
                if (credentials) {
                    await initLightningNode(credentials.password);
                }
            } else {
                setIsLightningInitialized(false);
                setLightningBalance(0);
                setLightningTransactions([]);
            }
            // ----------------------

            // Create a fast map to eliminate O(N^2) array lookups
            const cacheMap = new Map();
            wallet.derivedAddressInfoCache.forEach(c => cacheMap.set(c.address, c.tx_count));

            const checkUsage = async (addresses: string[]): Promise<boolean[]> => {
                const usage = new Array(addresses.length).fill(false);
                const to_fetch: string[] = [];
                const fetch_map = new Map<string, number>();

                addresses.forEach((addr, i) => {
                    const tx_count = cacheMap.get(addr);
                    if (tx_count !== undefined && tx_count > 0) {
                        usage[i] = true;
                    } else {
                        to_fetch.push(addr);
                        fetch_map.set(addr, i);
                    }
                });

                if (to_fetch.length > 0) {
                    try {
                        const network_data = await fetchAddressInfoBatch(to_fetch);
                        network_data.forEach(data => {
                            if (data.tx_count > 0) {
                                const index = fetch_map.get(data.address);
                                if (index !== undefined) {
                                    usage[index] = true;
                                    cacheMap.set(data.address, data.tx_count);
                                }
                            }
                        });
                    } catch (e) {
                        // Fail silently to allow boot if offline
                    }
                }
                return usage;
            };

            // --- RECEIVE CHAIN ---
            let consecutive_unused_receive = 0;
            const max_rx = wallet.derivedReceiveAddresses.length;

            // Count backwards to determine existing gap
            for (let i = max_rx - 1; i >= 0; i--) {
                const addr = wallet.derivedReceiveAddresses.find(a => a.index === i)?.address;
                if (addr && cacheMap.get(addr) > 0) break;
                consecutive_unused_receive++;
            }

            let receive_index = max_rx;

            while (consecutive_unused_receive < GAP_LIMIT) {
                const batch_size = GAP_LIMIT - consecutive_unused_receive;
                const current_batch: string[] = [];

                for (let i = 0; i < batch_size; i++) {
                    const index_to_derive = receive_index + i;
                    const derived = deriveReceiveAddress(root, index_to_derive, is_watch_only, script_type);
                    if (derived) {
                        await dbSaveAddress(walletId, derived, 0, NETWORK_NAME);
                        current_batch.push(derived.address);
                        wallet!.derivedReceiveAddresses.push(derived);
                        derived_new = true;
                    }
                }

                const usage_results = await checkUsage(current_batch);

                for (let i = 0; i < usage_results.length; i++) {
                    if (usage_results[i]) {
                        consecutive_unused_receive = 0;
                    } else {
                        consecutive_unused_receive++;
                    }
                }

                receive_index += batch_size;
                if (receive_index > 500) break;
            }

            // --- CHANGE CHAIN ---
            let consecutive_unused_change = 0;
            const max_ch = wallet.derivedChangeAddresses.length;

            for (let i = max_ch - 1; i >= 0; i--) {
                const addr = wallet.derivedChangeAddresses.find(a => a.index === i)?.address;
                if (addr && cacheMap.get(addr) > 0) break;
                consecutive_unused_change++;
            }

            let change_index = max_ch;

            while (consecutive_unused_change < GAP_LIMIT) {
                const batch_size = GAP_LIMIT - consecutive_unused_change;
                const current_batch: string[] = [];

                for (let i = 0; i < batch_size; i++) {
                    const index_to_derive = change_index + i;
                    const derived = deriveChangeAddress(root, index_to_derive, is_watch_only, script_type);
                    if (derived) {
                        await dbSaveAddress(walletId, derived, 1, NETWORK_NAME);
                        current_batch.push(derived.address);
                        wallet!.derivedChangeAddresses.push(derived);
                        derived_new = true;
                    }
                }

                const usage_results = await checkUsage(current_batch);

                for (let i = 0; i < usage_results.length; i++) {
                    if (usage_results[i]) {
                        consecutive_unused_change = 0;
                    } else {
                        consecutive_unused_change++;
                    }
                }

                change_index += batch_size;
                if (change_index > 500) break;
            }

            if (derived_new) {
                wallet = await buildActiveWallet(walletId);
            }

            if (wallet) {
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

            } catch (error) {
                console.error("DEBUG: Failed to bootstrap wallet:", error);
            } finally {
                setLoading(false);
                setLoadingSavedAddresses(false);
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
                    if (!prev) return null;
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
    const addWallet = async (params: { mnemonic?: string; xpub?: string; type?: 'standard' | 'watch-only'; name?: string; fingerprint?: string; derivation_path?: string; }): Promise<Wallet | null> => {
        const { mnemonic, name } = params;
        const type = params.type || 'standard';
        let walletXpub = params.xpub;
        let fingerprint = params.fingerprint;
        let derivation_path = params.derivation_path;

        let scriptType: 'p2wpkh' | 'p2sh-p2wpkh' = 'p2wpkh';

        try {
            if (walletXpub) {
                scriptType = inferScriptType(walletXpub);
            }

            if (type === 'standard' && mnemonic) {
                const seed = bip39.mnemonicToSeedSync(mnemonic);
                const root = bip32.fromSeed(seed, NETWORK);
                try {
                    const accountNode = root.derivePath(DERIVATION_PARENT_PATH);
                    walletXpub = accountNode.neutered().toBase58();
                    scriptType = 'p2wpkh';

                    if (!fingerprint) {
                        fingerprint = root.fingerprint.toString('hex');
                    }
                    if (!derivation_path) {
                        derivation_path = DERIVATION_PARENT_PATH;
                    }
                } catch (err) {
                    console.warn("Could not derive account xpub for standard wallet check", err);
                }
            }

            if (walletXpub) {
                const existingId = await dbFindWalletByXpub(walletXpub);
                if (existingId) {
                    Alert.alert("Wallet exists", "This wallet has already been added.");
                    return null;
                }
            }

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
                        Alert.alert("Wallet exists", "This wallet has already been added.");
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

        if (type === 'standard' && mnemonic) {
            await Keychain.setGenericPassword('user', mnemonic, { service: `${KEYCHAIN_SERVICE_PREFIX}.${newWalletId}` });
        }

        await dbCreateWallet(newWalletId, defaultName, NETWORK_NAME, type, walletXpub, scriptType, fingerprint, derivation_path);

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
        let verified_change_index = activeWallet.changeAddressIndex ?? 0;
        const change_addresses_set = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));

        // Scan forward to ensure the chosen index has exactly 0 previous transactions
        for (let i = verified_change_index; i < activeWallet.derivedChangeAddresses.length + 20; i++) {
            const info = activeWallet.derivedAddressInfoCache.find(c => c.index === i && change_addresses_set.has(c.address));
            if (!info || info.tx_count === 0) {
                verified_change_index = i;
                break;
            }
        }

        const scriptType = activeWallet.scriptType || 'p2wpkh';

        let changeAddress = activeWallet.derivedChangeAddresses.find(a => a.index === verified_change_index)?.address;
        if (!changeAddress) {
            const derived = deriveChangeAddress(root, verified_change_index, false, scriptType);
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
                usedChangeIndex = verified_change_index;
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
        if (item) {
            await dbUpdateSavedAddress('saved_addresses', { ...item, name: newName });
            setSavedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses'));
        }
    };

    const refreshSavedAddressBalances = async () => {
        queryClient.invalidateQueries({ queryKey: ['saved', 'balances'] });
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

        isLightningInitialized,
        lightningBalance,
        lightningTransactions,
        getLightningInvoice,
        payLightningInvoice,
        estimateLightningFee,
        getLightningTopUpAddress,
        prepareWithdrawToOnchain,
        withdrawToOnchain,
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
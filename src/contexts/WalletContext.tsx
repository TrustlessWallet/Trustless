import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback, useMemo } from 'react';
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
import { Alert, AppState, AppStateStatus } from 'react-native';
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
    dbFindWalletByXpub,
    dbUpdateAddressLabel
} from '../services/database';
import { InteractionManager } from 'react-native';
import { useWalletBalanceSync, useAddressListSync } from '../hooks/useBalance';

let activeSdkInstance: any = null;
let activeSdkListenerId: string | null = null;

const formatLightningInitError = (error: any): string => {
    try {
        if (!error) return 'Unknown error';
        if (typeof error === 'string') return error;
        const name = error?.name ? String(error.name) : '';
        const message = error?.message ? String(error.message) : '';
        const code = error?.code !== undefined ? String(error.code) : '';
        const stack = error?.stack ? String(error.stack) : '';

        let serialized = '';
        try {
            const props = Object.getOwnPropertyNames(error);
            serialized = JSON.stringify(error, props);
        } catch {
            try {
                serialized = JSON.stringify(error);
            } catch {
                serialized = String(error);
            }
        }

        const parts = [
            name && `name=${name}`,
            code && `code=${code}`,
            message && `message=${message}`,
            serialized && `raw=${serialized}`,
            stack && `stack=${stack}`,
        ].filter(Boolean);

        return parts.length > 0 ? parts.join(' | ') : 'Unknown error';
    } catch {
        return 'Unknown error';
    }
};

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
    triggerRefresh: () => Promise<void>;
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
    updateAddressLabel: (address: string, label: string) => Promise<void>;

    isLightningInitialized: boolean;
    lightningInitAttempted: boolean;
    lightningInitError: string | null;
    lightningBalance: number;
    lightningTransactions: LightningTransaction[];
    defaultLightningInvoice: string;
    getLightningInvoice: (amountSats: number) => Promise<string>;
    payLightningInvoice: (invoiceStr: string, amountSats?: number) => Promise<void>;
    estimateLightningFee: (invoiceStr: string, amountSats?: number) => Promise<number | null>;
    getLightningTopUpAddress: () => Promise<string>;
    prepareWithdrawToOnchain: (address: string, amountSats: number, feeTier: 'fast' | 'normal' | 'slow') => Promise<{ senderFeeMsat: number; recipientFeeMsat: number; prepareResponse: any }>;
    withdrawToOnchain: (prepareResponse: any, feeTier: 'fast' | 'normal' | 'slow') => Promise<void>;

    lightningAddress: string;
    checkLightningAddressAvailable: (username: string) => Promise<boolean>;
    registerLightningAddress: (username: string, description?: string) => Promise<void>;
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
    const [lastRefreshTime, setLastRefreshTime] = useState(() => Date.now());

    const [savedAddresses, setSavedAddresses] = useState<BitcoinAddress[]>([]);
    const [loadingSavedAddresses, setLoadingSavedAddresses] = useState(true);

    const [isLightningInitialized, setIsLightningInitialized] = useState(false);
    const [lightningInitAttempted, setLightningInitAttempted] = useState(false);
    const [lightningInitError, setLightningInitError] = useState<string | null>(null);
    const [lightningBalance, setLightningBalance] = useState(0);
    const [lightningTransactions, setLightningTransactions] = useState<LightningTransaction[]>([]);
    const [lightningAddress, setLightningAddress] = useState<string>('');

    const ACTIVE_WALLET_KEY = getStorageKey(KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE);

    // Tracks any setTimeout ids scheduled for deferred work (Lightning init,
    // UTXO scanning) so they can be cancelled if the provider unmounts,
    // instead of firing later against a torn-down environment / stale wallet.
    const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
    const lightningInitVersionRef = useRef(0);
    const lightningRefreshQueueRef = useRef<Promise<void>>(Promise.resolve());

    const scheduleDeferred = useCallback((fn: () => void, delayMs: number) => {
        const id = setTimeout(() => {
            pendingTimeoutsRef.current.delete(id);
            fn();
        }, delayMs);
        pendingTimeoutsRef.current.add(id);
        return id;
    }, []);

    useEffect(() => {
        return () => {
            ++lightningInitVersionRef.current;
            lightningRefreshQueueRef.current = Promise.resolve();
            pendingTimeoutsRef.current.forEach(id => clearTimeout(id));
            pendingTimeoutsRef.current.clear();
            void disposeActiveLightningNode();
        };
    }, []);

    // ------------------------------------------------------------------
    // SYNC HOOKS (Background Data Fetching)
    // ------------------------------------------------------------------

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

    const updateAddressLabel = async (address: string, label: string) => {
        try {
            await dbUpdateAddressLabel(address, label);

            setActiveWallet(prev => {
                if (!prev) return prev;

                const updatedReceive = prev.derivedReceiveAddresses.map(a =>
                    a.address === address ? { ...a, label } : a
                );

                const updatedChange = prev.derivedChangeAddresses.map(a =>
                    a.address === address ? { ...a, label } : a
                );

                return {
                    ...prev,
                    derivedReceiveAddresses: updatedReceive,
                    derivedChangeAddresses: updatedChange
                };
            });
        } catch (error) {
            console.error("Failed to update address label inside context:", error);
        }
    };

    const { data: syncedWalletData } = useWalletBalanceSync(activeWallet?.id, activeWalletAddresses);

    useEffect(() => {
        if (syncedWalletData && activeWallet) {
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

            // DEFER: Push UTXO scanning to macro task queue so it doesn't block UI renders
            scheduleDeferred(() => {
                InteractionManager.runAfterInteractions(() => {
                    scanAndNameUtxos().catch((e) => console.error("Deferred UTXO scan failed", e));
                });
            }, 1000);
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

    // ------------------------------------------------------------------
    // LIGHTNING NETWORK LOGIC
    // ------------------------------------------------------------------

    const [defaultLightningInvoice, setDefaultLightningInvoice] = useState<string>('');

    useEffect(() => {
        let isMounted = true;
        if (isLightningInitialized && !defaultLightningInvoice) {
            getLightningInvoice(0)
                .then(invoice => {
                    if (isMounted) setDefaultLightningInvoice(invoice);
                })
                .catch(err => console.error("Background invoice generation failed:", err));
        }
        return () => { isMounted = false; };
    }, [isLightningInitialized, defaultLightningInvoice]);

    const refreshLightningState = (forceSync = false): Promise<void> => {
        const sdk = activeSdkInstance;
        const initVersion = lightningInitVersionRef.current;
        if (!sdk) return Promise.resolve();

        if (forceSync) {
            // Update from the local cache immediately. Keep the network sync
            // outside the read queue so its latency cannot delay SDK events.
            void refreshLightningState().catch(error => {
                console.warn('Failed to read cached Lightning state:', error);
            });
            return sdk.syncWallet({}).then(() => {
                if (sdk !== activeSdkInstance || initVersion !== lightningInitVersionRef.current) return;
                return refreshLightningState();
            });
        }

        // Serialize local reads so an older result cannot overwrite a newer one.
        const task = lightningRefreshQueueRef.current.catch(() => {}).then(async () => {
            if (sdk !== activeSdkInstance || initVersion !== lightningInitVersionRef.current) return;

            // Show the balance as soon as it is available. Payment history can
            // take longer and should not hold the balance UI hostage.
            const info = await sdk.getInfo({ ensureSynced: false });
            if (sdk !== activeSdkInstance || initVersion !== lightningInitVersionRef.current) return;
            setLightningBalance(Number(info.balanceSats ?? 0));

            // Address lookup is independent of both balance and history.
            void sdk.getLightningAddress().then((addressInfo: any) => {
                if (sdk === activeSdkInstance && initVersion === lightningInitVersionRef.current) {
                    setLightningAddress(addressInfo?.lightningAddress || '');
                }
            }).catch((error: any) => {
                console.warn("Failed to fetch Lightning address:", error);
            });

            const paymentsResponse = await sdk.listPayments({
                offset: 0,
                limit: 100,
                sortAscending: false,
            } as any);

            const paymentsList = Array.isArray(paymentsResponse)
                ? paymentsResponse
                : (paymentsResponse?.payments || []);

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

                const finalStatus: 'complete' | 'pending' | 'failed' =
                    p.status === SDK_STATUS.Completed ? 'complete'
                        : p.status === SDK_STATUS.Failed ? 'failed'
                            : 'pending';

                const finalType: 'receive' | 'send' =
                    p.paymentType === SDK_TYPE.Receive ? 'receive' : 'send';

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
                    (detailsTag === 'Withdraw' ? 'Withdraw to on-chain' : '') ||
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

            if (sdk !== activeSdkInstance || initVersion !== lightningInitVersionRef.current) return;
            setLightningTransactions(formattedTxs);
        });

        lightningRefreshQueueRef.current = task;
        return task;
    };

    useEffect(() => {
        const subscription = AppState.addEventListener(
            'change',
            (nextAppState: AppStateStatus) => {
                if (nextAppState === 'active' && isLightningInitialized) {
                    refreshLightningState(true).catch(error => {
                        console.error('Failed to refresh Lightning state on app foreground:', error);
                    });
                }
            }
        );

        return () => subscription.remove();
    }, [isLightningInitialized]);

    const disposeActiveLightningNode = async () => {
        const sdk = activeSdkInstance;
        const listenerId = activeSdkListenerId;

        // Clear first, so stale callbacks cannot use this instance.
        activeSdkInstance = null;
        activeSdkListenerId = null;

        if (!sdk) return;

        try {
            if (listenerId && typeof sdk.removeEventListener === 'function') {
                await sdk.removeEventListener(listenerId);
            }
        } catch (error) {
            console.warn('Failed to remove Breez event listener:', error);
        }

        try {
            if (typeof sdk.disconnect === 'function') {
                await sdk.disconnect();
            }
        } catch (error) {
            console.warn('Failed to disconnect Breez SDK:', error);
        }
    };

    const initLightningNode = async (
        mnemonic: string,
        walletId: string,
        initVersion: number
    ) => {
        if (initVersion !== lightningInitVersionRef.current) return;

        try {
            const apiKey = process.env.EXPO_PUBLIC_BREEZ_API_KEY;

            setLightningInitAttempted(true);

            if (!apiKey) {
                setIsLightningInitialized(false);
                setLightningBalance(0);
                setLightningTransactions([]);
                setLightningInitError('Missing EXPO_PUBLIC_BREEZ_API_KEY at runtime');
                return;
            }

            let config = breezSdk.defaultConfig(breezSdk.Network.Mainnet);

            config.apiKey = apiKey;
            config.maxDepositClaimFee = new breezSdk.MaxFee.NetworkRecommended({
                leewaySatPerVbyte: BigInt(1)
            });

            config.lnurlDomain = "pay.hd-apps.com";

            const documentDir = FileSystem.Paths.document;
            const storageDirPath = `${documentDir.uri}breezSdkSpark/${walletId}`;
            const storageDir = new FileSystem.Directory(storageDirPath);

            const dirInfo = await storageDir.info();
            if (!dirInfo.exists) {
                await storageDir.create({ intermediates: true });
            }

            const seed = breezSdk.Seed.Mnemonic.new({
                mnemonic: mnemonic.toLowerCase().trim()
            } as any);

            const sdk = await breezSdk.connect({
                config,
                seed,
                storageDir: storageDir.uri.replace('file://', '')
            });

            if (initVersion !== lightningInitVersionRef.current) {
                await sdk.disconnect();
                return;
            }

            activeSdkInstance = sdk;
            setLightningInitError(null);

            if (sdk && typeof sdk.addEventListener === 'function') {
                const listenerId = await sdk.addEventListener({
                    onEvent: async (event: any) => {
                        if (
                            !event ||
                            activeSdkInstance !== sdk ||
                            initVersion !== lightningInitVersionRef.current
                        ) {
                            return;
                        }

                        const shouldRefresh =
                            event.tag === breezSdk.SdkEvent_Tags.Synced ||
                            event.tag === breezSdk.SdkEvent_Tags.PaymentPending ||
                            event.tag === breezSdk.SdkEvent_Tags.PaymentSucceeded ||
                            event.tag === breezSdk.SdkEvent_Tags.PaymentFailed;

                        if (shouldRefresh) {
                            // Do not await here: syncWallet may wait for event
                            // handlers while this refresh is queued behind it.
                            void refreshLightningState().catch(error => {
                                console.error('Failed to refresh Lightning state after SDK event:', error);
                            });
                        }

                        if (
                            event.tag === breezSdk.SdkEvent_Tags.PaymentSucceeded &&
                            activeSdkInstance === sdk &&
                            initVersion === lightningInitVersionRef.current
                        ) {
                            setDefaultLightningInvoice('');
                        }
                    }
                });

                if (
                    initVersion !== lightningInitVersionRef.current ||
                    activeSdkInstance !== sdk
                ) {
                    if (activeSdkInstance === sdk) {
                        activeSdkInstance = null;
                    }

                    try {
                        await sdk.removeEventListener(listenerId);
                        await sdk.disconnect();
                    } catch {
                    }

                    return;
                }

                activeSdkListenerId = listenerId;
            }

            // Read the locally cached balance before declaring the SDK ready.
            // Waiting for the network's initial sync here kept the selector
            // spinner visible for tens of seconds on a slow connection.
            const cachedInfo = await sdk.getInfo({ ensureSynced: false });
            if (initVersion !== lightningInitVersionRef.current || activeSdkInstance !== sdk) return;
            setLightningBalance(Number(cachedInfo.balanceSats ?? 0));
            setIsLightningInitialized(true);

            // The SDK syncs in the background and emits Synced; waiting for or
            // forcing that sync here would delay the selector unnecessarily.
            void refreshLightningState().catch(error => {
                console.error('Failed to load cached Lightning state:', error);
            });
        } catch (error: any) {
            if (initVersion !== lightningInitVersionRef.current) return;
            const formattedError = formatLightningInitError(error);
            console.error("Breez initialization failed:", formattedError);
            await disposeActiveLightningNode();
            setIsLightningInitialized(false);
            setLightningInitAttempted(true);
            setLightningInitError(formattedError);
        }
    };

    const checkLightningAddressAvailable = async (username: string): Promise<boolean> => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        const request = { username };
        return await activeSdkInstance.checkLightningAddressAvailable(request);
    };

    const registerLightningAddress = async (username: string, description?: string): Promise<void> => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        const request = {
            username,
            description: description || `Pay to ${username}@pay.hd-apps.com`
        };
        const addressInfo = await activeSdkInstance.registerLightningAddress(request);
        setLightningAddress(addressInfo.lightningAddress);
    };

    const getLightningInvoice = async (amountSats: number) => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        const req = await activeSdkInstance.receivePayment({
            paymentMethod: breezSdk.ReceivePaymentMethod.Bolt11Invoice.new({
                description: "Send to Trustless Wallet",
                amountSats: BigInt(amountSats)
            } as any)
        });
        return req.paymentRequest;
    };

    const payLightningInvoice = async (invoiceStr: string, amountSats?: number) => {
        const sdk = activeSdkInstance;
        if (!sdk) throw new Error("Lightning node not initialized");

        const cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();

        let parsedInput;
        try {
            parsedInput = await sdk.parse(cleanStr);
        } catch (error: any) {
            if (cleanStr.toLowerCase().startsWith('lnbc')) {
                parsedInput = { type: 'bolt11invoice' };
            } else {
                throw new Error(`Parse failed: ${error.message}`);
            }
        }

        const rawType = parsedInput.type || parsedInput.tag || '';
        const type = String(rawType).toLowerCase();

        if (type === 'bolt11invoice' || type === 'bolt11') {
            const prepareRequest: any = {
                paymentRequest: cleanStr
            };

            if (amountSats && amountSats > 0) {
                prepareRequest.amount = amountSats;
            }

            let prepareResponse;
            try {
                prepareResponse = await sdk.prepareSendPayment(prepareRequest);
            } catch (error: any) {
                throw new Error(`Prepare Error (${error.message}). Ensure you are not overriding a fixed-amount invoice or missing an amount for a 0-amount invoice. Zero balance also triggers this.`);
            }

            if (prepareResponse.paymentMethod?.tag === breezSdk.SendPaymentMethod_Tags.Bolt11Invoice) {
                // The receiver amount and Lightning routing fee are both paid
                // from this wallet. Check the SDK's actual quote before sending.
                await sdk.syncWallet({});
                const info = await sdk.getInfo({ ensureSynced: false });
                const amount = BigInt(prepareResponse.amount);
                const fee = BigInt(prepareResponse.paymentMethod.inner.lightningFeeSats);
                const available = BigInt(info.balanceSats);

                if (amount + fee > available) {
                    throw new Error(
                        `Insufficient Lightning balance: ${amount} sats plus a ${fee}-sat fee requires ${amount + fee} sats, but only ${available} sats are available.`
                    );
                }
            }

            try {
                await sdk.sendPayment({
                    prepareResponse: prepareResponse
                } as any);
            } catch (error: any) {
                const sdkMessage = String(error?.message || error || '');

                if (
                    sdkMessage.toLowerCase().includes('insufficient')
                ) {
                    throw new Error(
                        'Payment could not be completed. Your Lightning balance may not cover the invoice amount plus its routing fee.'
                    );
                }

                throw new Error(`Send error: ${sdkMessage || 'Unknown Lightning SDK error'}`);
            }

        } else if (type === 'lightningaddress' || type === 'lnurlpay') {
            let payRequestDetails;
            if (type === 'lightningaddress') {
                payRequestDetails = parsedInput.inner?.[0]?.payRequest || parsedInput.data?.payRequest;
            } else {
                payRequestDetails = parsedInput.data || parsedInput.inner?.[0] || parsedInput;
            }

            if (!payRequestDetails) throw new Error("Failed to extract LNURL pay request details.");

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
                prepareResponse = await sdk.prepareLnurlPay(prepareLnurlPayRequest);
            } catch (error: any) {
                throw new Error(`Prepare LNURL error (${error.message}).`);
            }

            try {
                await sdk.lnurlPay({
                    prepareResponse: prepareResponse,
                    idempotencyKey: undefined
                } as any);
            } catch (error: any) {
                throw new Error(`Send LNURL error (${error.message}).`);
            }

        } else {
            throw new Error(`Unsupported lightning format. Parsed type: ${rawType}`);
        }

        // A display refresh must not turn a completed send into a payment error.
        await refreshLightningState().catch(error => {
            console.warn('Payment sent, but Lightning display refresh failed:', error);
        });
    };

    const estimateLightningFee = async (invoiceStr: string, amountSats?: number): Promise<number | null> => {
        const sdk = activeSdkInstance;
        if (!sdk) return null;

        let cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();

        try {
            const parsedInput = await sdk.parse(cleanStr);
            const rawType = parsedInput.type || parsedInput.tag || '';
            const type = String(rawType).toLowerCase();

            if (type === 'lightningaddress' || type === 'lnurlpay') {
                let payRequestDetails;
                if (type === 'lightningaddress') {
                    payRequestDetails = parsedInput.inner?.[0]?.payRequest || parsedInput.data?.payRequest;
                } else {
                    payRequestDetails = parsedInput.data || parsedInput.inner?.[0] || parsedInput;
                }

                if (payRequestDetails) {
                    const prepareLnurlPayRequest: any = {
                        amountSats: BigInt(amountSats || 0),
                        payRequest: payRequestDetails,
                        comment: undefined,
                        validateSuccessActionUrl: undefined,
                        conversionOptions: undefined,
                        feePolicy: undefined
                    };

                    const prepareResponse = await sdk.prepareLnurlPay(prepareLnurlPayRequest);
                    if (prepareResponse && prepareResponse.feeSats) {
                        return Number(prepareResponse.feeSats);
                    }
                }
                return null;
            }
        } catch (error) {
            // Fall through to handle as raw bolt11 if parsing fails
        }

        const prepareRequest: any = {
            paymentRequest: cleanStr
        };

        if (amountSats && amountSats > 0) {
            prepareRequest.amount = amountSats;
        }

        try {
            const prepareResponse = await sdk.prepareSendPayment(prepareRequest);
            let totalFeeSats = 0;

            if (prepareResponse.paymentMethod) {
                const paymentMethod = prepareResponse.paymentMethod.inner || prepareResponse.paymentMethod;

                if (prepareResponse.paymentMethod.tag === 'Bolt11Invoice' || paymentMethod.lightningFeeSats !== undefined) {
                    // The SDK uses either Lightning routing or a Spark transfer,
                    // not both fees for one payment.
                    totalFeeSats = Number(paymentMethod.lightningFeeSats || 0);
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
            const response = await activeSdkInstance.receivePayment({
                paymentMethod: breezSdk.ReceivePaymentMethod.BitcoinAddress.new({
                    newAddress: undefined
                } as any)
            });

            const address = response.paymentRequest || response.bitcoinAddress || response.address;
            if (address) return address;

            throw new Error("Address empty in response");
        } catch (error: any) {
            throw new Error(`Failed to generate address: ${error.message}`);
        }
    };

    const prepareWithdrawToOnchain = async (address: string, amountSats: number, feeTier: 'fast' | 'normal' | 'slow') => {
        if (!activeSdkInstance) throw new Error("Lightning node not initialized");
        try {
            const prepareRequest = {
                paymentRequest: address,
                amount: amountSats
            };
            const res = await activeSdkInstance.prepareSendPayment(prepareRequest as any);

            let feeSats = 0;

            if (res.paymentMethod && res.paymentMethod.tag === 'BitcoinAddress') {
                const quote = res.paymentMethod.inner.feeQuote;

                if (feeTier === 'fast') {
                    const speedObj = quote?.speedFast;
                    const l1Fee = Number(speedObj?.l1BroadcastFeeSat || 0);
                    const userFee = Number(speedObj?.userFeeSat || 0);
                    feeSats = l1Fee + userFee;
                } else if (feeTier === 'slow') {
                    const speedObj = quote?.speedSlow;
                    const l1Fee = Number(speedObj?.l1BroadcastFeeSat || 0);
                    const userFee = Number(speedObj?.userFeeSat || 0);
                    feeSats = l1Fee + userFee;
                } else {
                    const speedObj = quote?.speedMedium;
                    const l1Fee = Number(speedObj?.l1BroadcastFeeSat || 0);
                    const userFee = Number(speedObj?.userFeeSat || 0);
                    feeSats = l1Fee + userFee;
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
        const sdk = activeSdkInstance;
        if (!sdk) throw new Error("Lightning node not initialized");

        let speed;
        try {
            const OnchainConfirmationSpeed = breezSdk.OnchainConfirmationSpeed;
            if (feeTier === 'fast') {
                speed = OnchainConfirmationSpeed.Fast;
            } else if (feeTier === 'slow') {
                speed = OnchainConfirmationSpeed.Slow;
            } else {
                speed = OnchainConfirmationSpeed.Medium;
            }
        } catch (enumError) {
            console.error('Failed to access OnchainConfirmationSpeed enum:', enumError);
            throw new Error(`Invalid fee tier: ${feeTier}`);
        }

        try {
            const options = new breezSdk.SendPaymentOptions.BitcoinAddress({
                confirmationSpeed: speed
            });

            await sdk.sendPayment({
                prepareResponse: prepareResponse,
                options: options
            });

            await refreshLightningState().catch(error => {
                console.warn('Withdrawal sent, but Lightning display refresh failed:', error);
            });
        } catch (error: any) {
            throw new Error(`Withdrawal failed: ${error.message}`);
        }
    };

    // ------------------------------------------------------------------
    // WALLET HYDRATION & LOGIC
    // ------------------------------------------------------------------

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

    const deriveReceiveAddress = (root: any, index: number, isWatchOnly: boolean, scriptType: string = 'p2wpkh'): DerivedAddress | null => {
        try {
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

    const triggerRefresh = async () => {
        setLastRefreshTime(Date.now());

        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['wallet-balances'] }),
            queryClient.invalidateQueries({ queryKey: ['saved', 'balances'] }),
            isLightningInitialized ? refreshLightningState(true) : Promise.resolve(),
        ]);
    };

    const getRootNode = async (wallet: Wallet) => {
        if (wallet.type === 'watch-only') {
            if (!wallet.xpub) throw new Error("Watch-only wallet missing xpub");
            try {
                return getBip32Node(wallet.xpub, NETWORK);
            } catch (e) {
                throw new Error("Invalid Network Key");
            }
        } else {
            const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${wallet.id}` });
            if (!credentials) throw new Error(`Mnemonic not found for wallet ${wallet.id}`);
            const mnemonic = credentials.password;
            const seed = bip39.mnemonicToSeedSync(mnemonic);
            return bip32.fromSeed(seed, NETWORK);
        }
    };

    const loadAndSetActiveWallet = async (walletId: string): Promise<boolean> => {
        const initVersion = ++lightningInitVersionRef.current;
        lightningRefreshQueueRef.current = Promise.resolve();
        setIsLightningInitialized(false);
        setLightningInitAttempted(false);
        setLightningInitError(null);
        setLightningBalance(0);
        setLightningTransactions([]);
        setLightningAddress('');
        setDefaultLightningInvoice('');
        await disposeActiveLightningNode();
        let wallet = await buildActiveWallet(walletId);
        if (!wallet) return false;

        try {
            const root = await getRootNode(wallet);
            const is_watch_only = wallet.type === 'watch-only';
            const script_type = wallet.scriptType || 'p2wpkh';
            let derived_new = false;

            // --- LIGHTNING INIT (DEFERRED) ---
            if (!is_watch_only) {
                const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
                if (credentials) {
                    // DEFER: Push Lightning initialization to macro task queue so UI renders first
                    scheduleDeferred(() => {
                        InteractionManager.runAfterInteractions(() => {
                            initLightningNode(credentials.password, walletId, initVersion).catch((e) =>
                                console.error("Deferred Lightning Init failed", e)
                            );
                        });
                    }, 800);
                } else {
                    setIsLightningInitialized(false);
                    setLightningInitAttempted(false);
                    setLightningBalance(0);
                    setLightningTransactions([]);
                    setLightningInitError('Mnemonic not found in Keychain for this wallet');
                }
            } else {
                setIsLightningInitialized(false);
                setLightningInitAttempted(false);
                setLightningBalance(0);
                setLightningTransactions([]);
                setLightningInitError('Active wallet is watch-only');
            }
            // ----------------------

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
                if (initVersion !== lightningInitVersionRef.current) return false;
                setActiveWallet(wallet);
                return true;
            }
            return false;
        } catch (e) {
            console.warn(`Failed to load wallet ${wallet?.name}:`, e);
            if (initVersion === lightningInitVersionRef.current) {
                setActiveWallet(null);
            }
            return false;
        }
    };

    // FAST-PATH BOOTSTRAP
    useEffect(() => {
        const bootstrap = async () => {
            setLoading(true);
            setLoadingSavedAddresses(true);
            try {
                const walletsFromDb = await dbGetWallets(NETWORK_NAME);
                setWallets(walletsFromDb);

                // Zero wallet edge-case optimization: skip keychain and address book calls
                if (walletsFromDb.length === 0) {
                    setActiveWallet(null);
                    const saved = await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses').catch(() => []);
                    setSavedAddresses(saved);
                    setLoading(false);
                    setLoadingSavedAddresses(false);
                    return;
                }

                // Existing wallets: fetch active ID and address book concurrently
                let activeId: string | null = null;
                const [activeIdCreds, saved] = await Promise.all([
                    Keychain.getGenericPassword({ service: ACTIVE_WALLET_KEY }).catch(() => null),
                    dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses').catch(() => [])
                ]);

                if (activeIdCreds) activeId = activeIdCreds.password;
                setSavedAddresses(saved);
                setLoadingSavedAddresses(false);

                let currentId = activeId;
                if (!currentId || !walletsFromDb.find(w => w.id === currentId)) {
                    currentId = walletsFromDb[0].id;
                }

                let success = await loadAndSetActiveWallet(currentId);

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
            } catch (error) {
                console.error("DEBUG: Failed to bootstrap wallet:", error);
            } finally {
                setLoading(false);
                setLoadingSavedAddresses(false);
            }
        };
        bootstrap();
    }, []);

    const getOrCreateNextUnusedReceiveAddress = async (currentAddress: string, currentIndex: number): Promise<{ address: string, index: number } | null> => {
        if (!activeWallet) return null;

        const addresses = activeWallet.derivedReceiveAddresses;
        const currentPos = addresses.findIndex(a => a.index === currentIndex);

        if (currentPos !== -1 && currentPos < addresses.length - 1) {
            return addresses[currentPos + 1];
        }

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
            dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses')
                .then(setSavedAddresses)
                .catch(() => { });
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
            const loaded = await loadAndSetActiveWallet(walletId);
            if (!loaded) throw new Error(`Could not load wallet ${walletId}`);
            await Keychain.setGenericPassword('user', walletId, { service: ACTIVE_WALLET_KEY });
        } catch (error) {
            console.error("Failed to switch wallet:", error);
            throw error;
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
                ++lightningInitVersionRef.current;
                lightningRefreshQueueRef.current = Promise.resolve();
                await disposeActiveLightningNode();
                setIsLightningInitialized(false);
                setLightningInitAttempted(false);
                setLightningInitError(null);
                setLightningBalance(0);
                setLightningTransactions([]);
                setLightningAddress('');
                setDefaultLightningInvoice('');
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
        ++lightningInitVersionRef.current;
        lightningRefreshQueueRef.current = Promise.resolve();
        await disposeActiveLightningNode();
        const d = await dbGetWallets(NETWORK_NAME);
        for (const w of d) {
            await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${w.id}` });
            await dbDeleteWallet(w.id);
        }
        await Keychain.resetGenericPassword({ service: ACTIVE_WALLET_KEY });
        setWallets([]);
        setActiveWallet(null);
        setIsLightningInitialized(false);
        setLightningInitAttempted(false);
        setLightningInitError(null);
        setLightningBalance(0);
        setLightningTransactions([]);
        setLightningAddress('');
        setDefaultLightningInvoice('');
    };

    const createAndSignTransaction = async (
        recipient: string, amount: number, utxos: any[], feeRate: number
    ): Promise<{ txHex: string | null; usedChangeIndex: number | null }> => {
        if (!activeWallet) throw new Error("No active wallet.");
        if (activeWallet.type === 'watch-only') throw new Error("Watch-only wallets cannot sign transactions.");

        const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${activeWallet.id}` });
        if (!credentials) throw new Error("Could not retrieve credentials.");
        const mnemonic = credentials.password;
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const root = bip32.fromSeed(seed, NETWORK);

        let verified_change_index = activeWallet.changeAddressIndex ?? 0;
        const change_addresses_set = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));

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
                usedChangeIndex = verified_change_index;
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
        if (item) {
            await dbUpdateSavedAddress('saved_addresses', { ...item, name: newName });
            setSavedAddresses(await dbGetSavedAddresses(NETWORK_NAME, 'saved_addresses'));
        }
    };

    const refreshSavedAddressBalances = async () => {
        queryClient.invalidateQueries({ queryKey: ['saved', 'balances'] });
    };

    const value: WalletContextType = {
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
        updateAddressLabel,

        isLightningInitialized,
        lightningInitAttempted,
        lightningInitError,
        lightningBalance,
        lightningTransactions,
        defaultLightningInvoice,
        lightningAddress,
        checkLightningAddressAvailable,
        registerLightningAddress,
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

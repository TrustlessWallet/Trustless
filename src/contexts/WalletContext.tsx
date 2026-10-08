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
import { LightningLifecycle, SingleFlight, withDeadline } from '../services/lightningSession';

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

// Temporary diagnostic logging. Never log request arguments, seeds, invoices, or payment records.
type LightningTraceContext = { wallet: string; session: number };
let lightningTraceSequence = 0;
const lightningWalletLabels = new Map<string, string>();
const lightningWalletLabel = (id: string | null) => {
    if (!id) return 'none';
    if (!lightningWalletLabels.has(id)) lightningWalletLabels.set(id, `wallet-${lightningWalletLabels.size + 1}`);
    return lightningWalletLabels.get(id)!;
};
const lightningTrace = (context: LightningTraceContext, step: string, details: Record<string, unknown> = {}) => {
    console.log('[LightningDebug]', JSON.stringify({ at: new Date().toISOString(), ...context, step, ...details }));
};
const lightningErrorDetails = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return {
        errorType: error instanceof Error ? error.name : typeof error,
        // Avoid dumping native error objects: they may contain complete payment requests.
        errorCategory: /timed? ?out|timeout/i.test(text) ? 'timeout'
            : /network|connect|dns|offline/i.test(text) ? 'network'
            : /sqlite|database|storage|locked/i.test(text) ? 'storage'
            : /decode|deserialize|parse|invalid type/i.test(text) ? 'decoding' : 'other',
        message: text.replace(/(?:https?:\/\/|lnbc|lntb|lnbcrt|lno1|lnurl1)\S+/gi, '[redacted]')
            .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[redacted]').slice(0, 600),
    };
};
const traceLightningStep = <T,>(context: LightningTraceContext, step: string, operation: () => Promise<T>, summarize?: (value: T) => Record<string, unknown>): Promise<T> => {
    const request = ++lightningTraceSequence;
    const started = Date.now();
    const log = (phase: string, details: Record<string, unknown> = {}) =>
        lightningTrace(context, step, { request, phase, elapsedMs: Date.now() - started, ...details });
    log('start');
    let promise: Promise<T>;
    try { promise = operation(); } catch (error) {
        log('error', step === 'sdk.connect' ? { errorType: 'connect threw synchronously' } : lightningErrorDetails(error));
        throw error;
    }
    // Observe the original promise without adding deadlines, retries, or extra SDK calls.
    const pending = setTimeout(() => log('still-pending'), 5000);
    void promise.then(value => {
        clearTimeout(pending);
        try { log('success', summarize?.(value)); }
        catch { log('success', { summaryUnavailable: true }); }
    }, error => {
        clearTimeout(pending);
        log('error', step === 'sdk.connect' ? { errorType: 'connect rejected' } : lightningErrorDetails(error));
    });
    return promise;
};

type LightningSdk = Awaited<ReturnType<typeof breezSdk.connect>>;
const HISTORY_PAGE_SIZE = 50;

const toLightningTransaction = (p: any): LightningTransaction => ({
    paymentHash: p.id || p.paymentHash || '',
    paymentTime: Number(p.timestamp ?? p.paymentTime ?? p.time ?? 0),
    amountMsat: Number(p.amount ?? p.amountSats ?? 0) * 1000,
    feeMsat: Number(p.fees ?? p.feeSats ?? 0) * 1000,
    status: p.status === breezSdk.PaymentStatus.Completed ? 'complete'
        : p.status === breezSdk.PaymentStatus.Failed ? 'failed' : 'pending',
    type: p.paymentType === breezSdk.PaymentType.Receive ? 'receive' : 'send',
    description: p.description || p.details?.inner?.description ||
        p.details?.inner?.invoiceDetails?.description ||
        (p.details?.tag === 'Deposit' ? 'Top-up' : p.details?.tag === 'Withdraw' ? 'Withdraw to on-chain' : ''),
    paymentMethod: Number(p.method),
});

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
    triggerRefresh: (mode?: 'lightning' | 'onchain' | 'all') => Promise<void>;
    isWalletSwitching: boolean;
    lightningSyncing: boolean;
    lightningSyncError: string | null;
    lightningLastSyncedAt: number | null;
    retryLightning: () => Promise<void>;
    hasMoreLightningTransactions: boolean;
    loadMoreLightningTransactions: () => Promise<void>;
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
    payLightningInvoice: (invoiceStr: string, amountSats?: number) => Promise<LightningTransaction>;
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
    const sdkRef = useRef<LightningSdk | null>(null);
    const listenerRef = useRef<string | null>(null);
    const readyRef = useRef(false);
    const sdkWalletIdRef = useRef<string | null>(null);
    const activeWalletIdRef = useRef<string | null>(null);
    const lifecycleRef = useRef(new LightningLifecycle<LightningSdk>());
    const flightsRef = useRef(new SingleFlight());
    const historyLimitRef = useRef(HISTORY_PAGE_SIZE);
    const historyRevisionRef = useRef(0);
    const initializationRef = useRef<Promise<void> | null>(null);
    const retryRef = useRef<Promise<void> | null>(null);
    const switchingRef = useRef(false);
    const paymentInFlightRef = useRef(false);
    const preparedWithdrawalsRef = useRef(new WeakMap<object, LightningSdk>());
    const [isWalletSwitching, setIsWalletSwitching] = useState(false);
    const [lightningSyncing, setLightningSyncing] = useState(false);
    const [lightningSyncError, setLightningSyncError] = useState<string | null>(null);
    const [lightningLastSyncedAt, setLightningLastSyncedAt] = useState<number | null>(null);
    const [hasMoreLightningTransactions, setHasMoreLightningTransactions] = useState(false);

    const lightningTraceContext = (): LightningTraceContext => ({
        wallet: lightningWalletLabel(sdkWalletIdRef.current || activeWalletIdRef.current),
        session: lightningInitVersionRef.current,
    });

    useEffect(() => {
        lightningTrace(lightningTraceContext(), 'react.state', {
            initialized: isLightningInitialized, syncing: lightningSyncing,
            balanceSats: lightningBalance, historyCount: lightningTransactions.length,
            pendingCount: lightningTransactions.filter(tx => tx.status === 'pending').length,
            hasInitError: !!lightningInitError, hasSyncError: !!lightningSyncError,
        });
    }, [activeWallet?.id, isLightningInitialized, lightningSyncing, lightningBalance,
        lightningTransactions, lightningInitError, lightningSyncError]);

    const resetLightningState = () => {
        lightningTrace(lightningTraceContext(), 'state.reset');
        readyRef.current = false;
        flightsRef.current = new SingleFlight();
        initializationRef.current = null;
        retryRef.current = null;
        historyLimitRef.current = HISTORY_PAGE_SIZE;
        ++historyRevisionRef.current;
        setLightningSyncing(false);
        setLightningSyncError(null);
        setLightningLastSyncedAt(null);
        setHasMoreLightningTransactions(false);
    };

    const requireLightningSession = () => {
        const sdk = sdkRef.current;
        const version = lightningInitVersionRef.current;
        if (!sdk || !readyRef.current || switchingRef.current || sdkWalletIdRef.current !== activeWalletIdRef.current) {
            throw new Error('Lightning is not ready for this wallet. Refresh and try again.');
        }
        const assertCurrent = () => {
            if (sdk !== sdkRef.current || version !== lightningInitVersionRef.current || switchingRef.current) {
                throw new Error('The active wallet changed. Please try again.');
            }
        };
        return { sdk, version, assertCurrent };
    };

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
            activeWalletIdRef.current = null;
            pendingTimeoutsRef.current.forEach(id => clearTimeout(id));
            pendingTimeoutsRef.current.clear();
            void disposeActiveLightningNode().catch(error => console.warn('Lightning cleanup failed:', error));
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
        const version = lightningInitVersionRef.current;
        if (isLightningInitialized && !defaultLightningInvoice) {
            getLightningInvoice(0)
                .then(invoice => {
                    if (isMounted && version === lightningInitVersionRef.current) setDefaultLightningInvoice(invoice);
                })
                .catch(err => console.error("Background invoice generation failed:", err));
        }
        return () => { isMounted = false; };
    }, [isLightningInitialized, defaultLightningInvoice, activeWallet?.id]);

    const refreshLightningState = (forceSync = false): Promise<void> => {
        const sdk = sdkRef.current;
        const version = lightningInitVersionRef.current;
        lightningTrace(lightningTraceContext(), 'refresh.request', { forceSync, connected: !!sdk, historyLimit: historyLimitRef.current });
        if (!sdk) return Promise.reject(new Error('Lightning is not connected. Please retry.'));
        const flights = flightsRef.current;
        const current = () => sdk === sdkRef.current && version === lightningInitVersionRef.current;
        const readBalance = () => withDeadline(flights.run('balance', async () => {
            const info = await traceLightningStep(lightningTraceContext(), 'sdk.getInfo', () => sdk.getInfo({ ensureSynced: false }), value => ({ balanceSats: String(value.balanceSats) }));
            lightningTrace(lightningTraceContext(), 'balance.apply', { responseSession: version, accepted: current(), balanceSats: String(info.balanceSats) });
            if (current()) setLightningBalance(Number(info.balanceSats));
        }), 'Reading Lightning balance');
        const readHistory = () => {
            const limit = historyLimitRef.current;
            return withDeadline(flights.run(`history:${limit}`, async () => {
                const revision = ++historyRevisionRef.current;
                const result = await traceLightningStep(lightningTraceContext(), 'sdk.listPayments', () => sdk.listPayments({ offset: 0, limit, sortAscending: false, typeFilter: undefined, statusFilter: undefined, assetFilter: new breezSdk.AssetFilter.Bitcoin(), paymentDetailsFilter: undefined, fromTimestamp: undefined, toTimestamp: undefined }), value => ({ count: value.payments.length, limit, statuses: value.payments.reduce((counts: Record<string, number>, p) => { const key = String(p.status); counts[key] = (counts[key] || 0) + 1; return counts; }, {}) }));
                lightningTrace(lightningTraceContext(), 'history.apply', { responseSession: version, revision, latestRevision: historyRevisionRef.current, accepted: current() && revision === historyRevisionRef.current, count: result.payments.length });
                if (!current() || revision !== historyRevisionRef.current) return;
                setLightningTransactions(result.payments.map(toLightningTransaction));
                setHasMoreLightningTransactions(result.payments.length === limit);
            }), 'Reading Lightning history');
        };
        const readAddress = () => withDeadline(flights.run('address', async () => {
            const address = await traceLightningStep(lightningTraceContext(), 'sdk.getLightningAddress', () => sdk.getLightningAddress(), value => ({ hasAddress: !!value?.lightningAddress }));
            if (current()) setLightningAddress(address?.lightningAddress || '');
        }), 'Reading Lightning address');
        void readAddress().catch(error => console.warn('Lightning address lookup failed:', error));
        // Each stream independently performs a trailing read. A payment event may
        // arrive while a previous read is in flight; sharing only that old read
        // could otherwise lose the event's newer state.
        if (!forceSync) return Promise.all([
            readBalance().then(() => current() ? readBalance() : undefined),
            readHistory().then(() => current() ? readHistory() : undefined),
        ]).then(() => {}).catch(error => { lightningTrace(lightningTraceContext(), 'refresh.cache.error', lightningErrorDetails(error)); throw error; });

        return flights.run('refresh', async () => {
            if (!current()) return;
            setLightningSyncing(true);
            setLightningSyncError(null);
            // Cache reads remain independent of network synchronization and each other.
            void Promise.all([readBalance(), readHistory()]).catch(error => lightningTrace(lightningTraceContext(), 'refresh.cache.error', lightningErrorDetails(error)));
            try {
                await withDeadline(flights.run('sync', () => traceLightningStep(lightningTraceContext(), 'sdk.syncWallet', () => sdk.syncWallet({}))), 'Lightning synchronization');
                if (!current()) return;
                // Finish any pre-sync reads and re-read each stream independently.
                // A stuck history call must not hold back a post-sync balance read.
                await Promise.all([
                    (async () => {
                        await readBalance();
                        if (!current()) return;
                        await readBalance();
                        if (current()) setLightningLastSyncedAt(Date.now());
                    })(),
                    readHistory().then(() => current() ? readHistory() : undefined),
                ]);
            } catch (error) {
                lightningTrace(lightningTraceContext(), 'refresh.sync.error', { responseSession: version, ...lightningErrorDetails(error) });
                if (current()) setLightningSyncError(error instanceof Error ? error.message : 'Lightning refresh failed.');
                throw error;
            } finally {
                lightningTrace(lightningTraceContext(), 'refresh.sync.finished', { responseSession: version, accepted: current() });
                if (current()) setLightningSyncing(false);
            }
        });
    };

    const loadMoreLightningTransactions = async () => {
        requireLightningSession();
        historyLimitRef.current += HISTORY_PAGE_SIZE;
        await refreshLightningState();
    };

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
            lightningTrace(lightningTraceContext(), 'app.state', { state });
            if (state === 'active' && activeWalletIdRef.current && !switchingRef.current) {
                void triggerRefresh('lightning').catch(error => console.warn('Foreground Lightning refresh failed:', error));
            }
        });
        return () => subscription.remove();
    }, [activeWallet?.id, isLightningInitialized]);

    const disposeActiveLightningNode = async () => {
        lightningTrace(lightningTraceContext(), 'dispose.request');
        const sdk = sdkRef.current;
        const listenerId = listenerRef.current;
        readyRef.current = false;
        sdkRef.current = null;
        listenerRef.current = null;
        sdkWalletIdRef.current = null;
        // A stuck listener removal must not prevent native disconnect. Generation
        // checks already make any remaining callbacks harmless.
        if (sdk && listenerId) {
            void withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.removeEventListener', () => sdk.removeEventListener(listenerId)), 'Removing Lightning listener', 5000)
                .catch(error => console.warn('Lightning listener cleanup failed:', error));
        }
        await traceLightningStep(lightningTraceContext(), 'lifecycle.dispose', () => withDeadline(lifecycleRef.current.dispose(sdk || undefined), 'Disconnecting Lightning', 15000));
    };

    const initLightningNode = (mnemonic: string, walletId: string, initVersion: number): Promise<void> => {
        lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.request', { stale: initVersion !== lightningInitVersionRef.current || activeWalletIdRef.current !== walletId, joiningExistingInit: !!initializationRef.current });
        if (initVersion !== lightningInitVersionRef.current || activeWalletIdRef.current !== walletId) return Promise.resolve();
        if (initializationRef.current) return initializationRef.current;
        const current = () => initVersion === lightningInitVersionRef.current && activeWalletIdRef.current === walletId;
        const task = (async () => {
            setLightningInitAttempted(true);
            setLightningInitError(null);
            try {
                const apiKey = process.env.EXPO_PUBLIC_BREEZ_API_KEY;
                if (!apiKey) throw new Error('Missing EXPO_PUBLIC_BREEZ_API_KEY at runtime');
                const sdk = await withDeadline(lifecycleRef.current.replace(async () => {
                    const config = breezSdk.defaultConfig(breezSdk.Network.Mainnet);
                    config.apiKey = apiKey;
                    config.maxDepositClaimFee = new breezSdk.MaxFee.NetworkRecommended({ leewaySatPerVbyte: BigInt(1) });
                    config.lnurlDomain = 'pay.hd-apps.com';
                    lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'storage.prepare.start');
                    const storageDir = new FileSystem.Directory(`${FileSystem.Paths.document.uri}breezSdkSpark/${walletId}`);
                    if (!(await storageDir.info()).exists) await storageDir.create({ intermediates: true });
                    lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'storage.prepare.ready');
                    return traceLightningStep({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'sdk.connect', () => breezSdk.connect({ config,
                        seed: breezSdk.Seed.Mnemonic.new({ mnemonic: mnemonic.toLowerCase().trim() } as any),
                        storageDir: storageDir.uri.replace('file://', ''),
                    }));
                }, current), 'Connecting Lightning', 30000);
                lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.connected', { accepted: !!sdk && current() });
                if (!sdk || !current()) return;
                sdkRef.current = sdk;
                sdkWalletIdRef.current = walletId;
                let paymentSyncRequested = false;
                let paymentSyncRunning = false;
                const syncAfterPayment = () => {
                    paymentSyncRequested = true;
                    if (paymentSyncRunning) return;
                    paymentSyncRunning = true;
                    // A payment event can precede the SDK's cached balance update.
                    // Drain any refresh already running, then request a sync which
                    // starts AFTER the payment event. Coalesce bursts of events.
                    void (async () => {
                        try {
                            await refreshLightningState(true).catch(() => {});
                            while (current() && sdkRef.current === sdk && paymentSyncRequested) {
                                paymentSyncRequested = false;
                                await refreshLightningState(true);
                            }
                        } catch (error) {
                            if (current()) setLightningSyncError(error instanceof Error ? error.message : String(error));
                        } finally {
                            paymentSyncRunning = false;
                        }
                    })();
                };
                const listenerTask = traceLightningStep(lightningTraceContext(), 'sdk.addEventListener', () => sdk.addEventListener({ onEvent: async (event: any) => {
                    lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'event', { tag: event.tag, accepted: current() && sdkRef.current === sdk, paymentStatus: event.inner?.payment?.status, paymentType: event.inner?.payment?.paymentType });
                    if (!current() || sdkRef.current !== sdk) return;
                    if ([breezSdk.SdkEvent_Tags.Synced, breezSdk.SdkEvent_Tags.PaymentPending,
                        breezSdk.SdkEvent_Tags.PaymentSucceeded, breezSdk.SdkEvent_Tags.PaymentFailed].includes(event.tag)) {
                        // Never await network work inside a native event callback.
                        void refreshLightningState().then(() => {
                            if (current() && event.tag === breezSdk.SdkEvent_Tags.Synced) {
                                setLightningLastSyncedAt(Date.now());
                                setLightningSyncError(null);
                            }
                        }).catch(error => {
                            if (current()) setLightningSyncError(String(error?.message || error));
                        });
                    }
                    if ([breezSdk.SdkEvent_Tags.PaymentPending, breezSdk.SdkEvent_Tags.PaymentSucceeded,
                        breezSdk.SdkEvent_Tags.PaymentFailed].includes(event.tag)) {
                        syncAfterPayment();
                    }
                    // Synced only reads the cache above: forcing another sync on
                    // Synced would create an endless synchronization loop.
                    if (event.tag === breezSdk.SdkEvent_Tags.PaymentSucceeded &&
                        event.inner?.payment?.paymentType === breezSdk.PaymentType.Receive) setDefaultLightningInvoice('');
                    if (event.tag === breezSdk.SdkEvent_Tags.LightningAddressChanged) {
                        setLightningAddress(event.inner?.lightningAddress?.lightningAddress || '');
                    }
                }}));
                // Also clean up a listener which was registered after the UI deadline.
                void listenerTask.then(id => {
                    if (!current()) void traceLightningStep(lightningTraceContext(), 'sdk.removeEventListener', () => sdk.removeEventListener(id)).catch(() => {});
                }, () => {});
                const id = await withDeadline(listenerTask, 'Registering Lightning listener');
                if (!current()) return;
                listenerRef.current = id;
                readyRef.current = true;
                lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.ready');
                setIsLightningInitialized(true);
            } catch (error) {
                lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.error', { errorType: error instanceof Error ? error.name : typeof error, stale: !current() });
                if (!current()) return;
                // Invalidate a late connect before allowing retry; lifecycle keeps
                // teardown serialized even if the native call is still pending.
                ++lightningInitVersionRef.current;
                sdkRef.current = null;
                sdkWalletIdRef.current = null;
                setIsLightningInitialized(false);
                setLightningInitError(error instanceof Error ? error.message : formatLightningInitError(error));
                void lifecycleRef.current.dispose().catch(e => console.warn('Lightning cleanup failed:', e));
                throw error;
            }
        })();
        initializationRef.current = task;
        void task.then(() => {
            if (initializationRef.current === task) initializationRef.current = null;
            if (current()) void refreshLightningState(true).catch(() => {});
        }, () => { if (initializationRef.current === task) initializationRef.current = null; });
        return task;
    };

    const retryLightning = (): Promise<void> => {
        lightningTrace(lightningTraceContext(), 'retry.request', { joiningExistingRetry: !!retryRef.current });
        if (retryRef.current) return retryRef.current;
        const task = (async () => {
            if (switchingRef.current) throw new Error('Please wait for the wallet switch to finish.');
            if (paymentInFlightRef.current) throw new Error('Please wait for the payment to finish.');
            if (!activeWallet || activeWallet.type === 'watch-only') return;
            if (initializationRef.current) return initializationRef.current;
            const walletId = activeWallet.id;
            const version = ++lightningInitVersionRef.current;
            resetLightningState();
            setIsLightningInitialized(false);
            setLightningInitError(null);
            setDefaultLightningInvoice('');
            try {
                await disposeActiveLightningNode();
                const credentials = await Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });
                if (version !== lightningInitVersionRef.current || walletId !== activeWalletIdRef.current) return;
                if (!credentials) throw new Error('Mnemonic not found for this wallet.');
                await initLightningNode(credentials.password, walletId, version);
                if (sdkRef.current && walletId === activeWalletIdRef.current) await refreshLightningState(true);
            } catch (error) {
                if (walletId === activeWalletIdRef.current && !sdkRef.current) {
                    setLightningInitError(error instanceof Error ? error.message : 'Lightning connection failed.');
                }
                throw error;
            }
        })();
        retryRef.current = task;
        void task.then(() => { if (retryRef.current === task) retryRef.current = null; },
            () => { if (retryRef.current === task) retryRef.current = null; });
        return task;
    };

    const checkLightningAddressAvailable = async (username: string): Promise<boolean> => {
        const { sdk, assertCurrent } = requireLightningSession();
        const available = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.checkLightningAddressAvailable', () => sdk.checkLightningAddressAvailable({ username })), 'Checking Lightning address');
        assertCurrent();
        return available;
    };

    const registerLightningAddress = async (username: string, description?: string): Promise<void> => {
        const { sdk, assertCurrent } = requireLightningSession();
        const request = {
            username,
            description: description || `Pay to ${username}@pay.hd-apps.com`
        };
        const addressInfo = await traceLightningStep(lightningTraceContext(), 'sdk.registerLightningAddress', () => sdk.registerLightningAddress(request));
        assertCurrent();
        setLightningAddress(addressInfo.lightningAddress);
    };

    const getLightningInvoice = useCallback(async (amountSats: number) => {
        const { sdk, assertCurrent } = requireLightningSession();
        const req = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.receivePayment', () => sdk.receivePayment({
            paymentMethod: breezSdk.ReceivePaymentMethod.Bolt11Invoice.new({
                description: "Send to Trustless Wallet",
                amountSats: amountSats > 0 ? BigInt(amountSats) : undefined,
                expirySecs: undefined,
                paymentHash: undefined,
            })
        })), 'Generating Lightning invoice');
        assertCurrent();
        return req.paymentRequest;
    }, []);

    const payLightningInvoice = async (invoiceStr: string, amountSats?: number): Promise<LightningTransaction> => {
        const { sdk, assertCurrent } = requireLightningSession();
        if (paymentInFlightRef.current) throw new Error('A payment is already in progress.');
        paymentInFlightRef.current = true;
        try {
            const cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();
            const parsed = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.parse', () => sdk.parse(cleanStr)), 'Reading Lightning payment');
            assertCurrent();
            let payment: breezSdk.Payment;
            if (parsed.tag === breezSdk.InputType_Tags.Bolt11Invoice) {
                const quote = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareSendPayment', () => sdk.prepareSendPayment({
                    paymentRequest: cleanStr,
                    amount: amountSats && amountSats > 0 ? BigInt(amountSats) : undefined,
                    tokenIdentifier: undefined, conversionOptions: undefined, feePolicy: undefined,
                })), 'Preparing Lightning payment');
                assertCurrent();
                // Let the SDK validate the live spendable balance and route. The
                // displayed balance is a cache and cannot authorize/reject a send.
                const response = await traceLightningStep(lightningTraceContext(), 'sdk.sendPayment', () => sdk.sendPayment({ prepareResponse: quote, options: undefined, idempotencyKey: uuidv4() }), value => ({ status: value.payment.status, paymentType: value.payment.paymentType }));
                payment = response.payment;
            } else if (parsed.tag === breezSdk.InputType_Tags.LightningAddress || parsed.tag === breezSdk.InputType_Tags.LnurlPay) {
                if (!amountSats || !Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Enter a positive amount in sats.');
                const payRequest = parsed.tag === breezSdk.InputType_Tags.LightningAddress ? parsed.inner[0].payRequest : parsed.inner[0];
                const quote = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareLnurlPay', () => sdk.prepareLnurlPay({
                    amount: BigInt(amountSats), payRequest,
                    comment: undefined, validateSuccessActionUrl: undefined, tokenIdentifier: undefined,
                    conversionOptions: undefined, feePolicy: undefined,
                })), 'Preparing Lightning payment');
                assertCurrent();
                const response = await traceLightningStep(lightningTraceContext(), 'sdk.lnurlPay', () => sdk.lnurlPay({ prepareResponse: quote, idempotencyKey: uuidv4() }), value => ({ status: value.payment.status, paymentType: value.payment.paymentType }));
                payment = response.payment;
            } else {
                throw new Error(`Unsupported Lightning payment: ${parsed.tag}`);
            }
            const transaction = toLightningTransaction(payment);
            // Publish the authoritative receipt immediately; a blocked history read
            // must not keep a completed payment in the sending state.
            if (sdkRef.current === sdk) {
                ++historyRevisionRef.current;
                setLightningTransactions(previous => [transaction, ...previous.filter(tx => tx.paymentHash !== transaction.paymentHash)]);
                void refreshLightningState().catch(error => console.warn('Payment display refresh failed:', error));
            }
            return transaction;
        } finally {
            paymentInFlightRef.current = false;
        }
    };

    const estimateLightningFee = async (invoiceStr: string, amountSats?: number): Promise<number | null> => {
        try {
            const { sdk, assertCurrent } = requireLightningSession();
            const cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();
            const parsed = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.parse', () => sdk.parse(cleanStr)), 'Reading Lightning payment');
            assertCurrent();
            if (parsed.tag === breezSdk.InputType_Tags.LightningAddress || parsed.tag === breezSdk.InputType_Tags.LnurlPay) {
                if (!amountSats || amountSats <= 0) return null;
                const payRequest = parsed.tag === breezSdk.InputType_Tags.LightningAddress ? parsed.inner[0].payRequest : parsed.inner[0];
                const quote = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareLnurlPay', () => sdk.prepareLnurlPay({
                    amount: BigInt(amountSats), payRequest, comment: undefined,
                    validateSuccessActionUrl: undefined, tokenIdentifier: undefined,
                    conversionOptions: undefined, feePolicy: undefined,
                })), 'Estimating Lightning fee');
                assertCurrent();
                return Number(quote.feeSats);
            }
            const quote = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareSendPayment', () => sdk.prepareSendPayment({
                paymentRequest: cleanStr, amount: amountSats && amountSats > 0 ? BigInt(amountSats) : undefined,
                tokenIdentifier: undefined, conversionOptions: undefined, feePolicy: undefined,
            })), 'Estimating Lightning fee');
            assertCurrent();
            const method = quote.paymentMethod;
            if (method.tag === breezSdk.SendPaymentMethod_Tags.Bolt11Invoice) return Number(method.inner.lightningFeeSats);
            if (method.tag === breezSdk.SendPaymentMethod_Tags.SparkAddress || method.tag === breezSdk.SendPaymentMethod_Tags.SparkInvoice) return Number(method.inner.fee);
            return null;
        } catch { return null; }
    };

    const getLightningTopUpAddress = async (): Promise<string> => {
        const { sdk, assertCurrent } = requireLightningSession();
        try {
            const response = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.receivePayment', () => sdk.receivePayment({
                paymentMethod: breezSdk.ReceivePaymentMethod.BitcoinAddress.new({
                    newAddress: undefined
                } as any)
            })), 'Generating top-up address');
            assertCurrent();
            const address = response.paymentRequest;
            if (address) return address;

            throw new Error("Address empty in response");
        } catch (error: any) {
            throw new Error(`Failed to generate address: ${error.message}`);
        }
    };

    const prepareWithdrawToOnchain = async (address: string, amountSats: number, feeTier: 'fast' | 'normal' | 'slow') => {
        const { sdk, assertCurrent } = requireLightningSession();
        try {
            const prepareRequest = {
                paymentRequest: address, amount: BigInt(amountSats),
                tokenIdentifier: undefined, conversionOptions: undefined, feePolicy: undefined,
            };
            const res = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareSendPayment', () => sdk.prepareSendPayment(prepareRequest)), 'Preparing withdrawal');
            assertCurrent();
            preparedWithdrawalsRef.current.set(res, sdk);

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
        const { sdk, assertCurrent } = requireLightningSession();
        if (preparedWithdrawalsRef.current.get(prepareResponse) !== sdk) throw new Error('Please prepare this withdrawal again for the active wallet.');
        if (paymentInFlightRef.current) throw new Error('A payment is already in progress.');
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

        paymentInFlightRef.current = true;
        try {
            assertCurrent();
            const options = new breezSdk.SendPaymentOptions.BitcoinAddress({
                confirmationSpeed: speed
            });

            await traceLightningStep(lightningTraceContext(), 'sdk.sendPayment', () => sdk.sendPayment({
                prepareResponse: prepareResponse,
                options: options,
                idempotencyKey: uuidv4(),
            }), value => ({ status: value.payment.status, paymentType: value.payment.paymentType }));

            void refreshLightningState().catch(error => {
                console.warn('Withdrawal sent, but Lightning display refresh failed:', error);
            });
        } catch (error: any) {
            throw new Error(`Withdrawal failed: ${error.message}`);
        } finally {
            paymentInFlightRef.current = false;
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

            setActiveWallet(prev => prev?.id === activeWallet.id ? ({
                ...prev,
                utxoLabels: updatedLabels,
                nextUtxoCount: newCount
            }) : prev);
        } catch (error) {
            console.error("Failed to scan and name UTXOs:", error);
        }
    };

    const triggerRefresh = async (mode: 'lightning' | 'onchain' | 'all' = 'all') => {
        lightningTrace(lightningTraceContext(), 'ui.refresh', { mode });
        setLastRefreshTime(Date.now());
        const tasks: Promise<unknown>[] = [];
        if (mode !== 'lightning') {
            tasks.push(withDeadline(queryClient.invalidateQueries({ queryKey: ['wallet-balances', activeWalletIdRef.current] }), 'Refreshing on-chain balance'));
        }
        if (mode !== 'onchain' && activeWallet?.type !== 'watch-only') {
            tasks.push(readyRef.current && sdkRef.current ? refreshLightningState(true) : retryLightning());
        }
        const results = await Promise.allSettled(tasks);
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) {
            if (mode === 'all') console.warn('Background wallet refresh failed:', failed.reason);
            else throw failed.reason;
        }
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
        const loadStarted = Date.now();
        lightningTrace({ wallet: lightningWalletLabel(walletId), session: lightningInitVersionRef.current + 1 }, 'wallet.open.start');
        const initVersion = ++lightningInitVersionRef.current;
        resetLightningState();
        setIsLightningInitialized(false);
        setLightningInitAttempted(false);
        setLightningInitError(null);
        setLightningBalance(0);
        setLightningTransactions([]);
        setLightningAddress('');
        setDefaultLightningInvoice('');
        // Loading the on-chain wallet must not wait for native Lightning teardown.
        const teardown = disposeActiveLightningNode();
        void teardown.catch(error => {
            if (initVersion === lightningInitVersionRef.current) setLightningInitError(String(error?.message || error));
        });
        activeWalletIdRef.current = null;
        setActiveWallet(null);
        let wallet = await buildActiveWallet(walletId);
        lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'wallet.local.loaded', { elapsedMs: Date.now() - loadStarted, found: !!wallet, receiveAddresses: wallet?.derivedReceiveAddresses.length, changeAddresses: wallet?.derivedChangeAddresses.length });
        if (!wallet) return false;

        try {
            const root = await getRootNode(wallet);
            const is_watch_only = wallet.type === 'watch-only';
            const script_type = wallet.scriptType || 'p2wpkh';
            let derived_new = false;

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
                        const network_data = await traceLightningStep({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'wallet.addressDiscovery', () => withDeadline(fetchAddressInfoBatch(to_fetch), 'Discovering wallet addresses', 15000), value => ({ requested: to_fetch.length, returned: value.length }));
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
                lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'wallet.discovery.finished', { elapsedMs: Date.now() - loadStarted });
                activeWalletIdRef.current = walletId;
                setActiveWallet(wallet);
                if (!is_watch_only) {
                    scheduleDeferred(() => {
                        void (async () => {
                            lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.waitForTeardown');
                            await teardown;
                            lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'init.teardownReady');
                            if (initVersion !== lightningInitVersionRef.current) return;
                            const credentials = await traceLightningStep({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'credentials.lookup', () => Keychain.getGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` }), value => ({ found: !!value }));
                            if (!credentials) throw new Error('Mnemonic not found for this wallet.');
                            await initLightningNode(credentials.password, walletId, initVersion);
                        })().catch(error => {
                            if (activeWalletIdRef.current === walletId && (initVersion === lightningInitVersionRef.current || !sdkRef.current)) setLightningInitError(String(error?.message || error));
                        });
                    }, 0);
                }
                return true;
            }
            return false;
        } catch (e) {
            console.warn(`Failed to load wallet ${wallet?.name}:`, e);
            if (initVersion === lightningInitVersionRef.current) {
                ++lightningInitVersionRef.current;
                activeWalletIdRef.current = null;
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
        if (paymentInFlightRef.current || switchingRef.current) throw new Error('Please wait for the current wallet operation to finish.');
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
        if (switchingRef.current) throw new Error('A wallet switch is already in progress.');
        if (paymentInFlightRef.current) throw new Error('Please wait for the payment to finish before switching wallets.');
        if (activeWalletIdRef.current === walletId) return;
        switchingRef.current = true;
        setIsWalletSwitching(true);
        try {
            const loaded = await loadAndSetActiveWallet(walletId);
            if (!loaded) throw new Error(`Could not load wallet ${walletId}`);
            await Keychain.setGenericPassword('user', walletId, { service: ACTIVE_WALLET_KEY });
        } catch (error) {
            console.error("Failed to switch wallet:", error);
            throw error;
        } finally {
            switchingRef.current = false;
            setIsWalletSwitching(false);
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
        if (paymentInFlightRef.current || switchingRef.current) throw new Error('Please wait for the current wallet operation to finish.');
        await dbDeleteWallet(walletId);
        await Keychain.resetGenericPassword({ service: `${KEYCHAIN_SERVICE_PREFIX}.${walletId}` });

        const remaining = await dbGetWallets(NETWORK_NAME);
        setWallets(remaining);

        if (activeWallet?.id === walletId) {
            if (remaining.length > 0) {
                await switchWallet(remaining[0].id);
            } else {
                activeWalletIdRef.current = null;
                ++lightningInitVersionRef.current;
                resetLightningState();
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
        if (paymentInFlightRef.current || switchingRef.current) throw new Error('Please wait for the current wallet operation to finish.');
        activeWalletIdRef.current = null;
        ++lightningInitVersionRef.current;
        resetLightningState();
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
        isWalletSwitching,
        lightningSyncing,
        lightningSyncError,
        lightningLastSyncedAt,
        retryLightning,
        hasMoreLightningTransactions,
        loadMoreLightningTransactions,
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

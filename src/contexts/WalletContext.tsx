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
import { assertNoActiveExit, loadExit } from '../services/exitStorage';
import type { RunExit } from '../services/unilateralExit';

import { Wallet, DerivedAddress, BitcoinAddress, LightningTransaction } from '../types';
import { canonicalMnemonic, generateWalletMnemonic, readWalletCredentials, storeWalletMnemonic, deleteWalletMnemonic } from '../services/walletSecrets';
import { ActiveWalletProvider } from './ActiveWalletContext';
import type { ActiveWallet } from './ActiveWalletContext';
export { useActiveWallet } from './ActiveWalletContext';
import {
    calculateTransactionMetrics,
    fetchUTXOs,
    getBip32Node,
    validateWatchOnlyImport,
    fetchAddressInfoBatch
} from '../services/bitcoin';
import { NETWORK, DERIVATION_PARENT_PATH, NETWORK_NAME, IS_TESTNET } from '../constants/network';
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
import { matchTerminalPayment, normalizeInvoice } from '../services/terminal';
import { removeTerminalItems } from '../services/terminalItems';
import { reconcileTerminalSales, removeTerminalSales } from '../services/terminalSales';
import { getTerminalRefund, findTerminalRefundByInvoice, listTerminalRefundsForInvoices, reconcileTerminalRefunds, removeTerminalRefunds, updateTerminalRefund } from '../services/terminalRefunds';
import { checkedRefundInvoice, checkedRefundQuote, matchRefundPayment, preflightRefund, TerminalRefundQuote, TerminalRefundResult } from '../services/terminalRefundPayment';
import { useWalletBalanceSync, useAddressListSync } from '../hooks/useBalance';

// Keep the call sites grouped around each SDK operation without retaining the
// temporary diagnostics or installing a process-global native logger.
type LightningTraceContext = { wallet: string; session: number };
const lightningWalletLabels = new Map<string, string>();
const lightningWalletLabel = (id: string | null) => {
    if (!id) return 'none';
    if (!lightningWalletLabels.has(id)) lightningWalletLabels.set(id, `wallet-${lightningWalletLabels.size + 1}`);
    return lightningWalletLabels.get(id)!;
};
const lightningTrace = (_context: LightningTraceContext, _step: string, _details: Record<string, unknown> = {}) => {};
const lightningErrorMessage = (error: unknown) => {
    const nativeDetail = error && typeof error === 'object' && Array.isArray((error as { inner?: unknown }).inner)
        ? (error as { inner: unknown[] }).inner[0] : undefined;
    return [error instanceof Error ? error.message : String(error), typeof nativeDetail === 'string' ? nativeDetail : '']
        .filter(Boolean)
        .join(': ');
};
const traceLightningStep = async <T,>(
    _context: LightningTraceContext,
    _step: string,
    operation: () => Promise<T>,
    _summarize?: (value: T) => Record<string, unknown>,
): Promise<T> => operation();

type LightningSdk = Awaited<ReturnType<typeof breezSdk.connect>>;
const HISTORY_PAGE_SIZE = 50;

const reconcileSalesPayments = (walletId: string, payments: breezSdk.Payment[]) => {
    const matches = payments.flatMap(payment => {
        const details = payment.details?.inner as { invoice?: unknown } | undefined;
        if (payment.paymentType !== breezSdk.PaymentType.Receive ||
            payment.details?.tag !== breezSdk.PaymentDetails_Tags.Lightning ||
            typeof details?.invoice !== 'string' ||
            (payment.status !== breezSdk.PaymentStatus.Completed && payment.status !== breezSdk.PaymentStatus.Pending)) return [];
        return [{ invoice: details.invoice, paymentId: payment.id,
            status: payment.status === breezSdk.PaymentStatus.Completed ? 'received' as const : 'pending' as const }];
    });
    if (!matches.length) return Promise.resolve();
    return reconcileTerminalSales(walletId, IS_TESTNET ? 'testnet' : 'mainnet', matches);
};

const reconcileRefundPayments = async (walletId: string, payments: breezSdk.Payment[]) => {
    const network = IS_TESTNET ? 'testnet' : 'mainnet';
    const invoices = payments.flatMap(payment => {
        const invoice = (payment.details?.inner as { invoice?: unknown } | undefined)?.invoice;
        return typeof invoice === 'string' ? [invoice] : [];
    });
    if (!invoices.length) return;
    const attempts = await listTerminalRefundsForInvoices(walletId, network, invoices);
    if (!attempts.length) return;
    const matches = payments.flatMap(payment => attempts.flatMap(attempt => {
        const result = matchRefundPayment(payment, attempt.invoice, attempt.amountSats);
        return result && result.status !== 'unknown' && result.paymentId &&
            (result.status !== 'failed' || attempt.paymentId === result.paymentId)
            ? [{ invoice: attempt.invoice, status: result.status, paymentId: result.paymentId }] : [];
    }));
    if (matches.length) await reconcileTerminalRefunds(walletId, network, matches);
};

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

// Stores the ID of the currently open wallet so the app remembers where you left off.
const KEYCHAIN_ACTIVE_WALLET_ID_KEY_BASE = 'com.btc.trustless.activeWalletId';

// The BIP-44 "Gap Limit".
// We stop generating new addresses if we find 20 unused addresses in a row.
const GAP_LIMIT = 20;

const getStorageKey = (base: string) => `${base}.${NETWORK_NAME}`;

interface WalletContextType {
    runLightningRecovery: RunExit;
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
    createTerminalInvoice: (amountSats: number) => Promise<{ invoice: string; expiresAt: number }>;
    validateTerminalInvoice: (invoice: string, amountSats: number) => Promise<number>;
    verifyTerminalInvoice: (invoice: string, createdAt: number, knownPaymentId?: string, includeUnfilteredFallback?: boolean) => Promise<{ status: 'received' | 'pending' | 'unknown'; paymentId?: string }>;
    prepareTerminalRefund: (invoice: string, amountSats: number) => Promise<TerminalRefundQuote>;
    sendTerminalRefund: (quoteId: string, attemptId: string) => Promise<TerminalRefundResult>;
    verifyTerminalRefund: (invoice: string, createdAt: number, knownPaymentId?: string) => Promise<TerminalRefundResult>;
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
    const walletGenerationRef = useRef(0);
    const receiveDerivationsRef = useRef(new SingleFlight());
    const sdkRef = useRef<LightningSdk | null>(null);
    const recoveryModeRef = useRef(false);
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
    const preparedRefundsRef = useRef(new Map<string, { quote: TerminalRefundQuote; response: breezSdk.PrepareSendPaymentResponse; sdk: LightningSdk; walletId: string; version: number; used: boolean }>());
    const [isWalletSwitching, setIsWalletSwitching] = useState(false);
    const [lightningSyncing, setLightningSyncing] = useState(false);
    const [lightningSyncError, setLightningSyncError] = useState<string | null>(null);
    const [lightningLastSyncedAt, setLightningLastSyncedAt] = useState<number | null>(null);
    const [hasMoreLightningTransactions, setHasMoreLightningTransactions] = useState(false);

    const lightningTraceContext = (): LightningTraceContext => ({
        wallet: lightningWalletLabel(sdkWalletIdRef.current || activeWalletIdRef.current),
        session: lightningInitVersionRef.current,
    });

    const resetLightningState = () => {
        preparedRefundsRef.current.clear();
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
            ++walletGenerationRef.current;
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
        // An invoice belongs to the synchronized Spark wallet state. Creating it
        // while an imported wallet is still restoring can leave its receive claim
        // behind the initial sync.
        if (!recoveryModeRef.current && isLightningInitialized && lightningLastSyncedAt && !lightningSyncing && !defaultLightningInvoice) {
            getLightningInvoice(0)
                .then(invoice => {
                    if (isMounted && version === lightningInitVersionRef.current) setDefaultLightningInvoice(invoice);
                })
                // A wallet switch invalidates the outgoing session. This invoice
                // is only a preloaded convenience value, so the Receive screen
                // will create a fresh one if this background request is stale.
                .catch(() => {});
        }
        return () => { isMounted = false; };
    }, [isLightningInitialized, lightningLastSyncedAt, lightningSyncing, defaultLightningInvoice, activeWallet?.id]);

    const refreshLightningState = (forceSync = false): Promise<void> => {
        if (recoveryModeRef.current) forceSync = false;
        const sdk = sdkRef.current;
        const version = lightningInitVersionRef.current;
        lightningTrace(lightningTraceContext(), 'refresh.request', { forceSync, connected: !!sdk, historyLimit: historyLimitRef.current });
        if (!sdk) return Promise.reject(new Error('Lightning is not connected. Please retry.'));
        // Spark temporarily reserves selected leaves while a send is in progress.
        // Do not start a wallet sync or publish that transient reservation as the
        // wallet balance. The SDK emits its final payment/sync event afterward.
        if (paymentInFlightRef.current) {
            lightningTrace(lightningTraceContext(), 'refresh.deferredForPayment');
            return Promise.resolve();
        }
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
                // Reuse the SDK history already read for the wallet. Closed
                // Terminal invoices remain sales without another polling loop.
                const salesWalletId = sdkWalletIdRef.current;
                if (salesWalletId) void reconcileSalesPayments(salesWalletId, result.payments).catch(() => {});
                if (salesWalletId) void reconcileRefundPayments(salesWalletId, result.payments).catch(() => {});
            }), 'Reading Lightning history');
        };
        const readAddress = () => withDeadline(flights.run('address', async () => {
            const address = await traceLightningStep(lightningTraceContext(), 'sdk.getLightningAddress', () => sdk.getLightningAddress(), value => ({ hasAddress: !!value?.lightningAddress }));
            if (current()) setLightningAddress(address?.lightningAddress || '');
        }), 'Reading Lightning address');
        if (!recoveryModeRef.current) void readAddress().catch(error => console.warn('Lightning address lookup failed:', error));
        // Each stream independently performs a trailing read. A payment event may
        // arrive while a previous read is in flight; sharing only that old read
        // could otherwise lose the event's newer state.
        if (!forceSync) return Promise.all([
            readBalance().then(() => current() ? readBalance() : undefined),
            readHistory().then(() => current() ? readHistory() : undefined),
        ]).then(() => {});

        // Breez can legitimately take longer than the UI deadline while it catches
        // up a wallet. Start at most one native synchronization and let callers
        // return after the fast, local cache reads instead of falsely reporting a
        // failure or queuing another full sync.
        const cachedState = Promise.all([readBalance(), readHistory()]).then(() => {});
        const synchronization = flights.run('refresh', async () => {
            if (!current()) return;
            setLightningSyncing(true);
            setLightningSyncError(null);
            try {
                await flights.run('sync', () =>
                    traceLightningStep(lightningTraceContext(), 'sdk.syncWallet', () => sdk.syncWallet({}))
                );
                if (!current()) return;
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
                if (current()) setLightningSyncError(error instanceof Error ? error.message : 'Lightning refresh failed.');
            } finally {
                lightningTrace(lightningTraceContext(), 'refresh.sync.finished', { responseSession: version, accepted: current() });
                if (current()) setLightningSyncing(false);
            }
        });
        // Keep any background error handled: it is represented in lightningSyncError.
        void synchronization.catch(() => {});
        return cachedState;
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
        const sdk = sdkRef.current;
        const listenerId = listenerRef.current;
        readyRef.current = false;
        sdkRef.current = null;
        listenerRef.current = null;
        sdkWalletIdRef.current = null;
        // A stuck listener removal must not delay wallet switching. Generation
        // checks make callbacks from the retiring session harmless.
        if (sdk && listenerId) {
            void withDeadline(sdk.removeEventListener(listenerId), 'Removing Lightning listener', 5000)
                .catch(() => {});
        }
        await traceLightningStep(lightningTraceContext(), 'lifecycle.dispose', () => withDeadline(lifecycleRef.current.dispose(sdk || undefined), 'Disconnecting Lightning', 15000));
    };

    const initLightningNode = (mnemonic: string, walletId: string, initVersion: number, forceRecovery = false): Promise<void> => {
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
                    const storedExit = await loadExit(walletId);
                    recoveryModeRef.current = forceRecovery || (!!storedExit && storedExit.phase !== 'done');
                    const config = recoveryModeRef.current
                        ? breezSdk.defaultServerConfig(breezSdk.Network.Mainnet)
                        : breezSdk.defaultConfig(breezSdk.Network.Mainnet);
                    config.apiKey = apiKey;
                    config.privateEnabledDefault = true;
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
                const listenerTask = traceLightningStep(lightningTraceContext(), 'sdk.addEventListener', () => sdk.addEventListener({ onEvent: async (event: any) => {
                    lightningTrace({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'event', { tag: event.tag, accepted: current() && sdkRef.current === sdk, paymentStatus: event.inner?.payment?.status, paymentType: event.inner?.payment?.paymentType });
                    if (!current() || sdkRef.current !== sdk) return;
                    if (event.inner?.payment) {
                        void reconcileSalesPayments(walletId, [event.inner.payment]).catch(() => {});
                        void reconcileRefundPayments(walletId, [event.inner.payment]).catch(() => {});
                    }
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
                    // The SDK owns payment settlement. Its Synced event means the
                    // local store has changed, so refresh that store only. Calling
                    // syncWallet from a payment callback queues another full sync
                    // while the SDK is reconciling the same payment.
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
                const credentials = await readWalletCredentials(walletId);
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
        await assertNoActiveExit(activeWalletIdRef.current || undefined);
        assertCurrent();
        const req = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.receivePayment', () => sdk.receivePayment({
            paymentMethod: breezSdk.ReceivePaymentMethod.Bolt11Invoice.new({
                description: "Send to Trustless Wallet",
                amountSats: amountSats > 0 ? BigInt(amountSats) : undefined,
                expirySecs: undefined,
                paymentHash: undefined,
                receiverIdentityPublicKey: undefined,
            })
        })), 'Generating Lightning invoice');
        assertCurrent();
        return req.paymentRequest;
    }, []);

    const validateTerminalInvoice = async (invoice: string, amountSats: number): Promise<number> => {
        if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Invalid invoice amount.');
        const { sdk, assertCurrent } = requireLightningSession();
        const walletId = activeWalletIdRef.current;
        const parsed = await withDeadline(sdk.parse(invoice), 'Checking terminal invoice');
        assertCurrent();
        if (walletId !== activeWalletIdRef.current || parsed.tag !== breezSdk.InputType_Tags.Bolt11Invoice) throw new Error('Invalid invoice for this wallet.');
        const details = parsed.inner[0];
        const expectedNetwork = IS_TESTNET ? breezSdk.BitcoinNetwork.Testnet3 : breezSdk.BitcoinNetwork.Bitcoin;
        if (details.network !== expectedNetwork || details.amountMsat !== BigInt(amountSats) * 1000n ||
            normalizeInvoice(details.invoice.bolt11) !== normalizeInvoice(invoice)) {
            throw new Error('Invoice amount or network does not match the saved request.');
        }
        const expiresAtBig = (details.timestamp + details.expiry) * 1000n;
        if (expiresAtBig > BigInt(Number.MAX_SAFE_INTEGER) || expiresAtBig <= 0n) throw new Error('Invalid invoice expiry.');
        return Number(expiresAtBig);
    };

    const createTerminalInvoice = async (amountSats: number): Promise<{ invoice: string; expiresAt: number }> => {
        if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Enter a valid amount.');
        if (IS_TESTNET) throw new Error('Lightning checkout is unavailable on Testnet.');
        const { sdk, assertCurrent } = requireLightningSession();
        const walletId = activeWalletIdRef.current;
        if (!walletId || activeWallet?.type === 'watch-only') throw new Error('Open a signing wallet first.');
        await assertNoActiveExit(walletId);
        assertCurrent();
        const response = await withDeadline(sdk.receivePayment({
            paymentMethod: breezSdk.ReceivePaymentMethod.Bolt11Invoice.new({
                description: 'Trustless terminal payment', amountSats: BigInt(amountSats),
                expirySecs: undefined, paymentHash: undefined, receiverIdentityPublicKey: undefined,
            }),
        }), 'Generating terminal invoice');
        assertCurrent();
        if (walletId !== activeWalletIdRef.current) throw new Error('The active wallet changed. Please try again.');
        const invoice = response.paymentRequest;
        const expiresAt = await validateTerminalInvoice(invoice, amountSats);
        assertCurrent();
        if (expiresAt <= Date.now()) {
            throw new Error('Invoice is already expired or has an invalid expiry.');
        }
        return { invoice, expiresAt };
    };

    const verifyTerminalInvoice = async (invoice: string, createdAt: number, knownPaymentId?: string, includeUnfilteredFallback = false): Promise<{ status: 'received' | 'pending' | 'unknown'; paymentId?: string }> => {
        const { sdk, assertCurrent } = requireLightningSession();
        const walletId = activeWalletIdRef.current;
        const target = normalizeInvoice(invoice);
        if (!target) throw new Error('Missing invoice.');
        const evaluate = (payment: breezSdk.Payment) => matchTerminalPayment(
            payment, target, breezSdk.PaymentType.Receive,
            breezSdk.PaymentStatus.Completed, breezSdk.PaymentDetails_Tags.Lightning,
        );
        if (knownPaymentId) {
            const result = await withDeadline(sdk.getPayment({ paymentId: knownPaymentId }), 'Checking terminal payment');
            assertCurrent();
            if (walletId !== activeWalletIdRef.current) throw new Error('The active wallet changed.');
            const match = evaluate(result.payment);
            if (match) return match;
        }
        // A resumed request has no SDK payment ID. The SDK has no exact-invoice
        // filter, so restrict its bounded search to the invoice's lifetime. A
        // five-minute allowance keeps the lookup safe if the device clock was
        // slightly wrong when the request was saved.
        const findMatchingPayment = async (fromTimestamp: bigint | undefined) => {
            for (let offset = 0; offset < 250; offset += 50) {
                const result = await withDeadline(sdk.listPayments({
                    offset, limit: 50, sortAscending: false,
                    typeFilter: [breezSdk.PaymentType.Receive], statusFilter: undefined,
                    assetFilter: new breezSdk.AssetFilter.Bitcoin(),
                    paymentDetailsFilter: [breezSdk.PaymentDetailsFilter.Lightning.new({ htlcStatus: undefined })],
                    fromTimestamp, toTimestamp: undefined,
                }), 'Checking terminal payments');
                assertCurrent();
                if (walletId !== activeWalletIdRef.current) throw new Error('The active wallet changed.');
                for (const payment of result.payments) {
                    const match = evaluate(payment);
                    if (match) return match;
                }
                if (result.payments.length < 50) break;
            }
            return null;
        };
        const fromTimestamp = BigInt(Math.max(0, Math.floor(createdAt / 1000) - 300));
        const recentMatch = await findMatchingPayment(fromTimestamp);
        if (recentMatch) return recentMatch;
        // The time-window scan is normally sufficient. A periodic full scan
        // keeps a request recoverable if its device clock was badly wrong when
        // it was saved, without making every six-second poll expensive.
        if (includeUnfilteredFallback) {
            const fallbackMatch = await findMatchingPayment(undefined);
            if (fallbackMatch) return fallbackMatch;
        }
        return { status: 'unknown' };
    };

    const prepareTerminalRefund = async (invoice: string, amountSats: number): Promise<TerminalRefundQuote> => {
      try {
        if (!Number.isSafeInteger(amountSats) || amountSats <= 0) preflightRefund('Enter a valid refund amount.');
        const { sdk, version, assertCurrent } = requireLightningSession();
        const walletId = activeWalletIdRef.current;
        if (!walletId || activeWallet?.type === 'watch-only') preflightRefund('Open a signing wallet first.');
        if (paymentInFlightRef.current || recoveryModeRef.current) preflightRefund('Another wallet operation is running.');
        await assertNoActiveExit(walletId);
        assertCurrent();
        const cleanInvoice = invoice.replace(/^lightning:/i, '').trim();
        const parsed = await withDeadline(sdk.parse(cleanInvoice), 'Checking refund invoice');
        assertCurrent();
        const invoiceExpiry = checkedRefundInvoice(parsed, cleanInvoice, amountSats,
            IS_TESTNET ? breezSdk.BitcoinNetwork.Testnet3 : breezSdk.BitcoinNetwork.Bitcoin);
        const response = await withDeadline(sdk.prepareSendPayment({
            paymentRequest: breezSdk.PaymentRequest.Input.new({ input: cleanInvoice }),
            amount: undefined, tokenIdentifier: undefined, conversionOptions: undefined,
            feePolicy: breezSdk.FeePolicy.FeesExcluded,
        }), 'Preparing refund');
        assertCurrent();
        const feeSats = checkedRefundQuote(response, cleanInvoice, amountSats);
        const expiresAt = Math.min(invoiceExpiry, Date.now() + 120000);
        if (expiresAt <= Date.now()) preflightRefund('Refund invoice has expired.');
        const quote: TerminalRefundQuote = { quoteId: uuidv4(), invoice: cleanInvoice, amountSats, feeSats, expiresAt };
        preparedRefundsRef.current.clear();
        preparedRefundsRef.current.set(quote.quoteId, { quote, response, sdk, walletId, version, used: false });
        return quote;
      } catch (error) {
        preflightRefund(lightningErrorMessage(error));
      }
    };

    const sendTerminalRefund = async (quoteId: string, attemptId: string): Promise<TerminalRefundResult> => {
        const prepared = preparedRefundsRef.current.get(quoteId);
        if (!prepared || prepared.used || prepared.quote.expiresAt <= Date.now()) preflightRefund('Refund quote expired. Prepare it again.');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)) preflightRefund('Invalid saved refund attempt.');
        const { sdk, version, assertCurrent } = (() => {
            try { return requireLightningSession(); }
            catch (error) { preflightRefund(lightningErrorMessage(error)); }
        })();
        if (sdk !== prepared.sdk || version !== prepared.version || activeWalletIdRef.current !== prepared.walletId ||
            activeWallet?.type === 'watch-only' || paymentInFlightRef.current || recoveryModeRef.current) {
            preflightRefund('The refund wallet changed. Prepare it again.');
        }
        const attempt = await getTerminalRefund(prepared.walletId, IS_TESTNET ? 'testnet' : 'mainnet', attemptId)
            .catch(error => preflightRefund(lightningErrorMessage(error)));
        try { assertCurrent(); } catch (error) { preflightRefund(lightningErrorMessage(error)); }
        if (!attempt || attempt.status !== 'unknown' || attempt.paymentId ||
            normalizeInvoice(attempt.invoice) !== normalizeInvoice(prepared.quote.invoice) ||
            attempt.amountSats !== prepared.quote.amountSats || attempt.feeSats !== prepared.quote.feeSats ||
            attempt.quoteExpiresAt !== prepared.quote.expiresAt || attempt.walletId !== prepared.walletId ||
            attempt.network !== (IS_TESTNET ? 'testnet' : 'mainnet') ||
            !attempt.saleId || !attempt.saleInvoice) preflightRefund('Saved refund attempt does not match the quote.');
        await assertNoActiveExit(prepared.walletId).catch(error => preflightRefund(lightningErrorMessage(error)));
        try { assertCurrent(); } catch (error) { preflightRefund(lightningErrorMessage(error)); }
        if (prepared.used || prepared.quote.expiresAt <= Date.now() || paymentInFlightRef.current) preflightRefund('Refund quote expired or another payment started.');
        let options: breezSdk.SendPaymentOptions;
        try { options = breezSdk.SendPaymentOptions.Bolt11Invoice.new({ preferSpark: false, completionTimeoutSecs: 10 }); }
        catch (error) { preflightRefund(lightningErrorMessage(error)); }
        // Consume the in-memory SDK response before the native call. A retry
        // needs explicit verification; it must never create a second send.
        prepared.used = true;
        paymentInFlightRef.current = true;
        let result: TerminalRefundResult;
        try {
            const sent = await sdk.sendPayment({
                prepareResponse: prepared.response,
                options,
                idempotencyKey: attempt.id,
            });
            result = matchRefundPayment(sent.payment, attempt.invoice, attempt.amountSats) || { status: 'unknown' };
        } catch {
            // A native error or timeout may occur after submission. Only an
            // authoritative SDK Failed payment can release the reservation.
            result = { status: 'unknown' };
        } finally {
            paymentInFlightRef.current = false;
        }
        await updateTerminalRefund(attempt, result);
        if (sdkRef.current === sdk && result.status === 'complete') void refreshLightningState().catch(() => {});
        return result;
    };

    const verifyTerminalRefund = async (invoice: string, createdAt: number, knownPaymentId?: string): Promise<TerminalRefundResult> => {
        const { sdk, assertCurrent } = requireLightningSession();
        const walletId = activeWalletIdRef.current;
        const attempt = await findTerminalRefundByInvoice(walletId || '', IS_TESTNET ? 'testnet' : 'mainnet', invoice);
        if (!attempt) preflightRefund('Saved refund attempt was not found.');
        assertCurrent();
        if (knownPaymentId) {
            const payment = await withDeadline(sdk.getPayment({ paymentId: knownPaymentId }), 'Checking refund payment').catch(() => null);
            assertCurrent();
            const result = matchRefundPayment(payment?.payment, invoice, attempt.amountSats);
            if (result && (result.status !== 'failed' || attempt.paymentId === result.paymentId)) return result;
        }
        // Bounded, user-triggered lookup. An empty or mismatched result never
        // proves failure and must leave the refund reserved.
        for (let offset = 0; offset < 250; offset += 50) {
            const page = await withDeadline(sdk.listPayments({
                offset, limit: 50, sortAscending: false,
                typeFilter: [breezSdk.PaymentType.Send], statusFilter: undefined,
                assetFilter: new breezSdk.AssetFilter.Bitcoin(),
                paymentDetailsFilter: [breezSdk.PaymentDetailsFilter.Lightning.new({ htlcStatus: undefined })],
                fromTimestamp: BigInt(Math.max(0, Math.floor(createdAt / 1000) - 300)), toTimestamp: undefined,
            }), 'Checking refund payments');
            assertCurrent();
            if (walletId !== activeWalletIdRef.current) preflightRefund('The active wallet changed.');
            for (const payment of page.payments) {
                const result = matchRefundPayment(payment, invoice, attempt.amountSats);
                if (result && (result.status !== 'failed' || attempt.paymentId === result.paymentId)) return result;
            }
            if (page.payments.length < 50) break;
        }
        return { status: 'unknown' };
    };

    const runLightningRecovery: RunExit = async (operation, recoveryOnly = false) => {
        if (IS_TESTNET) throw new Error('Unilateral recovery currently supports Bitcoin mainnet only.');
        let { sdk, assertCurrent } = requireLightningSession();
        if (!activeWallet || activeWallet.type === 'watch-only') throw new Error('Open a signing wallet first.');
        if (paymentInFlightRef.current) throw new Error('Another wallet operation is running.');
        paymentInFlightRef.current = true;
        try {
            const wallet = activeWallet;
            if (recoveryOnly && !recoveryModeRef.current) {
                const credentials = await readWalletCredentials(wallet.id);
                if (!credentials) throw new Error('Wallet credentials are unavailable.');
                const version = ++lightningInitVersionRef.current;
                resetLightningState();
                setIsLightningInitialized(false);
                await disposeActiveLightningNode();
                await initLightningNode(credentials.password, wallet.id, version, true);
                ({ sdk, assertCurrent } = requireLightningSession());
            }
            const root = await getRootNode(wallet);
            assertCurrent();
            return await operation({ sdk, wallet, root, assertCurrent });
        } finally {
            try {
                const saved = await loadExit(activeWallet.id);
                if (recoveryModeRef.current && (!saved || saved.phase === 'done')) {
                    const credentials = await readWalletCredentials(activeWallet.id);
                    if (!credentials) throw new Error('Wallet credentials are unavailable.');
                    const version = ++lightningInitVersionRef.current;
                    resetLightningState();
                    setIsLightningInitialized(false);
                    await disposeActiveLightningNode();
                    await initLightningNode(credentials.password, activeWallet.id, version);
                }
            } finally {
                paymentInFlightRef.current = false;
                void refreshLightningState(!recoveryModeRef.current).catch(() => {});
            }
        }
    };

    const payLightningInvoice = async (invoiceStr: string, amountSats?: number): Promise<LightningTransaction> => {
        const { sdk, assertCurrent } = requireLightningSession();
        if (paymentInFlightRef.current) throw new Error('A payment is already in progress.');
        paymentInFlightRef.current = true;
        let completedPayment = false;
        try {
            await assertNoActiveExit(activeWalletIdRef.current || undefined);
            assertCurrent();
            const cleanStr = invoiceStr.replace(/^lightning:/i, '').trim();
            const parsed = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.parse', () => sdk.parse(cleanStr)), 'Reading Lightning payment');
            assertCurrent();
            let payment: breezSdk.Payment;
            if (parsed.tag === breezSdk.InputType_Tags.Bolt11Invoice) {
                const quote = await withDeadline(traceLightningStep(lightningTraceContext(), 'sdk.prepareSendPayment', () => sdk.prepareSendPayment({
                    paymentRequest: breezSdk.PaymentRequest.Input.new({ input: cleanStr }),
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
            completedPayment = transaction.status === 'complete';
            // Publish the authoritative receipt immediately; a blocked history read
            // must not keep a completed payment in the sending state.
            if (sdkRef.current === sdk) {
                ++historyRevisionRef.current;
                setLightningTransactions(previous => [transaction, ...previous.filter(tx => tx.paymentHash !== transaction.paymentHash)]);
            }
            return transaction;
        } catch (error) {
            // React Native surfaces only the outer SdkError in the alert. Preserve
            // the safe native cause so a payment failure is actionable.
            throw new Error(lightningErrorMessage(error));
        } finally {
            paymentInFlightRef.current = false;
            // A failed or pending send can leave a short-lived SDK reservation in
            // its local balance. Do not publish that intermediate value as the
            // wallet balance. Payment events reconcile those states; a completed
            // receipt can safely refresh the settled balance.
            if (completedPayment) {
                void refreshLightningState().catch(error => console.warn('Payment display refresh failed:', error));
            }
        }
    };

    const estimateLightningFee = useCallback(async (invoiceStr: string, amountSats?: number): Promise<number | null> => {
        if (paymentInFlightRef.current || recoveryModeRef.current) return null;
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
                paymentRequest: breezSdk.PaymentRequest.Input.new({ input: cleanStr }), amount: amountSats && amountSats > 0 ? BigInt(amountSats) : undefined,
                tokenIdentifier: undefined, conversionOptions: undefined, feePolicy: undefined,
            })), 'Estimating Lightning fee');
            assertCurrent();
            const method = quote.paymentMethod;
            if (method.tag === breezSdk.SendPaymentMethod_Tags.Bolt11Invoice) return Number(method.inner.lightningFeeSats);
            if (method.tag === breezSdk.SendPaymentMethod_Tags.SparkAddress || method.tag === breezSdk.SendPaymentMethod_Tags.SparkInvoice) return Number(method.inner.fee);
            return null;
        } catch { return null; }
    }, []);

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
                paymentRequest: breezSdk.PaymentRequest.Input.new({ input: address }), amount: BigInt(amountSats),
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
            await assertNoActiveExit(activeWalletIdRef.current || undefined);
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
            const credentials = await readWalletCredentials(wallet.id);
            if (!credentials) throw new Error(`Mnemonic not found for wallet ${wallet.id}`);
            const mnemonic = credentials.password;
            const seed = bip39.mnemonicToSeedSync(mnemonic);
            return bip32.fromSeed(seed, NETWORK);
        }
    };

    const loadAndSetActiveWallet = async (walletId: string): Promise<boolean> => {
        const loadStarted = Date.now();
        const generation = ++walletGenerationRef.current;
        const networkName = NETWORK_NAME;
        const current = () => generation === walletGenerationRef.current && networkName === NETWORK_NAME;
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
        if (!wallet || !current()) return false;

        try {
            const root = await getRootNode(wallet);
            if (!current()) return false;
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
                    if (!current()) return false;
                    const index_to_derive = receive_index + i;
                    const derived = deriveReceiveAddress(root, index_to_derive, is_watch_only, script_type);
                    if (derived) {
                        if (!current()) return false;
                        await dbSaveAddress(walletId, derived, 0, networkName);
                        if (!current()) return false;
                        current_batch.push(derived.address);
                        wallet!.derivedReceiveAddresses.push(derived);
                        derived_new = true;
                    }
                }

                const usage_results = await checkUsage(current_batch);
                if (!current()) return false;

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
                    if (!current()) return false;
                    const index_to_derive = change_index + i;
                    const derived = deriveChangeAddress(root, index_to_derive, is_watch_only, script_type);
                    if (derived) {
                        if (!current()) return false;
                        await dbSaveAddress(walletId, derived, 1, networkName);
                        if (!current()) return false;
                        current_batch.push(derived.address);
                        wallet!.derivedChangeAddresses.push(derived);
                        derived_new = true;
                    }
                }

                const usage_results = await checkUsage(current_batch);
                if (!current()) return false;

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
                if (!current() || initVersion !== lightningInitVersionRef.current) return false;
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
                            const credentials = await traceLightningStep({ wallet: lightningWalletLabel(walletId), session: initVersion }, 'credentials.lookup', () => readWalletCredentials(walletId), value => ({ found: !!value }));
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

    const getOrCreateNextUnusedReceiveAddress = async (_currentAddress: string, currentIndex: number): Promise<{ address: string, index: number } | null> => {
        const wallet = activeWallet;
        const generation = walletGenerationRef.current;
        const networkName = NETWORK_NAME;
        const current = () => !!wallet && generation === walletGenerationRef.current &&
            networkName === NETWORK_NAME && activeWalletIdRef.current === wallet.id;
        if (!wallet || !current()) return null;
        const addresses = wallet.derivedReceiveAddresses;
        const next = addresses.filter(a => a.index > currentIndex).sort((a, b) => a.index - b.index)[0];
        if (next) return next;
        return receiveDerivationsRef.current.run(JSON.stringify([wallet.id, generation, networkName]), async () => {
            try {
                const root = await getRootNode(wallet);
                if (!current()) return null;
                const nextIndex = Math.max(-1, ...addresses.map(a => a.index)) + 1;
                if (!Number.isSafeInteger(nextIndex) || nextIndex >= 0x80000000) throw new Error('Receive address index exhausted.');
                const derived = deriveReceiveAddress(root, nextIndex, wallet.type === 'watch-only', wallet.scriptType || 'p2wpkh');
                if (!derived || !current()) return null;
                await dbSaveAddress(wallet.id, derived, 0, networkName);
                if (!current()) return null;
                setActiveWallet(prev => {
                    if (!current() || !prev || prev.id !== wallet.id || prev.derivedReceiveAddresses.some(a => a.index === derived.index)) return prev;
                    return { ...prev,
                        derivedReceiveAddresses: [...prev.derivedReceiveAddresses, derived],
                        derivedAddressInfoCache: [...prev.derivedAddressInfoCache, { address: derived.address, index: derived.index, balance: 0, tx_count: 0 }],
                    };
                });
                return derived;
            } catch (error) {
                if (current()) console.warn('Could not generate the next receive address.');
                return null;
            }
        });
    };

    const generateMnemonic = async (strength: number = 128): Promise<string | null> => {
        try {
            return generateWalletMnemonic(strength);
        } catch (error) {
            console.error("Failed to create mnemonic", error);
            return null;
        }
    };

    const addWallet = async (params: { mnemonic?: string; xpub?: string; type?: 'standard' | 'watch-only'; name?: string; fingerprint?: string; derivation_path?: string; }): Promise<Wallet | null> => {
        if (paymentInFlightRef.current || switchingRef.current) throw new Error('Please wait for the current wallet operation to finish.');
        const { name } = params;
        const mnemonic = params.type === 'watch-only' ? undefined : canonicalMnemonic(params.mnemonic ?? '');
        const type = params.type || 'standard';
        let walletXpub = params.xpub;
        let fingerprint = params.fingerprint;
        let derivation_path = params.derivation_path;

        let scriptType: 'p2wpkh' | 'p2sh-p2wpkh' = 'p2wpkh';
        if (type !== 'standard' && type !== 'watch-only') throw new Error('Unsupported wallet type.');
        if (type === 'watch-only') {
            const checked = validateWatchOnlyImport(walletXpub ?? '', fingerprint ?? '', derivation_path ?? '', NETWORK);
            walletXpub = checked.xpub;
            fingerprint = checked.fingerprint;
            derivation_path = checked.derivation_path;
            scriptType = checked.scriptType;
        }
        const importNetwork = NETWORK_NAME;
        const assertImportNetwork = () => { if (NETWORK_NAME !== importNetwork) throw new Error('Network changed. Please import the wallet again.'); };

        try {

            if (type === 'standard' && mnemonic) {
                const seed = bip39.mnemonicToSeedSync(mnemonic);
                const root = bip32.fromSeed(seed, NETWORK);
                try {
                    const accountNode = root.derivePath(DERIVATION_PARENT_PATH);
                    walletXpub = accountNode.neutered().toBase58();
                    scriptType = 'p2wpkh';

                    fingerprint = root.fingerprint.toString('hex');
                    derivation_path = DERIVATION_PARENT_PATH;
                } catch (err) {
                    throw new Error('Could not derive the wallet account.');
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
            throw new Error('Could not validate the wallet before import.');
        }
        assertImportNetwork();

        const isFirstWallet = wallets.length === 0;
        const defaultName = name || `Wallet ${wallets.length + 1}`;
        const newWalletId = uuidv4();

        if (type === 'standard' && mnemonic) {
            await storeWalletMnemonic(newWalletId, mnemonic);
        }
        assertImportNetwork();

        await dbCreateWallet(newWalletId, defaultName, importNetwork, type, walletXpub, scriptType, fingerprint, derivation_path);

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
        await assertNoActiveExit(walletId);
        await removeTerminalRefunds(walletId, NETWORK_NAME);
        await removeTerminalSales(walletId, NETWORK_NAME);
        await removeTerminalItems(walletId, NETWORK_NAME);
        if (activeWalletIdRef.current === walletId) {
            ++walletGenerationRef.current;
            activeWalletIdRef.current = null;
            setActiveWallet(null);
        }
        await dbDeleteWallet(walletId);
        await deleteWalletMnemonic(walletId);

        const remaining = await dbGetWallets(NETWORK_NAME);
        setWallets(remaining);

        if (activeWallet?.id === walletId) {
            if (remaining.length > 0) {
                await switchWallet(remaining[0].id);
            } else {
                activeWalletIdRef.current = null;
                ++walletGenerationRef.current;
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
            const credentials = await readWalletCredentials(walletId);
            return credentials ? credentials.password : null;
        } catch (error) { return null; }
    };

    const resetWallet = async () => {
        await assertNoActiveExit();
        if (paymentInFlightRef.current || switchingRef.current) throw new Error('Please wait for the current wallet operation to finish.');
        activeWalletIdRef.current = null;
        ++walletGenerationRef.current;
        ++lightningInitVersionRef.current;
        resetLightningState();
        await disposeActiveLightningNode();
        const d = await dbGetWallets(NETWORK_NAME);
        for (const w of d) {
            await removeTerminalRefunds(w.id, NETWORK_NAME);
            await removeTerminalSales(w.id, NETWORK_NAME);
            await removeTerminalItems(w.id, NETWORK_NAME);
            await deleteWalletMnemonic(w.id);
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
        const wallet = activeWallet;
        const networkName = NETWORK_NAME;
        const generation = walletGenerationRef.current;
        const assertCurrent = () => {
            if (generation !== walletGenerationRef.current || networkName !== NETWORK_NAME || activeWalletIdRef.current !== wallet.id)
                throw new Error('The active wallet or network changed. Please review the transaction again.');
        };
        assertCurrent();
        if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(feeRate) || feeRate <= 0 || !utxos.length)
            throw new Error('Invalid transaction amount, fee rate or inputs.');
        if (paymentInFlightRef.current) throw new Error("Another wallet operation is running.");
        await assertNoActiveExit(activeWallet.id);
        if (activeWallet.type === 'watch-only') throw new Error("Watch-only wallets cannot sign transactions.");

        assertCurrent();
        const credentials = await readWalletCredentials(wallet.id);
        assertCurrent();
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
                assertCurrent();
                await dbSaveAddress(wallet.id, derived, 1, networkName);
                assertCurrent();
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

            assertCurrent();
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
        createTerminalInvoice,
        validateTerminalInvoice,
        verifyTerminalInvoice,
        prepareTerminalRefund,
        sendTerminalRefund,
        verifyTerminalRefund,
        runLightningRecovery,
        payLightningInvoice,
        estimateLightningFee,
        getLightningTopUpAddress,
        prepareWithdrawToOnchain,
        withdrawToOnchain,
    };

    return <WalletContext.Provider value={value}>
        <ActiveWalletProvider value={activeWallet}>{children}</ActiveWalletProvider>
    </WalletContext.Provider>;
};

export const useWallet = (): WalletContextType => {
    const context = useContext(WalletContext);
    if (context === undefined) {
        throw new Error('useWallet must be used within a WalletProvider');
    }
    return context;
};

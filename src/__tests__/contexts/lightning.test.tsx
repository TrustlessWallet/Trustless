import React, { memo } from 'react';
import { act, render, renderHook, waitFor, cleanup } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider, useWallet, useActiveWallet } from '../../contexts/WalletContext';
import { WalletModeProvider, useWalletMode } from '../../contexts/WalletModeContext';
import * as Keychain from 'react-native-keychain';
import { dbSaveAddress, dbDeleteWallet, dbGetWallets } from '../../services/database';
import * as sdkModule from '@breeztech/breez-sdk-spark-react-native';
import * as refundJournal from '../../services/terminalRefunds';

jest.mock('../../services/exitStorage', () => ({ assertNoActiveExit: jest.fn(async () => {}), loadExit: jest.fn(async () => null) }));
jest.mock('uuid', () => ({ v4: () => '123e4567-e89b-42d3-a456-426614174000' }));
jest.mock('react-native-keychain', () => ({
    getGenericPassword: jest.fn(async ({ service }) => ({ password: service.includes('activeWalletId') ? 'a' : 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' })),
    setGenericPassword: jest.fn(async () => true), resetGenericPassword: jest.fn(async () => true),
}));
jest.mock('../../services/database', () => ({
    dbGetWallets: jest.fn(async () => ['a', 'b'].map(id => ({ id, name: id, type: 'standard', nextUtxoCount: 0 }))),
    dbGetDerivedAddresses: jest.fn(async (id, chain) => Array.from({ length: 20 }, (_, index) => ({ address: `${id}-${chain}-${index}`, index }))),
    dbGetAddressCache: jest.fn(async () => []), dbGetUtxoLabels: jest.fn(async () => ({})),
    dbDeleteWallet: jest.fn(),
    dbGetSavedAddresses: jest.fn(async () => []), dbUpdateAddressInfoBatch: jest.fn(), dbSaveAddress: jest.fn(),
}));
jest.mock('../../hooks/useBalance', () => ({
    useWalletBalanceSync: () => ({ data: undefined }), useAddressListSync: () => ({ data: undefined }),
}));
jest.mock('../../services/bitcoin', () => ({ fetchAddressInfoBatch: jest.fn(async () => []), fetchUTXOs: jest.fn(async () => []) }));
jest.mock('expo-file-system', () => ({
    Paths: { document: { uri: 'file:///test/' } },
    Directory: class { uri: string; constructor(uri: string) { this.uri = uri; } async info() { return { exists: true }; } },
}));
jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
    connect: jest.fn(), defaultConfig: () => ({}), Network: { Mainnet: 'mainnet' },
    MaxFee: { NetworkRecommended: class {} }, Seed: { Mnemonic: { new: (value: any) => value } },
    AssetFilter: { Bitcoin: class {} },
    PaymentDetailsFilter: { Lightning: { new: (value: any) => value } },
    PaymentStatus: { Completed: 0, Pending: 1, Failed: 2 }, PaymentType: { Receive: 0, Send: 1 },
    InputType_Tags: { Bolt11Invoice: 'Bolt11Invoice', LightningAddress: 'LightningAddress', LnurlPay: 'LnurlPay' },
    SendPaymentMethod_Tags: { Bolt11Invoice: 'Bolt11Invoice', SparkAddress: 'SparkAddress', SparkInvoice: 'SparkInvoice' },
    SendPaymentOptions: { Bolt11Invoice: { new: (value: any) => value } },
    FeePolicy: { FeesExcluded: 0 }, BitcoinNetwork: { Bitcoin: 0, Testnet3: 1 },
    PaymentDetails_Tags: { Lightning: 'Lightning' },
    PaymentRequest: { Input: { new: (value: any) => ({ tag: 'Input', inner: value }) } },
    SdkEvent_Tags: { Synced: 'Synced', PaymentPending: 'PaymentPending', PaymentSucceeded: 'PaymentSucceeded', PaymentFailed: 'PaymentFailed', LightningAddressChanged: 'LightningAddressChanged' },
    ReceivePaymentMethod: { Bolt11Invoice: { new: (value: any) => value }, BitcoinAddress: { new: (value: any) => value } },
}));

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const payment = (id = 'payment-1', status = 0) => ({ id, status, paymentType: 1, amount: 123n, fees: 2n, timestamp: 1234n, method: 0 });
function session(balance = 100) {
    let listener: any;
    return {
        getInfo: jest.fn(async () => ({ balanceSats: BigInt(balance) })),
        listPayments: jest.fn(async (_request?: any) => ({ payments: [] as any[] })),
        getLightningAddress: jest.fn(async () => ({ lightningAddress: 'test@example.test' })),
        syncWallet: jest.fn(async () => ({})), disconnect: jest.fn(async () => {}),
        addEventListener: jest.fn(async (value: any) => { listener = value; return 'listener'; }),
        removeEventListener: jest.fn(async () => true),
        receivePayment: jest.fn(async () => ({ paymentRequest: 'invoice' })),
        registerLightningAddress: jest.fn(async () => ({ lightningAddress: 'new@example.test' })),
        parse: jest.fn(async () => ({ tag: 'Bolt11Invoice' })),
        prepareSendPayment: jest.fn(async () => ({ amount: 123n })),
        sendPayment: jest.fn(async () => ({ payment: payment() })),
        getLeafOptimizationProgress: jest.fn(() => ({ isRunning: false, currentRound: 0, totalRounds: 0 })),
        cancelLeafOptimization: jest.fn(async () => {}),
        prepareLnurlPay: jest.fn(async (_request?: any) => ({})),
        lnurlPay: jest.fn(async () => ({ payment: payment() })),
        emit: (event: any) => listener.onEvent(event),
    };
}
let a: ReturnType<typeof session>;
let b: ReturnType<typeof session>;
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><WalletProvider>{children}</WalletProvider></QueryClientProvider>;
async function connected() {
    const hook = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLightningInitialized).toBe(true));
    await waitFor(() => expect(hook.result.current.lightningSyncing).toBe(false));
    return hook;
}
beforeEach(() => {
    process.env.EXPO_PUBLIC_BREEZ_API_KEY = 'test';
    a = session(100); b = session(900);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    (sdkModule.connect as jest.Mock).mockImplementation(async ({ storageDir }) => storageDir.endsWith('/a') ? a : b);
});
afterEach(async () => { cleanup(); client.clear(); jest.restoreAllMocks(); jest.useRealTimers(); });

const refundInvoice = 'lnbc123refund';
function mockRefundPreparation() {
    const now = BigInt(Math.floor(Date.now() / 1000));
    a.parse.mockResolvedValue({ tag: 'Bolt11Invoice', inner: [{ network: 0, amountMsat: 123000n,
        timestamp: now, expiry: 3600n, invoice: { bolt11: refundInvoice } }] });
    a.prepareSendPayment.mockResolvedValue({ paymentMethod: { tag: 'Bolt11Invoice', inner: {
        invoiceDetails: { invoice: { bolt11: refundInvoice } }, lightningFeeSats: 7n,
    } }, amount: 123n, tokenIdentifier: undefined, conversionEstimate: undefined, feePolicy: 0 });
}

it('sends only the saved refund attempt with its ID as the SDK idempotency key', async () => {
    const hook = await connected();
    mockRefundPreparation();
    const quote = await hook.result.current.prepareTerminalRefund(refundInvoice, 123);
    const attempt: any = { id: '123e4567-e89b-42d3-a456-426614174001', walletId: 'a', network: 'mainnet',
        saleId: 'sale', saleInvoice: 'lnbcsale', invoice: refundInvoice, amountSats: 123,
        feeSats: 7, quoteExpiresAt: quote.expiresAt, status: 'unknown' };
    jest.spyOn(refundJournal, 'listTerminalRefunds').mockResolvedValue([attempt]);
    jest.spyOn(refundJournal, 'updateTerminalRefund').mockResolvedValue(attempt);
    a.sendPayment.mockRejectedValueOnce(new Error('native timeout'));
    const result = await hook.result.current.sendTerminalRefund(quote.quoteId, attempt.id);
    expect(result).toEqual({ status: 'unknown' });
    expect(a.sendPayment).toHaveBeenCalledWith({
        prepareResponse: expect.objectContaining({ amount: 123n }),
        options: { preferSpark: false, completionTimeoutSecs: 10 }, idempotencyKey: attempt.id,
    });
    await expect(hook.result.current.sendTerminalRefund(quote.quoteId, attempt.id)).rejects.toMatchObject({ mayHaveSent: false });
    expect(a.sendPayment).toHaveBeenCalledTimes(1);
});

it('rejects an unmatched durable attempt before invoking the SDK', async () => {
    const hook = await connected();
    mockRefundPreparation();
    const quote = await hook.result.current.prepareTerminalRefund(refundInvoice, 123);
    jest.spyOn(refundJournal, 'listTerminalRefunds').mockResolvedValue([]);
    await expect(hook.result.current.sendTerminalRefund(quote.quoteId, '123e4567-e89b-42d3-a456-426614174001'))
        .rejects.toMatchObject({ mayHaveSent: false });
    expect(a.sendPayment).not.toHaveBeenCalled();
});

it('invalidates a prepared refund when the active wallet changes', async () => {
    const hook = await connected();
    mockRefundPreparation();
    const quote = await hook.result.current.prepareTerminalRefund(refundInvoice, 123);
    await act(async () => { await hook.result.current.switchWallet('b'); });
    await expect(hook.result.current.sendTerminalRefund(quote.quoteId, '123e4567-e89b-42d3-a456-426614174001'))
        .rejects.toMatchObject({ mayHaveSent: false });
    expect(a.sendPayment).not.toHaveBeenCalled();
    expect(b.sendPayment).not.toHaveBeenCalled();
});

it('connects the active wallet and explicitly synchronizes its balance', async () => {
    const { result } = await connected();
    expect(result.current.activeWallet?.id).toBe('a');
    expect(result.current.lightningBalance).toBe(100);
    expect(a.syncWallet).toHaveBeenCalledTimes(1);
    expect(result.current.lightningLastSyncedAt).not.toBeNull();
});

it('keeps active-wallet readers still through Lightning-only updates and delivers real wallet switches', async () => {
    const broadAddresses: string[] = [];
    const narrowWallets: ReturnType<typeof useActiveWallet>[] = [];
    const modeRenders: string[] = [];
    let broad!: ReturnType<typeof useWallet>;
    const BroadReader = memo(() => {
        broad = useWallet();
        broadAddresses.push(broad.lightningAddress);
        return null;
    });
    const WalletReader = memo(() => {
        narrowWallets.push(useActiveWallet());
        return null;
    });
    const ModeReader = memo(() => {
        modeRenders.push(useWalletMode().mode);
        return null;
    });
    const view = render(<QueryClientProvider client={client}><WalletProvider>
        <BroadReader />
        <WalletReader />
        <WalletModeProvider><ModeReader /></WalletModeProvider>
    </WalletProvider></QueryClientProvider>);
    await waitFor(() => expect(broad.isLightningInitialized).toBe(true));
    await waitFor(() => expect(broad.lightningSyncing).toBe(false));
    await waitFor(() => expect(modeRenders.length).toBeGreaterThan(0));
    expect(narrowWallets.at(-1)).toBe(broad.activeWallet);
    const narrowBefore = narrowWallets.length;
    const broadBefore = broadAddresses.length;
    const modeBefore = modeRenders.length;
    await act(async () => { await a.emit({ tag: 'LightningAddressChanged', inner: { lightningAddress: { lightningAddress: 'one@example.test' } } }); });
    await act(async () => { await a.emit({ tag: 'LightningAddressChanged', inner: { lightningAddress: { lightningAddress: 'two@example.test' } } }); });
    expect(broad.lightningAddress).toBe('two@example.test');
    expect(broadAddresses.length).toBeGreaterThanOrEqual(broadBefore + 2);
    expect(narrowWallets).toHaveLength(narrowBefore);
    expect(modeRenders).toHaveLength(modeBefore);
    expect(narrowWallets.at(-1)).toBe(broad.activeWallet);

    await act(async () => { await broad.switchWallet('b'); });
    await waitFor(() => expect(broad.activeWallet?.id).toBe('b'));
    expect(narrowWallets.at(-1)).toBe(broad.activeWallet);
    expect(narrowWallets.length).toBeGreaterThan(narrowBefore);
    view.unmount();
});

it('creates the default invoice only after the initial Lightning sync completes', async () => {
    const sync = deferred<any>();
    a.syncWallet.mockReturnValue(sync.promise);
    const hook = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLightningInitialized).toBe(true));
    expect(a.receivePayment).not.toHaveBeenCalled();
    await act(async () => { sync.resolve({}); });
    await waitFor(() => expect(a.receivePayment).toHaveBeenCalledTimes(1));
});

it('loads a payment received while wallet B was inactive after switching A to B', async () => {
    b.listPayments.mockResolvedValue({ payments: [{ ...payment('incoming'), paymentType: 0 }] });
    const { result } = await connected();
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    expect(result.current.activeWallet?.id).toBe('b');
    expect(result.current.lightningTransactions[0].paymentHash).toBe('incoming');
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(b.syncWallet).toHaveBeenCalledTimes(1);
});

it('does not let an old-wallet balance response overwrite the new wallet', async () => {
    const { result } = await connected();
    const old = deferred<any>(); a.getInfo.mockReturnValue(old.promise);
    await act(async () => { await a.emit({ tag: 'Synced' }); });
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    await act(async () => { old.resolve({ balanceSats: 99999n }); });
    expect(result.current.lightningBalance).toBe(900);
});

it('updates balance even when an earlier history request is stuck', async () => {
    const { result } = await connected();
    const history = deferred<any>(); a.listPayments.mockReturnValue(history.promise);
    await act(async () => { await a.emit({ tag: 'Synced' }); });
    a.getInfo.mockResolvedValue({ balanceSats: 777n });
    await act(async () => { await a.emit({ tag: 'Synced' }); });
    expect(result.current.lightningBalance).toBe(777);
    await act(async () => { history.resolve({ payments: [] }); });
});

it('falls back to an unfiltered lookup for a terminal request that may have been saved with a wrong device clock', async () => {
    const { result } = await connected();
    a.listPayments.mockClear();
    await act(async () => {
        await result.current.verifyTerminalInvoice('lnbc123abc', 1_000_000, undefined, true);
    });
    expect(a.listPayments).toHaveBeenNthCalledWith(1, expect.objectContaining({ fromTimestamp: 700n }));
    expect(a.listPayments).toHaveBeenNthCalledWith(2, expect.objectContaining({ fromTimestamp: undefined }));
});

it('returns refresh promptly while a slow synchronization continues in the background', async () => {
    const { result } = await connected();
    jest.useFakeTimers();
    const sync = deferred<any>(); a.syncWallet.mockReturnValue(sync.promise);
    const before = a.syncWallet.mock.calls.length;
    await act(async () => {
        const refresh = result.current.triggerRefresh('lightning');
        await Promise.resolve(); await Promise.resolve();
        await refresh;
    });
    expect(result.current.lightningSyncing).toBe(true);
    expect(result.current.lightningSyncError).toBeNull();
    expect(a.syncWallet).toHaveBeenCalledTimes(before + 1);
    await act(async () => { sync.resolve({}); await Promise.resolve(); });
    await waitFor(() => expect(result.current.lightningSyncing).toBe(false));
});

it('does not queue another native synchronization while one is already running', async () => {
    const { result } = await connected();
    const sync = deferred<any>(); a.syncWallet.mockReturnValue(sync.promise);
    const before = a.syncWallet.mock.calls.length;
    await act(async () => {
        await result.current.triggerRefresh('lightning');
        await result.current.triggerRefresh('lightning');
    });
    expect(a.syncWallet).toHaveBeenCalledTimes(before + 1);
    await act(async () => { sync.resolve({}); });
    await waitFor(() => expect(result.current.lightningSyncing).toBe(false));
});

it('does not start a full synchronization from a payment event', async () => {
    await connected();
    const before = a.syncWallet.mock.calls.length;
    await act(async () => {
        await a.emit({ tag: 'PaymentPending', inner: { payment: payment('incoming', 1) } });
        await Promise.resolve();
    });
    expect(a.syncWallet).toHaveBeenCalledTimes(before);
});

it('defers a wallet refresh while a Lightning send is in progress', async () => {
    const { result } = await connected();
    const send = deferred<any>();
    a.sendPayment.mockReturnValue(send.promise);
    let paymentTask!: Promise<any>;
    await act(async () => { paymentTask = result.current.payLightningInvoice('lnbc-test'); });
    const before = a.syncWallet.mock.calls.length;
    await act(async () => { await result.current.triggerRefresh('lightning'); });
    expect(a.syncWallet).toHaveBeenCalledTimes(before);
    await act(async () => { send.resolve({ payment: payment() }); await paymentTask; });
});

it('does not wait for on-chain queries during Lightning refresh', async () => {
    const { result } = await connected();
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    await act(async () => { await result.current.triggerRefresh('lightning'); });
    expect(invalidate).not.toHaveBeenCalled();
});

it('keeps fee estimation stable across Lightning balance refreshes', async () => {
    const { result } = await connected();
    const estimate = result.current.estimateLightningFee;
    await act(async () => { await result.current.triggerRefresh('lightning'); });
    expect(result.current.estimateLightningFee).toBe(estimate);
});

it('uses a typed payment request when preparing a Lightning fee estimate', async () => {
    const { result } = await connected();
    await act(async () => { await result.current.estimateLightningFee('lnbc-test'); });
    expect(a.prepareSendPayment).toHaveBeenCalledWith(expect.objectContaining({
        paymentRequest: { tag: 'Input', inner: { input: 'lnbc-test' } },
    }));
});

it('retries failed initialization on pull-to-refresh', async () => {
    (sdkModule.connect as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.lightningInitError).toBe('Offline'));
    await act(async () => { await result.current.triggerRefresh('lightning'); });
    expect(result.current.isLightningInitialized).toBe(true);
    expect(result.current.lightningBalance).toBe(100);
});

it('rejects stale address registration without changing the new wallet address', async () => {
    const { result } = await connected();
    const registration = deferred<any>(); a.registerLightningAddress.mockReturnValue(registration.promise);
    let outcome: any;
    const task = result.current.registerLightningAddress('old').catch(error => { outcome = error; });
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    await act(async () => { registration.resolve({ lightningAddress: 'old@example.test' }); await task; });
    expect(outcome.message).toContain('wallet changed');
    expect(result.current.lightningAddress).toBe('test@example.test');
});

it('returns an actual payment receipt without waiting for blocked history', async () => {
    const { result } = await connected();
    const history = deferred<any>(); a.listPayments.mockReturnValue(history.promise);
    let receipt: any;
    await act(async () => { receipt = await result.current.payLightningInvoice('lnbc-test'); });
    expect(receipt).toMatchObject({ paymentHash: 'payment-1', amountMsat: 123000, feeMsat: 2000, paymentTime: 1234, status: 'complete' });
    await act(async () => { history.resolve({ payments: [] }); });
});

it('does not publish a temporary SDK balance reservation after a failed send', async () => {
    const { result } = await connected();
    a.getInfo.mockClear();
    a.listPayments.mockClear();
    a.sendPayment.mockRejectedValueOnce(new Error('SdkError.SparkError'));

    await act(async () => {
        await expect(result.current.payLightningInvoice('lnbc-test')).rejects.toThrow('SdkError.SparkError');
        await Promise.resolve();
    });

    expect(a.getInfo).not.toHaveBeenCalled();
    expect(a.listPayments).not.toHaveBeenCalled();
});

it('blocks payments when a recovery has reserved this wallet', async () => {
    const { result } = await connected();
    const storage = require('../../services/exitStorage');
    storage.assertNoActiveExit.mockRejectedValueOnce(new Error('A unilateral exit is in progress.'));
    await expect(result.current.payLightningInvoice('lnbc-test')).rejects.toThrow('unilateral exit');
    expect(a.sendPayment).not.toHaveBeenCalled();
});

it('prevents switching and duplicate sends while a payment is outstanding', async () => {
    const { result } = await connected();
    const send = deferred<any>(); a.sendPayment.mockReturnValue(send.promise);
    let task!: Promise<any>;
    await act(async () => { task = result.current.payLightningInvoice('lnbc-test'); });
    await expect(result.current.switchWallet('b')).rejects.toThrow('payment to finish');
    await expect(result.current.payLightningInvoice('lnbc-test')).rejects.toThrow('already in progress');
    await act(async () => { send.resolve({ payment: payment() }); await task; });
});

it('retains pending SDK payment status instead of fabricating completion', async () => {
    const { result } = await connected();
    a.sendPayment.mockResolvedValue({ payment: payment('pending', 1) });
    let receipt: any;
    await act(async () => { receipt = await result.current.payLightningInvoice('lnbc-test'); });
    expect(receipt.status).toBe('pending');
});

it('uses the locked SDK amount field for LNURL payments', async () => {
    const { result } = await connected();
    a.parse.mockResolvedValue({ tag: 'LnurlPay', inner: [{}] } as any);
    await act(async () => { await result.current.payLightningInvoice('lnurl-test', 123); });
    expect(a.prepareLnurlPay).toHaveBeenCalledWith(expect.objectContaining({ amount: 123n }));
    expect(a.prepareLnurlPay.mock.calls[0][0]).not.toHaveProperty('amountSats');
});

it('loads history beyond the first page', async () => {
    const entries = Array.from({ length: 125 }, (_, index) => payment(String(index)));
    a.listPayments.mockImplementation(async request => ({ payments: entries.slice(0, request.limit) }));
    const { result } = await connected();
    expect(result.current.lightningTransactions).toHaveLength(50);
    await act(async () => { await result.current.loadMoreLightningTransactions(); });
    expect(result.current.lightningTransactions).toHaveLength(100);
    await act(async () => { await result.current.loadMoreLightningTransactions(); });
    expect(result.current.lightningTransactions).toHaveLength(125);
    expect(result.current.hasMoreLightningTransactions).toBe(false);
});

it('performs the post-sync balance read even when history cannot finish', async () => {
    const { result } = await connected();
    const history = deferred<any>();
    const firstBalance = deferred<any>();
    a.listPayments.mockReturnValue(history.promise);
    a.getInfo.mockReturnValueOnce(firstBalance.promise).mockResolvedValue({ balanceSats: 456n });
    let refresh!: Promise<void>;
    await act(async () => {
        refresh = result.current.triggerRefresh('lightning');
        await Promise.resolve(); await Promise.resolve();
        firstBalance.resolve({ balanceSats: 100n });
    });
    await waitFor(() => expect(result.current.lightningBalance).toBe(456));
    await act(async () => { history.resolve({ payments: [] }); await refresh; });
});

it('continues disconnect even when listener removal is stuck', async () => {
    const { result } = await connected();
    const removal = deferred<boolean>(); a.removeEventListener.mockReturnValue(removal.promise);
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    await act(async () => { removal.resolve(true); });
});

it('coalesces concurrent retry requests into one replacement connection', async () => {
    const { result } = await connected();
    const before = (sdkModule.connect as jest.Mock).mock.calls.length;
    await act(async () => { await Promise.all([result.current.retryLightning(), result.current.retryLightning()]); });
    expect((sdkModule.connect as jest.Mock).mock.calls.length).toBe(before + 1);
});

it('discards a receive address request that finishes after switching wallets', async () => {
    const hook = await connected();
    const credentials = deferred<any>();
    const original = Keychain.getGenericPassword as jest.Mock;
    const normal = original.getMockImplementation()!;
    let held = false;
    original.mockImplementation((options: any) => {
        if (!held && options.service === 'com.btc.trustless.mnemonic.v2.a') { held = true; return credentials.promise; }
        return normal(options);
    });
    let next!: ReturnType<typeof hook.result.current.getOrCreateNextUnusedReceiveAddress>;
    await act(async () => { next = hook.result.current.getOrCreateNextUnusedReceiveAddress('a-0-19', 19); });
    await waitFor(() => expect(held).toBe(true));
    await act(async () => { await hook.result.current.switchWallet('b'); });
    const before = hook.result.current.activeWallet!.derivedReceiveAddresses;
    (dbSaveAddress as jest.Mock).mockClear();
    await act(async () => { credentials.resolve({ password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' }); await next; });
    expect(await next).toBeNull();
    expect(hook.result.current.activeWallet?.id).toBe('b');
    expect(hook.result.current.activeWallet?.derivedReceiveAddresses).toEqual(before);
    expect(dbSaveAddress).not.toHaveBeenCalled();
});

it('coalesces concurrent next-address generation and publishes the new index once', async () => {
    const hook = await connected();
    (dbSaveAddress as jest.Mock).mockClear();
    let values: any[] = [];
    await act(async () => {
        values = await Promise.all([
            hook.result.current.getOrCreateNextUnusedReceiveAddress('a-0-19', 19),
            hook.result.current.getOrCreateNextUnusedReceiveAddress('a-0-19', 19),
        ]);
    });
    expect(values[0]?.index).toBe(20);
    expect(values[1]).toEqual(values[0]);
    expect(dbSaveAddress).toHaveBeenCalledTimes(1);
    expect(hook.result.current.activeWallet?.derivedReceiveAddresses.filter(a => a.index === 20)).toHaveLength(1);
});

it('invalidates an old receive request even when switching A to B and back to A', async () => {
    const hook = await connected();
    const credentials = deferred<any>();
    const get = Keychain.getGenericPassword as jest.Mock;
    const normal = get.getMockImplementation()!;
    let held = false;
    get.mockImplementation((options: any) => {
        if (!held && options.service === 'com.btc.trustless.mnemonic.v2.a') { held = true; return credentials.promise; }
        return normal(options);
    });
    let next!: Promise<any>;
    await act(async () => { next = hook.result.current.getOrCreateNextUnusedReceiveAddress('a-0-19', 19); });
    await waitFor(() => expect(held).toBe(true));
    await act(async () => { await hook.result.current.switchWallet('b'); });
    let back!: Promise<void>;
    await act(async () => { back = hook.result.current.switchWallet('a'); });
    await act(async () => {
        credentials.resolve({ password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' });
        await Promise.all([next, back]);
    });
    expect(await next).toBeNull();
    expect(hook.result.current.activeWallet?.id).toBe('a');
    expect(hook.result.current.activeWallet?.derivedReceiveAddresses.some(a => a.index === 20)).toBe(false);
});

it('rejects an invalid recovery phrase at the provider boundary before storing credentials', async () => {
    const hook = await connected();
    const writes = (Keychain.setGenericPassword as jest.Mock).mock.calls.length;
    await expect(hook.result.current.addWallet({ mnemonic: 'abandon '.repeat(12) })).rejects.toThrow('Invalid recovery phrase');
    expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(writes);
});

it('invalidates pending receive derivation before deleting an active wallet', async () => {
    const hook = await connected();
    const credentials = deferred<any>();
    const get = Keychain.getGenericPassword as jest.Mock;
    const normal = get.getMockImplementation()!;
    let held = false;
    get.mockImplementation((options: any) => {
        if (!held && options.service === 'com.btc.trustless.mnemonic.v2.a') { held = true; return credentials.promise; }
        return normal(options);
    });
    let next!: Promise<any>;
    await act(async () => { next = hook.result.current.getOrCreateNextUnusedReceiveAddress('a-0-19', 19); });
    await waitFor(() => expect(held).toBe(true));
    (dbGetWallets as jest.Mock).mockResolvedValue([{ id: 'b', name: 'b', type: 'standard', nextUtxoCount: 0 }]);
    let removal!: Promise<void>;
    await act(async () => { removal = hook.result.current.removeWallet('a'); });
    await waitFor(() => expect(dbDeleteWallet).toHaveBeenCalledWith('a'));
    (dbSaveAddress as jest.Mock).mockClear();
    await act(async () => { credentials.resolve({ password: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' }); await Promise.all([next, removal]); });
    expect(await next).toBeNull();
    expect(hook.result.current.activeWallet?.id).toBe('b');
    expect(dbSaveAddress).not.toHaveBeenCalled();
});

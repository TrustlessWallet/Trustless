import React from 'react';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WalletProvider, useWallet } from '../../contexts/WalletContext';
import * as sdkModule from '@breeztech/breez-sdk-spark-react-native';

jest.mock('uuid', () => ({ v4: () => 'test-request-id' }));
jest.mock('react-native-keychain', () => ({
    getGenericPassword: jest.fn(async ({ service }) => ({ password: service.includes('activeWalletId') ? 'a' : 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' })),
    setGenericPassword: jest.fn(async () => true), resetGenericPassword: jest.fn(async () => true),
}));
jest.mock('../../services/database', () => ({
    dbGetWallets: jest.fn(async () => ['a', 'b'].map(id => ({ id, name: id, type: 'standard', nextUtxoCount: 0 }))),
    dbGetDerivedAddresses: jest.fn(async (id, chain) => Array.from({ length: 20 }, (_, index) => ({ address: `${id}-${chain}-${index}`, index }))),
    dbGetAddressCache: jest.fn(async () => []), dbGetUtxoLabels: jest.fn(async () => ({})),
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
    PaymentStatus: { Completed: 0, Pending: 1, Failed: 2 }, PaymentType: { Receive: 0, Send: 1 },
    InputType_Tags: { Bolt11Invoice: 'Bolt11Invoice', LightningAddress: 'LightningAddress', LnurlPay: 'LnurlPay' },
    SendPaymentMethod_Tags: { Bolt11Invoice: 'Bolt11Invoice', SparkAddress: 'SparkAddress', SparkInvoice: 'SparkInvoice' },
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
afterEach(async () => { cleanup(); client.clear(); jest.useRealTimers(); });

it('connects the active wallet and explicitly synchronizes its balance', async () => {
    const { result } = await connected();
    expect(result.current.activeWallet?.id).toBe('a');
    expect(result.current.lightningBalance).toBe(100);
    expect(a.syncWallet).toHaveBeenCalledTimes(1);
    expect(result.current.lightningLastSyncedAt).not.toBeNull();
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

it('releases optimizer-reserved leaves before sending a payment', async () => {
    const { result } = await connected();
    a.getLeafOptimizationProgress.mockReturnValue({ isRunning: true, currentRound: 1, totalRounds: 2 });

    await act(async () => { await result.current.payLightningInvoice('lnbc-test'); });

    expect(a.cancelLeafOptimization).toHaveBeenCalledTimes(1);
    expect(a.cancelLeafOptimization.mock.invocationCallOrder[0]).toBeLessThan(a.sendPayment.mock.invocationCallOrder[0]);
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

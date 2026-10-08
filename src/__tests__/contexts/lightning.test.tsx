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

it('releases refresh with an error when synchronization exceeds its deadline', async () => {
    const { result } = await connected();
    jest.useFakeTimers();
    const sync = deferred<any>(); a.syncWallet.mockReturnValue(sync.promise);
    let outcome: any;
    await act(async () => {
        const refresh = result.current.triggerRefresh('lightning').catch(error => { outcome = error; });
        await Promise.resolve(); await Promise.resolve();
        await jest.advanceTimersByTimeAsync(12001);
        await refresh;
    });
    expect(outcome.message).toContain('timed out');
    expect(result.current.lightningSyncing).toBe(false);
    expect(result.current.lightningSyncError).toContain('timed out');
    await act(async () => { sync.resolve({}); });
});

it('does not wait for on-chain queries during Lightning refresh', async () => {
    const { result } = await connected();
    const invalidate = jest.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    await act(async () => { await result.current.triggerRefresh('lightning'); });
    expect(invalidate).not.toHaveBeenCalled();
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


it('applies payment completion immediately and does not regress to a stale pending list', async () => {
    const { result } = await connected();
    const history = deferred<any>();
    a.listPayments.mockReturnValue(history.promise);
    await act(async () => { await a.emit({ tag: 'Synced' }); });
    const incoming = { ...payment('incoming'), paymentType: 0 };
    await act(async () => { await a.emit({ tag: 'PaymentSucceeded', inner: { payment: incoming } }); });
    expect(result.current.lightningTransactions.find(tx => tx.paymentHash === 'incoming')?.status).toBe('complete');
    await act(async () => { history.resolve({ payments: [{ ...incoming, status: 1 }] }); });
    await waitFor(() => expect(result.current.lightningSyncing).toBe(false));
    expect(result.current.lightningTransactions.find(tx => tx.paymentHash === 'incoming')?.status).toBe('complete');
});

it('recovers a stuck balance read only after disconnect, and ignores its late result', async () => {
    const { result } = await connected();
    jest.useFakeTimers();
    const oldRead = deferred<any>();
    const disconnect = deferred<void>();
    const recovered = session(321);
    a.getInfo.mockReturnValue(oldRead.promise);
    a.disconnect.mockReturnValue(disconnect.promise);
    const connect = sdkModule.connect as jest.Mock;
    const before = connect.mock.calls.length;
    connect.mockResolvedValueOnce(recovered);
    await act(async () => {
        await a.emit({ tag: 'Synced' });
        await jest.advanceTimersByTimeAsync(8751);
    });
    expect(a.disconnect).toHaveBeenCalledTimes(1);
    expect(connect.mock.calls.length).toBe(before);
    await act(async () => { disconnect.resolve(); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(321));
    expect(connect.mock.calls.length).toBe(before + 1);
    await act(async () => { oldRead.resolve({ balanceSats: 99999n }); });
    expect(result.current.lightningBalance).toBe(321);
});

it('opens Lightning while on-chain address discovery is still waiting', async () => {
    const { result } = await connected();
    const db = require('../../services/database');
    const bitcoin = require('../../services/bitcoin');
    const discovery = deferred<any[]>();
    db.dbGetDerivedAddresses.mockImplementationOnce(async (id: string, chain: number) =>
        Array.from({ length: 19 }, (_, index) => ({ address: `${id}-${chain}-${index}`, index })));
    bitcoin.fetchAddressInfoBatch.mockReturnValueOnce(discovery.promise);
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    expect(result.current.activeWallet?.id).toBe('b');
    expect(result.current.isWalletSwitching).toBe(false);
    expect(bitcoin.fetchAddressInfoBatch).toHaveBeenCalled();
    await act(async () => { discovery.resolve([]); });
});

it('shows the last known balance immediately when switching back before connection finishes', async () => {
    const { result } = await connected();
    await act(async () => { await result.current.switchWallet('b'); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(900));
    const connection = deferred<any>();
    (sdkModule.connect as jest.Mock).mockReturnValueOnce(connection.promise);
    await act(async () => { await result.current.switchWallet('a'); });
    expect(result.current.lightningBalance).toBe(100);
    expect(result.current.lightningBalanceKnown).toBe(true);
    await act(async () => { connection.resolve(a); });
    await waitFor(() => expect(result.current.isLightningInitialized).toBe(true));
});

it('does not present an unsynchronized default zero as a known balance', async () => {
    const sync = deferred<any>();
    a.getInfo.mockResolvedValue({ balanceSats: 0n });
    a.syncWallet.mockReturnValue(sync.promise);
    const { result } = renderHook(() => useWallet(), { wrapper });
    await waitFor(() => expect(result.current.isLightningInitialized).toBe(true));
    expect(result.current.lightningBalanceKnown).toBe(false);
    a.getInfo.mockResolvedValue({ balanceSats: 456n });
    await act(async () => { sync.resolve({}); });
    await waitFor(() => expect(result.current.lightningBalance).toBe(456));
    expect(result.current.lightningBalanceKnown).toBe(true);
});

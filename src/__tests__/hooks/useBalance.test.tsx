import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { useAddressListSync, useWalletBalanceSync, useWalletTransactions } from '../../hooks/useBalance';
import { fetchAddressBalances, fetchAddressInfoBatch, fetchAddressTransactions } from '../../services/bitcoin';
import { dbGetTransactions, dbSaveTransactions } from '../../services/database';
import { BitcoinAddress, Transaction } from '../../types';

jest.mock('../../services/bitcoin', () => ({
    fetchAddressBalances: jest.fn(),
    fetchAddressInfoBatch: jest.fn(),
    fetchAddressTransactions: jest.fn(),
}));
jest.mock('../../services/database', () => ({
    dbGetTransactions: jest.fn(),
    dbSaveTransactions: jest.fn(),
}));

const balanceBatch = fetchAddressInfoBatch as jest.Mock;
const savedBalances = fetchAddressBalances as jest.Mock;
const addressTransactions = fetchAddressTransactions as jest.Mock;
const getTransactions = dbGetTransactions as jest.Mock;

const clients: QueryClient[] = [];
const makeClient = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    return client;
};
const makeWrapper = (client: QueryClient) =>
    ({ children }: { children: React.ReactNode }) =>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>;

const savedItem = (address: string): BitcoinAddress => ({
    id: address, address, balance: 0, lastUpdated: new Date(0),
});

beforeAll(() => {
    notifyManager.setNotifyFunction(callback => { act(callback); });
});

afterAll(() => {
    notifyManager.setNotifyFunction(callback => callback());
});

beforeEach(() => {
    jest.clearAllMocks();
    balanceBatch.mockImplementation(async (addresses: string[]) => addresses);
    savedBalances.mockImplementation(async (addresses: string[]) => addresses);
    addressTransactions.mockImplementation(async (addresses: string[]) => addresses);
    getTransactions.mockResolvedValue([]);
    (dbSaveTransactions as jest.Mock).mockResolvedValue(undefined);
});

afterEach(async () => {
    await act(async () => {
        clients.splice(0).forEach(client => client.clear());
        await new Promise(resolve => setTimeout(resolve, 0));
    });
});

it('refetches wallet balances when the address changes but the count stays the same', async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
        ({ addresses }: { addresses: string[] }) => useWalletBalanceSync('wallet-1', addresses),
        { initialProps: { addresses: ['first'] }, wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual(['first']));
    rerender({ addresses: ['second'] });
    await waitFor(() => expect(result.current.data).toEqual(['second']));

    expect(balanceBatch).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().findAll({ queryKey: ['wallet-balances', 'wallet-1'] })).toHaveLength(2);
});

it('refetches saved balances when an item changes address at the same list length', async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
        ({ items }: { items: BitcoinAddress[] }) => useAddressListSync('saved', items),
        { initialProps: { items: [savedItem('first')] }, wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual(['first']));
    rerender({ items: [savedItem('second')] });
    await waitFor(() => expect(result.current.data).toEqual(['second']));

    expect(savedBalances).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().findAll({ queryKey: ['saved', 'balances'] })).toHaveLength(2);
});

it('refetches transactions for a replacement address with the same count', async () => {
    const client = makeClient();
    const { result, rerender } = renderHook(
        ({ addresses }: { addresses: string[] }) => useWalletTransactions('wallet-1', addresses),
        { initialProps: { addresses: ['first'] }, wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual(['first']));
    rerender({ addresses: ['second'] });
    await waitFor(() => expect(result.current.data).toEqual(['second']));

    expect(addressTransactions).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().findAll({ queryKey: ['wallet-transactions', 'wallet-1'] })).toHaveLength(2);
});

it('hides the previous wallet database history before the next wallet finishes loading', async () => {
    const oldTx = { txid: 'old-wallet-transaction' } as Transaction;
    let resolveNext: ((value: Transaction[]) => void) | undefined;
    getTransactions.mockImplementation((walletId: string) => walletId === 'wallet-1'
        ? Promise.resolve([oldTx])
        : new Promise<Transaction[]>(resolve => { resolveNext = resolve; }));
    addressTransactions.mockResolvedValue([]);

    const client = makeClient();
    const { result, rerender } = renderHook(
        ({ walletId }: { walletId: string }) => useWalletTransactions(walletId, ['address']),
        { initialProps: { walletId: 'wallet-1' }, wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.data).toEqual([oldTx]));
    rerender({ walletId: 'wallet-2' });
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true);

    await act(async () => { resolveNext?.([]); });
    expect(result.current.data).toEqual([]);
});

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { useAddressDetails } from '../../hooks/useAddressDetails';
import { fetchBitcoinBalance, fetchUTXOs, fetchAddressTransactions } from '../../services/bitcoin';

jest.mock('../../services/bitcoin', () => ({
  fetchBitcoinBalance: jest.fn(),
  fetchUTXOs: jest.fn(),
  fetchAddressTransactions: jest.fn(),
}));

const balance = fetchBitcoinBalance as jest.Mock;
const coins = fetchUTXOs as jest.Mock;
const history = fetchAddressTransactions as jest.Mock;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const clients: QueryClient[] = [];
const client = () => {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(value);
  return value;
};
const wrapper = (value: QueryClient) => ({ children }: { children: React.ReactNode }) =>
  <QueryClientProvider client={value}>{children}</QueryClientProvider>;

beforeAll(() => notifyManager.setNotifyFunction(callback => { act(callback); }));
afterAll(() => notifyManager.setNotifyFunction(callback => callback()));
beforeEach(() => jest.clearAllMocks());
afterEach(() => clients.splice(0).forEach(value => value.clear()));

it('starts all resources independently and exposes an early result while the others remain pending', async () => {
  const slowCoins = deferred<never[]>();
  const slowHistory = deferred<never[]>();
  balance.mockResolvedValue(100);
  coins.mockReturnValue(slowCoins.promise);
  history.mockReturnValue(slowHistory.promise);
  const { result } = renderHook(() => useAddressDetails('wallet-1', 'address-1'), { wrapper: wrapper(client()) });

  await waitFor(() => expect(result.current.balance.data).toBe(100));
  expect(result.current.utxos.isPending).toBe(true);
  expect(result.current.transactions.isPending).toBe(true);
  expect(coins).toHaveBeenCalledWith(['address-1'], { strict: true });
  expect(history).toHaveBeenCalledWith(['address-1'], undefined, undefined, { strict: true });
  await act(async () => { slowCoins.resolve([]); slowHistory.resolve([]); });
});

it('keeps failures independent and supports explicit retry', async () => {
  balance.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(250);
  coins.mockResolvedValue([]);
  history.mockRejectedValue(new Error('history offline'));
  const { result } = renderHook(() => useAddressDetails('wallet-1', 'address-1'), { wrapper: wrapper(client()) });

  await waitFor(() => expect(result.current.balance.isError).toBe(true));
  await waitFor(() => expect(result.current.transactions.isError).toBe(true));
  expect(result.current.utxos.data).toEqual([]);
  expect(result.current.balance.data).toBeUndefined();
  expect(result.current.transactions.data).toBeUndefined();
  await act(async () => { await result.current.balance.refetch(); });
  await waitFor(() => expect(result.current.balance.data).toBe(250));
  expect(balance).toHaveBeenCalledTimes(2);
  expect(history).toHaveBeenCalledTimes(1);
});

it('never exposes data from a previous wallet or address while a new scope loads', async () => {
  const old = deferred<number>();
  const next = deferred<number>();
  balance.mockImplementation((address: string) => address === 'address-2' ? next.promise : old.promise);
  coins.mockResolvedValue([]);
  history.mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ wallet, address }: { wallet: string; address: string }) => useAddressDetails(wallet, address),
    { initialProps: { wallet: 'wallet-1', address: 'address-1' }, wrapper: wrapper(client()) },
  );
  await waitFor(() => expect(balance).toHaveBeenCalledTimes(1));
  rerender({ wallet: 'wallet-2', address: 'address-2' });
  expect(result.current.balance.data).toBeUndefined();
  await act(async () => { old.resolve(100); });
  expect(result.current.balance.data).toBeUndefined();
  await act(async () => { next.resolve(200); });
  await waitFor(() => expect(result.current.balance.data).toBe(200));
});

it('keeps cached same-scope data visible when its refresh fails', async () => {
  balance.mockResolvedValueOnce(100).mockRejectedValueOnce(new Error('offline'));
  coins.mockResolvedValue([]);
  history.mockResolvedValue([]);
  const { result } = renderHook(() => useAddressDetails('wallet-1', 'address-1'), { wrapper: wrapper(client()) });
  await waitFor(() => expect(result.current.balance.data).toBe(100));
  expect(result.current.balance.isRefetchError).toBe(false);
  await act(async () => { await result.current.balance.refetch(); });
  await waitFor(() => expect(balance).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.balance.isRefetchError).toBe(true));
  expect(result.current.balance.data).toBe(100);
});

it('reuses fresh same-scope cached data on reopen and makes no requests without a wallet', async () => {
  balance.mockResolvedValue(100);
  coins.mockResolvedValue([]);
  history.mockResolvedValue([]);
  const queryClient = client();
  const first = renderHook(() => useAddressDetails('wallet-1', 'address-1'), { wrapper: wrapper(queryClient) });
  await waitFor(() => expect(first.result.current.balance.data).toBe(100));
  await waitFor(() => expect(first.result.current.utxos.data).toEqual([]));
  await waitFor(() => expect(first.result.current.transactions.data).toEqual([]));
  first.unmount();
  const second = renderHook(() => useAddressDetails('wallet-1', 'address-1'), { wrapper: wrapper(queryClient) });
  expect(second.result.current.balance.data).toBe(100);
  expect(balance).toHaveBeenCalledTimes(1);
  expect(coins).toHaveBeenCalledTimes(1);
  expect(history).toHaveBeenCalledTimes(1);
  second.unmount();
  const missing = renderHook(() => useAddressDetails(undefined, 'address-1'), { wrapper: wrapper(queryClient) });
  expect(missing.result.current.balance.data).toBeUndefined();
  expect(balance).toHaveBeenCalledTimes(1);
});

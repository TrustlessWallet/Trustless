import React from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalSalesScreen from '../../screens/TerminalSalesScreen';
import { getTerminalSalesSummary, listTerminalSalesPage } from '../../services/terminalSales';
import { getTerminalRefundTotal } from '../../services/terminalRefunds';

const mockSalesListeners = new Set<(wallet: string, network: string) => void>();

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ activeWallet: { id: 'wallet-a' }, isLightningInitialized: true, validateTerminalInvoice: jest.fn(), verifyTerminalInvoice: jest.fn() }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('uuid', () => ({ v4: () => 'test-id' }));
jest.mock('../../services/terminalSalesExport', () => ({ exportTerminalSalesCsv: jest.fn() }));
jest.mock('../../services/terminalSales', () => ({
  listTerminalSalesPage: jest.fn(),
  getTerminalSalesSummary: jest.fn(),
  getTerminalSale: jest.fn(),
  subscribeTerminalSales: jest.fn((listener: (wallet: string, network: string) => void) => { mockSalesListeners.add(listener); return () => { mockSalesListeners.delete(listener); }; }),
  updateTerminalSalePayment: jest.fn(),
  terminalSaleDisplayStatus: (sale: { status: string }) => sale.status,
}));
jest.mock('../../services/terminalRefunds', () => ({
  getTerminalRefundTotal: jest.fn(),
  listTerminalRefundsForSale: jest.fn(async () => []),
  subscribeTerminalRefunds: jest.fn(() => () => undefined),
  remainingTerminalRefundSats: jest.fn(() => 0),
}));

const now = Date.now();
const sale = (id: string, amountSats: number) => ({
  request: { id, walletId: 'wallet-a', network: 'mainnet', invoice: `lnbc${id}`, amountSats, createdAt: now, expiresAt: now + 60_000 },
  status: 'received', receivedAt: now, updatedAt: now,
});
const summary = (activityCount: number, receivedCount: number, bitcoinSats: bigint) => ({ activityCount, receivedCount, sats: bitcoinSats, bitcoinSats, fiatMinor: {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockSalesListeners.clear();
  (getTerminalRefundTotal as jest.Mock).mockResolvedValue(0n);
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(0, 0, 0n));
});

it('replays the loaded row budget during a silent notification refresh', async () => {
  const rows = (prefix: string, start: number) => Array.from({ length: 50 }, (_, index) => sale(`${prefix}-${start + index}`, 1000 + start + index));
  let resolveReplay!: (value: unknown) => void;
  (listTerminalSalesPage as jest.Mock)
    .mockResolvedValueOnce({ items: rows('old', 0), nextCursor: { at: now, id: 'old-49' } })
    .mockResolvedValueOnce({ items: rows('old', 50), nextCursor: { at: now - 1, id: 'old-99' } })
    .mockResolvedValueOnce({ items: rows('fresh', 0), nextCursor: { at: now, id: 'fresh-49' } })
    .mockImplementationOnce(() => new Promise(resolve => { resolveReplay = resolve; }))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(50));
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(100));

  act(() => { mockSalesListeners.forEach(listener => listener('wallet-a', 'mainnet')); });
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenCalledTimes(4));
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(4);

  await act(async () => { resolveReplay({ items: rows('fresh', 50), nextCursor: { at: now - 1, id: 'fresh-99' } }); });
  expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(100);
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenCalledTimes(5));
  expect((listTerminalSalesPage as jest.Mock).mock.calls[4][2].cursor).toEqual({ at: now - 1, id: 'fresh-99' });
});

it('does not page with the old cursor while a notification refresh is pending', async () => {
  let resolveRefresh!: (value: unknown) => void;
  (listTerminalSalesPage as jest.Mock)
    .mockResolvedValueOnce({ items: [sale('old', 1200)], nextCursor: { at: now, id: 'old' } })
    .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }))
    .mockResolvedValueOnce({ items: [sale('new-page', 3200)], nextCursor: null });
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText(/1 200 sats, Paid/)).toBeTruthy());

  act(() => { mockSalesListeners.forEach(listener => listener('wallet-a', 'mainnet')); });
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenCalledTimes(2));
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(2);

  await act(async () => { resolveRefresh({ items: [sale('fresh', 2400)], nextCursor: { at: now - 1, id: 'fresh' } }); });
  act(() => { view.UNSAFE_getByType(FlatList).props.onEndReached(); });
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenCalledTimes(3));
  expect((listTerminalSalesPage as jest.Mock).mock.calls[2][2].cursor).toEqual({ at: now - 1, id: 'fresh' });
});

it('uses the period summary for full counts and totals while rendering only the first page', async () => {
  (listTerminalSalesPage as jest.Mock).mockResolvedValue({ items: [sale('first', 1200)], nextCursor: null });
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(77, 63, 9000n));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);

  await waitFor(() => expect(view.getByText('63')).toBeTruthy());
  expect(view.getByText('77')).toBeTruthy();
  expect(view.getByText('9 000 sats')).toBeTruthy();
  expect(view.getAllByLabelText(/1 200 sats, Paid/)).toHaveLength(1);
  expect(listTerminalSalesPage).toHaveBeenCalledWith('wallet-a', 'mainnet', expect.objectContaining({ range: expect.any(Object), limit: 50 }));
});

it('coalesces repeated end events, deduplicates IDs, and discards a stale append after the period changes', async () => {
  let resolveNext!: (value: unknown) => void;
  (listTerminalSalesPage as jest.Mock)
    .mockResolvedValueOnce({ items: [sale('first', 1200)], nextCursor: { at: now, id: 'first' } })
    .mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve; }))
    .mockResolvedValueOnce({ items: [sale('week', 3200)], nextCursor: null });
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText(/1 200 sats, Paid/)).toBeTruthy());

  const list = view.UNSAFE_getByType(FlatList);
  act(() => { list.props.onEndReached(); list.props.onEndReached(); });
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByLabelText(/3 200 sats, Paid/)).toBeTruthy());
  await act(async () => { resolveNext({ items: [sale('first', 1200), sale('stale', 6400)], nextCursor: null }); });
  expect(view.queryByLabelText(/6 400 sats, Paid/)).toBeNull();
  expect(view.queryByLabelText(/1 200 sats, Paid/)).toBeNull();
});

it('stops loading when a failed notification refresh supersedes the initial request', async () => {
  let finishInitial!: (value: unknown) => void;
  (listTerminalSalesPage as jest.Mock)
    .mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }))
    .mockRejectedValueOnce(new Error('read failed'));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenCalledTimes(1));
  act(() => { mockSalesListeners.forEach(listener => listener('wallet-a', 'mainnet')); });
  await waitFor(() => expect(view.getByText('Sales unavailable')).toBeTruthy());
  expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  await act(async () => { finishInitial({ items: [sale('old', 1200)], nextCursor: null }); });
  expect(view.getByText('Sales unavailable')).toBeTruthy();
  expect(view.queryByText('1 200 sats')).toBeNull();
});

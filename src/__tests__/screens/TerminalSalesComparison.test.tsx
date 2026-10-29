import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalReportsScreen from '../../screens/TerminalReportsScreen';
import { getTerminalSalesSummary, listTerminalSalesPage } from '../../services/terminalSales';
import { getTerminalRefundTotal } from '../../services/terminalRefunds';
import { getTerminalSalesComparison } from '../../services/terminalSalesComparison';
import { createTerminalItemPerformanceSnapshot } from '../../services/terminalItemPerformance';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ activeWallet: { id: 'wallet-a' }, isLightningInitialized: true, validateTerminalInvoice: jest.fn(), verifyTerminalInvoice: jest.fn() }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('uuid', () => ({ v4: () => 'comparison-test-id' }));
jest.mock('../../services/terminalSalesExport', () => ({ exportTerminalSalesCsv: jest.fn(async () => true) }));
jest.mock('../../services/terminalItemPerformance', () => ({
  createTerminalItemPerformanceSnapshot: jest.fn(),
  readTerminalItemPerformancePage: jest.fn(),
  removeTerminalItemPerformanceSnapshot: jest.fn(async () => undefined),
  formatTerminalItemGross: (gross: bigint, unit: string) => `${unit} ${gross}`,
}));
jest.mock('../../services/terminalSales', () => ({
  listTerminalSalesPage: jest.fn(async () => ({ items: [], nextCursor: null })),
  getTerminalSalesSummary: jest.fn(),
  getTerminalSale: jest.fn(),
  subscribeTerminalSales: jest.fn(() => () => undefined),
  updateTerminalSalePayment: jest.fn(),
  terminalSaleDisplayStatus: jest.fn(),
}));
jest.mock('../../services/terminalRefunds', () => ({
  getTerminalRefundTotal: jest.fn(),
  listTerminalRefundsForSale: jest.fn(async () => []),
  subscribeTerminalRefunds: jest.fn(() => () => undefined),
  remainingTerminalRefundSats: jest.fn(() => 0),
}));
jest.mock('../../services/terminalSalesComparison', () => ({
  ...jest.requireActual('../../services/terminalSalesComparison'),
  getTerminalSalesComparison: jest.fn(),
}));

const summary = (receivedCount: number, bitcoinSats = 0n, fiatMinor: Record<string, bigint> = {}) => ({ activityCount: receivedCount, receivedCount, sats: bitcoinSats, bitcoinSats, fiatMinor });

beforeEach(() => {
  jest.clearAllMocks();
  (listTerminalSalesPage as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(3, 200n, { USD: 1000n }));
  (getTerminalRefundTotal as jest.Mock).mockResolvedValue(100n);
  (getTerminalSalesComparison as jest.Mock).mockResolvedValue({ summary: summary(1, 100n, { EUR: 500n }), refundedSats: 50n });
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'comparison-items', totalCount: 0, paidWithoutItems: 0 });
  (require('../../services/terminalItemPerformance').readTerminalItemPerformancePage as jest.Mock).mockResolvedValue({ items: [], nextSeq: null });
});

it('shows exact previous values and signed absolute changes for currency, sats, and refunds', async () => {
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText('Paid sales, previous 1, change +2')).toBeTruthy());
  expect(view.getByLabelText('USD, previous $0.00, change +$10.00')).toBeTruthy();
  expect(view.getByLabelText('EUR, previous €5.00, change −€5.00')).toBeTruthy();
  expect(view.getByLabelText('Sats, previous 100 sats, change +100 sats')).toBeTruthy();
  expect(view.getByLabelText('Refunded, previous 50 sats, change +50 sats')).toBeTruthy();
  expect(view.getByText(/^Compared with /)).toBeTruthy();
  expect(view.getByText('Current period in progress')).toBeTruthy();
  expect(view.queryByText(/%/)).toBeNull();
});

it('mounts item performance only after selecting the Items report', async () => {
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValueOnce({ token: 'latte-items', totalCount: 1, paidWithoutItems: 0 });
  (require('../../services/terminalItemPerformance').readTerminalItemPerformancePage as jest.Mock).mockResolvedValueOnce({ items: [{ itemId: 'latte', name: 'Paid latte snapshot', unit: 'USD', quantity: 4n, gross: 2000n }], nextSeq: null });
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(view.getByLabelText('Paid latte snapshot, quantity 4, gross USD 2000')).toBeTruthy());
  expect(view.getByText('Sort by')).toBeTruthy();
  expect(view.queryByText('TODAY’S ACTIVITY')).toBeNull();
});

it('hides comparison for All without starting a previous-period request', async () => {
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText('Period comparison')).toBeTruthy());
  (getTerminalSalesComparison as jest.Mock).mockClear();
  fireEvent.press(view.getByLabelText('All sales'));
  await waitFor(() => expect(view.getByLabelText('All sales').props.accessibilityState.selected).toBe(true));
  await waitFor(() => expect(view.queryByLabelText('Period comparison')).toBeNull());
  expect(getTerminalSalesComparison).not.toHaveBeenCalled();
});

it('discards a stale comparison after the selected period changes', async () => {
  let finishToday!: (value: unknown) => void;
  let finishWeek!: (value: unknown) => void;
  (getTerminalSalesComparison as jest.Mock)
    .mockImplementationOnce(() => new Promise(resolve => { finishToday = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishWeek = resolve; }));
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(finishToday).toBeDefined());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(finishWeek).toBeDefined());
  await act(async () => { finishWeek({ summary: summary(2), refundedSats: 0n }); });
  await waitFor(() => expect(view.getByLabelText('Paid sales, previous 2, change +1')).toBeTruthy());
  await act(async () => { finishToday({ summary: summary(99), refundedSats: 0n }); });
  expect(view.queryByLabelText('Paid sales, previous 99, change −96')).toBeNull();
  expect(view.getByLabelText('Paid sales, previous 2, change +1')).toBeTruthy();
});

it('keeps current totals visible when comparison fails and retries only the comparison', async () => {
  (getTerminalSalesComparison as jest.Mock).mockRejectedValueOnce(new Error('comparison failed'));
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Comparison unavailable')).toBeTruthy());
  expect(view.getAllByText('3').length).toBeGreaterThan(0);
  const currentReads = (listTerminalSalesPage as jest.Mock).mock.calls.length;
  (getTerminalSalesComparison as jest.Mock).mockResolvedValueOnce({ summary: summary(1), refundedSats: 0n });
  fireEvent.press(view.getByLabelText('Retry period comparison'));
  await waitFor(() => expect(view.getByLabelText('Paid sales, previous 1, change +2')).toBeTruthy());
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(currentReads);
});

it('never displays the prior wallet comparison after switching wallets', async () => {
  let finishOld!: (value: unknown) => void;
  (getTerminalSalesComparison as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const view = render(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(finishOld).toBeDefined());
  view.rerender(<TerminalReportsScreen initialSelection={{ period: 'today', day: Date.now() }} walletId="wallet-b" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText('Paid sales, previous 1, change +2')).toBeTruthy());
  expect(getTerminalSalesComparison).toHaveBeenLastCalledWith('wallet-b', 'mainnet', expect.any(Object));
  await act(async () => { finishOld({ summary: summary(99), refundedSats: 0n }); });
  expect(view.queryByLabelText('Paid sales, previous 99, change −96')).toBeNull();
});

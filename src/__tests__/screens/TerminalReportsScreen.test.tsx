import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalReportsScreen, { TerminalReportSelection } from '../../screens/TerminalReportsScreen';
import { getTerminalSalesSummary, listTerminalSalesPage } from '../../services/terminalSales';
import { getTerminalRefundTotal } from '../../services/terminalRefunds';
import { createTerminalItemPerformanceSnapshot, readTerminalItemPerformancePage } from '../../services/terminalItemPerformance';

const mockReportListeners = new Set<(wallet: string, network: string) => void>();

jest.mock('../../services/terminalReportPresets', () => ({ ...jest.requireActual('../../services/terminalReportPresets'), listTerminalReportPresets: jest.fn(async () => []), saveTerminalReportPreset: jest.fn(async () => []) }));

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../services/terminalSalesComparison', () => ({ getTerminalSalesComparison: jest.fn(async () => ({ summary: { receivedCount: 0, activityCount: 0, sats: 0n, bitcoinSats: 0n, fiatMinor: {} }, refundedSats: 0n })) }));
jest.mock('../../components/TerminalPeriodComparison', () => () => null);
jest.mock('../../services/terminalSales', () => ({
  getTerminalSalesSummary: jest.fn(),
  listTerminalSalesPage: jest.fn(),
  subscribeTerminalSales: jest.fn((listener: (wallet: string, network: string) => void) => { mockReportListeners.add(listener); return () => { mockReportListeners.delete(listener); }; }),
}));
jest.mock('../../services/terminalRefunds', () => ({
  getTerminalRefundTotal: jest.fn(),
  subscribeTerminalRefunds: jest.fn((listener: (wallet: string, network: string) => void) => { mockReportListeners.add(listener); return () => { mockReportListeners.delete(listener); }; }),
}));
jest.mock('../../services/terminalItemPerformance', () => ({
  createTerminalItemPerformanceSnapshot: jest.fn(),
  readTerminalItemPerformancePage: jest.fn(),
  removeTerminalItemPerformanceSnapshot: jest.fn(async () => undefined),
  formatTerminalItemGross: (gross: bigint, unit: string) => `${unit} ${gross}`,
}));

const now = new Date();
const reportDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const initialSelection: TerminalReportSelection = { period: 'today', day: reportDay };
const summary = (receivedCount: number) => ({ activityCount: receivedCount, receivedCount, sats: 0n, bitcoinSats: 0n, fiatMinor: {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockReportListeners.clear();
  require('../../services/terminalReportPresets').listTerminalReportPresets.mockResolvedValue([]);
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(2));
  (getTerminalRefundTotal as jest.Mock).mockResolvedValue(0n);
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValue({ token: 'items-token', totalCount: 0, paidWithoutItems: 0 });
  (readTerminalItemPerformancePage as jest.Mock).mockResolvedValue({ items: [], nextSeq: null });
});

it('mounts and queries only the active report tab', async () => {
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  expect(getTerminalSalesSummary).toHaveBeenCalledTimes(1);
  expect(createTerminalItemPerformanceSnapshot).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledTimes(1));
  expect(view.queryByLabelText('Reports overview')).toBeNull();
  expect(listTerminalSalesPage).not.toHaveBeenCalled();
});

it('keeps custom drafts independent until Apply and Cancel never refreshes', async () => {
  const input: TerminalReportSelection = { period: 'custom', customRange: { startDate: '2026-06-10', endDate: '2026-06-12' }, day: reportDay };
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={input} onClose={jest.fn()} />);
  await waitFor(() => expect(getTerminalSalesSummary).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Edit custom date range'));
  fireEvent.press(view.getByLabelText('Cancel custom date range'));
  expect(getTerminalSalesSummary).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('Custom sales range'));
  fireEvent.press(view.getByLabelText('From Jun 10, 2026'));
  fireEvent.press(view.getByLabelText(new Date(2026, 5, 11).toLocaleDateString()));
  fireEvent.press(view.getByLabelText('Apply custom date range'));
  await waitFor(() => expect(getTerminalSalesSummary).toHaveBeenCalledTimes(2));
  expect((getTerminalSalesSummary as jest.Mock).mock.calls[1][2]).toEqual({ start: new Date(2026, 5, 11).getTime(), end: new Date(2026, 5, 13).getTime() });
  expect(input.customRange).toEqual({ startDate: '2026-06-10', endDate: '2026-06-12' });
});

it('drops stale period and wallet completions, closes normally, and never reads history pages', async () => {
  let finishToday!: (value: unknown) => void;
  let finishWeek!: (value: unknown) => void;
  let finishWallet!: (value: unknown) => void;
  (getTerminalSalesSummary as jest.Mock)
    .mockImplementationOnce(() => new Promise(resolve => { finishToday = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishWeek = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishWallet = resolve; }));
  const close = jest.fn();
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={close} />);
  await waitFor(() => expect(finishToday).toBeDefined());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(finishWeek).toBeDefined());
  view.rerender(<TerminalReportsScreen walletId="wallet-b" network="mainnet" initialSelection={initialSelection} onClose={close} />);
  await waitFor(() => expect(finishWallet).toBeDefined());
  await act(async () => { finishWallet(summary(3)); });
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  await act(async () => { finishWeek(summary(8)); finishToday(summary(9)); });
  expect(view.queryByText('8')).toBeNull();
  expect(view.queryByText('9')).toBeNull();
  expect(listTerminalSalesPage).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Close reports'));
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps the old overview selected until both sales and refunds for the new period are ready', async () => {
  let finishSummary!: (value: unknown) => void;
  let finishRefunds!: (value: bigint) => void;
  (getTerminalSalesSummary as jest.Mock).mockResolvedValueOnce(summary(2)).mockImplementationOnce(() => new Promise(resolve => { finishSummary = resolve; }));
  (getTerminalRefundTotal as jest.Mock).mockResolvedValueOnce(5n).mockImplementationOnce(() => new Promise(resolve => { finishRefunds = resolve; }));
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('5 sats')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.busy).toBe(true);
  await act(async () => { finishSummary(summary(8)); });
  expect(view.getByText('2')).toBeTruthy();
  expect(view.getByText('5 sats')).toBeTruthy();
  await act(async () => { finishRefunds(9n); });
  await waitFor(() => expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true));
  expect(view.getByText('8')).toBeTruthy();
  expect(view.getByText('9 sats')).toBeTruthy();
});

it('leaves a failed report period unselected with its previous totals', async () => {
  (getTerminalSalesSummary as jest.Mock).mockResolvedValueOnce(summary(2)).mockRejectedValueOnce(new Error('unavailable'));
  (getTerminalRefundTotal as jest.Mock).mockResolvedValueOnce(5n);
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('5 sats')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByText('Couldn’t open that period. Try again.')).toBeTruthy());
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('2')).toBeTruthy();
  expect(view.getByText('5 sats')).toBeTruthy();
});

it('does not reuse a period result invalidated by a sale notification', async () => {
  let finishOldWeek!: (value: unknown) => void;
  (getTerminalSalesSummary as jest.Mock)
    .mockResolvedValueOnce(summary(2))
    .mockImplementationOnce(() => new Promise(resolve => { finishOldWeek = resolve; }))
    .mockResolvedValueOnce(summary(3))
    .mockResolvedValueOnce(summary(4));
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  act(() => { mockReportListeners.values().next().value!('wallet-a', 'mainnet'); });
  await waitFor(() => expect(view.getByText('3')).toBeTruthy());
  await act(async () => { finishOldWeek(summary(9)); });
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByText('4')).toBeTruthy());
  expect(getTerminalSalesSummary).toHaveBeenCalledTimes(4);
});

it('refreshes a prepared period after a refund changes while Reports is hidden', async () => {
  let finishFreshSummary!: (value: unknown) => void;
  let finishFreshRefunds!: (value: bigint) => void;
  (getTerminalSalesSummary as jest.Mock)
    .mockResolvedValueOnce(summary(2))
    .mockResolvedValueOnce(summary(8))
    .mockImplementationOnce(() => new Promise(resolve => { finishFreshSummary = resolve; }));
  (getTerminalRefundTotal as jest.Mock)
    .mockResolvedValueOnce(1n)
    .mockResolvedValueOnce(5n)
    .mockImplementationOnce(() => new Promise(resolve => { finishFreshRefunds = resolve; }));
  const props = { walletId: 'wallet-a', network: 'mainnet' as const, initialSelection, onClose: jest.fn() };
  const view = render(<TerminalReportsScreen {...props} />);
  await waitFor(() => expect(view.getByText('1 sats')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true));
  expect(view.getByText('8')).toBeTruthy();
  expect(view.getByText('5 sats')).toBeTruthy();
  view.rerender(<TerminalReportsScreen {...props} visible={false} />);
  act(() => { mockReportListeners.values().next().value!('wallet-a', 'mainnet'); });
  view.rerender(<TerminalReportsScreen {...props} visible />);
  await waitFor(() => expect(finishFreshSummary).toBeDefined());
  expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('8')).toBeTruthy();
  expect(view.getByText('5 sats')).toBeTruthy();
  await act(async () => { finishFreshSummary(summary(9)); finishFreshRefunds(7n); });
  await waitFor(() => expect(view.getByText('7 sats')).toBeTruthy());
  expect(view.getByText('9')).toBeTruthy();
});

it('keeps item results and period aligned while preparing the next item snapshot', async () => {
  let finishSnapshot!: (value: unknown) => void;
  let finishPage!: (value: unknown) => void;
  (createTerminalItemPerformanceSnapshot as jest.Mock)
    .mockResolvedValueOnce({ token: 'today-token', totalCount: 1, paidWithoutItems: 0 })
    .mockImplementationOnce(() => new Promise(resolve => { finishSnapshot = resolve; }));
  (readTerminalItemPerformancePage as jest.Mock)
    .mockResolvedValueOnce({ items: [{ itemId: 'today', name: 'Today item', unit: 'USD', quantity: 1n, gross: 100n }], nextSeq: null })
    .mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(view.getByText('Today item')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('Today item')).toBeTruthy();
  await act(async () => { finishSnapshot({ token: 'week-token', totalCount: 1, paidWithoutItems: 0 }); });
  expect(view.getByText('Today item')).toBeTruthy();
  await act(async () => { finishPage({ items: [{ itemId: 'week', name: 'Week item', unit: 'USD', quantity: 2n, gross: 200n }], nextSeq: null }); });
  await waitFor(() => expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true));
  expect(view.getByText('Week item')).toBeTruthy();
  expect(view.queryByText('Today item')).toBeNull();
});

it('keeps the old item period visible if preparing the next snapshot fails', async () => {
  (createTerminalItemPerformanceSnapshot as jest.Mock)
    .mockResolvedValueOnce({ token: 'today-token', totalCount: 1, paidWithoutItems: 0 })
    .mockRejectedValueOnce(new Error('unavailable'));
  (readTerminalItemPerformancePage as jest.Mock).mockResolvedValueOnce({ items: [{ itemId: 'today', name: 'Today item', unit: 'USD', quantity: 1n, gross: 100n }], nextSeq: null });
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(view.getByText('Today item')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByText('Couldn’t open that period. Try again.')).toBeTruthy());
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('Today item')).toBeTruthy();
});

it('retries overview and item failures without crossing report queries', async () => {
  (getTerminalSalesSummary as jest.Mock).mockRejectedValueOnce(new Error('overview failed'));
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Reports unavailable')).toBeTruthy());
  (getTerminalSalesSummary as jest.Mock).mockResolvedValueOnce(summary(4));
  fireEvent.press(view.getByLabelText('Retry reports overview'));
  await waitFor(() => expect(view.getByText('4')).toBeTruthy());
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockRejectedValueOnce(new Error('items failed'));
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(view.getByText('Item report unavailable')).toBeTruthy());
  (createTerminalItemPerformanceSnapshot as jest.Mock).mockResolvedValueOnce({ token: 'retry-token', totalCount: 0, paidWithoutItems: 0 });
  fireEvent.press(view.getByLabelText('Retry item report'));
  await waitFor(() => expect(view.getByText('No item sales in this period')).toBeTruthy());
  expect(listTerminalSalesPage).not.toHaveBeenCalled();
});

it('rolls relative report filters and the custom calendar cap at local midnight', async () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date(2026, 5, 18, 23, 59, 59, 500));
    const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={{ period: 'today', day: new Date(2026, 5, 18).getTime() }} onClose={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('Jun 18, 2026')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(600); await Promise.resolve(); });
    expect(view.getByText('Jun 19, 2026')).toBeTruthy();
    fireEvent.press(view.getByLabelText('Custom sales range'));
    expect(view.getByText('June 2026')).toBeTruthy();
    expect(view.getByLabelText(new Date(2026, 5, 19).toLocaleDateString()).props.accessibilityState.disabled).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});


it('applies saved period, tab, currency and sorting together and retains item filters across tabs', async () => {
  const preset = { period: 'week', tab: 'items', unit: 'USD', sort: 'gross' };
  require('../../services/terminalReportPresets').listTerminalReportPresets.mockResolvedValue([preset]);
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Saved reports · 1')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Saved reports'));
  fireEvent.press(view.getByLabelText('Open saved report 7 days · Items · USD · Sales amount'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledTimes(1));
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const end = new Date(day); end.setDate(end.getDate() + 1);
  const start = new Date(day); start.setDate(start.getDate() - 6);
  expect(createTerminalItemPerformanceSnapshot).toHaveBeenLastCalledWith('wallet-a', 'mainnet', { start: start.getTime(), end: end.getTime() }, { unit: 'USD', sort: 'gross' });
  expect(getTerminalSalesSummary).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Item currency USD')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Overview reports'));
  fireEvent.press(view.getByLabelText('Item reports'));
  await waitFor(() => expect(createTerminalItemPerformanceSnapshot).toHaveBeenCalledTimes(2));
  expect(view.getByLabelText('Sort items by sales amount').props.accessibilityState.selected).toBe(true);
});


it('saves applied filters rather than an unfinished date draft and applies fixed custom dates', async () => {
  const service = require('../../services/terminalReportPresets');
  const fixed = { period: 'custom', customRange: { startDate: '2020-01-01', endDate: '2020-01-02' }, tab: 'overview', unit: null, sort: 'quantity' };
  service.listTerminalReportPresets.mockResolvedValue([fixed]);
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Saved reports · 1')).toBeTruthy());
  service.saveTerminalReportPreset.mockResolvedValueOnce([fixed]);
  fireEvent.press(view.getByLabelText('Custom sales range'));
  fireEvent.press(view.getByLabelText('Save current report'));
  expect(service.saveTerminalReportPreset).toHaveBeenCalledWith('wallet-a', 'mainnet', { period: 'today', tab: 'overview', unit: null, sort: 'quantity' }, expect.any(Function));
  service.listTerminalReportPresets.mockResolvedValue([fixed]);
  fireEvent.press(view.getByLabelText('Saved reports'));
  fireEvent.press(view.getByLabelText(/Open saved report Jan 1, 2020/));
  await waitFor(() => expect(getTerminalSalesSummary).toHaveBeenLastCalledWith('wallet-a', 'mainnet', { start: new Date(2020, 0, 1).getTime(), end: new Date(2020, 0, 3).getTime() }));
  expect(view.queryByLabelText('Apply custom date range')).toBeNull();
});


it('invalidates prepared overview results when journal changes arrive behind another sheet', async () => {
  const props = { walletId: 'wallet-a', network: 'mainnet' as const, initialSelection, onClose: jest.fn() };
  const view = render(<TerminalReportsScreen {...props} visible />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(9));
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await waitFor(() => expect(view.getByText('9')).toBeTruthy());
  view.rerender(<TerminalReportsScreen {...props} visible={false} />);
  (getTerminalSalesSummary as jest.Mock).mockResolvedValue(summary(12));
  (getTerminalRefundTotal as jest.Mock).mockResolvedValue(100n);
  act(() => mockReportListeners.forEach(listener => listener('wallet-a', 'mainnet')));
  view.rerender(<TerminalReportsScreen {...props} visible />);
  await waitFor(() => expect(view.getByText('12')).toBeTruthy());
  expect(view.queryByText('9')).toBeNull();
  expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true);
});

it('keeps the whole overview period until comparison figures are ready too', async () => {
  const service = require('../../services/terminalSalesComparison');
  let resolveComparison!: (value: any) => void;
  service.getTerminalSalesComparison.mockReturnValueOnce(new Promise(resolve => { resolveComparison = resolve; }));
  const view = render(<TerminalReportsScreen walletId="wallet-a" network="mainnet" initialSelection={initialSelection} onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  await act(async () => { await Promise.resolve(); });
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByText('2')).toBeTruthy();
  await act(async () => resolveComparison({ summary: summary(1), refundedSats: 0n }));
  await waitFor(() => expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true));
});

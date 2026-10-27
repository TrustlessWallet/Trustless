import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalReportsScreen, { TerminalReportSelection } from '../../screens/TerminalReportsScreen';
import { getTerminalSalesSummary, listTerminalSalesPage } from '../../services/terminalSales';
import { getTerminalRefundTotal } from '../../services/terminalRefunds';
import { createTerminalItemPerformanceSnapshot, readTerminalItemPerformancePage } from '../../services/terminalItemPerformance';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../components/TerminalPeriodComparison', () => () => null);
jest.mock('../../services/terminalSales', () => ({
  getTerminalSalesSummary: jest.fn(),
  listTerminalSalesPage: jest.fn(),
  subscribeTerminalSales: jest.fn(() => () => undefined),
}));
jest.mock('../../services/terminalRefunds', () => ({
  getTerminalRefundTotal: jest.fn(),
  subscribeTerminalRefunds: jest.fn(() => () => undefined),
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

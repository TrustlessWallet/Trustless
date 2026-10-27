import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import TerminalSalesScreen from '../../screens/TerminalSalesScreen';
import TerminalDateRangePicker, { TerminalDateRangeDraft } from '../../components/TerminalDateRangePicker';
import { listTerminalSalesPage } from '../../services/terminalSales';
import { exportTerminalSalesCsv } from '../../services/terminalSalesExport';
import { localSalesDateKey } from '../../services/terminalSalesPeriod';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ activeWallet: { id: 'wallet-a' }, isLightningInitialized: true, validateTerminalInvoice: jest.fn(), verifyTerminalInvoice: jest.fn() }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('uuid', () => ({ v4: () => 'custom-range-test-id' }));
jest.mock('../../services/terminalSalesExport', () => ({ exportTerminalSalesCsv: jest.fn(async () => true) }));
jest.mock('../../services/terminalSalesComparison', () => ({ ...jest.requireActual('../../services/terminalSalesComparison'), getTerminalSalesComparison: jest.fn(() => new Promise(() => undefined)) }));
jest.mock('../../services/terminalItemPerformance', () => ({ getTerminalItemPerformance: jest.fn(() => new Promise(() => undefined)), formatTerminalItemGross: jest.fn() }));
jest.mock('../../services/terminalSales', () => ({
  listTerminalSalesPage: jest.fn(async () => ({ items: [], nextCursor: null })),
  getTerminalSalesSummary: jest.fn(async () => ({ activityCount: 0, receivedCount: 0, sats: 0n, bitcoinSats: 0n, fiatMinor: {} })),
  getTerminalSale: jest.fn(),
  subscribeTerminalSales: jest.fn(() => () => undefined),
  updateTerminalSalePayment: jest.fn(),
  terminalSaleDisplayStatus: jest.fn(),
}));
jest.mock('../../services/terminalRefunds', () => ({
  getTerminalRefundTotal: jest.fn(async () => 0n),
  listTerminalRefundsForSale: jest.fn(async () => []),
  subscribeTerminalRefunds: jest.fn(() => () => undefined),
  remainingTerminalRefundSats: jest.fn(() => 0),
}));

beforeEach(() => jest.clearAllMocks());

it('keeps the applied filter and queries unchanged while the custom editor is opened and cancelled', async () => {
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  expect(view.getByText('Month')).toBeTruthy();
  const callsBefore = (listTerminalSalesPage as jest.Mock).mock.calls.length;
  fireEvent.press(view.getByLabelText('Custom sales range'));
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText('Custom date range editor')).toBeTruthy();
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(callsBefore);
  fireEvent.press(view.getByLabelText('Cancel custom date range'));
  expect(view.queryByLabelText('Custom date range editor')).toBeNull();
  expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true);
  expect(listTerminalSalesPage).toHaveBeenCalledTimes(callsBefore);
});

it('applies a same-day custom range atomically and resets it when the wallet changes', async () => {
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Custom sales range'));
  const key = localSalesDateKey(new Date());
  const start = new Date(`${key}T00:00:00`);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  fireEvent.press(view.getByLabelText('Apply custom date range'));
  await waitFor(() => expect(view.getByLabelText('Custom sales range').props.accessibilityState.selected).toBe(true));
  await waitFor(() => expect(listTerminalSalesPage).toHaveBeenLastCalledWith('wallet-a', 'mainnet', expect.objectContaining({ range: {
    start: start.getTime(),
    end: end.getTime(),
  } })));
  expect(view.getByText('CUSTOM ACTIVITY')).toBeTruthy();
  expect(view.getByLabelText('Edit custom date range')).toBeTruthy();
  view.rerender(<TerminalSalesScreen walletId="wallet-b" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true));
  expect(view.queryByLabelText('Edit custom date range')).toBeNull();
});

it('disables Apply and explains a reversed range', () => {
  const apply = jest.fn();
  const view = render(<TerminalDateRangePicker value={{ startDate: '2026-10-20', endDate: '2026-10-10' }} today={new Date(2026, 9, 26)} onChange={jest.fn()} onApply={apply} onCancel={jest.fn()} />);
  expect(view.getByText('From date must be on or before To date.')).toBeTruthy();
  const button = view.getByLabelText('Apply custom date range');
  expect(button.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(button);
  expect(apply).not.toHaveBeenCalled();
});

it('invalidates an in-flight custom export when its applied range changes', async () => {
  let finish!: (value: boolean) => void;
  (exportTerminalSalesCsv as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Custom sales range'));
  fireEvent.press(view.getByLabelText('Apply custom date range'));
  await waitFor(() => expect(view.getByLabelText('Export custom activity')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText('Export custom activity')); });
  const first = (exportTerminalSalesCsv as jest.Mock).mock.calls[0][0];
  expect(first.isCurrent()).toBe(true);
  fireEvent.press(view.getByLabelText('Edit custom date range'));
  const today = new Date();
  const previous = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (previous.getMonth() !== today.getMonth()) fireEvent.press(view.getByLabelText('Previous month'));
  fireEvent.press(view.getByLabelText(previous.toLocaleDateString()));
  fireEvent.press(view.getByLabelText('Apply custom date range'));
  expect(first.isCurrent()).toBe(false);
  await act(async () => { finish(false); });
});


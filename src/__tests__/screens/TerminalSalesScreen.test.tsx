import React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TerminalSalesScreen from '../../screens/TerminalSalesScreen';
import { useWallet } from '../../contexts/WalletContext';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import { TerminalRequest } from '../../services/terminal';
import { exportTerminalSalesCsv } from '../../services/terminalSalesExport';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('uuid', () => ({ v4: () => 'refund-test-id' }));
jest.mock('../../services/terminalSalesExport', () => ({ exportTerminalSalesCsv: jest.fn() }));

const validateTerminalInvoice = jest.fn();
const verifyTerminalInvoice = jest.fn();
const now = Date.now();
const request = (id: string, walletId = 'wallet-a', amountSats = 1200): TerminalRequest => ({
  id, walletId, network: 'mainnet', invoice: `lnbc${id}abc`, amountSats,
  createdAt: now, expiresAt: now + 60_000,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  validateTerminalInvoice.mockReset();
  verifyTerminalInvoice.mockReset();
  (exportTerminalSalesCsv as jest.Mock).mockReset().mockResolvedValue(true);
  (useWallet as jest.Mock).mockReturnValue({
    activeWallet: { id: 'wallet-a' }, isLightningInitialized: true,
    validateTerminalInvoice, verifyTerminalInvoice,
  });
});

it('exports the selected period once per share and keeps the action off sale details', async () => {
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  expect(exportTerminalSalesCsv).not.toHaveBeenCalled();
  let finishShare!: (value: boolean) => void;
  (exportTerminalSalesCsv as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishShare = resolve; }));
  const button = view.getByLabelText(/^Export (today’s|all) activity$/);
  fireEvent.press(button);
  fireEvent.press(button);
  expect(exportTerminalSalesCsv).toHaveBeenCalledTimes(1);
  expect(exportTerminalSalesCsv).toHaveBeenCalledWith(expect.objectContaining({ walletId: 'wallet-a', network: 'mainnet', period: 'today', day: expect.any(Date), isCurrent: expect.any(Function) }));
  expect(view.getByLabelText(/^Export (today’s|all) activity$/).props.accessibilityState.busy).toBe(true);
  await act(async () => { finishShare(true); });
  fireEvent.press(view.getByLabelText('All sales'));
  await act(async () => { fireEvent.press(view.getByLabelText(/^Export (today’s|all) activity$/)); });
  expect(exportTerminalSalesCsv).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'all' }));
  await recordTerminalSale(request('detail'));
  await waitFor(() => expect(view.getByLabelText(/1 200 sats, Unpaid/)).toBeTruthy());
  fireEvent.press(view.getByLabelText(/1 200 sats, Unpaid/));
  expect(view.queryByLabelText(/^Export (today’s|all) activity$/)).toBeNull();
});

it('stops a pending export after leaving the list and shows genuine share errors only in the current view', async () => {
  let finishShare!: (value: boolean) => void;
  (exportTerminalSalesCsv as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishShare = resolve; }));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  fireEvent.press(view.getByLabelText(/^Export (today’s|all) activity$/));
  const options = (exportTerminalSalesCsv as jest.Mock).mock.calls[0][0];
  expect(options.isCurrent()).toBe(true);
  await recordTerminalSale(request('detail'));
  await waitFor(() => expect(view.getByLabelText(/1 200 sats, Unpaid/)).toBeTruthy());
  fireEvent.press(view.getByLabelText(/1 200 sats, Unpaid/));
  expect(options.isCurrent()).toBe(false);
  await act(async () => { finishShare(false); });
  fireEvent.press(view.getByLabelText('Today sales'));
  (exportTerminalSalesCsv as jest.Mock).mockRejectedValueOnce(new Error('Share failed'));
  await act(async () => { fireEvent.press(view.getByLabelText(/^Export (today’s|all) activity$/)); });
  await waitFor(() => expect(view.getByText('Couldn’t export sales. Try again.')).toBeTruthy());
  view.rerender(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} visible={false} />);
  expect(options.isCurrent()).toBe(false);
});

it('shows paid totals by original denomination and includes unpaid activity', async () => {
  const fiat = { ...request('fiat'), amountSats: 100000, fiat: { currency: 'USD' as const, amountMinor: 10000, rate: '100000', fetchedAt: now } };
  await recordTerminalSale(fiat);
  await updateTerminalSalePayment(fiat, { status: 'received' });
  const sats = request('sats');
  await recordTerminalSale(sats);
  await updateTerminalSalePayment(sats, { status: 'received' });
  await recordTerminalSale(request('unpaid'));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('2')).toBeTruthy());
  expect(view.getAllByText('$100.00').length).toBeGreaterThan(0);
  expect(view.getAllByText('1 200 sats').length).toBeGreaterThan(0);
  expect(view.getByText('Unpaid')).toBeTruthy();
  expect(view.getByText('By local verification date')).toBeTruthy();
});

it('hides the previous wallet’s sales as soon as scope changes', async () => {
  await recordTerminalSale(request('first'));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('1 200 sats')).toBeTruthy());
  view.rerender(<TerminalSalesScreen walletId="wallet-b" network="mainnet" onClose={jest.fn()} />);
  expect(view.queryByText('1 200 sats')).toBeNull();
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
});

it('checks one selected sale only on request and records a verified payment', async () => {
  const sale = request('manual');
  await recordTerminalSale(sale);
  validateTerminalInvoice.mockResolvedValue(sale.expiresAt);
  verifyTerminalInvoice.mockResolvedValue({ status: 'received', paymentId: 'payment-one' });
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('1 200 sats')).toBeTruthy());
  expect(verifyTerminalInvoice).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText(/1 200 sats, Unpaid/));
  fireEvent.press(view.getByLabelText('Check payment'));
  await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledWith(sale.invoice, sale.createdAt, undefined, true));
  await waitFor(() => expect(view.getByText('Paid')).toBeTruthy());
  expect(view.getByText('VERIFIED')).toBeTruthy();
  await waitFor(() => expect(view.getByLabelText('Share receipt')).toBeTruthy());
  expect(view.getByLabelText('Refund sale')).toBeTruthy();
});

it('shows a retry state when saved sales cannot be read', async () => {
  await AsyncStorage.setItem('@terminalSales:v1:mainnet:wallet-a', '{broken');
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Sales unavailable')).toBeTruthy());
  expect(view.getByText('Retry')).toBeTruthy();
  expect(view.queryByText('No paid sales today')).toBeNull();
});

it('keeps paid details open but blocks refund actions for inconsistent refund totals', async () => {
  const sale = request('overrefund');
  await recordTerminalSale(sale);
  await updateTerminalSalePayment(sale, { status: 'received' });
  const attempt = (id: string, invoice: string) => ({
    id, walletId: 'wallet-a', network: 'mainnet', saleId: sale.id, saleInvoice: sale.invoice,
    invoice, amountSats: 1000, feeSats: 0, quoteExpiresAt: now + 60_000,
    createdAt: now, status: 'complete', updatedAt: now,
  });
  await AsyncStorage.setItem('@terminalRefunds:v1:mainnet:wallet-a', JSON.stringify({ version: 1, attempts: [attempt('one', 'lnbcfirstrefund'), attempt('two', 'lnbcsecondrefund')] }));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText(/1 200 sats, Paid/)).toBeTruthy());
  fireEvent.press(view.getByLabelText(/1 200 sats, Paid/));
  await waitFor(() => expect(view.getByText('Refund records need attention. Refund and receipt are unavailable.')).toBeTruthy());
  expect(view.queryByLabelText('Refund sale')).toBeNull();
  expect(view.queryByLabelText('Share receipt')).toBeNull();
});


it('does not reveal pull-to-refresh while opening, but shows it for a user refresh', async () => {
  const readMock = AsyncStorage.getItem as jest.Mock;
  const originalRead = readMock.getMockImplementation()!;
  let finishRead!: (value: string | null) => void;
  const salesKey = '@terminalSales:v1:mainnet:wallet-a';
  readMock.mockImplementation(key => key === salesKey
    ? new Promise(resolve => { finishRead = resolve; }) : originalRead(key));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  try {
    await waitFor(() => expect(finishRead).toBeDefined());
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(view.queryByText('Loading sales…')).toBeNull();
    await act(async () => { finishRead(null); });
    await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
    fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
    await waitFor(() => expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true));
    await act(async () => { finishRead(null); });
    await waitFor(() => expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false));
  } finally {
    readMock.mockImplementation(originalRead);
  }
});

it('filters paid and unpaid activity by local verification date across the four periods', async () => {
  const today = new Date();
  const at = (daysBack: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack, 12).getTime();
  const older = { ...request('older'), createdAt: at(8), expiresAt: at(8) + 60_000 };
  const verifiedToday = { ...request('verifiedtoday', 'wallet-a', 2100), createdAt: at(8), expiresAt: at(8) + 60_000 };
  const inWeek = { ...request('week', 'wallet-a', 3200), createdAt: at(6), expiresAt: at(6) + 60_000 };
  const unpaidToday = { ...request('unpaidtoday', 'wallet-a', 4300), createdAt: at(0), expiresAt: at(0) + 60_000 };
  await recordTerminalSale(older);
  await updateTerminalSalePayment(older, { status: 'received' }, at(8));
  await recordTerminalSale(verifiedToday);
  await updateTerminalSalePayment(verifiedToday, { status: 'received' }, at(0));
  await recordTerminalSale(inWeek);
  await updateTerminalSalePayment(inWeek, { status: 'received' }, at(6));
  await recordTerminalSale(unpaidToday);

  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText(/2 100 sats, Paid/)).toBeTruthy());
  expect(view.queryByLabelText(/3 200 sats, Paid/)).toBeNull();
  expect(view.getByText('By local verification date')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(view.getByLabelText(/2 100 sats, Paid/)).toBeTruthy();
  expect(view.getByLabelText(/3 200 sats, Paid/)).toBeTruthy();
  expect(view.queryByLabelText(/1 200 sats, Paid/)).toBeNull();
  expect(view.getByText('5 300 sats')).toBeTruthy();
  expect(view.getByText('LAST 7 DAYS’ ACTIVITY')).toBeTruthy();
  const start = new Date(at(6)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const end = new Date(at(0)).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  expect(view.getByText(`${start} – ${end}`)).toBeTruthy();
  fireEvent.press(view.getByLabelText('This month sales'));
  expect(view.getByText('THIS MONTH’S ACTIVITY')).toBeTruthy();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  expect(view.getByText(`${monthStart} – ${end}`)).toBeTruthy();
  fireEvent.press(view.getByLabelText('All sales'));
  expect(view.getByLabelText(/1 200 sats, Paid/)).toBeTruthy();
  expect(view.getByText('6 500 sats')).toBeTruthy();
});

it('shows completed refunds in a period even when no sale is listed there', async () => {
  const today = new Date();
  const at = (daysBack: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysBack, 12).getTime();
  const sale = { ...request('refundedold'), createdAt: at(8), expiresAt: at(8) + 60_000 };
  await recordTerminalSale(sale);
  await updateTerminalSalePayment(sale, { status: 'received' }, at(8));
  await AsyncStorage.setItem('@terminalRefunds:v1:mainnet:wallet-a', JSON.stringify({ version: 1, attempts: [{
    id: 'refund-only', walletId: 'wallet-a', network: 'mainnet', saleId: sale.id, saleInvoice: sale.invoice,
    invoice: 'lnbcrefundonly', amountSats: 500, feeSats: 0, quoteExpiresAt: at(0) + 60_000,
    createdAt: at(0), status: 'complete', updatedAt: at(0),
  }] }));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('500 sats')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(view.getByText('No sales in this period')).toBeTruthy();
  expect(view.getByText('No paid sales in this period')).toBeTruthy();
  expect(view.getByText('500 sats')).toBeTruthy();
  expect(view.queryByLabelText(/1 200 sats, Paid/)).toBeNull();
});

it('keeps the chosen period when returning from details and resets it for a new wallet', async () => {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12).getTime();
  await recordTerminalSale({ ...request('yesterday'), createdAt: yesterday, expiresAt: yesterday + 60_000 });
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  fireEvent.press(view.getByLabelText(/1 200 sats, Expired/));
  expect(view.getByText('Sale details')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(view.getByLabelText('Last 7 days sales').props.accessibilityState.selected).toBe(true);
  expect(view.getByLabelText(/1 200 sats, Expired/)).toBeTruthy();
  view.rerender(<TerminalSalesScreen walletId="wallet-b" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByLabelText('Today sales').props.accessibilityState.selected).toBe(true));
  expect(view.queryByLabelText(/1 200 sats, Expired/)).toBeNull();
});

it('invalidates pending export callbacks when period changes, even if it changes back', async () => {
  let finish!: (value: boolean) => void;
  (exportTerminalSalesCsv as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('No sales today')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Export today’s activity'));
  const first = (exportTerminalSalesCsv as jest.Mock).mock.calls[0][0];
  expect(first.isCurrent()).toBe(true);
  fireEvent.press(view.getByLabelText('Last 7 days sales'));
  expect(first.isCurrent()).toBe(false);
  fireEvent.press(view.getByLabelText('Today sales'));
  expect(first.isCurrent()).toBe(false);
  await act(async () => { finish(false); });
  await act(async () => { fireEvent.press(view.getByLabelText('Export today’s activity')); });
  expect(exportTerminalSalesCsv).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'today', day: expect.any(Date) }));
  expect(exportTerminalSalesCsv).toHaveBeenCalledTimes(2);
});

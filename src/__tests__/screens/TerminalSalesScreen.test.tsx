import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TerminalSalesScreen from '../../screens/TerminalSalesScreen';
import { useWallet } from '../../contexts/WalletContext';
import { recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';
import { TerminalRequest } from '../../services/terminal';

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

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
  (useWallet as jest.Mock).mockReturnValue({
    activeWallet: { id: 'wallet-a' }, isLightningInitialized: true,
    validateTerminalInvoice, verifyTerminalInvoice,
  });
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
  await waitFor(() => expect(view.getByText('No activity today')).toBeTruthy());
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
});

it('shows a retry state when saved sales cannot be read', async () => {
  await AsyncStorage.setItem('@terminalSales:v1:mainnet:wallet-a', '{broken');
  const view = render(<TerminalSalesScreen walletId="wallet-a" network="mainnet" onClose={jest.fn()} />);
  await waitFor(() => expect(view.getByText('Sales unavailable')).toBeTruthy());
  expect(view.getByText('Retry')).toBeTruthy();
  expect(view.queryByText('No paid sales today')).toBeNull();
});

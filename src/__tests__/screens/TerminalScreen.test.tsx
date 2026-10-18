import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TerminalScreen from '../../screens/TerminalScreen';
import { useWallet } from '../../contexts/WalletContext';

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: () => ({ setMode: jest.fn(), changing: false }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

const wallet = { id: 'wallet-a', name: 'Shop', type: 'standard' };
const createTerminalInvoice = jest.fn();
const validateTerminalInvoice = jest.fn();
const verifyTerminalInvoice = jest.fn();

beforeEach(async () => {
  await AsyncStorage.clear();
  createTerminalInvoice.mockReset();
  validateTerminalInvoice.mockReset();
  verifyTerminalInvoice.mockReset().mockResolvedValue({ status: 'unknown' });
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: wallet, isLightningInitialized: true, lightningInitAttempted: true, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
});

it('blocks duplicate presses and reveals the QR only after storage succeeds', async () => {
  let resolveInvoice!: (value: { invoice: string; expiresAt: number }) => void;
  createTerminalInvoice.mockImplementation(() => new Promise(resolve => { resolveInvoice = resolve; }));
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  fireEvent.press(view.getByTestId('terminal-request'));
  expect(createTerminalInvoice).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Scan to pay with Lightning')).toBeNull();
  resolveInvoice({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  await waitFor(() => expect(view.getByText('Scan to pay with Lightning')).toBeTruthy());
});

it('does not show a QR if persisting the invoice fails', async () => {
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(view.getByText('storage full')).toBeTruthy());
  expect(view.queryByText('Scan to pay with Lightning')).toBeNull();
  jest.restoreAllMocks();
});

it('discards an invoice response after the active wallet changes', async () => {
  let resolveInvoice!: (value: { invoice: string; expiresAt: number }) => void;
  createTerminalInvoice.mockImplementation(() => new Promise(resolve => { resolveInvoice = resolve; }));
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { ...wallet, id: 'wallet-b' }, isLightningInitialized: true, lightningInitAttempted: true, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
  view.rerender(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  resolveInvoice({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  await waitFor(() => expect(view.queryByText('Scan to pay with Lightning')).toBeNull());
});

it('cannot overwrite an unread saved request after keypad input, and retries hydration', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage read failed'));
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Retry loading')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  expect(view.getByText('Retry loading')).toBeTruthy();
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  expect(createTerminalInvoice).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

it('hides a restored invoice until its amount, network, and expiry are validated by the SDK', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:Bitcoin:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'Bitcoin', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockRejectedValueOnce(new Error('mismatched invoice')).mockResolvedValueOnce(expiresAt);
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Cannot validate request')).toBeTruthy());
  expect(view.queryByText('Scan to pay with Lightning')).toBeNull();
  expect(view.queryByText('1200 sats')).toBeNull();
  expect(view.queryByText('Copy invoice')).toBeNull();
  fireEvent.press(view.getByText('Retry validation'));
  await waitFor(() => expect(view.getByText('Scan to pay with Lightning')).toBeTruthy());
  expect(validateTerminalInvoice).toHaveBeenCalledWith('lnbc123abc', 1200);
});

it('allows verification of the next request after ending one with a check in flight', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:Bitcoin:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'Bitcoin', invoice: 'lnbc123abc', amountSats: 1,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  let finishFirst!: (value: { status: string }) => void;
  verifyTerminalInvoice.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValue({ status: 'unknown' });
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc456def', expiresAt });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.(); });
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Scan to pay with Lightning')).toBeTruthy());
  await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByText('End request'));
  await waitFor(() => expect(view.getByText('Request payment')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(2));
  finishFirst({ status: 'received' });
  jest.restoreAllMocks();
});

it('shows controls for a saved request while Lightning is disconnected without exposing the invoice', async () => {
  await AsyncStorage.setItem('@terminalActiveRequest:Bitcoin:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'Bitcoin', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt: Date.now() + 60000,
  }));
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: wallet, isLightningInitialized: false, lightningInitAttempted: true, lightningInitError: 'Connection unavailable', createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
  const view = render(<TerminalScreen />);
  await waitFor(() => expect(view.getByText('Checking saved request')).toBeTruthy());
  expect(view.getByText('End request')).toBeTruthy();
  expect(view.getByText('Exit terminal')).toBeTruthy();
  expect(view.getByText('Connection unavailable')).toBeTruthy();
  expect(view.queryByText('Scan to pay with Lightning')).toBeNull();
  expect(view.queryByText('1200 sats')).toBeNull();
  expect(validateTerminalInvoice).not.toHaveBeenCalled();
});

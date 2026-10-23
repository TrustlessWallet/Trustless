import React from 'react';
import { Alert, Modal } from 'react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TerminalScreen, { isTerminalPollDue } from '../../screens/TerminalScreen';
import { GlassView } from '../../components/GlassView';
import { useWallet } from '../../contexts/WalletContext';
import { clearTerminalRateCacheForTests } from '../../services/terminalRates';
import { listTerminalSales, recordTerminalSale, updateTerminalSalePayment } from '../../services/terminalSales';

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
const mockSetMode = jest.fn();
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: () => ({ setMode: mockSetMode, changing: false, cashierState: 'off', cashierBusy: false, consumeCashierTerminalDraft: () => null }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' }, LAYOUT: { radius: 8, inputHeight: 48 } } }) }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-qrcode-svg', () => 'QRCode');
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()), notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('uuid', () => ({ v4: () => 'refund-test-id' }));

const wallet = { id: 'wallet-a', name: 'Shop', type: 'standard' };
const createTerminalInvoice = jest.fn();
const validateTerminalInvoice = jest.fn();
const verifyTerminalInvoice = jest.fn();

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSetMode.mockClear();
  clearTerminalRateCacheForTests();
  createTerminalInvoice.mockReset();
  validateTerminalInvoice.mockReset();
  verifyTerminalInvoice.mockReset().mockResolvedValue({ status: 'unknown' });
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: wallet, isLightningInitialized: true, lightningInitAttempted: true, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
});

const renderWithCurrencyMeasurement = () => render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
const visibleScreen = (node: any): boolean => {
  for (let parent = node; parent; parent = parent.parent) {
    if (parent.type === 'RNSScreen' || parent.type === 'RNSModalScreen') return parent.props['aria-hidden'] === false;
  }
  return false;
};

const openCurrency = async (view: ReturnType<typeof render>) => {
  const row = view.getByLabelText('Currency');
  row.parent!.instance.measureInWindow.mockImplementation((callback: (x: number, y: number, width: number, height: number) => void) => callback(24, 180, 272, 68));
  fireEvent.press(row);
  await waitFor(() => expect(view.getByLabelText('USD')).toBeTruthy());
};

it('runs a pending terminal check immediately after the device clock is corrected backward', () => {
  expect(isTerminalPollDue(10_000, 5_000, 9_000)).toBe(true);
  expect(isTerminalPollDue(10_000, 5_000, 14_000)).toBe(false);
});

it('preserves the entered amount and wallet mode after visiting Settings', async () => {
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByText('2'));
  fireEvent.press(view.getByLabelText('Terminal settings'));
  await waitFor(() => expect(view.getByLabelText('Close terminal settings')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(view.getByTestId('terminal-amount').props.children).toBe('12'));
  expect(mockSetMode).not.toHaveBeenCalled();
});

it('lets the owner save an item from Terminal Settings and use it at checkout', async () => {
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  fireEvent.press(view.getByLabelText('Manage items'));
  await waitFor(() => expect(view.getByLabelText('Add item')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Add item'));
  fireEvent.changeText(view.getByLabelText('Item name'), 'Tea');
  fireEvent.changeText(view.getByLabelText('Item price'), '250');
  fireEvent.press(view.getByLabelText('Save item'));
  await waitFor(() => expect(view.getByText('Tea')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Close items'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Items'));
  expect(view.getByLabelText('Add Tea')).toBeTruthy();
});

it('accepts a single decimal comma for item price and rejects mixed or excess precision', async () => {
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  fireEvent.press(view.getByLabelText('Manage items'));
  await waitFor(() => expect(view.getByLabelText('Add item')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Add item'));
  fireEvent.changeText(view.getByLabelText('Item name'), 'Tea');
  fireEvent.press(view.getByLabelText('Price in USD'));
  fireEvent.changeText(view.getByLabelText('Item price'), '1,2.3');
  fireEvent.press(view.getByLabelText('Save item'));
  expect(view.getByLabelText('Item price')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Item price'), '1,234');
  fireEvent.press(view.getByLabelText('Save item'));
  expect(view.getByLabelText('Item price')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Item price'), ' 1,25 ');
  fireEvent.press(view.getByLabelText('Save item'));
  await waitFor(() => expect(view.getByText('Tea')).toBeTruthy());
  const catalog = JSON.parse((await AsyncStorage.getItem('@terminalItems:v1:mainnet:wallet-a')) || '{}');
  expect(catalog.items[0].unitPrice).toBe(125);
});

it('opens currency choices from Settings and dismisses them outside or with the system back action', async () => {
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  expect(view.queryByLabelText('USD')).toBeNull();
  await openCurrency(view);
  expect(view.getByLabelText('USD')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Dismiss currencies'));
  expect(view.queryByLabelText('USD')).toBeNull();
  await openCurrency(view);
  fireEvent(view.UNSAFE_getByType(Modal), 'onRequestClose');
  expect(view.queryByLabelText('USD')).toBeNull();
});

it('charges a fiat amount using a fresh quote and keeps the frozen amount beside the invoice', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000.12345678' } } }) });
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  await openCurrency(view);
  fireEvent.press(view.getByLabelText('USD'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(visibleScreen(view.getByTestId('terminal-request'))).toBe(true));
  await waitFor(() => expect(view.queryByText('Price unavailable')).toBeNull());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByText('0'));
  fireEvent.press(view.getByText('0'));
  await waitFor(() => expect(view.getByText('≈ 100 000 sats')).toBeTruthy());
  await waitFor(() => expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(false));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(createTerminalInvoice).toHaveBeenCalledWith(100000));
  await waitFor(() => expect(view.getByTestId('terminal-checkout-number').props.children).toBe('100.00'));
  expect(view.getByText('100 000 sats')).toBeTruthy();
  expect(view.queryByLabelText('Terminal settings')).toBeNull();
  expect(view.getByLabelText('Terminal settings', { includeHiddenElements: true })).toBeTruthy();
  expect(createTerminalInvoice).toHaveBeenCalledTimes(1);
  const raw = await AsyncStorage.getItem('@terminalActiveRequest:mainnet:wallet-a');
  expect(JSON.parse(raw || '{}').fiat).toEqual({ currency: 'USD', amountMinor: 10000, rate: '100000', fetchedAt: expect.any(Number) });
});

it('quotes rapid basket quantity changes from one fiat grand total and freezes selected items', async () => {
  await AsyncStorage.setItem('@terminalItems:v1:mainnet:wallet-a', JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [{ id: 'coffee', name: 'Coffee', unit: 'USD', unitPrice: 1 }] }));
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '60000', EUR: '90000', CHF: '80000' } } }) });
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  await openCurrency(view);
  fireEvent.press(view.getByLabelText('USD'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Items'));
  fireEvent.press(view.getByLabelText('Add Coffee'));
  fireEvent.press(view.getByLabelText('Add one Coffee'));
  fireEvent.press(view.getByLabelText('Add one Coffee'));
  fireEvent.press(view.getByLabelText('Close item picker'));
  await waitFor(() => expect(view.getByTestId('terminal-request')).toBeTruthy());
  fireEvent.press(view.getByTestId('terminal-request'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(createTerminalInvoice).toHaveBeenCalledWith(50));
  expect(createTerminalInvoice).toHaveBeenCalledTimes(1);
  const raw = await AsyncStorage.getItem('@terminalActiveRequest:mainnet:wallet-a');
  expect(JSON.parse(raw || '{}').basket).toEqual({ unit: 'USD', total: 3, lines: [{ itemId: 'coffee', name: 'Coffee', unitPrice: 1, quantity: 3, total: 3 }] });
});

it('keeps the first item currency when two different currencies are tapped rapidly', async () => {
  await AsyncStorage.setItem('@terminalItems:v1:mainnet:wallet-a', JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [
    { id: 'eur', name: 'Euro item', unit: 'EUR', unitPrice: 125 },
    { id: 'usd', name: 'Dollar item', unit: 'USD', unitPrice: 200 },
  ] }));
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Items'));
  act(() => {
    fireEvent.press(view.getByLabelText('Add Euro item'));
    fireEvent.press(view.getByLabelText('Add Dollar item'));
  });
  expect(view.getByLabelText('Add Dollar item').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByLabelText('Close item picker'));
  expect(view.getByTestId('terminal-amount').props.children).toBe('1.25');
  expect(view.getByText('€')).toBeTruthy();
});

it('does not let a delayed preferred currency reinterpret an active basket', async () => {
  await AsyncStorage.setItem('@terminalItems:v1:mainnet:wallet-a', JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [{ id: 'tea', name: 'Tea', unit: 'sats', unitPrice: 250 }] }));
  const getItem = AsyncStorage.getItem as jest.Mock;
  const priorGetItem = getItem.getMockImplementation()!;
  let finishPreference!: (value: string) => void;
  getItem.mockImplementation((key: string) => key === '@terminalPreferredUnit' ? new Promise(resolve => { finishPreference = resolve; }) : priorGetItem(key));
  try {
    const view = renderWithCurrencyMeasurement();
    await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
    fireEvent.press(view.getByLabelText('Items'));
    fireEvent.press(view.getByLabelText('Add Tea'));
    fireEvent.press(view.getByLabelText('Close item picker'));
    expect(view.getByTestId('terminal-amount').props.children).toBe('250');
    await act(async () => { finishPreference('USD'); });
    expect(view.getByTestId('terminal-amount').props.children).toBe('250');
    expect(view.getByText('sats')).toBeTruthy();
  } finally { getItem.mockImplementation(priorGetItem); }
});

it('keeps manual entry on dismissal and returns to zero after removing the last item', async () => {
  await AsyncStorage.setItem('@terminalItems:v1:mainnet:wallet-a', JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [{ id: 'tea', name: 'Tea', unit: 'sats', unitPrice: 250 }] }));
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
  fireEvent.press(view.getByText('5'));
  fireEvent.press(view.getByLabelText('Items'));
  fireEvent.press(view.getByLabelText('Close item picker'));
  expect(view.getByTestId('terminal-amount').props.children).toBe('5');
  expect(createTerminalInvoice).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Items'));
  fireEvent.press(view.getByLabelText('Add Tea'));
  fireEvent.press(view.getByLabelText('Remove Tea'));
  fireEvent.press(view.getByLabelText('Close item picker'));
  fireEvent.press(view.getByTestId('terminal-request'));
  expect(createTerminalInvoice).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Items'));
  expect(view.queryByLabelText('Return to manual amount')).toBeNull();
  fireEvent.press(view.getByLabelText('Close item picker'));
  expect(view.getByTestId('terminal-amount').props.children).toBe('0');
});

it('requires an available rate before charging in fiat', async () => {
  (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Terminal settings'));
  await openCurrency(view);
  fireEvent.press(view.getByLabelText('EUR'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(view.getByText('Refresh price')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  expect(view.getByText('Price expired. Refresh price before charging.')).toBeTruthy();
  expect(createTerminalInvoice).not.toHaveBeenCalled();
});

it('does not reinterpret entered sats when the saved denomination loads late', async () => {
  const readMock = AsyncStorage.getItem as jest.Mock;
  const originalRead = readMock.getMockImplementation()!;
  let finish!: (unit: string) => void;
  readMock.mockImplementation(key => key === '@terminalPreferredUnit'
    ? new Promise(resolve => { finish = resolve; }) : originalRead(key));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  await act(async () => { finish('BTC'); });
  expect(view.getByTestId('terminal-amount').props.children).toBe('1');
  expect(view.getAllByText('sats').length).toBeGreaterThan(0);
  readMock.mockImplementation(originalRead);
});

it('restores the frozen fiat amount without requesting a new exchange rate', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'fiat-saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc',
    amountSats: 100000, createdAt: Date.now(), expiresAt,
    fiat: { currency: 'USD', amountMinor: 10000, rate: '100000', fetchedAt: Date.now() - 100000 },
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  (global as any).fetch = jest.fn();
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByTestId('terminal-checkout-number').props.children).toBe('100.00'));
  expect(view.getByText('100 000 sats')).toBeTruthy();
  expect(view.getByTestId('terminal-qr')).toBeTruthy();
  expect((global as any).fetch).not.toHaveBeenCalled();
});

it('keeps a validated QR visible while a payment check is temporarily unavailable', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  verifyTerminalInvoice.mockRejectedValueOnce(new Error('offline'));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Cannot verify payment right now. The invoice may still be paid.')).toBeTruthy());
  expect(view.getByTestId('terminal-qr')).toBeTruthy();
});

it('closes an active invoice back to amount entry without leaving Terminal', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Close invoice'));
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  expect(view.queryByTestId('terminal-qr')).toBeNull();
  expect((await listTerminalSales('wallet-a', 'mainnet'))).toHaveLength(1);
});

it.each([false, true])('holds the invoice sheet until durable close settles (clear fails: %s)', async clearFails => {
  const expiresAt = Date.now() + 60000;
  const activeKey = '@terminalActiveRequest:mainnet:wallet-a';
  await AsyncStorage.setItem(activeKey, JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const removeMock = AsyncStorage.removeItem as jest.Mock;
  const originalRemove = removeMock.getMockImplementation()!;
  let finish!: () => void;
  let removals = 0;
  removeMock.mockImplementation((key: string) => key === activeKey ? new Promise<void>((resolve, reject) => {
    removals += 1;
    finish = () => clearFails ? reject(new Error('storage failed')) : void originalRemove(key).then(resolve, reject);
  }) : originalRemove(key));
  const view = renderWithCurrencyMeasurement();
  try {
    await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
    fireEvent.press(view.getByLabelText('Close invoice'));
    fireEvent.press(view.getByLabelText('Close invoice'));
    await waitFor(() => expect(finish).toBeDefined());
    expect(removals).toBe(1);
    expect(view.getByTestId('terminal-qr')).toBeTruthy();
    await act(async () => { finish(); });
    if (clearFails) {
      await waitFor(() => expect(view.getByText('Could not end the saved request. Please retry.')).toBeTruthy());
      expect(view.getByTestId('terminal-qr')).toBeTruthy();
      expect(await AsyncStorage.getItem(activeKey)).not.toBeNull();
    } else {
      await waitFor(() => expect(view.queryByTestId('terminal-qr')).toBeNull());
      expect(await AsyncStorage.getItem(activeKey)).toBeNull();
    }
  } finally { removeMock.mockImplementation(originalRemove); view.unmount(); }
});

it.each([false, true])('keeps a new wallet request intact when ending the old wallet request settles (clear fails: %s)', async clearFails => {
  const expiresAt = Date.now() + 60000;
  const oldKey = '@terminalActiveRequest:mainnet:wallet-a';
  const newKey = '@terminalActiveRequest:mainnet:wallet-b';
  const oldRequest = { id: 'old', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcold123', amountSats: 1200, createdAt: Date.now(), expiresAt };
  const newRequest = { ...oldRequest, id: 'new', walletId: 'wallet-b', invoice: 'lnbcnew123', amountSats: 2300 };
  await AsyncStorage.setItem(oldKey, JSON.stringify(oldRequest));
  await AsyncStorage.setItem(newKey, JSON.stringify(newRequest));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());

  const removeMock = AsyncStorage.removeItem as jest.Mock;
  const originalRemove = removeMock.getMockImplementation()!;
  let finishOldClear!: () => void;
  let held = false;
  removeMock.mockImplementation(key => {
    if (key === oldKey && !held) {
      held = true;
      return new Promise<void>((resolve, reject) => {
        finishOldClear = () => {
          if (clearFails) reject(new Error('old wallet storage failed'));
          else void originalRemove(key).then(resolve, reject);
        };
      });
    }
    return originalRemove(key);
  });
  try {
    fireEvent.press(view.getByLabelText('Close invoice'));
    await waitFor(() => expect(finishOldClear).toBeDefined());
    (useWallet as jest.Mock).mockReturnValue({ activeWallet: { ...wallet, id: 'wallet-b' }, isLightningInitialized: true, lightningInitAttempted: true, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
    view.rerender(<NavigationContainer><TerminalScreen /></NavigationContainer>);
    await act(async () => { finishOldClear(); });
    await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
    expect(view.getByTestId('terminal-checkout-number').props.children).toBe('2 300');
    expect(view.queryByText('Could not end the saved request. Please retry.')).toBeNull();
    expect(await AsyncStorage.getItem(newKey)).not.toBeNull();
    expect(await AsyncStorage.getItem(oldKey)).toBe(clearFails ? JSON.stringify(oldRequest) : null);
  } finally { removeMock.mockImplementation(originalRemove); view.unmount(); }
});

it('restores a paid invoice and keeps its sale after guarded sheet closing', async () => {
  const expiresAt = Date.now() + 60000;
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt });
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('2'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
  expect(view.getByLabelText('Close invoice')).toBeTruthy();
  expect(createTerminalInvoice).toHaveBeenCalledTimes(1);
  view.unmount();
  const [sale] = await listTerminalSales('wallet-a', 'mainnet');
  await updateTerminalSalePayment(sale.request, { status: 'received', paymentId: 'paid-one' });
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const resumed = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  // A temporarily incomplete SDK query cannot turn a known paid sale unpaid.
  await waitFor(() => expect(resumed.getByText('Paid')).toBeTruthy());
  fireEvent.press(resumed.getByLabelText('Close invoice'));
  await waitFor(() => expect(resumed.getByText('Generate invoice')).toBeTruthy());
  expect((await listTerminalSales('wallet-a', 'mainnet'))[0].status).toBe('received');
});

it('clears a nonzero amount when changing into a fiat currency', async () => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByLabelText('Terminal settings'));
  await openCurrency(view);
  fireEvent.press(view.getByLabelText('USD'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  await waitFor(() => expect(view.getByTestId('terminal-amount').props.children).toBe('0'));
});

it('blocks duplicate presses and reveals the QR only after storage succeeds', async () => {
  let resolveInvoice!: (value: { invoice: string; expiresAt: number }) => void;
  createTerminalInvoice.mockImplementation(() => new Promise(resolve => { resolveInvoice = resolve; }));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  fireEvent.press(view.getByTestId('terminal-request'));
  expect(createTerminalInvoice).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Generating invoice').props.color).toBe('#f90');
  expect(view.queryByText('Creating invoice…')).toBeNull();
  expect(view.queryByTestId('terminal-qr')).toBeNull();
  resolveInvoice({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
});

it('does not show a QR if persisting the invoice fails', async () => {
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage full'));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(view.getByText('storage full')).toBeTruthy());
  expect(view.queryByTestId('terminal-qr')).toBeNull();
  jest.restoreAllMocks();
});

it('discards an invoice response after the active wallet changes', async () => {
  let resolveInvoice!: (value: { invoice: string; expiresAt: number }) => void;
  createTerminalInvoice.mockImplementation(() => new Promise(resolve => { resolveInvoice = resolve; }));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { ...wallet, id: 'wallet-b' }, isLightningInitialized: true, lightningInitAttempted: true, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
  view.rerender(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  resolveInvoice({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  await waitFor(() => expect(view.queryByTestId('terminal-qr')).toBeNull());
});

it('cannot overwrite an unread saved request after keypad input, and retries hydration', async () => {
  const readMock = AsyncStorage.getItem as jest.Mock;
  const originalRead = readMock.getMockImplementation()!;
  let failed = false;
  readMock.mockImplementation(key => {
    if (!failed && key.startsWith('@terminalActiveRequest')) { failed = true; return Promise.reject(new Error('storage read failed')); }
    return originalRead(key);
  });
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc123abc', expiresAt: Date.now() + 60000 });
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Retry loading')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  expect(view.getByText('Retry loading')).toBeTruthy();
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  expect(createTerminalInvoice).not.toHaveBeenCalled();
  readMock.mockImplementation(originalRead);
});

it('hides a restored invoice until its amount, network, and expiry are validated by the SDK', async () => {
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockRejectedValueOnce(new Error('mismatched invoice')).mockResolvedValueOnce(expiresAt);
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Cannot validate request')).toBeTruthy());
  expect(view.queryByTestId('terminal-qr')).toBeNull();
  expect(view.queryByText('1200 sats')).toBeNull();
  expect(view.queryByText('Copy')).toBeNull();
  fireEvent.press(view.getByText('Retry validation'));
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
  expect(validateTerminalInvoice).toHaveBeenCalledWith('lnbc123abc', 1200);
});

it('allows verification of the next request after ending one with a check in flight', async () => {
  const expiresAt = Date.now() + 60000;
  const createdAt = Date.now() - 1000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1,
    createdAt, expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  let finishFirst!: (value: { status: string }) => void;
  verifyTerminalInvoice.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValue({ status: 'unknown' });
  createTerminalInvoice.mockResolvedValue({ invoice: 'lnbc456def', expiresAt });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.(); });
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
  await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(1));
  expect(verifyTerminalInvoice).toHaveBeenCalledWith('lnbc123abc', createdAt, undefined, false);
  fireEvent.press(view.getByLabelText('Close invoice'));
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  fireEvent.press(view.getByText('1'));
  fireEvent.press(view.getByTestId('terminal-request'));
  await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(2));
  finishFirst({ status: 'received' });
  jest.restoreAllMocks();
});

it('shows controls for a saved request while Lightning is disconnected without exposing the invoice', async () => {
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'saved', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt: Date.now() + 60000,
  }));
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: wallet, isLightningInitialized: false, lightningInitAttempted: true, lightningInitError: 'Connection unavailable', createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice });
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  await waitFor(() => expect(view.getByText('Checking saved request')).toBeTruthy());
  expect(view.queryByText('End request')).toBeNull();
  expect(view.getByLabelText('Close invoice')).toBeTruthy();
  expect(view.getByText('Connection unavailable')).toBeTruthy();
  expect(view.queryByTestId('terminal-qr')).toBeNull();
  expect(view.queryByText('1200 sats')).toBeNull();
  expect(validateTerminalInvoice).not.toHaveBeenCalled();
});


it('pauses invoice polling while another route covers Terminal', async () => {
  jest.useFakeTimers();
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'covered', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  try {
    await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(1));
    view.rerender(<NavigationContainer><TerminalScreen visible={false} /></NavigationContainer>);
    await act(async () => { jest.advanceTimersByTime(12000); });
    expect(verifyTerminalInvoice).toHaveBeenCalledTimes(1);
    view.rerender(<NavigationContainer><TerminalScreen visible={true} /></NavigationContainer>);
    await waitFor(() => expect(verifyTerminalInvoice).toHaveBeenCalledTimes(2));
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});


it('keeps saved-request hydration from creating a second invoice', async () => {
  const read = AsyncStorage.getItem as jest.Mock;
  const original = read.getMockImplementation()!;
  let finish!: (value: null) => void;
  read.mockImplementation(key => key === '@terminalActiveRequest:mainnet:wallet-a'
    ? new Promise(resolve => { finish = resolve; }) : original(key));
  const view = render(<NavigationContainer><TerminalScreen /></NavigationContainer>);
  try {
    await waitFor(() => expect(finish).toBeDefined());
    expect(view.getByText('Generate invoice')).toBeTruthy();
    fireEvent.press(view.getByTestId('terminal-request'));
    expect(createTerminalInvoice).not.toHaveBeenCalled();
    await act(async () => { finish(null); });
  } finally { view.unmount(); read.mockImplementation(original); }
});


it('preloads local sales before Sales opens and keeps them current while hidden', async () => {
  const saved = {
    id: 'preloaded-sale', walletId: 'wallet-a', network: 'mainnet' as const,
    invoice: 'lnbcprefetchedabc', amountSats: 2100,
    createdAt: Date.now(), expiresAt: Date.now() + 60000,
  };
  await recordTerminalSale(saved);
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Unpaid', { includeHiddenElements: true })).toBeTruthy());
  await act(async () => { await updateTerminalSalePayment(saved, { status: 'received' }); });
  await waitFor(() => expect(view.getByText('Paid', { includeHiddenElements: true })).toBeTruthy());
  fireEvent.press(view.getByLabelText('Sales'));
  expect(view.getByText('Paid')).toBeTruthy();
  expect(view.queryByText('Loading sales…')).toBeNull();
});

it('restores sheet close and export after a cancelled native gesture', async () => {
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByLabelText('Sales')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Sales'));
  await waitFor(() => expect(view.getByLabelText('Close sales')).toBeTruthy());

  const listeners = view.UNSAFE_root.find(node => node.props.screenListeners?.transitionStart).props.screenListeners;
  const button = (label: string) => view.UNSAFE_root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  const close = () => button('Close sales');
  const exportButton = () => button('Export today’s activity');
  const glassIsInteractive = (button: ReturnType<typeof close>) => button.findByType(GlassView).props.interactive;

  expect(close().props.disabled).toBe(false);
  expect(exportButton().props.disabled).toBe(false);
  expect(glassIsInteractive(close())).toBe(true);
  expect(glassIsInteractive(exportButton())).toBe(true);

  act(() => listeners.transitionStart());
  expect(close().props.disabled).toBe(true);
  expect(exportButton().props.disabled).toBe(true);
  expect(glassIsInteractive(close())).toBe(false);
  expect(glassIsInteractive(exportButton())).toBe(false);

  // A cancelled iOS sheet gesture emits gestureCancel without transitionEnd.
  act(() => listeners.gestureCancel());
  expect(close().props.disabled).toBe(false);
  expect(exportButton().props.disabled).toBe(false);
  expect(glassIsInteractive(close())).toBe(true);
  expect(glassIsInteractive(exportButton())).toBe(true);
  view.unmount();
});


it('expires an invoice without a one-second redraw interval and rechecks after returning', async () => {
  jest.useFakeTimers();
  const expiresAt = Date.now() + 2000;
  await AsyncStorage.setItem('@terminalActiveRequest:mainnet:wallet-a', JSON.stringify({
    id: 'expiry', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbcexpiryabc', amountSats: 1200,
    createdAt: Date.now(), expiresAt,
  }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const interval = jest.spyOn(global, 'setInterval');
  const view = renderWithCurrencyMeasurement();
  try {
    await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
    expect(interval.mock.calls.some(call => call[1] === 1000)).toBe(false);
    view.rerender(<NavigationContainer><TerminalScreen visible={false} /></NavigationContainer>);
    await act(async () => { jest.advanceTimersByTime(2500); });
    view.rerender(<NavigationContainer><TerminalScreen visible={true} /></NavigationContainer>);
    await waitFor(() => expect(view.getByText('Request expired')).toBeTruthy());
    expect(view.queryByTestId('terminal-qr')).toBeNull();
  } finally {
    view.unmount();
    interval.mockRestore();
    jest.useRealTimers();
  }
});


it.each([false, true])('allows a committed native dismissal without replay and retains recovery on clear failure (%s)', async clearFails => {
  const activeKey = '@terminalActiveRequest:mainnet:wallet-a';
  const expiresAt = Date.now() + 60000;
  await AsyncStorage.setItem(activeKey, JSON.stringify({ id: 'native-close', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc', amountSats: 1200, createdAt: Date.now(), expiresAt }));
  validateTerminalInvoice.mockResolvedValue(expiresAt);
  const removeMock = AsyncStorage.removeItem as jest.Mock;
  const originalRemove = removeMock.getMockImplementation()!;
  let finish!: () => void;
  let removals = 0;
  removeMock.mockImplementation((key: string) => key === activeKey ? new Promise<void>((resolve, reject) => {
    removals++;
    finish = () => clearFails ? reject(new Error('storage failed')) : void originalRemove(key).then(resolve, reject);
  }) : originalRemove(key));
  const navigation = createNavigationContainerRef<any>();
  const view = render(<NavigationContainer ref={navigation}><TerminalScreen /></NavigationContainer>);
  try {
    await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
    // Native-stack dispatches this removal after a successful gesture has dismissed the sheet.
    await act(async () => { navigation.goBack(); });
    await waitFor(() => expect(finish).toBeDefined());
    expect(navigation.getCurrentRoute()?.name).toBe('Checkout');
    expect(view.queryByTestId('terminal-qr')).toBeNull();
    expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(true);
    expect(removals).toBe(1);
    expect(createTerminalInvoice).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    if (clearFails) {
      await waitFor(() => expect(view.getByText('Resume invoice')).toBeTruthy());
      fireEvent.press(view.getByTestId('terminal-request'));
      await waitFor(() => expect(view.getByTestId('terminal-qr')).toBeTruthy());
      expect(await AsyncStorage.getItem(activeKey)).not.toBeNull();
      expect(createTerminalInvoice).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
      expect(await AsyncStorage.getItem(activeKey)).toBeNull();
    }
  } finally { removeMock.mockImplementation(originalRemove); view.unmount(); }
});


it('starts a fresh amount when changing basket currency without reinterpreting item prices', async () => {
  await AsyncStorage.setItem('@terminalItems:v1:mainnet:wallet-a', JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet', items: [{ id: 'coffee', name: 'Coffee', unit: 'USD', unitPrice: 350 }] }));
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByLabelText('Items')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Items'));
  fireEvent.press(view.getByLabelText('Add Coffee'));
  expect(view.queryByText(/Basket in/)).toBeNull();
  fireEvent.press(view.getByLabelText('Close item picker'));
  expect(view.getByTestId('terminal-amount').props.children).toBe('3.50');
  fireEvent.press(view.getByLabelText('Terminal settings'));
  expect(view.queryByLabelText('Clear basket')).toBeNull();
  await openCurrency(view);
  fireEvent.press(view.getByLabelText('EUR'));
  fireEvent.press(view.getByLabelText('Close terminal settings'));
  expect(view.getByTestId('terminal-amount').props.children).toBe('0');
  fireEvent.press(view.getByLabelText('Items'));
  expect(view.getByText('USD 3.50')).toBeTruthy();
  expect(view.getByLabelText('Add Coffee').props.accessibilityState.disabled).toBe(false);
});


it.each(['sats', 'BTC', 'USD'])('keeps Generate inactive for an empty or zero %s amount without showing validation copy', async unit => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { currency: 'BTC', rates: { USD: '100000', EUR: '90000', CHF: '80000' } } }) });
  const view = renderWithCurrencyMeasurement();
  await waitFor(() => expect(view.getByText('Generate invoice')).toBeTruthy());
  if (unit !== 'sats') {
    fireEvent.press(view.getByLabelText('Terminal settings'));
    await openCurrency(view);
    fireEvent.press(view.getByLabelText(unit));
    fireEvent.press(view.getByLabelText('Close terminal settings'));
  }
  expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByText('1'));
  expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(false);
  fireEvent.press(view.getByText('⌫'));
  expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getAllByText('0').slice(-1)[0]);
  if (unit !== 'sats') { fireEvent.press(view.getByText('.')); fireEvent.press(view.getAllByText('0').slice(-1)[0]); }
  expect(view.getByTestId('terminal-request').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByTestId('terminal-request'));
  expect(createTerminalInvoice).not.toHaveBeenCalled();
  expect(view.queryByText(/Enter an amount|Enter a valid amount|Enter BTC/)).toBeNull();
});

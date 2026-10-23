import React from 'react';
import { ActivityIndicator } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWallet } from '../../contexts/WalletContext';
import { useAddressDetails } from '../../hooks/useAddressDetails';
import AddressDetailsScreen from '../../screens/AddressDetailsScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn(), useRoute: jest.fn(), useIsFocused: () => true }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: { colors: { background: '#000', surface: '#222', primary: '#fff', border: '#333', muted: '#888', bitcoin: '#f90' } } }) }));
jest.mock('../../hooks/useAddressDetails', () => ({ useAddressDetails: jest.fn() }));
jest.mock('../../components/StyledText', () => ({ Text: require('react-native').Text }));
jest.mock('../../components/GlassIconButton', () => ({ __esModule: true, default: ({ children, onPress }: any) => require('react').createElement(require('react-native').TouchableOpacity, { onPress }, children) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: ({ value }: { value: string }) => require('react').createElement(require('react-native').Text, { testID: 'address-qr' }, value) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const address = 'bc1qexampleaddress123456789';
const query = (data?: unknown, overrides: Record<string, unknown> = {}) => ({
  data, isPending: data === undefined, isError: false, isFetching: data === undefined,
  refetch: jest.fn().mockResolvedValue(undefined), ...overrides,
});
const queries = (balance = query(), utxos = query(), transactions = query()) => ({ balance, utxos, transactions });

beforeEach(() => {
  jest.clearAllMocks();
  (useRoute as jest.Mock).mockReturnValue({ params: { address } });
  (useNavigation as jest.Mock).mockReturnValue({ setOptions: jest.fn(), goBack: jest.fn(), navigate: jest.fn() });
  (useWallet as jest.Mock).mockReturnValue({
    activeWallet: { id: 'wallet-1', scriptType: 'p2wpkh', derivedReceiveAddresses: [{ address, index: 0 }], derivedChangeAddresses: [] },
    getUtxoLabel: jest.fn(), updateUtxoLabel: jest.fn(), updateAddressLabel: jest.fn(),
  });
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');
  (useAddressDetails as jest.Mock).mockReturnValue(queries());
});

it('shows the QR and actions while all address data is pending', () => {
  const view = render(<AddressDetailsScreen />);
  expect(view.getByTestId('address-qr')).toBeTruthy();
  expect(view.getByText('Copy')).toBeTruthy();
  expect(view.getByText('View')).toBeTruthy();
  expect(view.getByText('Share')).toBeTruthy();
  expect(view.getByLabelText('Loading balance')).toBeTruthy();
  expect(view.getByLabelText('Loading spendable coins')).toBeTruthy();
  expect(view.getByLabelText('Loading transaction history')).toBeTruthy();
  expect(view.queryByText('No UTXOs found')).toBeNull();
});

it('keeps a fetched balance masked until the privacy preference resolves', async () => {
  let resolvePreference!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValue(new Promise(resolve => { resolvePreference = resolve; }));
  (useAddressDetails as jest.Mock).mockReturnValue(queries(query(100_000_000), query([]), query([])));
  const view = render(<AddressDetailsScreen />);
  expect(view.getByText('*******')).toBeTruthy();
  expect(view.queryByText(/1\.00000000/)).toBeNull();
  await act(async () => { resolvePreference('false'); });
  await waitFor(() => expect(view.getByText(/1\.00000000/)).toBeTruthy());
});

it('keeps cached data visible on refresh failure and retries only that section', () => {
  const balance = query(100_000_000, { isError: true, isFetching: false });
  const utxos = query([], { isError: true, isFetching: false });
  const transactions = query([]);
  (useAddressDetails as jest.Mock).mockReturnValue(queries(balance, utxos, transactions));
  const view = render(<AddressDetailsScreen />);
  expect(view.getByText('Could not refresh balance.')).toBeTruthy();
  expect(view.getByText('Could not refresh spendable coins.')).toBeTruthy();
  expect(view.getByText('No UTXOs found')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Retry balance'));
  expect(balance.refetch).toHaveBeenCalledTimes(1);
  expect(utxos.refetch).not.toHaveBeenCalled();
  expect(transactions.refetch).not.toHaveBeenCalled();
});

it('disables repeated retry during fetch and shows the section refresh spinner', () => {
  const balance = query(100, { isError: true, isFetching: true });
  (useAddressDetails as jest.Mock).mockReturnValue(queries(balance, query([]), query([])));
  const view = render(<AddressDetailsScreen />);
  const retry = view.getByLabelText('Retry balance');
  expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(retry.findByType(ActivityIndicator)).toBeTruthy();
  expect(view.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
  fireEvent.press(retry);
  expect(balance.refetch).not.toHaveBeenCalled();
});

it('indicates a background refresh without replacing cached balance or duplicating spinners', () => {
  (useAddressDetails as jest.Mock).mockReturnValue(queries(query(100, { isFetching: true }), query([]), query([])));
  const view = render(<AddressDetailsScreen />);
  expect(view.getByLabelText('Refreshing balance')).toBeTruthy();
  expect(view.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
  expect(view.queryByLabelText('Retry balance')).toBeNull();
});

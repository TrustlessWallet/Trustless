import React from 'react';
import { render } from '@testing-library/react-native';
import WalletOptionsScreen from '../../screens/WalletOptionsScreen';

const mockNavigation = { canGoBack: () => true, goBack: jest.fn(), popToTop: jest.fn() };
let mockFocused = false;
let mockLoading = false;
let mockWallets: { id: string }[] = [];

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { wallet_id: 'removed' } }),
  useIsFocused: () => mockFocused,
}));
jest.mock('../../contexts/WalletContext', () => ({
  useWallet: () => ({ wallets: mockWallets, loading: mockLoading }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: { colors: {}, LAYOUT: {} } }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

it.each([true, false])('closes missing wallet options on focus (other wallets: %s)', otherWallets => {
  jest.clearAllMocks();
  mockWallets = otherWallets ? [{ id: 'remaining' }] : [];
  mockFocused = false;
  mockLoading = true;
  const view = render(<WalletOptionsScreen />);
  mockFocused = true;
  view.rerender(<WalletOptionsScreen />);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.popToTop).not.toHaveBeenCalled();
  mockLoading = false;
  mockFocused = false;
  view.rerender(<WalletOptionsScreen />);
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  expect(mockNavigation.popToTop).not.toHaveBeenCalled();
  mockFocused = true;
  view.rerender(<WalletOptionsScreen />);
  expect(otherWallets ? mockNavigation.goBack : mockNavigation.popToTop).toHaveBeenCalledTimes(1);
  expect(view.queryByText('Wallet not found.')).toBeNull();
});

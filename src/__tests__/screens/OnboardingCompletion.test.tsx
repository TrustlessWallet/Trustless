import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingWalletScreen from '../../screens/OnboardingWalletScreen';

const mockReset = jest.fn();
const mockBootstrap = jest.fn();
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
}));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ retryBootstrap: mockBootstrap }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', bitcoin: '#f90', muted: '#888', border: '#ccc' } }, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-qrcode-svg', () => () => null);
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); });

it('registers consecutive taps and only starts wallet setup after persisting completion', async () => {
  const view = render(<OnboardingWalletScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Continue' }));
  expect(view.getByText('Create your wallet')).toBeTruthy();
  for (let step = 0; step < 7; step++) fireEvent.press(view.getByRole('button', { name: 'Next' }));
  expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBeNull();
  expect(mockBootstrap).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: 'Get started' }));
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainTabs' }] }));
  expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBe('wallet-pending');
  expect(mockBootstrap).toHaveBeenCalledTimes(1);
});

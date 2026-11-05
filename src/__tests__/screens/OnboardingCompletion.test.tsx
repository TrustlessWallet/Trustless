import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingWalletScreen, { OnboardingBackdrop } from '../../screens/OnboardingWalletScreen';

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
let mockFocused = false;
const mockBootstrap = jest.fn();
const mockComplete = jest.fn();
let mockLoading = false;
let mockWallet: { id: string } | null = { id: "first" };
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
}));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ retryBootstrap: mockBootstrap, completeOnboarding: mockComplete, loading: mockLoading, activeWallet: mockWallet }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack }), useIsFocused: () => mockFocused }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', bitcoin: '#f90', muted: '#888', border: '#ccc' } }, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-qrcode-svg', () => () => null);
beforeEach(async () => { await AsyncStorage.clear(); jest.clearAllMocks(); mockFocused = false; mockLoading = false; mockWallet = { id: "first" }; });

it('registers consecutive taps and closes the carousel through native navigation', async () => {
  const view = render(<OnboardingWalletScreen />);
  expect(view.getByText('Create your wallet')).toBeTruthy();
  for (let step = 0; step < 7; step++) fireEvent.press(view.getByRole('button', { name: 'Next' }));
  expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBeNull();
  expect(mockBootstrap).not.toHaveBeenCalled();
  mockLoading = true;
  view.rerender(<OnboardingWalletScreen />);
  fireEvent.press(view.getByRole('button', { name: 'Get started' }));
  expect(mockGoBack).not.toHaveBeenCalled();
  mockLoading = false;
  view.rerender(<OnboardingWalletScreen />);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

it('waits for the prepared wallet before completing a dismissal', async () => {
  const view = render(<OnboardingBackdrop />);
  await act(async () => {});
  expect(mockBootstrap).not.toHaveBeenCalled();
  mockFocused = true;
  mockLoading = true;
  mockWallet = null;
  view.rerender(<OnboardingBackdrop />);
  expect(mockReplace).not.toHaveBeenCalled();
  mockLoading = false;
  mockWallet = { id: 'first' };
  view.rerender(<OnboardingBackdrop />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('MainTabs'));
  expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBe('true');
  expect(mockBootstrap).not.toHaveBeenCalled();
});

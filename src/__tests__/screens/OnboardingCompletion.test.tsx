import React from 'react';
import { Animated, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RevealContext } from '../../contexts/RevealContext';
import OnboardingWalletScreen, { OnboardingWalletRoot } from '../../screens/OnboardingWalletScreen';

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
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockGoBack }), useIsFocused: () => mockFocused }));
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

it('mounts the wallet under the cover after dismissal and starts sync after the fade', async () => {
  let reveal: (() => void) | null = null;
  let completeFade: Animated.EndCallback | undefined;
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: callback => { completeFade = callback; },
    stop: jest.fn(),
    reset: jest.fn(),
  });
  function PreparedWallet() {
    reveal = React.useContext(RevealContext);
    return <View testID="prepared-wallet" />;
  }
  const tree = <OnboardingWalletRoot><PreparedWallet /></OnboardingWalletRoot>;
  try {
    const view = render(tree);
    expect(view.queryByTestId('prepared-wallet', { includeHiddenElements: true })).toBeNull();
    expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBeNull();

    mockFocused = true;
    view.rerender(<OnboardingWalletRoot><PreparedWallet /></OnboardingWalletRoot>);
    await waitFor(() => expect(view.getByTestId('onboarding-wallet-cover')).toBeTruthy());
    expect(view.getByTestId('prepared-wallet', { includeHiddenElements: true })).toBeTruthy();
    expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBe('true');
    expect(mockComplete).not.toHaveBeenCalled();

    act(() => reveal?.());
    expect(timing).toHaveBeenCalledTimes(1);
    expect(mockComplete).not.toHaveBeenCalled();

    act(() => completeFade?.({ finished: true }));
    expect(view.queryByTestId('onboarding-wallet-cover')).toBeNull();
    expect(view.getByTestId('prepared-wallet')).toBeTruthy();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  } finally {
    timing.mockRestore();
  }
});

it('reveals after the fallback if the wallet never signals readiness', async () => {
  jest.useFakeTimers();
  mockFocused = true;
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    start: callback => { callback?.({ finished: true }); },
    stop: jest.fn(),
    reset: jest.fn(),
  });
  try {
    const view = render(<OnboardingWalletRoot><View /></OnboardingWalletRoot>);
    await act(async () => {});
    expect(view.getByTestId('onboarding-wallet-cover')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1200));
    expect(view.queryByTestId('onboarding-wallet-cover')).toBeNull();
    expect(mockComplete).toHaveBeenCalledTimes(1);
  } finally {
    timing.mockRestore();
    jest.useRealTimers();
  }
});

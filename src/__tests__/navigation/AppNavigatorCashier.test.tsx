import React from 'react';
import { AppState } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import AppNavigator from '../../navigation/AppNavigator';
import { useWallet } from '../../contexts/WalletContext';
import { useWalletMode } from '../../contexts/WalletModeContext';

const mockRoutes: string[] = [];
const mockContainers: { initialState?: unknown }[] = [];
const mockNavigators: { initialRouteName?: string }[] = [];
const mockNavRef = { isReady: jest.fn(() => true), getCurrentRoute: jest.fn(() => ({ name: 'Terminal' })), navigate: jest.fn(), canGoBack: jest.fn(() => false), goBack: jest.fn() };

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', surface: '#eee', border: '#ccc', bitcoin: '#f90' } }, isDark: false }) }));
jest.mock('../../navigation/TerminalNavigation', () => ({ CashierTerminalRoot: () => null, MainRoot: () => null, TerminalRoute: () => null }));
jest.mock('../../services/nfc', () => ({ get_is_nfc_scanning: () => false, finish_nfc_scanning: jest.fn() }));
jest.mock('../../services/authState', () => ({ get_biometric_prompt_shown: () => false, set_biometric_prompt_shown: jest.fn() }));
jest.mock('../../screens/ExportPSBTScreen', () => () => null);
jest.mock('../../screens/ImportPSBTScreen', () => () => null);
jest.mock('../../screens/QRScannerScreen', () => () => null);
jest.mock('../../screens/BackupIntroScreen', () => () => null);
jest.mock('../../screens/ShowMnemonicScreen', () => () => null);
jest.mock('../../screens/ShowMnemonicQRScreen', () => () => null);
jest.mock('../../screens/VerifyMnemonicScreen', () => () => null);
jest.mock('../../screens/RecoverWalletScreen', () => () => null);
jest.mock('../../screens/ImportWatchOnlyScreen', () => () => null);
jest.mock('../../screens/ReceiveScreen', () => () => null);
jest.mock('../../screens/SendScreen', () => () => null);
jest.mock('../../screens/TransactionConfirmScreen', () => () => null);
jest.mock('../../screens/TransactionSuccessScreen', () => () => null);
jest.mock('../../screens/TransactionDetailsScreen', () => () => null);
jest.mock('../../screens/WalletSwitcherScreen', () => () => null);
jest.mock('../../screens/WalletOptionsScreen', () => () => null);
jest.mock('../../screens/ShowPublicKeyScreen', () => () => null);
jest.mock('../../screens/AddWalletOptionsScreen', () => () => null);
jest.mock('../../screens/BackupDisclaimerScreen', () => () => null);
jest.mock('../../screens/AddressBookScreen', () => () => null);
jest.mock('../../screens/AddSavedAddressScreen', () => () => null);
jest.mock('../../screens/BalanceDetailScreen', () => () => null);
jest.mock('../../screens/CoinControlScreen', () => () => null);
jest.mock('../../screens/AuthCheckScreen', () => () => null);
jest.mock('../../screens/OnboardingWelcomeScreen', () => () => null);
jest.mock('../../screens/OnboardingWalletScreen', () => () => null);
jest.mock('../../screens/AddressDetailsScreen', () => () => null);
jest.mock('../../screens/PrivacyPolicyScreen', () => () => null);
jest.mock('../../screens/TermsConditionsScreen', () => () => null);
jest.mock('../../screens/SupportScreen', () => () => null);
jest.mock('../../screens/LightningTopUpScreen', () => ({ LightningTopUpScreen: () => null }));
jest.mock('../../screens/UnilateralExitScreen', () => ({ UnilateralExitScreen: () => null }));
jest.mock('../../screens/WithdrawToOnchainScreen', () => ({ WithdrawToOnchainScreen: () => null }));
jest.mock('../../screens/TransactionHistoryScreen', () => () => null);
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children, onReady, initialState }: { children: React.ReactNode; onReady?: () => void; initialState?: unknown }) => {
    const React = require('react');
    React.useEffect(() => { onReady?.(); }, [onReady]);
    mockContainers.push({ initialState });
    return React.createElement(React.Fragment, null, children);
  },
  useNavigationContainerRef: () => mockNavRef,
  DefaultTheme: { fonts: {} },
  useIsFocused: () => true,
  useNavigation: () => mockNavRef,
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children, initialRouteName }: { children: React.ReactNode; initialRouteName?: string }) => {
      const React = require('react');
      mockRoutes.length = 0;
      mockNavigators.push({ initialRouteName });
      return React.createElement(React.Fragment, null, children);
    },
    Screen: ({ name }: { name: string }) => { mockRoutes.push(name); return null; },
    Group: ({ children }: { children: React.ReactNode }) => require('react').createElement(require('react').Fragment, null, children),
  }),
}));
jest.mock('expo-local-authentication', () => ({ isEnrolledAsync: jest.fn(async () => false) }));
jest.mock('../../components/GlassView', () => ({ GlassView: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

beforeEach(async () => {
  await AsyncStorage.clear();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockRoutes.length = 0;
  mockContainers.length = 0;
  mockNavigators.length = 0;
  mockNavRef.navigate.mockClear();
  (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
  (useWallet as jest.Mock).mockReturnValue({ wallets: [{ id: 'shop' }], loading: false });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'locked', cashierUnlockRevision: 0 });
});

it('registers only Terminal and privacy while locked, then resets to the normal root after owner unlock', async () => {
  await AsyncStorage.setItem('@biometricsEnabled', 'true');
  await AsyncStorage.setItem('@autoLockTime', '0');
  (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
  const view = render(<AppNavigator />);
  await waitFor(() => expect(mockRoutes).toEqual(['Terminal', 'PrivacyOverlay']));
  expect(mockNavigators.at(-1)?.initialRouteName).toBe('Terminal');
  expect(mockContainers.at(-1)?.initialState).toBeUndefined();
  expect(mockRoutes).not.toContain('MainTabs');
  expect(mockRoutes).not.toContain('Send');
  expect(mockRoutes).not.toContain('AuthCheck');

  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierUnlockRevision: 1 });
  await act(async () => { view.rerender(<AppNavigator />); });
  expect(mockRoutes).toContain('MainTabs');
  expect(mockRoutes).toContain('Send');
  expect(mockNavigators.at(-1)?.initialRouteName).toBe('MainTabs');
  expect(mockContainers.at(-1)?.initialState).toBeUndefined();
  expect(mockNavRef.navigate).not.toHaveBeenCalledWith('AuthCheck');
});

it('starts directly in Terminal after an authenticated Settings unlock targeting Terminal', async () => {
  const view = render(<AppNavigator />);
  await waitFor(() => expect(mockRoutes).toEqual(['Terminal', 'PrivacyOverlay']));
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierUnlockRevision: 1, cashierUnlockDestination: 'terminal' });
  await act(async () => { view.rerender(<AppNavigator />); });
  expect(mockNavigators.at(-1)?.initialRouteName).toBe('Terminal');
  expect(mockContainers.at(-1)?.initialState).toBeUndefined();
  expect(mockNavRef.navigate).not.toHaveBeenCalledWith('AuthCheck');
});

it('preserves ordinary app authentication after an unauthenticated recovery retry finds no lock', async () => {
  await AsyncStorage.setItem('@hasCompletedOnboarding', 'true');
  await AsyncStorage.setItem('@biometricsEnabled', 'true');
  (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'recovery', cashierUnlockRevision: 0 });
  const view = render(<AppNavigator />);
  await waitFor(() => expect(mockRoutes).toEqual(['Terminal', 'PrivacyOverlay']));
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierUnlockRevision: 0 });
  await act(async () => { view.rerender(<AppNavigator />); });
  expect(mockNavigators.at(-1)?.initialRouteName).toBe('AuthCheck');
  expect(mockRoutes).toContain('AuthCheck');
});

it('does not route a cashier session to generic AuthCheck on resume', async () => {
  await AsyncStorage.setItem('@biometricsEnabled', 'true');
  await AsyncStorage.setItem('@autoLockTime', '0');
  (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
  let change!: (state: string) => void;
  const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    change = listener as (state: string) => void;
    return { remove: jest.fn() } as any;
  });
  const view = render(<AppNavigator />);
  await waitFor(() => expect(mockRoutes).toEqual(['Terminal', 'PrivacyOverlay']));
  await act(async () => { change('background'); });
  await act(async () => { change('active'); });
  expect(mockNavRef.navigate).not.toHaveBeenCalledWith('AuthCheck');
  view.unmount();
  appState.mockRestore();
});

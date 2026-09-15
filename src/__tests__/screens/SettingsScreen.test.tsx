import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { useWallet } from '../../contexts/WalletContext';
import SettingsScreen from '../../screens/SettingsScreen';
import { TX_BIOMETRIC_CONFIRM_KEY } from '../../services/authState';

// This suite exercises the real authState module (real in-memory AsyncStorage,
// via jest_setup.ts) so the "Enable Biometrics" / "Confirm transaction"
// toggles are tested against the exact same logic authenticate_transaction_action()
// uses at tx time - that's what the stale-switch bug was about.

jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useIsFocused: jest.fn(() => true),
}));

jest.mock('../../contexts/WalletContext', () => ({
    useWallet: jest.fn(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        theme: { colors: { background: '#000', primary: '#FFF', muted: '#888', text: '#FFF' } },
        isDark: true,
        toggleTheme: jest.fn(),
    }),
}));

jest.mock('expo-local-authentication', () => ({
    hasHardwareAsync: jest.fn(),
    isEnrolledAsync: jest.fn(),
    authenticateAsync: jest.fn(),
}));

jest.mock('../../services/electrum', () => ({
    getElectrumClient: jest.fn(() => Promise.resolve({ close: jest.fn() })),
    resetActiveConnection: jest.fn(),
    getActiveHostName: jest.fn(() => 'test-node'),
    test_custom_node_connection: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../constants/build.json', () => ({ version: '0.0.0-test', build: 'test' }), { virtual: true });

jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: any) => <>{children}</> }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const press_biometrics_toggle = (getByTestId: any) => fireEvent.press(getByTestId('toggle-biometrics'));
const press_tx_confirm_toggle = (getByTestId: any) => fireEvent.press(getByTestId('toggle-tx-confirm'));
const read_toggle_state = (getByTestId: any, testId: string) =>
    within(getByTestId(testId)).getByText(/^(On|Off)$/).props.children;

describe('SettingsScreen - Biometrics toggle sync', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        jest.clearAllMocks();

        (useNavigation as jest.Mock).mockReturnValue({ navigate: jest.fn() });
        (useIsFocused as jest.Mock).mockReturnValue(true);

        (useWallet as jest.Mock).mockReturnValue({
            resetWallet: jest.fn(),
            triggerRefresh: jest.fn(),
            activeWallet: { id: 'wallet1' },
            isLightningInitialized: true,
            lightningInitAttempted: true,
            lightningApiKeyPresent: true,
            lightningInitError: null,
        });

        (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
        (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
        (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });
    });

    it('turns "Confirm transaction" on by default the first time biometrics is enabled, with no stale flash', async () => {
        const { getByTestId, queryByTestId } = render(<SettingsScreen />);

        await waitFor(() => expect(getByTestId('toggle-biometrics')).toBeTruthy());
        expect(read_toggle_state(getByTestId, 'toggle-biometrics')).toBe('Off');
        expect(queryByTestId('toggle-tx-confirm')).toBeNull();

        press_biometrics_toggle(getByTestId);

        await waitFor(() => expect(read_toggle_state(getByTestId, 'toggle-biometrics')).toBe('On'));
        await waitFor(() => expect(getByTestId('toggle-tx-confirm')).toBeTruthy());

        // The switch must show "On" immediately - no waiting for a refocus
        // to catch up, which is exactly what the reported bug required.
        expect(read_toggle_state(getByTestId, 'toggle-tx-confirm')).toBe('On');

        // And the persisted state must be explicit 'true', not left to an
        // implicit null-default, so it can never disagree with the switch.
        expect(await AsyncStorage.getItem(TX_BIOMETRIC_CONFIRM_KEY)).toBe('true');
    });

    it('keeps the switch in sync when biometrics is toggled off then back on without touching the sub-setting', async () => {
        const { getByTestId, queryByTestId } = render(<SettingsScreen />);
        await waitFor(() => expect(getByTestId('toggle-biometrics')).toBeTruthy());

        // Turn on -> sub-setting defaults on and is persisted explicitly.
        press_biometrics_toggle(getByTestId);
        await waitFor(() => expect(getByTestId('toggle-tx-confirm')).toBeTruthy());
        expect(read_toggle_state(getByTestId, 'toggle-tx-confirm')).toBe('On');

        // Turn off -> the sub-toggle row disappears (gated by master switch).
        press_biometrics_toggle(getByTestId);
        await waitFor(() => expect(queryByTestId('toggle-tx-confirm')).toBeNull());

        // Turn back on -> since a sub-pref now exists ('true' from the first
        // enable), it must be respected rather than reset, and the switch
        // must immediately show the correct state, not a stale one.
        press_biometrics_toggle(getByTestId);
        await waitFor(() => expect(getByTestId('toggle-tx-confirm')).toBeTruthy());
        expect(read_toggle_state(getByTestId, 'toggle-tx-confirm')).toBe('On');
    });

    it('respects an explicit "off" choice and does not silently re-enable it on remount', async () => {
        const { getByTestId, unmount } = render(<SettingsScreen />);
        await waitFor(() => expect(getByTestId('toggle-biometrics')).toBeTruthy());

        press_biometrics_toggle(getByTestId);
        await waitFor(() => expect(getByTestId('toggle-tx-confirm')).toBeTruthy());

        // User explicitly turns the sub-setting off.
        press_tx_confirm_toggle(getByTestId);
        await waitFor(() => expect(read_toggle_state(getByTestId, 'toggle-tx-confirm')).toBe('Off'));
        expect(await AsyncStorage.getItem(TX_BIOMETRIC_CONFIRM_KEY)).toBe('false');

        unmount();

        // A fresh mount (simulating navigating away and back) must read the
        // same persisted, explicit choice - not re-derive a stale "on".
        const { getByTestId: getByTestIdAgain } = render(<SettingsScreen />);
        await waitFor(() => expect(getByTestIdAgain('toggle-tx-confirm')).toBeTruthy());
        expect(read_toggle_state(getByTestIdAgain, 'toggle-tx-confirm')).toBe('Off');
    });
});

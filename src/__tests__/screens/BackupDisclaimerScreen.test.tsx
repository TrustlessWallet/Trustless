import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useNavigation } from '@react-navigation/native';
import { useWallet } from '../../contexts/WalletContext';
import { get_biometric_prompt_shown } from '../../services/authState';
import BackupDisclaimerScreen from '../../screens/BackupDisclaimerScreen';

jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useRoute: () => ({ params: { walletId: 'public-test-wallet' } }),
    useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: { background: '#000', primary: '#fff', inversePrimary: '#000', bitcoin: '#f90' } } }),
}));
jest.mock('expo-local-authentication', () => ({ authenticateAsync: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));

const publicTestPhrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
};

describe('BackupDisclaimerScreen', () => {
    const navigate = jest.fn();
    const getMnemonicForWallet = jest.fn();
    let appStateHandler: ((state: string) => void) | undefined;

    beforeEach(async () => {
        await AsyncStorage.clear();
        jest.clearAllMocks();
        Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active', writable: true });
        jest.spyOn(AppState, 'addEventListener').mockImplementation((_event: any, handler: any) => {
            appStateHandler = handler;
            return { remove: jest.fn() } as any;
        });
        (useNavigation as jest.Mock).mockReturnValue({ navigate });
        (useWallet as jest.Mock).mockReturnValue({ getMnemonicForWallet });
        getMnemonicForWallet.mockResolvedValue(publicTestPhrase);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        appStateHandler = undefined;
    });

    it('releases the prompt guard and navigates after successful authentication', async () => {
        await AsyncStorage.setItem('@biometricsEnabled', 'true');
        const authentication = deferred<{ success: boolean }>();
        (LocalAuthentication.authenticateAsync as jest.Mock).mockReturnValue(authentication.promise);
        const screen = render(<BackupDisclaimerScreen />);
        fireEvent.press(screen.getByText('Show phrase'));
        await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
        expect(get_biometric_prompt_shown()).toBe(true);
        await act(async () => authentication.resolve({ success: true }));
        await waitFor(() => expect(navigate).toHaveBeenCalledWith('ShowMnemonic', { mnemonic: publicTestPhrase, mode: 'backup' }));
        expect(get_biometric_prompt_shown()).toBe(false);
        screen.unmount();
    });

    it('releases the guard without fetching the phrase when authentication is cancelled', async () => {
        await AsyncStorage.setItem('@biometricsEnabled', 'true');
        (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: false });
        const screen = render(<BackupDisclaimerScreen />);
        fireEvent.press(screen.getByText('Show QR code'));
        await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(get_biometric_prompt_shown()).toBe(false));
        expect(getMnemonicForWallet).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        screen.unmount();
    });

    it('releases the guard when native authentication fails', async () => {
        await AsyncStorage.setItem('@biometricsEnabled', 'true');
        (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValue(new Error('native unavailable'));
        const screen = render(<BackupDisclaimerScreen />);
        fireEvent.press(screen.getByText('Show phrase'));
        await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(get_biometric_prompt_shown()).toBe(false));
        expect(getMnemonicForWallet).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        screen.unmount();
    });

    it('does not navigate when the app backgrounds during authentication', async () => {
        await AsyncStorage.setItem('@biometricsEnabled', 'true');
        const authentication = deferred<{ success: boolean }>();
        (LocalAuthentication.authenticateAsync as jest.Mock).mockReturnValue(authentication.promise);
        const screen = render(<BackupDisclaimerScreen />);
        fireEvent.press(screen.getByText('Show phrase'));
        await waitFor(() => expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(1));
        act(() => { AppState.currentState = 'background'; appStateHandler?.('background'); });
        await act(async () => authentication.resolve({ success: true }));
        expect(get_biometric_prompt_shown()).toBe(false);
        expect(getMnemonicForWallet).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
        screen.unmount();
    });

    it('does not navigate when the disclaimer is removed before phrase retrieval finishes', async () => {
        const phrase = deferred<string>();
        getMnemonicForWallet.mockReturnValue(phrase.promise);
        const screen = render(<BackupDisclaimerScreen />);
        fireEvent.press(screen.getByText('Show phrase'));
        await waitFor(() => expect(getMnemonicForWallet).toHaveBeenCalledTimes(1));
        screen.unmount();
        await act(async () => phrase.resolve(publicTestPhrase));
        expect(navigate).not.toHaveBeenCalled();
        expect(get_biometric_prompt_shown()).toBe(false);
    });
});

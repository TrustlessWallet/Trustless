import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { get_biometric_prompt_shown } from '../../services/authState';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isBackupPending, setBackupPending } from '../../services/firstLaunchWallet';
import ShowMnemonicScreen from '../../screens/ShowMnemonicScreen';
import ShowMnemonicQRScreen from '../../screens/ShowMnemonicQRScreen';

let mockRouteParams = { mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident', mode: 'backup', walletId: undefined as string | undefined };
jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: { background: '#000', primary: '#fff', inversePrimary: '#000', border: '#888' } }, isDark: true }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-qrcode-svg', () => () => null);

describe('backup display Done', () => {
    const popToTop = jest.fn();
    beforeEach(() => {
        jest.clearAllMocks();
        mockRouteParams = { ...mockRouteParams, walletId: undefined };
        (useNavigation as jest.Mock).mockReturnValue({ popToTop });
    });

    it.each([
        ['recovery words', ShowMnemonicScreen],
        ['recovery QR code', ShowMnemonicQRScreen],
    ])('leaves no privacy exception after Done on %s', (_label, Screen) => {
        const screen = render(<Screen />);
        fireEvent.press(screen.getByText('Done'));
        expect(popToTop).toHaveBeenCalledTimes(1);
        expect(get_biometric_prompt_shown()).toBe(false);
        screen.unmount();
    });

    it.each([
        ['recovery words', ShowMnemonicScreen],
        ['recovery QR code', ShowMnemonicQRScreen],
    ])('confirms only the displayed wallet after explicit acknowledgment on %s', async (_label, Screen) => {
        await AsyncStorage.clear();
        mockRouteParams = { ...mockRouteParams, walletId: 'wallet-a' };
        await setBackupPending('Bitcoin', 'wallet-a');
        await setBackupPending('Bitcoin', 'wallet-b');
        const screen = render(<Screen />);
        fireEvent.press(screen.getByText('I saved my recovery phrase'));
        await waitFor(() => expect(popToTop).toHaveBeenCalledTimes(1));
        expect(await isBackupPending('Bitcoin', 'wallet-a')).toBe(false);
        expect(await isBackupPending('Bitcoin', 'wallet-b')).toBe(true);
        screen.unmount();
    });
});

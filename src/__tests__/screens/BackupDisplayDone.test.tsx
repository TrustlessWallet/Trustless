import React from 'react';
import QRCode from 'react-native-qrcode-svg';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { get_biometric_prompt_shown } from '../../services/authState';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setBackupPending } from '../../services/firstLaunchWallet';
import ShowMnemonicScreen from '../../screens/ShowMnemonicScreen';
import ShowMnemonicQRScreen from '../../screens/ShowMnemonicQRScreen';

let mockRouteParams = { mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident', mode: 'backup', walletId: undefined as string | undefined };
jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useRoute: () => ({ params: mockRouteParams }),
}));
let mockDark = true;
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: { background: mockDark ? '#000' : '#fff', primary: mockDark ? '#fff' : '#000', inversePrimary: '#000', border: '#888' } }, isDark: mockDark }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-qrcode-svg', () => () => null);

describe('backup display Done', () => {
    const popToTop = jest.fn();
    const navigate = jest.fn();
    let focus: (() => void) | undefined;
    beforeEach(() => {
        jest.clearAllMocks();
        mockDark = true;
        mockRouteParams = { ...mockRouteParams, mode: 'backup', walletId: undefined };
        focus = undefined;
        (useNavigation as jest.Mock).mockReturnValue({ popToTop, navigate, addListener: (_event: string, listener: () => void) => { focus = listener; return jest.fn(); } });
    });

    it.each([false, true])('renders the recovery QR with wallet theme colors (dark = %s)', dark => {
        mockDark = dark;
        const screen = render(<ShowMnemonicQRScreen />);
        expect(screen.UNSAFE_getByType(QRCode).props).toMatchObject({
            value: mockRouteParams.mnemonic, size: 240,
            color: dark ? '#fff' : '#000', backgroundColor: dark ? '#000' : '#fff',
        });
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
        expect(await AsyncStorage.getItem('@walletBackupStatus.Bitcoin.wallet-a')).toBe('confirmed');
        expect(await AsyncStorage.getItem('@walletBackupStatus.Bitcoin.wallet-b')).toBe('pending');
        screen.unmount();
    });

    it('allows another verification attempt after returning to the phrase screen', () => {
        mockRouteParams = { ...mockRouteParams, mode: 'create' };
        const screen = render(<ShowMnemonicScreen />);
        fireEvent.press(screen.getByText('Check my backup'));
        expect(navigate).toHaveBeenCalledTimes(1);
        act(() => focus?.());
        fireEvent.press(screen.getByText('Check my backup'));
        expect(navigate).toHaveBeenCalledTimes(2);
        screen.unmount();
    });
});

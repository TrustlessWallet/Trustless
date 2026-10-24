import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import { get_biometric_prompt_shown } from '../../services/authState';
import ShowMnemonicScreen from '../../screens/ShowMnemonicScreen';
import ShowMnemonicQRScreen from '../../screens/ShowMnemonicQRScreen';

jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useRoute: () => ({ params: { mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident', mode: 'backup' } }),
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
});

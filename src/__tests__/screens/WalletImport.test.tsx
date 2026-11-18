import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import RecoverWalletScreen from '../../screens/RecoverWalletScreen';
import ImportWatchOnlyScreen from '../../screens/ImportWatchOnlyScreen';
import { useWallet } from '../../contexts/WalletContext';
import { getStringAsync } from 'expo-clipboard';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn() }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: {}, LAYOUT: { radius: 8, inputHeight: 56 } } }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }));

const addWallet = jest.fn();
const navigate = jest.fn();
const mnemonic = 'abandon '.repeat(11) + 'about';
const xpub = 'zpub6qvRHJQEqEKSVjH1ZqFZGvqqXSowmdRgFTdDDts2umRiss7peQkJZD2t6ATxS9t386pBDEoU6UsKyVDeb3GkPuiX2VDmMxrVmU7PnBN2d7x';

beforeEach(() => {
    jest.clearAllMocks();
    addWallet.mockResolvedValue({ id: 'imported-wallet' });
    (useWallet as jest.Mock).mockReturnValue({ addWallet });
    (useNavigation as jest.Mock).mockReturnValue({ navigate, isFocused: () => true });
});

it('keeps an invalid phrase in the field, then imports corrected multiline text', async () => {
    const screen = render(<RecoverWalletScreen />);
    const field = screen.getByLabelText('Recovery phrase');
    const invalid = mnemonic.replace('about', 'typo');
    fireEvent.changeText(field, invalid);
    fireEvent.press(screen.getByRole('button', { name: 'Import wallet' }));

    expect(screen.getByText(/Check word 12/)).toBeTruthy();
    expect(screen.getByDisplayValue(invalid)).toBeTruthy();
    expect(addWallet).not.toHaveBeenCalled();

    fireEvent.changeText(field, mnemonic.toUpperCase().replace(/ /g, '\n'));
    fireEvent.press(screen.getByRole('button', { name: 'Import wallet' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('WalletSetupSuccess', { kind: 'imported' }));
    expect(addWallet).toHaveBeenCalledWith({ mnemonic });
});

it('requires account origin metadata and imports an account scanned from QR', async () => {
    const screen = render(<ImportWatchOnlyScreen />);
    fireEvent.changeText(screen.getByLabelText('Extended public key'), xpub);
    fireEvent.press(screen.getByRole('button', { name: 'Import wallet' }));
    expect(screen.getByText(/master fingerprint and derivation path/)).toBeTruthy();
    expect(addWallet).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Scan extended public key' }));
    expect(navigate).toHaveBeenCalledWith('QRScanner', expect.anything());
    const { onScanSuccess } = navigate.mock.calls[0][1];
    act(() => onScanSuccess(`[DEADBEEF/84'/0'/7']${xpub}`));

    fireEvent.press(screen.getByRole('button', { name: 'Import wallet' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('WalletSetupSuccess', { kind: 'imported' }));
    expect(addWallet).toHaveBeenCalledWith({ type: 'watch-only', xpub, fingerprint: 'deadbeef', derivation_path: "m/84'/0'/7'" });
});

it('ignores a clipboard response that arrives after the user edits the field', async () => {
    let finishPaste!: (text: string) => void;
    (getStringAsync as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finishPaste = resolve; }));
    const screen = render(<RecoverWalletScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Paste recovery phrase' }));
    fireEvent.changeText(screen.getByLabelText('Recovery phrase'), 'abandon');
    await act(async () => { finishPaste(mnemonic); });
    expect(screen.getByDisplayValue('abandon')).toBeTruthy();
});

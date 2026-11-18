import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ReceiveScreen from '../../screens/ReceiveScreen';
import { useWallet } from '../../contexts/WalletContext';

jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ setOptions: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: { mode: mockMode } }), useIsFocused: () => true,
}));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: { colors: { primary: '#fff', background: '#000', muted: '#888' } } }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: any) => children }));
jest.mock('../../components/StyledText', () => ({ Text: require('react-native').Text }));
jest.mock('../../components/StyledInput', () => ({ StyledInput: require('react-native').TextInput }));
jest.mock('react-native-qrcode-svg', () => {
    const { Text } = require('react-native');
    return ({ value }: any) => <Text testID="invoice-qr">{value}</Text>;
});

let wallet: any;
let mockMode: 'onchain' | 'lightning';
beforeEach(() => {
    mockMode = 'lightning';
    wallet = {
        activeWallet: { id: 'a', derivedReceiveAddresses: [], derivedChangeAddresses: [], derivedAddressInfoCache: [] },
        loading: false, isLightningInitialized: true, defaultLightningInvoice: '', lightningAddress: '',
        getLightningInvoice: jest.fn(async () => 'invoice-a'), retryLightning: jest.fn(),
    };
    (useWallet as jest.Mock).mockImplementation(() => wallet);
});

it('shows a retryable error instead of a fake invoice', async () => {
    wallet.getLightningInvoice.mockRejectedValueOnce(new Error('Offline'));
    const screen = render(<ReceiveScreen />);
    await waitFor(() => expect(screen.getByText('Offline')).toBeTruthy());
    expect(screen.queryByTestId('invoice-qr')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('invoice-qr').props.children).toBe('invoice-a'));
});

it('ignores an invoice from the previous wallet', async () => {
    let finish!: (value: string) => void;
    wallet.getLightningInvoice.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const screen = render(<ReceiveScreen />);
    wallet = { ...wallet, activeWallet: { ...wallet.activeWallet, id: 'b' }, getLightningInvoice: jest.fn(async () => 'invoice-b') };
    screen.rerender(<ReceiveScreen />);
    await waitFor(() => expect(screen.getByTestId('invoice-qr').props.children).toBe('invoice-b'));
    await act(async () => { finish('old-invoice-a'); });
    expect(screen.getByTestId('invoice-qr').props.children).toBe('invoice-b');
});

it('keeps the custom amount invoice when the background default rotates', async () => {
    wallet.defaultLightningInvoice = 'default-a';
    wallet.getLightningInvoice.mockResolvedValue('custom-123');
    const screen = render(<ReceiveScreen />);
    fireEvent.press(screen.getByText('Set amount'));
    fireEvent.changeText(screen.getByPlaceholderText('0'), '123');
    fireEvent.press(screen.getByText('Save amount'));
    await waitFor(() => expect(screen.getByTestId('invoice-qr').props.children).toBe('custom-123'));
    wallet = { ...wallet, defaultLightningInvoice: 'default-new' };
    screen.rerender(<ReceiveScreen />);
    expect(screen.getByTestId('invoice-qr').props.children).toBe('custom-123');
    expect(wallet.getLightningInvoice).toHaveBeenCalledTimes(1);
    expect(wallet.getLightningInvoice).toHaveBeenCalledWith(123);
});

it('includes the requested Bitcoin amount in the QR and restores the bare address when cleared', () => {
    mockMode = 'onchain';
    const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
    wallet.activeWallet.address = address;
    wallet.activeWallet.derivedReceiveAddresses = [{ address, index: 0 }];
    wallet.getOrCreateNextUnusedReceiveAddress = jest.fn().mockResolvedValue(null);
    const screen = render(<ReceiveScreen />);
    expect(screen.getByTestId('invoice-qr').props.children).toBe(address);

    fireEvent.press(screen.getByText('Set amount'));
    fireEvent.changeText(screen.getByPlaceholderText('0'), '123');
    fireEvent.press(screen.getByText('Save amount'));
    expect(screen.getByTestId('invoice-qr').props.children).toBe(`bitcoin:${address}?amount=0.00000123`);

    fireEvent.press(screen.getByText('Edit amount'));
    fireEvent.changeText(screen.getByPlaceholderText('0'), '');
    fireEvent.press(screen.getByText('Clear amount'));
    expect(screen.getByTestId('invoice-qr').props.children).toBe(address);
});

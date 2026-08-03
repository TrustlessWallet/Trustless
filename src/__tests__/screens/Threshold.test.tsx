import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import WalletScreen from '../../screens/WalletScreen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scanLightningInvoice } from '../../services/nfc';
import { resolveLnurlOrAddress } from '../../services/lnurl';
import { useNavigation } from '@react-navigation/native';
import { useWallet } from '../../contexts/WalletContext';


jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useIsFocused: jest.fn(() => true),
}));

jest.mock('../../contexts/WalletContext', () => ({
    useWallet: jest.fn(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: { background: '#000', primary: '#FFF', muted: '#888' } } })
}));

jest.mock('../../hooks/useBalance', () => ({
    useWalletTransactions: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
    useWalletUTXOs: () => ({ data: [], refetch: jest.fn() }),
    useTipHeight: jest.fn(),
}));

jest.mock('../../services/nfc', () => ({
    scanLightningInvoice: jest.fn(),
    NfcCancelledError: class extends Error {},
    NfcUnsupportedError: class extends Error {},
}));

jest.mock('../../services/lnurl', () => ({
    resolveLnurlOrAddress: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
    impactAsync: jest.fn(() => Promise.resolve()),
    ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' }
}));

// Mock UI components that rely on native rendering
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null, MaterialIcons: () => null }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: any) => <>{children}</> }));
jest.mock('react-native-safe-area-context', () => ({
    SafeAreaView: ({ children }: any) => <>{children}</>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));


describe('WalletScreen - NFC Tap-to-Pay Thresholds', () => {
    const mockNavigate = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useNavigation as jest.Mock).mockReturnValue({ navigate: mockNavigate });

        // Force the wallet to act as if it is loaded and has a Lightning balance
        (useWallet as jest.Mock).mockReturnValue({
            activeWallet: { id: 'wallet1', type: 'standard', derivedAddressInfoCache: [], derivedChangeAddresses: [], derivedReceiveAddresses: [] },
            loading: false,
            triggerRefresh: jest.fn(),
            lightningBalance: 50000,
            lightningTransactions: [],
            isLightningInitialized: true
        });

        // Seed AsyncStorage to return a 10,000 sats limit and default the UI to Lightning mode
        (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => {
            if (key === '@tapToPayLimit') return Promise.resolve('10000');
            if (key === '@defaultWalletMode') return Promise.resolve('Lightning');
            return Promise.resolve(null);
        });
    });

    it('1. Auto-pays when a BOLT11 invoice is under the threshold', async () => {
        // 50u = 5,000 sats (< 10,000 limit)
        (scanLightningInvoice as jest.Mock).mockResolvedValue('lnbc50u1...');
        (resolveLnurlOrAddress as jest.Mock).mockRejectedValue(new Error('Not LNURL'));

        const { getByText } = render(<WalletScreen />);
        
        // Wait for AsyncStorage to load the lightning mode preference
        await waitFor(() => expect(getByText(/sats/i)).toBeTruthy());

        // Find the Send button and simulate the NFC long-press
        const sendButton = getByText('Send');
        fireEvent(sendButton, 'longPress');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('Send', {
                mode: 'lightning',
                prefill: 'lnbc50u1...',
                autoConfirm: true
            });
        });
    });

    it('2. Disables auto-pay when a BOLT11 invoice is over the threshold', async () => {
        // 150u = 15,000 sats (> 10,000 limit)
        (scanLightningInvoice as jest.Mock).mockResolvedValue('lnbc150u1...');
        (resolveLnurlOrAddress as jest.Mock).mockRejectedValue(new Error('Not LNURL'));

        const { getByText } = render(<WalletScreen />);
        await waitFor(() => expect(getByText(/sats/i)).toBeTruthy());

        fireEvent(getByText('Send'), 'longPress');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('Send', {
                mode: 'lightning',
                prefill: 'lnbc150u1...',
                autoConfirm: false
            });
        });
    });

    it('3. Disables auto-pay for an amountless BOLT11 invoice', async () => {
        // No amount specified
        (scanLightningInvoice as jest.Mock).mockResolvedValue('lnbc1...');
        (resolveLnurlOrAddress as jest.Mock).mockRejectedValue(new Error('Not LNURL'));

        const { getByText } = render(<WalletScreen />);
        await waitFor(() => expect(getByText(/sats/i)).toBeTruthy());

        fireEvent(getByText('Send'), 'longPress');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('Send', {
                mode: 'lightning',
                prefill: 'lnbc1...',
                autoConfirm: false
            });
        });
    });

    it('4. Disables auto-pay for a standard LNURL (range amount)', async () => {
        const payload = 'lnurl1...';
        (scanLightningInvoice as jest.Mock).mockResolvedValue(payload);
        
        // LNURL resolves to a range (1000 - 5000 sats)
        (resolveLnurlOrAddress as jest.Mock).mockResolvedValue({
            tag: 'payRequest',
            minSendable: 1000000, // 1000 sats (in msats)
            maxSendable: 5000000  // 5000 sats (in msats)
        });

        const { getByText } = render(<WalletScreen />);
        await waitFor(() => expect(getByText(/sats/i)).toBeTruthy());

        fireEvent(getByText('Send'), 'longPress');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('Send', {
                mode: 'lightning',
                prefill: payload,
                autoConfirm: false // Cannot auto-pay a range
            });
        });
    });

    it('5. Auto-pays an exact-amount LNURL under the threshold', async () => {
        const payload = 'lightning:satoshi@nakamoto.com';
        (scanLightningInvoice as jest.Mock).mockResolvedValue(payload);
        
        // LNURL resolves to exactly 5000 sats (< 10,000 limit)
        (resolveLnurlOrAddress as jest.Mock).mockResolvedValue({
            tag: 'payRequest',
            minSendable: 5000000,
            maxSendable: 5000000
        });

        const { getByText } = render(<WalletScreen />);
        await waitFor(() => expect(getByText(/sats/i)).toBeTruthy());

        fireEvent(getByText('Send'), 'longPress');

        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('Send', {
                mode: 'lightning',
                prefill: payload,
                autoConfirm: true
            });
        });
    });
});
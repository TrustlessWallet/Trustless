import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Alert, Keyboard } from 'react-native';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import SendScreen from '../../screens/SendScreen';
import { useWallet } from '../../contexts/WalletContext';
import { resolveLnurlOrAddress, fetchLnurlInvoice } from '../../services/lnurl';

// --- Mocks ---

jest.mock('@react-navigation/native', () => ({
    useNavigation: jest.fn(),
    useRoute: jest.fn(),
    useIsFocused: jest.fn(),
}));

jest.mock('../../contexts/WalletContext', () => ({
    useWallet: jest.fn(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({
        theme: {
            colors: {
                background: '#000000',
                surface: '#1A1A1A',
                primary: '#FFFFFF',
                inversePrimary: '#000000',
                error: '#FF0000',
                muted: '#888888',
                border: '#333333',
                bitcoin: '#F7931A'
            },
        },
        isDark: true,
    }),
}));

jest.mock('../../services/lnurl', () => ({
    resolveLnurlOrAddress: jest.fn(),
    fetchLnurlInvoice: jest.fn(),
}));

jest.mock('../../services/bitcoin', () => ({
    validateBitcoinAddress: jest.fn(),
    fetchUTXOs: jest.fn().mockResolvedValue([]),
    broadcastTransaction: jest.fn(),
    fetchFeeEstimates: jest.fn().mockResolvedValue({ fast: 15, normal: 10, slow: 5 }),
    calculateTransactionMetrics: jest.fn(),
    DUST_THRESHOLD: 546,
}));

jest.mock('../../hooks/useKeyboardScroll', () => ({
    useKeyboardScroll: () => ({
        scrollViewRef: null,
        paddingBottom: 0,
        handleInputFocus: jest.fn()
    })
}));

jest.mock('@expo/vector-icons', () => ({
    Feather: 'Feather',
}));

jest.mock('expo-clipboard', () => ({
    getStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn(),
}));

// Mock custom components to simplify assertions and avoid import chain issues
jest.mock('../../components/StyledInput', () => {
    const { TextInput } = require('react-native');
    return {
        StyledInput: (props: any) => (
            <TextInput
                {...props}
                testID="styled-input"
                editable={props.editable !== false && !props.style?.opacity}
            />
        )
    };
});

jest.mock('../../components/StyledText', () => {
    const { Text } = require('react-native');
    return { Text: (props: any) => <Text {...props}>{props.children}</Text> };
});

jest.mock('../../components/AddressText', () => {
    const { Text } = require('react-native');
    return { AddressText: (props: any) => <Text {...props}>{props.address}</Text> };
});


// --- Tests ---

describe('SendScreen - Lightning Auto-Pay Logic', () => {
    const mockNavigate = jest.fn();
    const mockReplace = jest.fn();
    const mockPayLightningInvoice = jest.fn();
    const mockEstimateLightningFee = jest.fn();
    const mockTriggerRefresh = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Setup Navigation Mocks
        (useNavigation as jest.Mock).mockReturnValue({
            navigate: mockNavigate,
            replace: mockReplace,
            setParams: jest.fn(),
        });
        (useIsFocused as jest.Mock).mockReturnValue(true);
        
        // Setup Alert Spy
        jest.spyOn(Alert, 'alert').mockImplementation(() => {});
        
        // Default Wallet Context Setup (can be overridden in specific tests)
        (useWallet as jest.Mock).mockReturnValue({
            activeWallet: { id: 'test-wallet', type: 'standard' },
            lightningBalance: 100000, // 100k sats
            payLightningInvoice: mockPayLightningInvoice,
            estimateLightningFee: mockEstimateLightningFee,
            triggerRefresh: mockTriggerRefresh,
        });
        
        // Make sure Keyboard visibility is false so the fee estimator runs
        jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
            return { remove: jest.fn() } as any;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('Standard Auto-Pay Execution: Fires payment automatically for fixed-amount BOLT11', async () => {
        // lnbc100u1... = 10,000 sats
        const validBolt11 = 'lightning:lnbc100u1p3x...'; 
        
        (useRoute as jest.Mock).mockReturnValue({
            params: { mode: 'lightning', prefill: validBolt11, autoConfirm: true }
        });

        // BOLT11 parsing doesn't use LNURL resolver, so it returns null
        (resolveLnurlOrAddress as jest.Mock).mockResolvedValue(null);
        mockPayLightningInvoice.mockResolvedValue(true);

        render(<SendScreen />);

        // Assert that the payment fires automatically without user interaction
        await waitFor(() => {
            expect(mockPayLightningInvoice).toHaveBeenCalledTimes(1);
            expect(mockPayLightningInvoice).toHaveBeenCalledWith(
                validBolt11.replace('lightning:', ''), 
                undefined // No override amount needed for fixed BOLT11
            );
        });

        // Assert it navigates to the success screen
        await waitFor(() => {
            expect(mockNavigate).toHaveBeenCalledWith('TransactionSuccess', expect.objectContaining({
                type: 'lightning'
            }));
        });
    });

    it('LNURL Range Rejection: Aborts auto-pay and leaves input editable for LNURL with amount range', async () => {
        const lnurlRange = 'lightning:lnurl1dp68gurn8ghj7...';
        
        (useRoute as jest.Mock).mockReturnValue({
            params: { mode: 'lightning', prefill: lnurlRange, autoConfirm: true }
        });

        // Mock resolver returning a min/max range (1,000 - 10,000 sats)
        (resolveLnurlOrAddress as jest.Mock).mockResolvedValue({
            tag: 'payRequest',
            minSendable: '1000000', // 1,000 sats in msats
            maxSendable: '10000000', // 10,000 sats in msats
            callback: 'https://test.com/pay'
        });

        const { getByPlaceholderText } = render(<SendScreen />);

        // Wait for the async resolver to finish
        await waitFor(() => {
            expect(resolveLnurlOrAddress).toHaveBeenCalledWith(lnurlRange.replace('lightning:', ''));
        });

        // Assert payment is NEVER called because hasFixedAmount becomes false
        expect(mockPayLightningInvoice).not.toHaveBeenCalled();

        // Check if the amount input is editable for the user to type
        const amountInput = getByPlaceholderText('0');
        expect(amountInput.props.editable).toBe(true);
    });

    it('Insufficient Balance Halt: Halts auto-pay and alerts user if balance is too low', async () => {
        // lnbc500u1... = 50,000 sats
        const expensiveBolt11 = 'lightning:lnbc500u1p3x...'; 
        
        (useRoute as jest.Mock).mockReturnValue({
            params: { mode: 'lightning', prefill: expensiveBolt11, autoConfirm: true }
        });

        // Mock wallet having only 10,000 sats (lower than 50k invoice)
        (useWallet as jest.Mock).mockReturnValue({
            activeWallet: { id: 'test-wallet', type: 'standard' },
            lightningBalance: 10000, 
            payLightningInvoice: mockPayLightningInvoice,
            estimateLightningFee: mockEstimateLightningFee,
            triggerRefresh: mockTriggerRefresh,
        });

        (resolveLnurlOrAddress as jest.Mock).mockResolvedValue(null);

        render(<SendScreen />);

        await waitFor(() => {
            expect(Alert.alert).toHaveBeenCalledWith(
                'Insufficient balance',
                expect.stringContaining('You do not have enough sats')
            );
        });

        expect(mockPayLightningInvoice).not.toHaveBeenCalled();
    });
});
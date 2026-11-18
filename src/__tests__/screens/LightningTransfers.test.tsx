import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Transaction } from 'bitcoinjs-lib';
import { LightningTopUpScreen } from '../../screens/LightningTopUpScreen';
import { WithdrawToOnchainScreen } from '../../screens/WithdrawToOnchainScreen';
import { useWallet } from '../../contexts/WalletContext';
import { fetchFeeEstimates, fetchUTXOs } from '../../services/bitcoin';

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ isFocused: () => true, goBack: jest.fn() }),
}));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: {}, LAYOUT: { radius: 8, inputHeight: 56 } } }),
}));
jest.mock('../../services/authState', () => ({ authenticate_transaction_action: jest.fn().mockResolvedValue(true) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../services/bitcoin', () => ({
    ...jest.requireActual('../../services/bitcoin'),
    fetchFeeEstimates: jest.fn(),
    fetchUTXOs: jest.fn(),
    broadcastTransaction: jest.fn(),
}));

const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const prepareWithdrawToOnchain = jest.fn();
const withdrawToOnchain = jest.fn();
const createAndSignTransaction = jest.fn();

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (useWallet as jest.Mock).mockReturnValue({
        activeWallet: { id: 'test', address, derivedAddressInfoCache: [{ address, balance: 10200 }] },
        isLightningInitialized: true,
        lightningBalance: 20000,
        getLightningTopUpAddress: async () => address,
        prepareWithdrawToOnchain,
        withdrawToOnchain,
        createAndSignTransaction,
        triggerRefresh: jest.fn(),
    });
    (fetchFeeEstimates as jest.Mock).mockResolvedValue({ normal: 1, slow: 1, fast: 5 });
    (fetchUTXOs as jest.Mock).mockResolvedValue([{ value: 10200 }]);
});

it('shows the actual signed top-up fee when small change is absorbed', async () => {
    const tx = new Transaction();
    tx.addInput(Buffer.alloc(32), 0);
    tx.addOutput(Buffer.from([0x51]), 10000);
    createAndSignTransaction.mockResolvedValue({ txHex: tx.toHex(), usedChangeIndex: null });
    const screen = render(<LightningTopUpScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount in sats'), '10,000');
    const review = await screen.findByRole('button', { name: 'Review top-up', disabled: false });
    fireEvent.press(review);

    await screen.findByRole('button', { name: 'Confirm top-up' });
    expect(screen.getByText('200 sats')).toBeTruthy();
    expect(screen.getByText('10,200 sats')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Edit transfer' }));
    expect(screen.getByDisplayValue('10000')).toBeTruthy();
});

it('quotes only the selected withdrawal speed and submits that reviewed quote', async () => {
    const response = {
        paymentMethod: {
            tag: 'BitcoinAddress',
            inner: { feeQuote: { speedFast: { l1BroadcastFeeSat: 120n, userFeeSat: 25n } } },
        },
    };
    prepareWithdrawToOnchain.mockResolvedValue({ prepareResponse: response });
    const screen = render(<WithdrawToOnchainScreen />);
    expect(prepareWithdrawToOnchain).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Amount in sats'), '2500');
    fireEvent.press(screen.getByText('Settlement speed'));
    fireEvent.press(screen.getByRole('radio', { name: 'Fast' }));
    fireEvent.press(screen.getByRole('button', { name: 'Review withdrawal' }));

    const confirm = await screen.findByRole('button', { name: 'Confirm withdrawal' });
    expect(prepareWithdrawToOnchain).toHaveBeenCalledTimes(1);
    expect(prepareWithdrawToOnchain).toHaveBeenCalledWith(address, 2500, 'fast');
    expect(screen.getByText('120 sats')).toBeTruthy();
    expect(screen.getByText('25 sats')).toBeTruthy();
    expect(screen.getByText('2,645 sats')).toBeTruthy();
    fireEvent.press(confirm);
    await waitFor(() => expect(withdrawToOnchain).toHaveBeenCalledWith(response, 'fast'));
});

it('keeps the withdrawal draft when the selected fee quote is missing', async () => {
    prepareWithdrawToOnchain.mockResolvedValue({ prepareResponse: {} });
    const screen = render(<WithdrawToOnchainScreen />);
    fireEvent.changeText(screen.getByLabelText('Amount in sats'), '2500');
    fireEvent.press(screen.getByRole('button', { name: 'Review withdrawal' }));
    await screen.findByText(/fee quote is unavailable/);
    expect(screen.getByDisplayValue('2500')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm withdrawal' })).toBeNull();
});

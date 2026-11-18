import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { useRoute } from '@react-navigation/native';
import TransactionConfirmScreen from '../../screens/TransactionConfirmScreen';

jest.mock('@react-navigation/native', () => ({ useRoute: jest.fn() }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ activeWallet: null }) }));
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: {}, LAYOUT: { radius: 8, inputHeight: 56 } } }),
}));
jest.mock('../../services/authState', () => ({ authenticate_transaction_action: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const renderReview = (isImported = false) => {
    (useRoute as jest.Mock).mockReturnValue({
        params: {
            recipientAddress: 'bc1qrecipient',
            amount: '10000',
            unit: 'sats',
            fee: 282,
            feeOptions: isImported ? undefined : { slow: 1, normal: 2, fast: 8 },
            selectedRate: 2,
            onConfirm: jest.fn(),
            utxos: [{ address: 'bc1qsource', value: 11000 }],
            isImported,
        },
    });
    return render(<TransactionConfirmScreen />);
};

it('shows the fee and total after a rate change removes the change output', () => {
    const screen = renderReview();
    expect(screen.getByText('10,282 sats')).toBeTruthy();
    expect(screen.queryByText('Input addresses')).toBeNull();

    fireEvent.press(screen.getByText('Fee rate'));
    fireEvent.press(screen.getByText('Fast'));

    expect(screen.getByText('11,000 sats')).toBeTruthy();
    expect(screen.getByText(/120 sats of small change/)).toBeTruthy();
    fireEvent.press(screen.getByText('Transaction details'));
    expect(screen.getByText('0 sats')).toBeTruthy();
});

it('disables signing when the chosen rate exceeds the selected funds', () => {
    const screen = renderReview();
    fireEvent.press(screen.getByText('Fee rate'));
    fireEvent.press(screen.getByText('Custom'));
    fireEvent.changeText(screen.getByLabelText('Custom fee rate'), '20');

    expect(screen.getByText(/selected coins don’t cover this fee/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign and send', disabled: true })).toBeTruthy();
});

it('keeps an imported PSBT fee fixed and exposes broadcast as its primary action', () => {
    const screen = renderReview(true);
    expect(screen.getByText('10,282 sats')).toBeTruthy();
    expect(screen.queryByText('Fee rate')).toBeNull();
    expect(screen.getByRole('button', { name: 'Broadcast transaction' })).toBeTruthy();
});

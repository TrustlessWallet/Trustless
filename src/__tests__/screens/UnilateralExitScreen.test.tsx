import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator, ScrollView } from 'react-native';
import { UnilateralExitScreen } from '../../screens/UnilateralExitScreen';
import { quoteExit } from '../../services/unilateralExit';

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({}), useIsFocused: () => true,
}));
jest.mock('../../contexts/WalletContext', () => {
    const wallet = { id: 'wallet-1', address: 'bc1q-destination', type: 'standard' };
    return { useWallet: () => ({
        activeWallet: wallet, isLightningInitialized: true,
        runLightningRecovery: (operation: any) => operation({}),
    }) };
});
jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: {
        colors: { background: '#000', surface: '#222', primary: '#fff' },
        LAYOUT: { radius: 16, inputHeight: 56 },
    } }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/StyledText', () => ({ Text: require('react-native').Text }));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('../../constants/network', () => ({ IS_TESTNET: false }));
jest.mock('../../services/authState', () => ({}));
jest.mock('../../services/exitStorage', () => ({ loadExit: jest.fn(async () => null) }));
jest.mock('../../services/exitCodec', () => ({}));
jest.mock('../../services/packageBroadcaster', () => ({ loadBroadcaster: jest.fn(async () => null) }));
jest.mock('../../services/unilateralExit', () => ({
    quoteExit: jest.fn(), recoveryCoins: jest.fn(async () => []),
}));

it.each(['success', 'failure'])('keeps the form mounted through quote %s', async outcome => {
    let resolve!: (quote: any) => void;
    let reject!: (error: Error) => void;
    (quoteExit as jest.Mock).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const screen = render(<UnilateralExitScreen />);
    await act(async () => {});
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const scrollTo = jest.spyOn(scroll.instance, 'scrollTo').mockImplementation(() => {});
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 640 } } });
    const destination = screen.getByLabelText('Bitcoin destination');
    const button = screen.getByRole('button', { name: 'Get recovery quote' });

    fireEvent.changeText(destination, 'bc1q-user-destination');
    await act(async () => { fireEvent.press(button); });
    expect(screen.UNSAFE_getByType(ScrollView)).toBe(scroll);
    expect(screen.getByLabelText('Bitcoin destination')).toBe(destination);
    expect(screen.getByRole('button', { name: 'Get recovery quote' })).toBe(button);
    expect(button.props.accessibilityState.busy).toBe(true);
    // The only spinner is inside the existing button, not above the form.
    expect(screen.UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
    expect(button.findAllByType(ActivityIndicator)).toHaveLength(1);

    await act(async () => {
        if (outcome === 'failure') reject(new Error('Quote unavailable'));
        else resolve({
            recoverableValueSat: 1000n, totalFeeSat: 100n, cpfpFeeSat: 50n,
            fanoutFeeSat: 25n, sweepFeeSat: 25n, singleUtxoFundingSat: 100n, leaves: [],
        });
    });
    expect(screen.UNSAFE_getByType(ScrollView)).toBe(scroll);
    expect(screen.getByLabelText('Bitcoin destination')).toBe(destination);
    expect(destination.props.value).toBe('bc1q-user-destination');
    expect(button.props.accessibilityState.busy).toBe(false);
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
    // Simulate the sheet reporting a reset while it lays out the new message.
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 0 } } });
    fireEvent(scroll, 'contentSizeChange', 390, 2400);
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 640, animated: false });
    scrollTo.mockClear();
    fireEvent(scroll, 'scrollBeginDrag');
    fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { x: 0, y: 800 } } });
    fireEvent(scroll, 'contentSizeChange', 390, 2450);
    expect(scrollTo).not.toHaveBeenCalled();
    if (outcome === 'failure') expect(screen.getByText('Quote unavailable')).toBeTruthy();
    else expect(screen.getByText('Recoverable balance')).toBeTruthy();
    screen.unmount();
});

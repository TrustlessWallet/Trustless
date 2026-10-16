import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator, ScrollView, Keyboard, StyleSheet } from 'react-native';
import { UnilateralExitScreen } from '../../screens/UnilateralExitScreen';
import { quoteExit } from '../../services/unilateralExit';
import { loadExit } from '../../services/exitStorage';

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

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
    const scrollToEnd = jest.spyOn(scroll.instance, 'scrollToEnd').mockImplementation(() => {});
    const loadCount = (loadExit as jest.Mock).mock.calls.length;
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
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect((loadExit as jest.Mock).mock.calls.length).toBe(loadCount);
    if (outcome === 'failure') expect(screen.getByText('Quote unavailable')).toBeTruthy();
    else expect(screen.getByText('Recoverable balance')).toBeTruthy();
    screen.unmount();
});

it('keeps the previous error visible during retry and does not scroll on repeated requests', async () => {
    (quoteExit as jest.Mock).mockRejectedValueOnce(new Error('First error'));
    const screen = render(<UnilateralExitScreen />);
    await act(async () => {});
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const scrollTo = jest.spyOn(scroll.instance, 'scrollTo').mockImplementation(() => {});
    const scrollToEnd = jest.spyOn(scroll.instance, 'scrollToEnd').mockImplementation(() => {});
    const button = screen.getByRole('button', { name: 'Get recovery quote' });
    await act(async () => { fireEvent.press(button); });
    const message = screen.getByText('First error');
    let reject!: (error: Error) => void;
    (quoteExit as jest.Mock).mockReturnValue(new Promise((_resolve, no) => { reject = no; }));
    const calls = (quoteExit as jest.Mock).mock.calls.length;
    await act(async () => { fireEvent.press(button); fireEvent.press(button); });
    expect((quoteExit as jest.Mock).mock.calls.length).toBe(calls + 1);
    expect(screen.getByText('First error')).toBe(message);
    await act(async () => { reject(new Error('Second error')); });
    expect(screen.getByText('Second error')).toBe(message);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
    screen.unmount();
});

it('uses the Send focus behavior only for the bottom backup field', async () => {
    jest.useFakeTimers();
    const keyboardListeners: Record<string, (event: any) => void> = {};
    const addListener = Keyboard.addListener.bind(Keyboard);
    jest.spyOn(Keyboard, 'addListener').mockImplementation((name, handler) => {
        keyboardListeners[name] = handler;
        return addListener(name, handler);
    });
    const screen = render(<UnilateralExitScreen />);
    await act(async () => {});
    const scroll = screen.UNSAFE_getByType(ScrollView);
    const scrollToEnd = jest.spyOn(scroll.instance, 'scrollToEnd').mockImplementation(() => {});
    fireEvent(screen.getByLabelText('Broadcaster URL'), 'focus', {});
    act(() => { jest.advanceTimersByTime(100); });
    expect(scrollToEnd).not.toHaveBeenCalled();
    fireEvent(screen.getByLabelText('Backup file password'), 'focus', {});
    act(() => {
        const show = keyboardListeners.keyboardWillShow || keyboardListeners.keyboardDidShow;
        show({ endCoordinates: { height: 300 } });
        jest.advanceTimersByTime(100);
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(382);
    act(() => {
        const hide = keyboardListeners.keyboardWillHide || keyboardListeners.keyboardDidHide;
        hide({});
    });
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    screen.unmount();
});

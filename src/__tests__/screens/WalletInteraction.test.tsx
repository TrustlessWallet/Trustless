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

let mockTerminalChanging = false;
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
let mockTransactions: any[] = [];
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: () => ({ showTerminal: true, setMode: jest.fn(), changing: mockTerminalChanging }) }));

jest.mock('../../contexts/WalletContext', () => ({
    useWallet: jest.fn(),
}));

jest.mock('../../contexts/ThemeContext', () => ({
    useTheme: () => ({ theme: { colors: { background: '#000', primary: '#FFF', muted: '#888', bitcoin: '#F7931A' } } })
}));

jest.mock('../../hooks/useBalance', () => ({
    useWalletTransactions: () => ({ data: mockTransactions, isLoading: false, refetch: jest.fn() }),
    useWalletUTXOs: () => ({ data: [], refetch: jest.fn() }),
    useTipHeight: jest.fn(),
}));

jest.mock('../../services/nfc', () => ({
    scanLightningInvoice: jest.fn(),
    finish_nfc_scanning: jest.fn(),
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
    useSafeAreaInsets: () => mockInsets
}));



import { act } from '@testing-library/react-native';
import { Alert, Dimensions, Platform, RefreshControl, StyleSheet } from 'react-native';
const originalPlatform = Platform.OS;
afterEach(() => { Platform.OS = originalPlatform; });
const refresh = jest.fn<Promise<void>, []>(() => Promise.resolve());
const navigate = jest.fn();
beforeEach(() => {
    jest.clearAllMocks();
    mockTerminalChanging = false;
    mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
    mockTransactions = [];
    Platform.OS = 'ios';
    (useNavigation as jest.Mock).mockReturnValue({ navigate });
    (useWallet as jest.Mock).mockReturnValue({
        activeWallet: { id: 'shop', type: 'standard', derivedAddressInfoCache: [], derivedChangeAddresses: [], derivedReceiveAddresses: [] },
        loading: false, triggerRefresh: refresh, lightningBalance: 100, lightningTransactions: [], isLightningInitialized: true,
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});
const scroll = (screen: any, y: number) => fireEvent.scroll(screen.getByTestId('wallet-transactions'), {
    nativeEvent: { contentOffset: { x: 0, y }, contentInset: { top: 0 }, contentSize: { width: 390, height: 1100 }, layoutMeasurement: { width: 390, height: 800 } },
});
it('keeps receive and send immediately available after focus returns', async () => {
    const screen = render(<WalletScreen />);
    await act(async () => {});
    fireEvent.press(screen.getByText('Receive'));
    fireEvent.press(screen.getByText('Send'));
    expect(navigate).toHaveBeenCalledWith('Receive', { mode: 'onchain' });
    expect(navigate).toHaveBeenCalledWith('Send', { mode: 'onchain' });
});
it('ignores synthetic refresh callbacks and slight pulls, but refreshes on a deliberate drag', async () => {
    const screen = render(<WalletScreen />);
    await act(async () => {});
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -12);
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -70);
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('onchain');
});
it('does not carry a pull gesture over a Terminal round trip', async () => {
    const screen = render(<WalletScreen />);
    await act(async () => {});
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -70);
    const { useIsFocused } = require('@react-navigation/native');
    useIsFocused.mockReturnValue(false);
    screen.rerender(<WalletScreen />);
    useIsFocused.mockReturnValue(true);
    screen.rerender(<WalletScreen />);
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).not.toHaveBeenCalled();
});

it('starts a fresh list and shows a new pull spinner after switching wallets', async () => {
    mockInsets = { top: 47, bottom: 34, left: 0, right: 0 };
    const screen = render(<WalletScreen />);
    await act(async () => {});
    const oldList = screen.getByTestId('wallet-transactions');
    const expectViewport = (list: any) => {
        expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
        expect(list.props.automaticallyAdjustContentInsets).toBe(false);
        expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({ paddingTop: 47, paddingBottom: 144 });
        expect(StyleSheet.flatten(list.props.ListHeaderComponent.props.style).minHeight)
            .toBe(Dimensions.get('window').height * 0.65);
        expect(screen.UNSAFE_getByType(RefreshControl).props.progressViewOffset).toBe(63);
    };
    expectViewport(oldList);
    fireEvent(oldList, 'scrollBeginDrag');
    scroll(screen, -70);

    (useWallet as jest.Mock).mockReturnValue({
        activeWallet: { id: 'savings', type: 'standard', derivedAddressInfoCache: [], derivedChangeAddresses: [], derivedReceiveAddresses: [] },
        loading: false, triggerRefresh: refresh, lightningBalance: 100, lightningTransactions: [], isLightningInitialized: true,
    });
    screen.rerender(<WalletScreen />);
    expect(screen.getByTestId('wallet-transactions')).not.toBe(oldList);
    expectViewport(screen.getByTestId('wallet-transactions'));
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).not.toHaveBeenCalled();

    let finish!: () => void;
    refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -70);
    let task!: Promise<void>;
    act(() => { task = screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
    expect(refresh).toHaveBeenCalledWith('onchain');
    await act(async () => { finish(); await task; });
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
});

it('shows three recent transactions and keeps the full-history link', async () => {
    mockTransactions = Array.from({ length: 5 }, (_, index) => ({
        txid: `tx-${index}`,
        type: 'receive',
        vin: [],
        vout: [],
        amount: 1000,
        status: { confirmed: true, block_time: 1 },
    }));
    const screen = render(<WalletScreen />);
    await act(async () => {});
    expect(screen.getByTestId('wallet-transactions').props.data.map((tx: any) => tx.txid))
        .toEqual(['tx-0', 'tx-1', 'tx-2']);
    fireEvent.press(screen.getByText('See full transaction history'));
    expect(navigate).toHaveBeenCalledWith('TransactionHistory', { mode: 'onchain' });
});

it('accepts native Android refresh at zero list offset', async () => {
    Platform.OS = 'android';
    const screen = render(<WalletScreen />);
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).toHaveBeenCalledTimes(1);
});
it('does not accept a late synthetic callback from an ended iOS drag', async () => {
    const screen = render(<WalletScreen />);
    await act(async () => {});
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -70);
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollEndDrag', { nativeEvent: { contentOffset: {x: 0, y: -70}, velocity: {x: 0, y: 0} } });
    const realNow = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(realNow + 500);
    await act(async () => { await screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    now.mockRestore();
    expect(refresh).not.toHaveBeenCalled();
});

it('finishes an in-flight refresh without showing its failure over Terminal', async () => {
    let fail!: (error: Error) => void;
    refresh.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = render(<WalletScreen />);
    await act(async () => {});
    fireEvent(screen.getByTestId('wallet-transactions'), 'scrollBeginDrag');
    scroll(screen, -70);
    let task!: Promise<void>;
    act(() => { task = screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    const { useIsFocused } = require('@react-navigation/native');
    useIsFocused.mockReturnValue(false);
    screen.rerender(<WalletScreen />);
    await act(async () => { fail(new Error('offline')); await task; });
    expect(alert).not.toHaveBeenCalled();
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    alert.mockRestore();
    useIsFocused.mockReturnValue(true);
});


it('shows the Bitcoin-colored spinner while Terminal entry is busy', async () => {
    mockTerminalChanging = true;
    const screen = render(<WalletScreen />);
    await act(async () => {});
    expect(screen.getByTestId('open-terminal').props.accessibilityState.busy).toBe(true);
    expect(screen.getByTestId('terminal-entry-spinner').props.color).toBe('#F7931A');
    mockTerminalChanging = false;
    screen.rerender(<WalletScreen />);
    expect(screen.queryByTestId('terminal-entry-spinner')).toBeNull();
    expect(screen.getByText('T')).toBeTruthy();
});

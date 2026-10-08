import React from 'react';
import { act, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import TransactionHistoryScreen from '../../screens/TransactionHistoryScreen';
import { useWallet } from '../../contexts/WalletContext';
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}), useRoute: () => ({ params: { mode: 'lightning' } }), useIsFocused: () => true }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { primary: '#fff' } } }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('../../components/StyledText', () => ({ Text: require('react-native').Text }));
jest.mock('../../hooks/useBalance', () => ({ useWalletTransactions: () => ({ data: [], isLoading: false, refetch: jest.fn() }) }));

it('keeps the history spinner active until Lightning refresh finishes', async () => {
    let finish!: () => void;
    const refresh = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    (useWallet as jest.Mock).mockReturnValue({ activeWallet: null, lightningTransactions: [], triggerRefresh: refresh });
    const screen = render(<TransactionHistoryScreen />);
    let task!: Promise<void>;
    await act(async () => { task = screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
    expect(refresh).toHaveBeenCalledWith('lightning');
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
    await act(async () => { finish(); await task; });
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
});

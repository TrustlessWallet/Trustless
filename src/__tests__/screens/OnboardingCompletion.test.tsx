import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OnboardingWalletScreen from '../../screens/OnboardingWalletScreen';
const mockReset = jest.fn();
jest.mock('../../contexts/WalletContext', () => ({ useWallet: () => ({ completeOnboarding: jest.fn() }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', bitcoin: '#f90', muted: '#888', border: '#ccc' } }, isDark: false }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-qrcode-svg', () => () => null);
beforeEach(async () => { await AsyncStorage.clear(); mockReset.mockClear(); });
it('does not mark onboarding complete on mount or when viewing the last slide', async () => {
 const view = render(<OnboardingWalletScreen />);
 await act(async () => {});
 expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBeNull();
 const list = view.UNSAFE_getByType(FlatList);
 act(() => list.props.onViewableItemsChanged({ viewableItems: [{ index: list.props.data.length - 1 }] }));
 expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBeNull();
 fireEvent.press(view.getByText('Get started'));
 await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'MainTabs' }] }));
 expect(await AsyncStorage.getItem('@hasCompletedOnboarding')).toBe('wallet-pending');
});

it('accepts consecutive Next presses without waiting for viewability callbacks', () => {
 const view = render(<OnboardingWalletScreen />);
 fireEvent.press(view.getByText('Next'));
 fireEvent.press(view.getByText('Next'));
 const list = view.UNSAFE_getByType(FlatList);
 // An older slide becoming visible must not undo a newer requested page.
 act(() => list.props.onViewableItemsChanged({ viewableItems: [{ index: 1 }] }));
 for (let index = 2; index < list.props.data.length - 1; index++) fireEvent.press(view.getByText('Next'));
 expect(view.getByText('Get started')).toBeTruthy();
});

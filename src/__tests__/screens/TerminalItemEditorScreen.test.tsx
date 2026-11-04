import React from 'react';
let mockProStatus = 'free';
const mockRequirePro = jest.fn();
jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => ({ status: mockProStatus }) }));
jest.mock('../../hooks/useTerminalProGate', () => ({ useTerminalProGate: () => ({ requirePro: mockRequirePro, openPro: jest.fn(), proSheet: null }) }));
import { act, fireEvent, render } from '@testing-library/react-native';
import TerminalItemEditorScreen from '../../screens/TerminalItemEditorScreen';
import { saveTerminalItem } from '../../services/terminalItems';

const mockNavigation = { setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) };
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useNavigation: () => mockNavigation }));
jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: () => ({ id: 'shop', type: 'standard' }) }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: () => ({ cashierState: 'off' }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', inversePrimary: '#fff', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('../../hooks/useKeyboardScroll', () => ({ useKeyboardScroll: () => ({ paddingBottom: 36, handleInputFocus: jest.fn() }) }));
jest.mock('../../components/StyledInput', () => ({ StyledInput: (props: any) => require('react').createElement(require('react-native').TextInput, props) }));
jest.mock('../../screens/TerminalSheetHeader', () => () => null);
jest.mock('../../services/terminalItems', () => ({ saveTerminalItem: jest.fn(async () => {}) }));

it.each(['USD', 'EUR', 'CHF', 'sats', 'BTC'] as const)('preserves the exact %s price when an existing item is saved unchanged', async unit => {
  jest.clearAllMocks();
  const item = { id: 'coffee', name: 'Coffee', unit, unitPrice: 123456789 };
  const close = jest.fn();
  const screen = render(<TerminalItemEditorScreen walletId="shop" network="mainnet" preferredUnit="sats" initialItem={item} onClose={close} />);
  expect(screen.getByLabelText('Item price').props.value).toBe(unit === 'BTC' ? '1.23456789' : unit === 'sats' ? '123456789' : '1234567.89');
  await act(async () => { fireEvent.press(screen.getByLabelText('Save item')); });
  expect(saveTerminalItem).toHaveBeenCalledWith('shop', 'mainnet', item, expect.any(Function), expect.any(Function));
  expect(close).toHaveBeenCalledTimes(1);
});

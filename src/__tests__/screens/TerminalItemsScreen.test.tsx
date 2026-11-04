import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import TerminalItemsScreen from '../../screens/TerminalItemsScreen';
import { deleteTerminalItem, getCachedTerminalItems, listTerminalItems } from '../../services/terminalItems';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: () => ({ id: 'shop', type: 'standard' }) }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: () => ({ cashierState: 'off' }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#ffffff', primary: '#000', inversePrimary: '#fff', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../screens/TerminalSheetHeader', () => () => null);
jest.mock('../../services/terminalItems', () => ({ deleteTerminalItem: jest.fn(), getCachedTerminalItems: jest.fn(), listTerminalItems: jest.fn() }));
const coffee = { id: 'coffee', name: 'Coffee', unit: 'USD', unitPrice: 123456 };
beforeEach(() => { jest.clearAllMocks(); (getCachedTerminalItems as jest.Mock).mockReturnValue([coffee]); });

it('shows the cached catalog immediately and ignores an older refresh after deletion', async () => {
  let finish!: (items: unknown[]) => void;
  (listTerminalItems as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  (deleteTerminalItem as jest.Mock).mockResolvedValue([]);
  const view = render(<TerminalItemsScreen walletId="shop" network="mainnet" preferredUnit="USD" onClose={jest.fn()} onEdit={jest.fn()} />);
  expect(view.getByText('Coffee')).toBeTruthy();
  expect(view.getByText('USD 1 234.56')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('Delete Coffee')); });
  expect(view.queryByText('Coffee')).toBeNull();
  await act(async () => { finish([coffee]); });
  expect(view.queryByText('Coffee')).toBeNull();
});

it('ignores stale refresh errors after a successful deletion', async () => {
  let fail!: (error: Error) => void;
  (listTerminalItems as jest.Mock).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
  (deleteTerminalItem as jest.Mock).mockResolvedValue([]);
  const view = render(<TerminalItemsScreen walletId="shop" network="mainnet" preferredUnit="USD" onClose={jest.fn()} onEdit={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByLabelText('Delete Coffee')); });
  await act(async () => { fail(new Error('Old read failed')); });
  expect(view.queryByText('Saved items are unavailable.')).toBeNull();
});

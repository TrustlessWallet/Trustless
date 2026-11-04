import React from 'react';
let mockProStatus = 'free';
const mockRequirePro = jest.fn();
jest.mock('../../contexts/TerminalProContext', () => ({ useTerminalPro: () => ({ status: mockProStatus }) }));
jest.mock('../../hooks/useTerminalProGate', () => ({ useTerminalProGate: () => ({ requirePro: mockRequirePro, openPro: jest.fn(), proSheet: null }) }));
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
jest.mock('../../services/terminalItems', () => ({ FREE_TERMINAL_ITEM_LIMIT: 5, PRO_TERMINAL_ITEM_LIMIT: 30, deleteTerminalItem: jest.fn(), getCachedTerminalItems: jest.fn(), listTerminalItems: jest.fn() }));
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

it('explains why adding is disabled when the catalog is full', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ ...coffee, id: `item-${i}`, name: `Item ${i}` }));
  (getCachedTerminalItems as jest.Mock).mockReturnValue(items);
  (listTerminalItems as jest.Mock).mockReturnValue(new Promise(() => {}));
  const edit = jest.fn();
  const view = render(<TerminalItemsScreen walletId="shop" network="mainnet" preferredUnit="USD" onClose={jest.fn()} onEdit={edit} />);
  expect(view.getByText('Item limit reached')).toBeTruthy();
  fireEvent.press(view.getByLabelText('Add item'));
  expect(edit).not.toHaveBeenCalled();
});

it('offers Pro at five free items while keeping editing available', () => {
  mockProStatus = 'free'; mockRequirePro.mockClear();
  const items = Array.from({ length: 5 }, (_, i) => ({ ...coffee, id: `item-${i}`, name: `Item ${i}` }));
  (getCachedTerminalItems as jest.Mock).mockReturnValue(items);
  (listTerminalItems as jest.Mock).mockReturnValue(new Promise(() => {}));
  const edit = jest.fn();
  const view = render(<TerminalItemsScreen walletId="shop" network="mainnet" preferredUnit="USD" onClose={jest.fn()} onEdit={edit} />);
  fireEvent.press(view.getByLabelText('Upgrade to Terminal Pro'));
  expect(mockRequirePro).toHaveBeenCalledTimes(1);
  expect(edit).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('Edit Item 0'));
  expect(edit).toHaveBeenCalledWith(items[0]);
  mockProStatus = 'pro';
  view.rerender(<TerminalItemsScreen walletId="shop" network="mainnet" preferredUnit="USD" onClose={jest.fn()} onEdit={edit} />);
  fireEvent.press(view.getByLabelText('Add item'));
  expect(edit).toHaveBeenLastCalledWith();
});

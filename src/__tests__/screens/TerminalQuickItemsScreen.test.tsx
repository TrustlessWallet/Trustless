import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import TerminalQuickItemsScreen from '../../screens/TerminalQuickItemsScreen';
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', muted: '#888', border: '#ccc' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('../../screens/TerminalSheetHeader', () => () => null);
it('keeps renamed and deleted basket items at their original prices and quantities', () => {
  const line = { itemId: 'coffee', name: 'Original coffee', unitPrice: 100, quantity: 2, total: 200 };
  const removed = { itemId: 'deleted', name: 'Deleted tea', unitPrice: 250, quantity: 1, total: 250 };
  const add = jest.fn(), remove = jest.fn();
  const view = render(<TerminalQuickItemsScreen catalog={[{ id: 'coffee', name: 'New coffee', unit: 'USD', unitPrice: 999 }]} lines={[line, removed]} unit="USD" busy={false} onAdd={add} onRemoveOne={remove} onClose={jest.fn()} />);
  fireEvent.press(view.getByLabelText('Add one Original coffee'));
  expect(add).toHaveBeenCalledWith({ id: 'coffee', name: 'Original coffee', unit: 'USD', unitPrice: 100 });
  fireEvent.press(view.getByLabelText('Remove one Deleted tea'));
  expect(remove).toHaveBeenCalledWith(removed);
});
it('updates virtualized controls when the payment becomes busy', () => {
  const item = { id: 'coffee', name: 'Coffee', unit: 'USD' as const, unitPrice: 100 };
  const add = jest.fn();
  const props = { catalog: [item], lines: [], unit: 'USD' as const, onAdd: add, onRemoveOne: jest.fn(), onClose: jest.fn() };
  const view = render(<TerminalQuickItemsScreen {...props} busy={false} />);
  view.rerender(<TerminalQuickItemsScreen {...props} busy />);
  fireEvent.press(view.getByLabelText('Add Coffee'));
  expect(add).not.toHaveBeenCalled();
});

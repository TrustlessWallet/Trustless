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

it('filters accent-insensitively and restores basket controls when cleared', () => {
  const coffee = { id: 'coffee', name: 'Caffè', unit: 'USD' as const, unitPrice: 100 };
  const tea = { id: 'tea', name: 'Tea', unit: 'USD' as const, unitPrice: 200 };
  const view = render(<TerminalQuickItemsScreen catalog={[coffee, tea]}
    lines={[{ itemId: coffee.id, name: coffee.name, unitPrice: 100, quantity: 2, total: 200 }]}
    unit="USD" busy={false} onAdd={jest.fn()} onRemoveOne={jest.fn()} onClose={jest.fn()} />);
  fireEvent.changeText(view.getByLabelText('Search items'), 'tea');
  expect(view.queryByLabelText('Remove one Caffè')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Search items'), 'CAFFE');
  expect(view.getByLabelText('Remove one Caffè')).toBeTruthy();
  expect(view.getByText('2')).toBeTruthy();
  expect(view.queryByLabelText('Add Tea')).toBeNull();
  fireEvent.press(view.getByLabelText('Clear search items'));
  expect(view.getByLabelText('Add Tea')).toBeTruthy();
  expect(view.getByText('2')).toBeTruthy();
});

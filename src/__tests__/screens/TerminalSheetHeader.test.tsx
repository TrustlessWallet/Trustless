import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import TerminalSheetHeader, { TerminalSheetInteractionContext } from '../../screens/TerminalSheetHeader';
import { GlassView } from '../../components/GlassView';
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: true, theme: { colors: { surface: '#222', background: '#000', primary: '#fff', border: '#333' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: any) => children }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
it.each([[false, true], [true, false]])('disables covered/transitioning header touch and native glass (%s,%s)', (focused, enabled) => {
  mockFocused = focused;
  const close = jest.fn();
  const view = render(<TerminalSheetInteractionContext.Provider value={enabled}><TerminalSheetHeader title="Items" closeLabel="Close items" onClose={close} /></TerminalSheetInteractionContext.Provider>);
  fireEvent.press(view.getByLabelText('Close items'));
  expect(close).not.toHaveBeenCalled();
  expect(view.UNSAFE_getByType(GlassView).props.interactive).toBe(false);
});
it('enables only the focused settled sheet header', () => {
  mockFocused = true;
  const close = jest.fn();
  const view = render(<TerminalSheetHeader title="Items" closeLabel="Close items" onClose={close} />);
  fireEvent.press(view.getByLabelText('Close items'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(view.UNSAFE_getByType(GlassView).props.interactive).toBe(true);
  expect(StyleSheet.flatten(view.getByLabelText('Close items').props.style)).toMatchObject({ width: 44, height: 44 });
});

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import SheetHeader from '../../components/SheetHeader';
import GlassIconButton from '../../components/GlassIconButton';
import { GlassView } from '../../components/GlassView';
import { SHEET_HEADER_HEIGHT, SHEET_HEADER_HORIZONTAL_PADDING, SHEET_HEADER_SIDE_WIDTH } from '../../constants/theme';

let mockDark = false;
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ isDark: mockDark, theme: { colors: { background: '#fff', surface: '#222', border: '#888', primary: '#000' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: any) => children }));

it.each([false, true])('keeps centered sheet geometry and themed surface in dark=%s', dark => {
  mockDark = dark;
  const view = render(<SheetHeader title="A long sheet title" leading={<View testID="custom-leading" />} trailing={<View testID="custom-trailing" />} />);
  const header = view.UNSAFE_getAllByType(View)[0];
  expect(StyleSheet.flatten(header.props.style)).toMatchObject({
    height: SHEET_HEADER_HEIGHT,
    paddingHorizontal: SHEET_HEADER_HORIZONTAL_PADDING,
    backgroundColor: dark ? '#222' : '#fff',
    borderBottomColor: '#888',
    zIndex: 2,
    elevation: 2,
  });
  const sides = header.props.children.filter((child: React.ReactElement) => child?.type === View);
  expect(sides).toHaveLength(2);
  sides.forEach((side: React.ReactElement) => expect(StyleSheet.flatten(side.props.style).width).toBe(SHEET_HEADER_SIDE_WIDTH));
  expect(StyleSheet.flatten(view.getByText('A long sheet title').props.style)).toMatchObject({ left: 64, right: 64, textAlign: 'center', fontSize: 17 });
  expect(view.getByTestId('custom-leading')).toBeTruthy();
  expect(view.getByTestId('custom-trailing')).toBeTruthy();
});

it('disables touch and glass together while preserving the 44 point touch target', () => {
  const press = jest.fn();
  const view = render(<GlassIconButton accessibilityLabel="Export" onPress={press} visualSize={40} disabled busy><View /></GlassIconButton>);
  const button = view.getByLabelText('Export');
  fireEvent.press(button);
  expect(press).not.toHaveBeenCalled();
  expect(button.props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 44, height: 44 });
  expect(view.UNSAFE_getByType(GlassView).props).toMatchObject({ width: 40, height: 40, interactive: false });
});

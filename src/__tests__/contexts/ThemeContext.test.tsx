import React from 'react';
import { Appearance } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { ThemeProvider, useTheme } from '../../contexts/ThemeContext';

afterEach(() => jest.restoreAllMocks());

it.each([false, true])('applies the saved theme on iOS and follows toggles (initialIsDark=%s)', initialIsDark => {
  const setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  const { result } = renderHook(useTheme, {
    wrapper: ({ children }) => <ThemeProvider initialIsDark={initialIsDark}>{children}</ThemeProvider>,
  });
  expect(setScheme).toHaveBeenLastCalledWith(initialIsDark ? 'dark' : 'light');
  act(() => result.current.toggleTheme());
  expect(setScheme).toHaveBeenLastCalledWith(initialIsDark ? 'light' : 'dark');
});

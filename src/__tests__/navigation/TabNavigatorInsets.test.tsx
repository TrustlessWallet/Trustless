import React from 'react';
import { render } from '@testing-library/react-native';
import TabNavigator from '../../navigation/TabNavigator';

const mockTabOptions: Record<string, Record<string, unknown>> = {};
let mockNavigatorOptions: Record<string, unknown> = {};

jest.mock('@react-navigation/bottom-tabs/unstable', () => ({
  createNativeBottomTabNavigator: () => ({
    Navigator: ({ children, screenOptions }: any) => {
      mockNavigatorOptions = screenOptions;
      return children;
    },
    Screen: ({ name, options }: any) => {
      mockTabOptions[name] = options;
      return null;
    },
  }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: { colors: { background: '#000', primary: '#fff', muted: '#888' } } }),
}));
jest.mock('../../screens/WalletScreen', () => () => null);
jest.mock('../../screens/MapScreen', () => () => null);
jest.mock('../../screens/SettingsScreen', () => () => null);

it('lets only Wallet keep its explicit scroll inset behavior', () => {
  render(<TabNavigator />);

  expect(mockNavigatorOptions).not.toHaveProperty('overrideScrollViewContentInsetAdjustmentBehavior');
  expect(mockTabOptions.Wallet).toHaveProperty('overrideScrollViewContentInsetAdjustmentBehavior', false);
  expect(mockTabOptions.Map).not.toHaveProperty('overrideScrollViewContentInsetAdjustmentBehavior');
  expect(mockTabOptions.Settings).not.toHaveProperty('overrideScrollViewContentInsetAdjustmentBehavior');
});

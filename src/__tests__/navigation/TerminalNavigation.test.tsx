import React from 'react';
import { act, render } from '@testing-library/react-native';
import { MainRoot, TerminalRoute } from '../../navigation/TerminalNavigation';
import { useWalletMode } from '../../contexts/WalletModeContext';
import { useWallet } from '../../contexts/WalletContext';
import { useIsFocused, useNavigation } from '@react-navigation/native';

jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn(), useIsFocused: jest.fn() }));
const mockMount = jest.fn();
const mockUnmount = jest.fn();
jest.mock('../../navigation/TabNavigator', () => () => {
  require('react').useEffect(() => { mockMount(); return mockUnmount; }, []);
  return null;
});
jest.mock('../../screens/TerminalScreen', () => () => null);
const navigate = jest.fn();
const goBack = jest.fn();
const replace = jest.fn();
const setMode = jest.fn(() => Promise.resolve());
let beforeRemove: () => void;
beforeEach(() => {
  jest.clearAllMocks();
  (useNavigation as jest.Mock).mockReturnValue({ navigate, goBack, replace, canGoBack: () => true, addListener: (_: string, listener: () => void) => { beforeRemove = listener; return jest.fn(); } });
  (useIsFocused as jest.Mock).mockReturnValue(true);
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'shop', type: 'standard' } });
  (useWalletMode as jest.Mock).mockReturnValue({ mode: 'wallet', setMode });
});
it('keeps the wallet navigator mounted across repeated Terminal visits', () => {
  const view = render(<MainRoot />);
  for (let i = 0; i < 3; i++) {
    (useWalletMode as jest.Mock).mockReturnValue({ mode: 'terminal', setMode });
    view.rerender(<MainRoot />);
    (useWalletMode as jest.Mock).mockReturnValue({ mode: 'wallet', setMode });
    view.rerender(<MainRoot />);
  }
  expect(navigate).toHaveBeenCalledTimes(3);
  expect(navigate).toHaveBeenCalledWith('Terminal');
  expect(mockMount).toHaveBeenCalledTimes(1);
  expect(mockUnmount).not.toHaveBeenCalled();
});
it('does not open restored Terminal while authentication or another screen covers tabs', () => {
  (useWalletMode as jest.Mock).mockReturnValue({ mode: 'terminal', setMode });
  (useIsFocused as jest.Mock).mockReturnValue(false);
  const view = render(<MainRoot />);
  expect(navigate).not.toHaveBeenCalled();
  (useIsFocused as jest.Mock).mockReturnValue(true);
  view.rerender(<MainRoot />);
  expect(navigate).toHaveBeenCalledWith('Terminal');
});
it('does not open Terminal for a watch-only wallet', () => {
  (useWalletMode as jest.Mock).mockReturnValue({ mode: 'terminal', setMode });
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'watch', type: 'watch-only' } });
  render(<MainRoot />);
  expect(navigate).not.toHaveBeenCalled();
});
it('returns to existing tabs on exit and handles system Back consistently', async () => {
  (useWalletMode as jest.Mock).mockReturnValue({ mode: 'terminal', setMode });
  const view = render(<TerminalRoute />);
  expect(goBack).not.toHaveBeenCalled();
  await act(async () => { beforeRemove(); });
  expect(setMode).toHaveBeenCalledWith('wallet');
  (useWalletMode as jest.Mock).mockReturnValue({ mode: 'wallet', setMode });
  view.rerender(<TerminalRoute />);
  expect(goBack).toHaveBeenCalledTimes(1);
});

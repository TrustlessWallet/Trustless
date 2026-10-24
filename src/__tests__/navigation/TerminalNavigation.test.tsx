import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CashierTerminalRoot, MainRoot, TerminalRoute } from '../../navigation/TerminalNavigation';
import { useWalletMode } from '../../contexts/WalletModeContext';
import { useActiveWallet } from '../../contexts/WalletContext';
import { useIsFocused, useNavigation } from '@react-navigation/native';

jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', muted: '#888', inversePrimary: '#fff', bitcoin: '#f90' } } }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn(), useIsFocused: jest.fn() }));
const mockMount = jest.fn();
const mockUnmount = jest.fn();
jest.mock('../../navigation/TabNavigator', () => () => {
  require('react').useEffect(() => { mockMount(); return mockUnmount; }, []);
  return null;
});
const mockTerminalRender = jest.fn();
jest.mock('../../screens/TerminalScreen', () => (props: { visible: boolean }) => { mockTerminalRender(props); return null; });
const navigate = jest.fn();
const goBack = jest.fn();
const replace = jest.fn();
const setMode = jest.fn(() => Promise.resolve());
let beforeRemove: () => void;
beforeEach(() => {
  jest.clearAllMocks();
  (useNavigation as jest.Mock).mockReturnValue({ navigate, goBack, replace, canGoBack: () => true, addListener: (_: string, listener: () => void) => { beforeRemove = listener; return jest.fn(); } });
  (useIsFocused as jest.Mock).mockReturnValue(true);
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
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
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'watch', type: 'watch-only' });
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
  expect(mockTerminalRender).toHaveBeenLastCalledWith({ visible: false });
});

it('keeps cashier checkout in the restricted route and routes exit through owner unlock', async () => {
  const unlockCashier = jest.fn().mockResolvedValue(true);
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'locked', cashierBusy: false, unlockCashier, retryCashierLoad: jest.fn() });
  render(<CashierTerminalRoot />);
  expect(mockTerminalRender).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, onExit: expect.any(Function) }));
  await act(async () => { mockTerminalRender.mock.lastCall[0].onExit(); });
  expect(unlockCashier).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it('shows a failed owner unlock from checkout', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'locked', cashierBusy: false, unlockCashier: jest.fn().mockRejectedValue(new Error('storage failed')), retryCashierLoad: jest.fn() });
  render(<CashierTerminalRoot />);
  await act(async () => { await mockTerminalRender.mock.lastCall[0].onExit(); });
  expect(alert).toHaveBeenCalledWith('Couldn’t unlock cashier mode', 'Please retry.');
  alert.mockRestore();
});

it('shows owner unlock and retry instead of checkout for a missing or mismatched cashier wallet', async () => {
  const unlockCashier = jest.fn().mockResolvedValue(false);
  const retryCashierLoad = jest.fn().mockResolvedValue(undefined);
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'recovery', cashierBusy: false, unlockCashier, retryCashierLoad });
  const view = render(<CashierTerminalRoot />);
  expect(mockTerminalRender).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByLabelText('Retry cashier lock')); });
  expect(retryCashierLoad).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.press(view.getByLabelText('Owner unlock')); });
  expect(unlockCashier).toHaveBeenCalledTimes(1);
});

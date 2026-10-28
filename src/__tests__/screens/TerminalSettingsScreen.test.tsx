import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import TerminalSettingsScreen from '../../screens/TerminalSettingsScreen';
import { useActiveWallet } from '../../contexts/WalletContext';
import { useWalletMode } from '../../contexts/WalletModeContext';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true }));

jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: jest.fn() }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

it('offers a minimal cashier setting and requires owner enablement when tapped', async () => {
  const enableCashier = jest.fn().mockResolvedValue(true);
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false, enableCashier, unlockCashier: jest.fn() });
  const view = render(<TerminalSettingsScreen unit="sats" onSelectUnit={jest.fn()} onClose={jest.fn()} />);
  expect(view.getByLabelText('Currency')).toBeTruthy();
  expect(view.getByLabelText('Cashier mode')).toBeTruthy();
  expect(view.getByText('Off')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByLabelText('Cashier mode')); });
  expect(enableCashier).toHaveBeenCalledTimes(1);
});

it('does not offer cashier mode for a watch-only wallet', () => {
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'watch', type: 'watch-only' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false, enableCashier: jest.fn(), unlockCashier: jest.fn() });
  const view = render(<TerminalSettingsScreen unit="sats" onSelectUnit={jest.fn()} onClose={jest.fn()} />);
  expect(view.queryByLabelText('Cashier mode')).toBeNull();
});

it('opens receipt settings only for the owner outside cashier mode', () => {
  const open = jest.fn();
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false });
  const view = render(<TerminalSettingsScreen unit="sats" onSelectUnit={jest.fn()} onClose={jest.fn()} onOpenReceipts={open} />);
  fireEvent.press(view.getByLabelText('Receipt settings'));
  expect(open).toHaveBeenCalledTimes(1);
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'locked', cashierBusy: false });
  view.rerender(<TerminalSettingsScreen unit="sats" onSelectUnit={jest.fn()} onClose={jest.fn()} onOpenReceipts={open} />);
  expect(view.queryByLabelText('Receipt settings')).toBeNull();
});

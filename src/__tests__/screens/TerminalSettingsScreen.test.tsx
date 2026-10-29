import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useIsFocused } from '@react-navigation/native';
import TerminalSettingsScreen from '../../screens/TerminalSettingsScreen';
import { useActiveWallet } from '../../contexts/WalletContext';
import { useWalletMode } from '../../contexts/WalletModeContext';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: jest.fn(() => true) }));

jest.mock('../../contexts/WalletContext', () => ({ useActiveWallet: jest.fn() }));
jest.mock('../../contexts/WalletModeContext', () => ({ useWalletMode: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: { colors: { background: '#fff', primary: '#000', surface: '#eee', muted: '#888', border: '#ccc', bitcoin: '#f90' } } }) }));
jest.mock('../../components/GlassView', () => ({ GlassView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));

beforeEach(() => { (useIsFocused as jest.Mock).mockReturnValue(true); });

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


it('discards delayed currency positioning after leaving and returning to the sheet', () => {
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false });
  const props = { unit: 'sats' as const, onSelectUnit: jest.fn(), onClose: jest.fn() };
  const view = render(<TerminalSettingsScreen {...props} />);
  let position!: (x: number, y: number, width: number, height: number) => void;
  view.getByLabelText('Currency').parent!.instance.measureInWindow.mockImplementation((callback: typeof position) => { position = callback; });
  fireEvent.press(view.getByLabelText('Currency'));
  (useIsFocused as jest.Mock).mockReturnValue(false);
  view.rerender(<TerminalSettingsScreen {...props} />);
  (useIsFocused as jest.Mock).mockReturnValue(true);
  view.rerender(<TerminalSettingsScreen {...props} />);
  act(() => position(24, 100, 280, 48));
  expect(view.queryByLabelText('USD')).toBeNull();
  expect(props.onSelectUnit).not.toHaveBeenCalled();
});

it('closes currency choices when the active wallet changes', () => {
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false });
  const props = { unit: 'sats' as const, onSelectUnit: jest.fn(), onClose: jest.fn() };
  const view = render(<TerminalSettingsScreen {...props} />);
  view.getByLabelText('Currency').parent!.instance.measureInWindow.mockImplementation((callback: any) => callback(24, 100, 280, 48));
  fireEvent.press(view.getByLabelText('Currency'));
  expect(view.getByLabelText('USD')).toBeTruthy();
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'other', type: 'standard' });
  view.rerender(<TerminalSettingsScreen {...props} />);
  expect(view.queryByLabelText('USD')).toBeNull();
});


it('does not reopen dismissed currencies when an older measurement finishes late', () => {
  (useActiveWallet as jest.Mock).mockReturnValue({ id: 'shop', type: 'standard' });
  (useWalletMode as jest.Mock).mockReturnValue({ cashierState: 'off', cashierBusy: false });
  const onSelectUnit = jest.fn();
  const view = render(<TerminalSettingsScreen unit="sats" onSelectUnit={onSelectUnit} onClose={jest.fn()} />);
  const positions: ((x: number, y: number, width: number, height: number) => void)[] = [];
  view.getByLabelText('Currency').parent!.instance.measureInWindow.mockImplementation((callback: typeof positions[number]) => { positions.push(callback); });
  fireEvent.press(view.getByLabelText('Currency'));
  fireEvent.press(view.getByLabelText('Currency'));
  act(() => positions[1](24, 100, 280, 48));
  fireEvent.press(view.getByLabelText('USD'));
  expect(onSelectUnit).toHaveBeenCalledWith('USD');
  act(() => positions[0](24, 100, 280, 48));
  expect(view.queryByLabelText('USD')).toBeNull();
});

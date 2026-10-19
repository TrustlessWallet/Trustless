import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletMode, WalletModeProvider, WALLET_MODE_KEY } from '../../contexts/WalletModeContext';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => <WalletModeProvider>{children}</WalletModeProvider>;

beforeEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue('wallet');
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
});

it('publishes a mode change immediately while persistence completes', async () => {
  let finish!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe('wallet'));
  let change!: Promise<void>;
  act(() => { change = result.current.setMode('terminal'); });
  expect(result.current.mode).toBe('terminal');
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish(); await change; });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(WALLET_MODE_KEY, 'terminal');
  expect(result.current.mode).toBe('terminal');
});

it('rolls the visible mode back when persistence fails', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.mode).toBe('wallet'));
  let change!: Promise<void>;
  act(() => { change = result.current.setMode('terminal'); });
  expect(result.current.mode).toBe('terminal');
  await act(async () => { await expect(change).rejects.toThrow('write failed'); });
  expect(result.current.mode).toBe('wallet');
});

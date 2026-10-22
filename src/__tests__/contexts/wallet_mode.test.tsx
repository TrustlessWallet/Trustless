import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletMode, WalletModeProvider, WALLET_MODE_KEY, SHOW_TERMINAL_KEY } from '../../contexts/WalletModeContext';
import { useWallet } from '../../contexts/WalletContext';
import { CASHIER_LOCK_KEY } from '../../services/cashierLock';
import { authenticate_terminal_cashier } from '../../services/authState';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../../contexts/WalletContext', () => ({ useWallet: jest.fn() }));
jest.mock('../../services/authState', () => ({ authenticate_terminal_cashier: jest.fn() }));

const wrapper = ({ children }: { children: React.ReactNode }) => <WalletModeProvider>{children}</WalletModeProvider>;

beforeEach(() => {
  const values = new Map<string, string>([[WALLET_MODE_KEY, 'wallet']]);
  (AsyncStorage.getItem as jest.Mock).mockReset().mockImplementation(async key => values.get(key) ?? null);
  (AsyncStorage.setItem as jest.Mock).mockReset().mockImplementation(async (key, value) => { values.set(key, value); });
  (AsyncStorage.removeItem as jest.Mock).mockReset().mockImplementation(async key => { values.delete(key); });
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-a', type: 'standard' } });
  (authenticate_terminal_cashier as jest.Mock).mockReset().mockResolvedValue(true);
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


it('hydrates hidden Terminal access before exposing consumers', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === SHOW_TERMINAL_KEY ? 'false' : key === WALLET_MODE_KEY ? 'wallet' : null);
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.showTerminal).toBe(false));
});

it('updates Terminal access across consumers before storage finishes', async () => {
  let finish!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const { result } = renderHook(() => ({ settings: useWalletMode(), wallet: useWalletMode() }), { wrapper });
  await waitFor(() => expect(result.current.wallet.showTerminal).toBe(true));
  let change!: Promise<void>;
  act(() => { change = result.current.settings.setShowTerminal(false); });
  expect(result.current.wallet.showTerminal).toBe(false);
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish(); await change; });
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(SHOW_TERMINAL_KEY, 'false');
});

it('restores Terminal visibility after a failed setting write', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.showTerminal).toBe(true));
  let change!: Promise<void>;
  act(() => { change = result.current.setShowTerminal(false); });
  expect(result.current.showTerminal).toBe(false);
  await act(async () => { await expect(change).rejects.toThrow('write failed'); });
  expect(result.current.showTerminal).toBe(true);
});

it('requires fresh owner authentication to enable and unlock cashier mode regardless of preferences', async () => {
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); });
  await act(async () => { expect(await result.current.enableCashier()).toBe(true); });
  expect(result.current.cashierState).toBe('locked');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(CASHIER_LOCK_KEY, JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet' }));
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
  await act(async () => { expect(await result.current.unlockCashier()).toBe(true); });
  expect(result.current.cashierState).toBe('off');
  expect(result.current.mode).toBe('wallet');
  expect(AsyncStorage.removeItem).toHaveBeenCalledWith(CASHIER_LOCK_KEY);
  expect((authenticate_terminal_cashier as jest.Mock).mock.calls.map(call => call[0])).toEqual(['Enable cashier mode', 'Unlock cashier mode']);
  const writes = (AsyncStorage.setItem as jest.Mock).mock.calls;
  expect(writes.findIndex(call => call[0] === WALLET_MODE_KEY && call[1] === 'wallet')).toBeGreaterThan(writes.findIndex(call => call[0] === CASHIER_LOCK_KEY));
});

it('durably targets Terminal on Settings unlock and hands its scoped draft to the new root once', async () => {
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); await result.current.enableCashier(); });
  const draft = { walletId: 'wallet-a', network: 'mainnet' as const, unit: 'USD' as const, manualAmount: '', basketLines: [{ itemId: 'tea', name: 'Tea', unitPrice: 250, quantity: 2, total: 500 }] };
  await act(async () => { expect(await result.current.unlockCashier('terminal', () => draft)).toBe(true); });
  expect(result.current.mode).toBe('terminal');
  expect(result.current.cashierUnlockDestination).toBe('terminal');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(WALLET_MODE_KEY, 'terminal');
  expect(result.current.consumeCashierTerminalDraft('wallet-a', 'mainnet')).toEqual(draft);
  expect(result.current.consumeCashierTerminalDraft('wallet-a', 'mainnet')).toBeNull();
});

it('discards a handoff for a different wallet and keeps the lock if destination persistence fails', async () => {
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); await result.current.enableCashier(); });
  const draft = { walletId: 'wallet-a', network: 'mainnet' as const, unit: 'sats' as const, manualAmount: '25', basketLines: [] };
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('mode write failed'));
  await act(async () => { await expect(result.current.unlockCashier('terminal', () => draft)).rejects.toThrow('mode write failed'); });
  expect(result.current.cashierState).toBe('locked');
  expect(result.current.consumeCashierTerminalDraft('wallet-a', 'mainnet')).toBeNull();
  await act(async () => { expect(await result.current.unlockCashier('terminal', () => draft)).toBe(true); });
  expect(result.current.consumeCashierTerminalDraft('wallet-b', 'mainnet')).toBeNull();
  expect(result.current.consumeCashierTerminalDraft('wallet-a', 'mainnet')).toBeNull();
});

it('keeps cashier mode off when owner auth is cancelled and serializes duplicate taps', async () => {
  let finishAuth!: (value: boolean) => void;
  (authenticate_terminal_cashier as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishAuth = resolve; }));
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); });
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => { first = result.current.enableCashier(); second = result.current.enableCashier(); });
  expect(await second).toBe(false);
  expect(authenticate_terminal_cashier).toHaveBeenCalledTimes(1);
  await act(async () => { finishAuth(false); expect(await first).toBe(false); });
  expect(result.current.cashierState).toBe('off');
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(CASHIER_LOCK_KEY, expect.anything());
});

it('ignores an owner-auth result after the active wallet changes', async () => {
  let finishAuth!: (value: boolean) => void;
  (authenticate_terminal_cashier as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishAuth = resolve; }));
  const { result, rerender } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); });
  let enabling!: Promise<boolean>;
  act(() => { enabling = result.current.enableCashier(); });
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-b', type: 'standard' } });
  rerender({});
  await act(async () => { finishAuth(true); expect(await enabling).toBe(false); });
  expect(result.current.cashierState).toBe('off');
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(CASHIER_LOCK_KEY, expect.anything());
});

it('restricts a different wallet if it appears while a lock write is completing', async () => {
  let finishWrite!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string) => {
    if (key === CASHIER_LOCK_KEY) await new Promise<void>(resolve => { finishWrite = resolve; });
  });
  const { result, rerender } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); });
  let enabling!: Promise<boolean>;
  act(() => { enabling = result.current.enableCashier(); });
  await waitFor(() => expect(finishWrite).toBeDefined());
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-b', type: 'standard' } });
  rerender({});
  await act(async () => { finishWrite(); expect(await enabling).toBe(true); });
  expect(result.current.cashierState).toBe('recovery');
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
});

it('fails closed on unreadable or corrupt lock state and after an uncertain write', async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === CASHIER_LOCK_KEY ? '{broken' : key === WALLET_MODE_KEY ? 'wallet' : null);
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('recovery'));
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => { if (key === CASHIER_LOCK_KEY) throw new Error('read failed'); return key === WALLET_MODE_KEY ? 'wallet' : null; });
  await act(async () => { await expect(result.current.retryCashierLoad()).rejects.toThrow('read failed'); });
  expect(result.current.cashierState).toBe('recovery');
});

it('restores a durable lock before children mount and restricts wallet-scope mismatches', async () => {
  const lock = JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet' });
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === CASHIER_LOCK_KEY ? lock : key === WALLET_MODE_KEY ? 'terminal' : null);
  const { result, rerender } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('locked'));
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-b', type: 'standard' } });
  rerender({});
  expect(result.current.cashierState).toBe('recovery');
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
});

it('keeps routes restricted when a lock write may have reached storage despite rejection', async () => {
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async key => { if (key === CASHIER_LOCK_KEY) throw new Error('uncertain write'); });
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('off'));
  await act(async () => { await result.current.setMode('terminal'); });
  await act(async () => { await expect(result.current.enableCashier()).rejects.toThrow('uncertain write'); });
  expect(result.current.cashierState).toBe('recovery');
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
});

it('retains the restricted surface if removing the durable lock fails after persisting wallet mode', async () => {
  const lock = JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet' });
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === CASHIER_LOCK_KEY ? lock : key === WALLET_MODE_KEY ? 'terminal' : null);
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('remove failed'));
  const { result } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('locked'));
  await act(async () => { await expect(result.current.unlockCashier()).rejects.toThrow('remove failed'); });
  expect(result.current.cashierState).toBe('locked');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(WALLET_MODE_KEY, 'wallet');
  await expect(result.current.setMode('wallet')).rejects.toThrow('owner unlock');
});

it('rejects stale unlock authentication before storage mutation and duplicate unlocks', async () => {
  const lock = JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet' });
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === CASHIER_LOCK_KEY ? lock : key === WALLET_MODE_KEY ? 'terminal' : null);
  let finishAuth!: (value: boolean) => void;
  (authenticate_terminal_cashier as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finishAuth = resolve; }));
  const { result, rerender } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('locked'));
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => { first = result.current.unlockCashier(); second = result.current.unlockCashier(); });
  expect(await second).toBe(false);
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-b', type: 'standard' } });
  rerender({});
  await act(async () => { finishAuth(true); expect(await first).toBe(false); });
  expect(result.current.cashierState).toBe('recovery');
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  expect(authenticate_terminal_cashier).toHaveBeenCalledTimes(1);
});

it('lets an authenticated owner-device unlock finish if the wallet changes during durable removal', async () => {
  const lock = JSON.stringify({ version: 1, walletId: 'wallet-a', network: 'mainnet' });
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => key === CASHIER_LOCK_KEY ? lock : key === WALLET_MODE_KEY ? 'terminal' : null);
  let finishRemove!: () => void;
  (AsyncStorage.removeItem as jest.Mock).mockImplementationOnce(() => new Promise<void>(resolve => { finishRemove = resolve; }));
  const { result, rerender } = renderHook(() => useWalletMode(), { wrapper });
  await waitFor(() => expect(result.current.cashierState).toBe('locked'));
  let unlocking!: Promise<boolean>;
  act(() => { unlocking = result.current.unlockCashier(); });
  await waitFor(() => expect(finishRemove).toBeDefined());
  expect(authenticate_terminal_cashier).toHaveBeenCalledTimes(1);
  (useWallet as jest.Mock).mockReturnValue({ activeWallet: { id: 'wallet-b', type: 'standard' } });
  rerender({});
  expect(result.current.cashierState).toBe('recovery');
  await act(async () => { finishRemove(); expect(await unlocking).toBe(true); });
  expect(result.current.cashierState).toBe('off');
  expect(result.current.mode).toBe('wallet');
});

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useTerminalEntry } from '../../hooks/useTerminalEntry';
import { warmTerminalItems } from '../../services/terminalItems';
jest.mock('../../services/terminalItems', () => ({ warmTerminalItems: jest.fn() }));
const wallet = { id: 'shop', type: 'standard' };
beforeEach(() => { (warmTerminalItems as jest.Mock).mockReset().mockResolvedValue(undefined); });
it('warms before entry, indicates cold preparation and prevents duplicate navigation', async () => {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  (warmTerminalItems as jest.Mock).mockReturnValue(ready);
  const setMode = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useTerminalEntry(wallet, false, setMode));
  await waitFor(() => expect(warmTerminalItems).toHaveBeenCalledWith('shop', expect.any(String)));
  let opening!: Promise<void>;
  act(() => { opening = result.current.openTerminal(); void result.current.openTerminal(); });
  expect(result.current.busy).toBe(true);
  expect(setMode).not.toHaveBeenCalled();
  await act(async () => { finish(); await opening; });
  expect(setMode).toHaveBeenCalledTimes(1);
  expect(setMode).toHaveBeenCalledWith('terminal');
  expect(result.current.busy).toBe(false);
});
it.each(['switch', 'unmount', 'blur'])('does not open a stale Terminal after %s', async action => {
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  (warmTerminalItems as jest.Mock).mockReturnValue(ready);
  const setMode = jest.fn().mockResolvedValue(undefined);
  const { result, rerender, unmount } = renderHook(({ wallet, focused }) => useTerminalEntry(wallet, false, setMode, focused), { initialProps: { wallet, focused: true } });
  let opening!: Promise<void>;
  act(() => { opening = result.current.openTerminal(); });
  if (action === 'unmount') unmount();
  else rerender({ wallet: action === 'switch' ? { ...wallet, id: 'other' } : wallet, focused: action !== 'blur' });
  await act(async () => { finish(); await opening; });
  expect(setMode).not.toHaveBeenCalled();
  unmount();
});
it('opens manual checkout even while the catalog read is still pending', async () => {
  jest.useFakeTimers();
  try {
    (warmTerminalItems as jest.Mock).mockReturnValue(new Promise<void>(() => {}));
    const setMode = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTerminalEntry(wallet, false, setMode));
    await act(async () => {
      void result.current.openTerminal();
      jest.advanceTimersByTime(150);
    });
    expect(setMode).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
it('allows manual checkout when the optional catalog cannot load', async () => {
  (warmTerminalItems as jest.Mock).mockRejectedValue(new Error('storage busy'));
  const setMode = jest.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useTerminalEntry(wallet, false, setMode));
  await act(async () => { await result.current.openTerminal(); });
  expect(setMode).toHaveBeenCalledWith('terminal');
  expect(result.current.busy).toBe(false);
});
it('does not prepare or enter Terminal for watch-only wallets', async () => {
  const setMode = jest.fn();
  const { result } = renderHook(() => useTerminalEntry({ ...wallet, type: 'watch-only' }, false, setMode));
  await act(async () => { await result.current.openTerminal(); });
  expect(warmTerminalItems).not.toHaveBeenCalled();
  expect(setMode).not.toHaveBeenCalled();
});

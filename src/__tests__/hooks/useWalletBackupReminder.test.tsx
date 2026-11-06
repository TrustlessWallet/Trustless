import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWalletBackupReminder } from '../../hooks/useWalletBackupReminder';
import { isBackupPending } from '../../services/firstLaunchWallet';
jest.mock('../../services/firstLaunchWallet', () => ({ isBackupPending: jest.fn() }));
it('retains the reminder under sheets and while rechecking on return, then clears on confirmation', async () => {
 (isBackupPending as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
 const hook = renderHook(({ focused }) => useWalletBackupReminder('auto', 'Bitcoin', focused), { initialProps: { focused: true } });
 await waitFor(() => expect(hook.result.current).toBe('auto'));
 hook.rerender({ focused: false });
 expect(hook.result.current).toBe('auto');
 let finish!: (pending: boolean) => void;
 (isBackupPending as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
 hook.rerender({ focused: true });
 expect(hook.result.current).toBe('auto');
 await act(async () => finish(false));
 expect(hook.result.current).toBeNull();
});
it('never carries the reminder to another wallet or accepts an obsolete read', async () => {
 let finish!: (pending: boolean) => void;
 (isBackupPending as jest.Mock).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(false);
 const hook = renderHook(({ id }) => useWalletBackupReminder(id, 'Bitcoin', true), { initialProps: { id: 'auto' } });
 hook.rerender({ id: 'imported' });
 await act(async () => finish(true));
 expect(hook.result.current).toBeNull();
});

it('loads the reminder before the wallet screen first receives focus', async () => {
 (isBackupPending as jest.Mock).mockResolvedValueOnce(true);
 const hook = renderHook(() => useWalletBackupReminder('auto', 'Bitcoin', false));
 await waitFor(() => expect(hook.result.current).toBe('auto'));
});

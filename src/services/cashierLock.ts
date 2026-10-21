import AsyncStorage from '@react-native-async-storage/async-storage';
import { TerminalNetwork } from './terminal';

export const CASHIER_LOCK_KEY = '@terminalCashierLock:v1';
export type CashierLockRecord = { version: 1; walletId: string; network: TerminalNetwork };

// Module scope keeps boot reads and writes ordered even if the provider remounts.
let storageQueue: Promise<unknown> = Promise.resolve();
const serialize = <T,>(operation: () => Promise<T>): Promise<T> => {
  const task = storageQueue.then(operation);
  storageQueue = task.catch(() => undefined);
  return task;
};

export const readCashierBoot = (modeKey: string): Promise<{ mode: string | null; lock: CashierLockRecord | null }> => serialize(async () => {
  const [mode, raw] = await Promise.all([AsyncStorage.getItem(modeKey), AsyncStorage.getItem(CASHIER_LOCK_KEY)]);
  if (raw === null) return { mode, lock: null };
  const lock: unknown = JSON.parse(raw);
  if (!lock || typeof lock !== 'object' || (lock as CashierLockRecord).version !== 1 ||
    typeof (lock as CashierLockRecord).walletId !== 'string' || !(lock as CashierLockRecord).walletId ||
    !['mainnet', 'testnet'].includes((lock as CashierLockRecord).network)) throw new Error('Invalid cashier lock');
  return { mode, lock: lock as CashierLockRecord };
});

export const writeCashierLock = (lock: CashierLockRecord): Promise<void> => serialize(() =>
  AsyncStorage.setItem(CASHIER_LOCK_KEY, JSON.stringify(lock)));

export const clearCashierLock = (modeKey: string): Promise<void> => serialize(async () => {
  // If the second write fails, the durable lock still gates every route.
  await AsyncStorage.setItem(modeKey, 'wallet');
  await AsyncStorage.removeItem(CASHIER_LOCK_KEY);
});

export const writeWalletMode = (modeKey: string, mode: string): Promise<void> => serialize(() =>
  AsyncStorage.setItem(modeKey, mode));

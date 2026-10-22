import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWallet } from './WalletContext';
import { NETWORK_NAME } from '../constants/network';
import { terminalNetwork, TerminalBasketLine, TerminalNetwork, TerminalUnit } from '../services/terminal';
import { authenticate_terminal_cashier } from '../services/authState';
import { CashierLockRecord, clearCashierLock, readCashierBoot, writeCashierLock, writeWalletMode } from '../services/cashierLock';

export type WalletMode = 'wallet' | 'terminal';
export type CashierTerminalDraft = Readonly<{ walletId: string; network: TerminalNetwork; unit: TerminalUnit; manualAmount: string; basketLines: readonly TerminalBasketLine[] }>;
export const WALLET_MODE_KEY = '@appWalletMode';
export const SHOW_TERMINAL_KEY = '@showTerminal';

type ModeContext = {
  mode: WalletMode;
  changing: boolean;
  showTerminal: boolean;
  setShowTerminal: (show: boolean) => Promise<void>;
  setMode: (mode: WalletMode) => Promise<void>;
  cashierState: 'off' | 'locked' | 'recovery';
  cashierBusy: boolean;
  cashierUnlockRevision: number;
  cashierUnlockDestination: WalletMode | null;
  enableCashier: () => Promise<boolean>;
  unlockCashier: (destination?: WalletMode, getDraft?: () => CashierTerminalDraft | null) => Promise<boolean>;
  consumeCashierTerminalDraft: (walletId: string, network: TerminalNetwork) => CashierTerminalDraft | null;
  retryCashierLoad: () => Promise<void>;
};

const Context = createContext<ModeContext | null>(null);

export function WalletModeProvider({ children }: { children: React.ReactNode }) {
  const { activeWallet } = useWallet();
  const network = terminalNetwork(NETWORK_NAME);
  const walletScope = `${network}:${activeWallet?.id ?? ''}:${activeWallet?.type ?? ''}`;
  const walletScopeRef = useRef(walletScope);
  walletScopeRef.current = walletScope;
  const [mode, publish] = useState<WalletMode>('wallet');
  const [cashierLock, publishCashierLock] = useState<CashierLockRecord | null | undefined>(undefined);
  const cashierLockRef = useRef<CashierLockRecord | null | undefined>(undefined);
  const [cashierBusy, setCashierBusy] = useState(false);
  const [cashierUnlockRevision, setCashierUnlockRevision] = useState(0);
  const [cashierUnlockDestination, setCashierUnlockDestination] = useState<WalletMode | null>(null);
  const terminalDraft = useRef<CashierTerminalDraft | null>(null);
  const cashierMutation = useRef(false);
  const cashierEpoch = useRef(0);
  const [showTerminal, publishShowTerminal] = useState(true);
  const visibilityQueue = useRef<Promise<unknown>>(Promise.resolve());
  const visibilitySequence = useRef(0);
  const persistedVisibility = useRef(true);
  const [loaded, setLoaded] = useState(false);
  const [changing, setChanging] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const modeRef = useRef<WalletMode>('wallet');
  const persistedModeRef = useRef<WalletMode>('wallet');
  const requestSequence = useRef(0);
  const pendingWrites = useRef(0);

  useEffect(() => {
    mounted.current = true;
    Promise.all([readCashierBoot(WALLET_MODE_KEY), AsyncStorage.getItem(SHOW_TERMINAL_KEY)]).then(([boot, visibility]) => {
      if (mounted.current) {
        persistedVisibility.current = visibility !== 'false';
        publishShowTerminal(visibility !== 'false');
        cashierLockRef.current = boot.lock;
        publishCashierLock(boot.lock);
        const restored = boot.mode === 'terminal' ? 'terminal' : 'wallet';
        modeRef.current = restored;
        persistedModeRef.current = restored;
        publish(restored);
      }
    }).catch(() => {
      // No wallet route is safe when the lock record cannot be read.
      if (mounted.current) { cashierLockRef.current = undefined; publishCashierLock(undefined); }
    }).finally(() => { if (mounted.current) setLoaded(true); });
    return () => { mounted.current = false; ++cashierEpoch.current; };
  }, []);

  const cashierState = cashierLock === undefined ? 'recovery'
    : cashierLock === null ? 'off'
      : activeWallet?.id === cashierLock.walletId && activeWallet.type !== 'watch-only' && network === cashierLock.network ? 'locked' : 'recovery';

  const retryCashierLoad = async (): Promise<void> => {
    if (cashierMutation.current) return;
    try {
      const boot = await readCashierBoot(WALLET_MODE_KEY);
      if (!mounted.current) return;
      cashierLockRef.current = boot.lock;
      publishCashierLock(boot.lock);
      const restored = boot.mode === 'terminal' ? 'terminal' : 'wallet';
      modeRef.current = restored;
      persistedModeRef.current = restored;
      publish(restored);
    } catch (error) {
      if (mounted.current) { cashierLockRef.current = undefined; publishCashierLock(undefined); }
      throw error;
    }
  };

  const enableCashier = async (): Promise<boolean> => {
    if (cashierMutation.current || cashierLockRef.current !== null || !activeWallet || activeWallet.type === 'watch-only' || modeRef.current !== 'terminal') return false;
    cashierMutation.current = true;
    terminalDraft.current = null;
    if (mounted.current) setCashierBusy(true);
    const capturedScope = walletScope;
    const epoch = cashierEpoch.current;
    try {
      if (!await authenticate_terminal_cashier('Enable cashier mode')) return false;
      await queue.current;
      if (!mounted.current || epoch !== cashierEpoch.current || capturedScope !== walletScopeRef.current || modeRef.current !== 'terminal') return false;
      const lock: CashierLockRecord = { version: 1, walletId: activeWallet.id, network };
      // A scope change while this write is pending still leaves the restricted
      // surface visible once the durable lock has committed.
      try { await writeCashierLock(lock); }
      catch (error) {
        // A rejected storage write may still have reached disk. Restrict until
        // a successful read proves whether a lock exists.
        cashierLockRef.current = undefined;
        if (mounted.current) publishCashierLock(undefined);
        throw error;
      }
      cashierLockRef.current = lock;
      if (mounted.current) publishCashierLock(lock);
      return true;
    } finally {
      cashierMutation.current = false;
      if (mounted.current) setCashierBusy(false);
    }
  };

  const unlockCashier = async (destination: WalletMode = 'wallet', getDraft?: () => CashierTerminalDraft | null): Promise<boolean> => {
    if (cashierMutation.current || cashierLockRef.current === null) return false;
    cashierMutation.current = true;
    terminalDraft.current = null;
    if (mounted.current) setCashierBusy(true);
    const capturedScope = walletScope;
    const epoch = cashierEpoch.current;
    try {
      if (!await authenticate_terminal_cashier('Unlock cashier mode')) return false;
      if (!mounted.current || epoch !== cashierEpoch.current || capturedScope !== walletScopeRef.current) return false;
      const draft = destination === 'terminal' && getDraft ? getDraft() : null;
      if (destination === 'terminal' && getDraft && !draft) throw new Error('Finish the current invoice before disabling cashier mode.');
      if (draft && (draft.walletId !== activeWallet?.id || draft.network !== network)) return false;
      // Authentication is scoped until the durable unlock begins. After that,
      // it authorizes this owner-device exit even if the active wallet changes
      // while storage completes; the lock is being removed for the whole app.
      await clearCashierLock(WALLET_MODE_KEY, destination);
      terminalDraft.current = draft ? { ...draft, basketLines: draft.basketLines.map(line => ({ ...line })) } : null;
      cashierLockRef.current = null;
      modeRef.current = destination;
      persistedModeRef.current = destination;
      void AsyncStorage.setItem('@lastActiveTime', Date.now().toString()).catch(() => undefined);
      if (mounted.current) { setCashierUnlockDestination(destination); setCashierUnlockRevision(value => value + 1); publishCashierLock(null); publish(destination); }
      return true;
    } finally {
      cashierMutation.current = false;
      if (mounted.current) setCashierBusy(false);
    }
  };

  const consumeCashierTerminalDraft = (walletId: string, requestedNetwork: TerminalNetwork): CashierTerminalDraft | null => {
    const draft = terminalDraft.current;
    terminalDraft.current = null;
    return draft?.walletId === walletId && draft.network === requestedNetwork ? draft : null;
  };

  const setMode = (next: WalletMode): Promise<void> => {
    if (cashierLockRef.current !== null || cashierMutation.current) return Promise.reject(new Error('Cashier mode requires owner unlock.'));
    if (next === modeRef.current) return Promise.resolve();
    modeRef.current = next;
    const sequence = ++requestSequence.current;
    // Change the visible surface immediately. Storage is only a persistence
    // detail, so it should never make entering or leaving checkout feel slow.
    if (mounted.current) publish(next);
    pendingWrites.current += 1;
    setChanging(true);
    const task = queue.current.then(async () => {
      await writeWalletMode(WALLET_MODE_KEY, next);
    });
    queue.current = task.catch(() => undefined);
    return task.then(() => {
      persistedModeRef.current = next;
    }).catch(error => {
      // A failed write must not leave the UI claiming a mode that will vanish
      // after a restart. Do not roll back a newer requested mode, including a
      // later request that happens to choose the same mode again.
      if (requestSequence.current === sequence) {
        modeRef.current = persistedModeRef.current;
        if (mounted.current) publish(persistedModeRef.current);
      }
      throw error;
    }).finally(() => {
      pendingWrites.current -= 1;
      if (mounted.current && pendingWrites.current === 0) setChanging(false);
    });
  };

  const setShowTerminal = (next: boolean): Promise<void> => {
    const sequence = ++visibilitySequence.current;
    publishShowTerminal(next);
    const task = visibilityQueue.current.then(() => AsyncStorage.setItem(SHOW_TERMINAL_KEY, String(next)));
    visibilityQueue.current = task.catch(() => undefined);
    return task.then(() => { persistedVisibility.current = next; }).catch(error => {
      if (mounted.current && visibilitySequence.current === sequence) publishShowTerminal(persistedVisibility.current);
      throw error;
    });
  };

  if (!loaded) return null;
  return <Context.Provider value={{ mode, changing, setMode, showTerminal, setShowTerminal, cashierState, cashierBusy, cashierUnlockRevision, cashierUnlockDestination, enableCashier, unlockCashier, consumeCashierTerminalDraft, retryCashierLoad }}>{children}</Context.Provider>;
}

export function useWalletMode(): ModeContext {
  const value = useContext(Context);
  if (!value) throw new Error('Wallet mode is unavailable.');
  return value;
}

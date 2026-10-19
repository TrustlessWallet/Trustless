import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WalletMode = 'wallet' | 'terminal';
export const WALLET_MODE_KEY = '@appWalletMode';
export const SHOW_TERMINAL_KEY = '@showTerminal';

type ModeContext = {
  mode: WalletMode;
  changing: boolean;
  showTerminal: boolean;
  setShowTerminal: (show: boolean) => Promise<void>;
  setMode: (mode: WalletMode) => Promise<void>;
};

const Context = createContext<ModeContext | null>(null);

export function WalletModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, publish] = useState<WalletMode>('wallet');
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
    Promise.all([AsyncStorage.getItem(WALLET_MODE_KEY), AsyncStorage.getItem(SHOW_TERMINAL_KEY)]).then(([value, visibility]) => {
      if (mounted.current) {
        persistedVisibility.current = visibility !== 'false';
        publishShowTerminal(visibility !== 'false');
        const restored = value === 'terminal' ? 'terminal' : 'wallet';
        modeRef.current = restored;
        persistedModeRef.current = restored;
        publish(restored);
      }
    }).catch(() => {}).finally(() => { if (mounted.current) setLoaded(true); });
    return () => { mounted.current = false; };
  }, []);

  const setMode = (next: WalletMode): Promise<void> => {
    if (next === modeRef.current) return Promise.resolve();
    modeRef.current = next;
    const sequence = ++requestSequence.current;
    // Change the visible surface immediately. Storage is only a persistence
    // detail, so it should never make entering or leaving checkout feel slow.
    if (mounted.current) publish(next);
    pendingWrites.current += 1;
    setChanging(true);
    const task = queue.current.then(async () => {
      await AsyncStorage.setItem(WALLET_MODE_KEY, next);
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
  return <Context.Provider value={{ mode, changing, setMode, showTerminal, setShowTerminal }}>{children}</Context.Provider>;
}

export function useWalletMode(): ModeContext {
  const value = useContext(Context);
  if (!value) throw new Error('Wallet mode is unavailable.');
  return value;
}

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type WalletMode = 'wallet' | 'terminal';
export const WALLET_MODE_KEY = '@appWalletMode';

type ModeContext = {
  mode: WalletMode;
  changing: boolean;
  setMode: (mode: WalletMode) => Promise<void>;
};

const Context = createContext<ModeContext | null>(null);

export function WalletModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, publish] = useState<WalletMode>('wallet');
  const [loaded, setLoaded] = useState(false);
  const [changing, setChanging] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    AsyncStorage.getItem(WALLET_MODE_KEY).then(value => {
      if (mounted.current) publish(value === 'terminal' ? 'terminal' : 'wallet');
    }).catch(() => {}).finally(() => { if (mounted.current) setLoaded(true); });
    return () => { mounted.current = false; };
  }, []);

  const setMode = (next: WalletMode): Promise<void> => {
    setChanging(true);
    const task = queue.current.then(async () => {
      await AsyncStorage.setItem(WALLET_MODE_KEY, next);
      if (mounted.current) publish(next);
    });
    queue.current = task.catch(() => undefined);
    void task.finally(() => { if (mounted.current) setChanging(false); }).catch(() => undefined);
    return task;
  };

  if (!loaded) return null;
  return <Context.Provider value={{ mode, changing, setMode }}>{children}</Context.Provider>;
}

export function useWalletMode(): ModeContext {
  const value = useContext(Context);
  if (!value) throw new Error('Wallet mode is unavailable.');
  return value;
}

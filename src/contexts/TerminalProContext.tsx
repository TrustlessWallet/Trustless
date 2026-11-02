import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import {
  createTerminalProService,
  ProPlan,
  ProPlanId,
  ProStatus,
  TerminalProService,
  TerminalProSnapshot,
} from '../services/terminalPro';
import { AppState } from 'react-native';

export type { ProPlan, ProPlanId, ProStatus };

export type TerminalProContextValue = TerminalProSnapshot & {
  refresh: () => Promise<void>;
  loadPlans: () => Promise<void>;
  purchase: (id: ProPlanId) => Promise<boolean>;
  restore: () => Promise<boolean>;
  manage: () => Promise<void>;
};

const unavailable: TerminalProContextValue = {
  status: 'unavailable', pending: false, plans: [], loadingPlans: false, busy: false, error: null,
  refresh: async () => {}, loadPlans: async () => {}, purchase: async () => false,
  restore: async () => false, manage: async () => {},
};
const Context = createContext<TerminalProContextValue>(unavailable);

export function TerminalProProvider({ children }: { children: React.ReactNode }) {
  const service = useRef<TerminalProService | null>(null);
  const started = useRef(false);
  const [snapshot, setSnapshot] = useState<TerminalProSnapshot>({ ...unavailable, status: 'loading' });

  useEffect(() => {
    const current = createTerminalProService();
    service.current = current;
    const unsubscribe = current.subscribe(setSnapshot);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active' && started.current) void current.refresh(); });
    return () => { foreground.remove(); unsubscribe(); current.dispose(); if (service.current === current) service.current = null; };
  }, []);
  const refresh = useCallback(async () => { started.current = true; await service.current?.refresh(); }, []);
  const loadPlans = useCallback(async () => { started.current = true; await service.current?.loadPlans(); }, []);
  const purchase = useCallback(async (id: ProPlanId) => await service.current?.purchase(id) ?? false, []);
  const restore = useCallback(async () => await service.current?.restore() ?? false, []);
  const manage = useCallback(async () => { await service.current?.manage(); }, []);
  return <Context.Provider value={{ ...snapshot, refresh, loadPlans, purchase, restore, manage }}>{children}</Context.Provider>;
}

export const useTerminalPro = (): TerminalProContextValue => useContext(Context);

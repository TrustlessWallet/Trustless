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
export type ProActivationKind = 'purchase' | 'restore';
export type ProActivation = { id: number; scope: string; kind: ProActivationKind; claimedBy: string | null };
type Attempt = { id: number; scope: string; kind: ProActivationKind; pending: boolean };

export type TerminalProContextValue = TerminalProSnapshot & {
  refresh: () => Promise<void>;
  loadPlans: () => Promise<void>;
  purchase: (id: ProPlanId, attemptId?: number) => Promise<boolean>;
  restore: (attemptId?: number) => Promise<boolean>;
  manage: () => Promise<void>;
  activation: ProActivation | null;
  beginActivation: (scope: string, kind: ProActivationKind) => number;
  abandonActivation: (attemptId: number) => void;
  claimActivation: (id: number, owner: string, scope: string) => boolean;
  releaseActivation: (id: number, owner: string) => void;
  acknowledgeActivation: (id: number, owner: string) => void;
};

const unavailable: TerminalProContextValue = {
  status: 'unavailable', pending: false, plans: [], loadingPlans: false, busy: false, error: null,
  refresh: async () => {}, loadPlans: async () => {}, purchase: async () => false,
  restore: async () => false, manage: async () => {}, activation: null,
  beginActivation: () => 0, abandonActivation: () => {}, claimActivation: () => false,
  releaseActivation: () => {}, acknowledgeActivation: () => {},
};
const Context = createContext<TerminalProContextValue>(unavailable);

export function TerminalProProvider({ children }: { children: React.ReactNode }) {
  const service = useRef<TerminalProService | null>(null);
  const started = useRef(false);
  const sequence = useRef(0);
  const attempt = useRef<Attempt | null>(null);
  const activationRef = useRef<ProActivation | null>(null);
  const [activation, setActivation] = useState<ProActivation | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalProSnapshot>({ ...unavailable, status: 'loading' });
  const publishActivation = useCallback((value: ProActivation | null) => {
    activationRef.current = value;
    setActivation(value);
  }, []);
  const recordVerified = useCallback((id: number) => {
    const current = attempt.current;
    if (!current || current.id !== id) return;
    publishActivation({ id: current.id, scope: current.scope, kind: current.kind, claimedBy: null });
    attempt.current = null;
  }, [publishActivation]);

  useEffect(() => {
    const current = createTerminalProService();
    service.current = current;
    const unsubscribe = current.subscribe(next => {
      setSnapshot(next);
      if (activationRef.current && next.status !== 'pro') publishActivation(null);
      const active = attempt.current;
      if (active && next.pending) active.pending = true;
      if (active?.pending && next.status === 'pro') recordVerified(active.id);
    });
    const foreground = AppState.addEventListener('change', state => { if (state === 'active' && started.current) void current.refresh(); });
    return () => { foreground.remove(); unsubscribe(); current.dispose(); attempt.current = null; activationRef.current = null; if (service.current === current) service.current = null; };
  }, [recordVerified, publishActivation]);
  const refresh = useCallback(async () => { started.current = true; await service.current?.refresh(); }, []);
  const loadPlans = useCallback(async () => { started.current = true; await service.current?.loadPlans(); }, []);
  const beginActivation = useCallback((scope: string, kind: ProActivationKind) => {
    const id = ++sequence.current;
    attempt.current = { id, scope, kind, pending: false };
    publishActivation(null);
    return id;
  }, [publishActivation]);
  const abandonActivation = useCallback((id: number) => {
    if (attempt.current?.id === id) attempt.current = null;
    if (activationRef.current?.id === id) publishActivation(null);
  }, [publishActivation]);
  const purchase = useCallback(async (id: ProPlanId, attemptId?: number) => {
    const success = await service.current?.purchase(id) ?? false;
    if (success && attemptId !== undefined) recordVerified(attemptId);
    return success;
  }, [recordVerified]);
  const restore = useCallback(async (attemptId?: number) => {
    const success = await service.current?.restore() ?? false;
    if (success && attemptId !== undefined) recordVerified(attemptId);
    return success;
  }, [recordVerified]);
  const manage = useCallback(async () => { await service.current?.manage(); }, []);
  const claimActivation = useCallback((id: number, owner: string, scope: string) => {
    const event = activationRef.current;
    if (!event || event.id !== id || event.scope !== scope || (event.claimedBy && event.claimedBy !== owner)) return false;
    if (event.claimedBy !== owner) publishActivation({ ...event, claimedBy: owner });
    return true;
  }, [publishActivation]);
  const releaseActivation = useCallback((id: number, owner: string) => {
    const event = activationRef.current;
    if (event?.id === id && event.claimedBy === owner) publishActivation({ ...event, claimedBy: null });
  }, [publishActivation]);
  const acknowledgeActivation = useCallback((id: number, owner: string) => {
    const event = activationRef.current;
    if (event?.id === id && event.claimedBy === owner) publishActivation(null);
  }, [publishActivation]);
  return <Context.Provider value={{ ...snapshot, refresh, loadPlans, purchase, restore, manage, activation, beginActivation, abandonActivation, claimActivation, releaseActivation, acknowledgeActivation }}>{children}</Context.Provider>;
}

export const useTerminalPro = (): TerminalProContextValue => useContext(Context);

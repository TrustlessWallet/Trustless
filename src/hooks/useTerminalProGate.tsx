import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { useTerminalPro, ProActivationKind } from '../contexts/TerminalProContext';
import TerminalProSheet from '../components/TerminalProSheet';
import { TerminalOwnerFocusContext } from '../contexts/TerminalOwnerFocusContext';

type PendingAction = { scope: string; run: () => void };
let nextOwner = 0;

/** Keeps a gated action attached to the currently focused owner and merchant scope. */
export function useTerminalProGate({ allowed: screenAllowed, scope }: { allowed: boolean; scope: string }) {
  const parentFocused = useContext(TerminalOwnerFocusContext);
  const allowed = screenAllowed && parentFocused;
  const pro = useTerminalPro();
  const { status, activation, beginActivation, abandonActivation, claimActivation, releaseActivation, acknowledgeActivation } = pro;
  const ownerRef = useRef<string | null>(null);
  if (ownerRef.current === null) ownerRef.current = `terminal-pro-${++nextOwner}`;
  const owner = ownerRef.current;
  const [isOpen, setIsOpen] = useState(false);
  const pending = useRef<PendingAction | null>(null);
  const verified = useRef(false);
  const activationStarted = useRef(false);
  const attemptId = useRef<number | null>(null);
  const claimedId = useRef<number | null>(null);
  const closingForUnlock = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ allowed, scope, status });
  const priorScope = useRef(scope);
  current.current = { allowed, scope, status };

  const scopeChanged = priorScope.current !== scope;
  if (scopeChanged || !allowed) {
    priorScope.current = scope;
    pending.current = null;
    verified.current = false;
    closingForUnlock.current = false;
    if (scopeChanged) activationStarted.current = false;
  }

  useEffect(() => {
    if (scopeChanged && attemptId.current !== null) {
      abandonActivation?.(attemptId.current);
      attemptId.current = null;
    }
    if (!allowed || scopeChanged) {
      if (claimedId.current !== null) {
        releaseActivation?.(claimedId.current, owner);
        claimedId.current = null;
      }
      setIsOpen(false);
    }
  }, [allowed, scopeChanged, owner, abandonActivation, releaseActivation]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
      if (claimedId.current !== null) releaseActivation?.(claimedId.current, owner);
      // A screen may unmount under a system purchase modal; the same merchant's
      // focused checkout fallback can still deliver the verified confirmation.
    };
  }, [owner, releaseActivation]);

  useEffect(() => {
    if (!allowed || !activation || activation.scope !== scope || status !== 'pro') return;
    if (claimActivation?.(activation.id, owner, scope)) {
      if (attemptId.current !== null && attemptId.current !== activation.id) {
        pending.current = null;
        verified.current = false;
        closingForUnlock.current = false;
      }
      attemptId.current = activation.id;
      claimedId.current = activation.id;
      setIsOpen(true);
    }
  }, [allowed, activation?.id, activation?.claimedBy, activation?.scope, scope, status, owner, claimActivation]);

  const finishDismissal = useCallback(() => {
    if (!closingForUnlock.current) return;
    closingForUnlock.current = false;
    const action = pending.current;
    pending.current = null;
    const canRun = mounted.current && verified.current && current.current.allowed && current.current.status === 'pro' && action?.scope === current.current.scope;
    verified.current = false;
    activationStarted.current = false;
    if (canRun) action?.run();
  }, []);

  const dismiss = useCallback(() => {
    if (claimedId.current !== null) {
      acknowledgeActivation?.(claimedId.current, owner);
      claimedId.current = null;
    }
    if (attemptId.current !== null) {
      abandonActivation?.(attemptId.current);
      attemptId.current = null;
    }
    pending.current = null;
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(false);
  }, [acknowledgeActivation, abandonActivation, owner]);

  const openPro = useCallback(() => {
    if (!current.current.allowed) return;
    pending.current = null;
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(true);
  }, []);

  const requirePro = useCallback((onUnlocked: () => void) => {
    const active = current.current;
    if (!active.allowed) return;
    if (active.status === 'pro') { onUnlocked(); return; }
    pending.current = { scope: active.scope, run: onUnlocked };
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(true);
  }, []);

  const onActivationStart = useCallback((kind: ProActivationKind) => {
    activationStarted.current = true;
    const id = beginActivation?.(current.current.scope, kind);
    attemptId.current = id || null;
    return id;
  }, [beginActivation]);

  const onVerified = useCallback(() => {
    if (!mounted.current || !current.current.allowed) return;
    if (attemptId.current !== null && claimedId.current !== attemptId.current) return;
    if (claimedId.current !== null) {
      acknowledgeActivation?.(claimedId.current, owner);
      claimedId.current = null;
      attemptId.current = null;
    }
    verified.current = true;
    if (current.current.status === 'pro') {
      closingForUnlock.current = true;
      setIsOpen(false);
    }
  }, [acknowledgeActivation, owner]);

  useEffect(() => {
    if (!isOpen || !pending.current || status !== 'pro' || activationStarted.current) return;
    verified.current = true;
    closingForUnlock.current = true;
    setIsOpen(false);
  }, [isOpen, status]);

  useEffect(() => {
    if (Platform.OS !== 'android' || isOpen || !closingForUnlock.current) return;
    const task = InteractionManager.runAfterInteractions(finishDismissal);
    return () => task.cancel();
  }, [isOpen, finishDismissal]);

  const visible = allowed && !scopeChanged && isOpen;
  const claimedActivation = visible && activation?.id === claimedId.current && activation?.scope === scope ? activation : null;
  return {
    openPro,
    requirePro,
    isOpen: visible,
    proSheet: <TerminalProSheet visible={visible} activation={claimedActivation} onClose={dismiss} onDismiss={finishDismissal} onVerified={onVerified} onActivationStart={onActivationStart} />,
  };
}

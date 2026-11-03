import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { useTerminalPro } from '../contexts/TerminalProContext';
import TerminalProSheet from '../components/TerminalProSheet';

type PendingAction = { scope: string; run: () => void };

/** Keeps a gated action attached to the currently mounted owner and merchant scope. */
export function useTerminalProGate({ allowed, scope }: { allowed: boolean; scope: string }) {
  const { status } = useTerminalPro();
  const [isOpen, setIsOpen] = useState(false);
  const pending = useRef<PendingAction | null>(null);
  const verified = useRef(false);
  const activationStarted = useRef(false);
  const closingForUnlock = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ allowed, scope, status });
  const priorScope = useRef(scope);
  current.current = { allowed, scope, status };

  // A new owner cannot inherit the previous owner's deferred action, even for one render.
  const scopeChanged = priorScope.current !== scope;
  if (scopeChanged || !allowed) {
    priorScope.current = scope;
    pending.current = null;
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
  }

  useEffect(() => {
    if (!allowed || scopeChanged) setIsOpen(false);
  }, [allowed, scope, scopeChanged]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
      verified.current = false;
      activationStarted.current = false;
      closingForUnlock.current = false;
    };
  }, []);

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
    pending.current = null;
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(false);
  }, []);

  const openPro = useCallback(() => {
    if (!current.current.allowed) return;
    pending.current = null;
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(true);
  }, []);

  const requirePro = useCallback((onUnlocked: () => void) => {
    const owner = current.current;
    if (!owner.allowed) return;
    if (owner.status === 'pro') {
      onUnlocked();
      return;
    }
    pending.current = { scope: owner.scope, run: onUnlocked };
    verified.current = false;
    activationStarted.current = false;
    closingForUnlock.current = false;
    setIsOpen(true);
  }, []);

  const onActivationStart = useCallback(() => { activationStarted.current = true; }, []);

  const onVerified = useCallback(() => {
    if (!mounted.current || !current.current.allowed) return;
    verified.current = true;
    if (current.current.status === 'pro') {
      closingForUnlock.current = true;
      setIsOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !pending.current || status !== 'pro' || activationStarted.current) return;
    verified.current = true;
    closingForUnlock.current = true;
    setIsOpen(false);
  }, [isOpen, status]);

  // React Native's Modal onDismiss is iOS only. On Android the native slide is
  // finished by InteractionManager before a deferred native picker may open.
  useEffect(() => {
    if (Platform.OS !== 'android' || isOpen || !closingForUnlock.current) return;
    const task = InteractionManager.runAfterInteractions(finishDismissal);
    return () => task.cancel();
  }, [isOpen, finishDismissal]);

  const visible = allowed && isOpen;
  return {
    openPro,
    requirePro,
    isOpen: visible,
    proSheet: <TerminalProSheet visible={visible} onClose={dismiss} onDismiss={finishDismissal} onVerified={onVerified} onActivationStart={onActivationStart} />,
  };
}

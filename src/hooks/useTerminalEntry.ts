import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { NETWORK_NAME } from '../constants/network';
import { warmTerminalItems } from '../services/terminalItems';

const CATALOG_WARMUP_BUDGET_MS = 120;

type Wallet = { id: string; type: string } | null;
export function useTerminalEntry(wallet: Wallet, changing: boolean, setMode: (mode: 'terminal') => Promise<void>, focused = true) {
  const [preparing, setPreparing] = useState(false);
  const current = useRef({ walletId: wallet?.id, type: wallet?.type, focused, epoch: 0 });
  if (current.current.walletId !== wallet?.id || current.current.type !== wallet?.type || current.current.focused !== focused) {
    current.current = { walletId: wallet?.id, type: wallet?.type, focused, epoch: current.current.epoch + 1 };
  }
  const mounted = useRef(true);
  const flight = useRef<number | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    flight.current = null; setPreparing(false);
    if (focused && wallet && wallet.type !== 'watch-only') void warmTerminalItems(wallet.id, NETWORK_NAME).catch(() => undefined);
  }, [wallet?.id, wallet?.type, focused]);
  const openTerminal = async () => {
    if (!focused || !wallet || wallet.type === 'watch-only' || changing || flight.current !== null) return;
    const epoch = current.current.epoch;
    const isCurrent = () => mounted.current && current.current.epoch === epoch;
    flight.current = epoch; setPreparing(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      // Give an in-progress catalog read a short head start. Manual checkout
      // can open while a slow read finishes in the background.
      await Promise.race([
        warmTerminalItems(wallet.id, NETWORK_NAME).catch(() => undefined),
        new Promise<void>(resolve => { timeout = setTimeout(resolve, CATALOG_WARMUP_BUDGET_MS); }),
      ]);
      if (isCurrent()) await setMode('terminal');
    } catch { if (isCurrent()) Alert.alert('Could not open terminal', 'Please retry.'); }
    finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (flight.current === epoch) flight.current = null;
      if (isCurrent()) setPreparing(false);
    }
  };
  return { openTerminal, busy: changing || preparing };
}

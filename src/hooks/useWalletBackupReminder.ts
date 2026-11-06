import { useEffect, useState } from 'react';
import { isBackupPending } from '../services/firstLaunchWallet';

export function useWalletBackupReminder(walletId: string | null, network: string, focused: boolean) {
  const [reminder, setReminder] = useState<{ walletId: string; network: string } | null>(null);
  useEffect(() => {
    let current = true;
    // Covering sheets must not clear the last confirmed reminder state.
    setReminder(previous => previous?.walletId === walletId && previous.network === network ? previous : null);
    // Load behind onboarding as soon as the wallet mounts. Focus changes still refresh it.
    if (walletId) {
      void isBackupPending(network, walletId).then(pending => {
        if (current) setReminder(pending ? { walletId, network } : null);
      }).catch(() => {});
    }
    return () => { current = false; };
  }, [walletId, network, focused]);
  return reminder?.network === network && reminder.walletId === walletId ? walletId : null;
}

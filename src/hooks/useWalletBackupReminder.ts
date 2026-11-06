import { useEffect, useState } from 'react';
import { isBackupPending } from '../services/firstLaunchWallet';

export function useWalletBackupReminder(walletId: string | null, network: string, focused: boolean) {
  const [reminder, setReminder] = useState<{ walletId: string; network: string; pending: boolean } | null>(null);
  useEffect(() => {
    let current = true;
    // Covering sheets must not clear the last confirmed reminder state.
    setReminder(previous => previous?.walletId === walletId && previous.network === network ? previous : null);
    if (walletId) {
      void isBackupPending(network, walletId).then(pending => {
        if (current) setReminder({ walletId, network, pending });
      }).catch(() => {
        if (current) setReminder(previous => previous ?? { walletId, network, pending: false });
      });
    }
    return () => { current = false; };
  }, [walletId, network, focused]);
  const matches = reminder?.network === network && reminder.walletId === walletId;
  return { walletId: matches && reminder.pending ? walletId : null, ready: !walletId || matches };
}

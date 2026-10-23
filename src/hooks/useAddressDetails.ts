import { useQuery } from '@tanstack/react-query';
import { NETWORK_NAME } from '../constants/network';
import { fetchAddressTransactions, fetchBitcoinBalance, fetchUTXOs } from '../services/bitcoin';

/** Each resource has its own lifecycle so a slow or failed request cannot hold up the others. */
export function useAddressDetails(walletId: string | undefined, address: string | undefined) {
  const enabled = Boolean(walletId && address);
  const scope = [NETWORK_NAME, walletId, address];
  const options = { enabled, staleTime: 30_000, retry: false } as const;

  const balance = useQuery({
    queryKey: ['address-details', ...scope, 'balance'],
    queryFn: () => fetchBitcoinBalance(address!, { strict: true }),
    ...options,
  });
  const utxos = useQuery({
    queryKey: ['address-details', ...scope, 'utxos'],
    queryFn: () => fetchUTXOs([address!], { strict: true }),
    ...options,
  });
  const transactions = useQuery({
    queryKey: ['address-details', ...scope, 'transactions'],
    queryFn: () => fetchAddressTransactions([address!], undefined, undefined, { strict: true }),
    ...options,
  });

  return { balance, utxos, transactions };
}

import { useQuery } from '@tanstack/react-query';
import { fetchBitcoinBalance, fetchAddressBalances, fetchAddressInfoBatch, fetchAddressTransactions, fetchUTXOs } from '../services/bitcoin';
import { BitcoinAddress, Transaction } from '../types';
import { dbGetTransactions, dbSaveTransactions } from '../services/database';
import { NETWORK_NAME } from '../constants/network';
import { useState, useEffect } from 'react';

/**
 * useBalance
 * Fetches the balance for a single address.
 */
export const useBalance = (address: string) => {
  return useQuery({
    queryKey: ['balance', address],
    queryFn: () => fetchBitcoinBalance(address),
    enabled: !!address,
    staleTime: 30000, 
    retry: false,
  });
};

/**
 * useWalletBalanceSync
 * Batch fetches info for Active Wallet.
 */
export const useWalletBalanceSync = (
    walletId: string | undefined, 
    addresses: string[]
) => {
    return useQuery({
        queryKey: ['wallet-balances', walletId, addresses.length], 
        queryFn: async () => {
            if (!walletId || addresses.length === 0) return [];
            return await fetchAddressInfoBatch(addresses);
        },
        enabled: !!walletId && addresses.length > 0,
        refetchOnWindowFocus: true, 
        staleTime: 60000,
        retry: false,
    });
};

/**
 * useAddressListSync
 * Batch fetches balances for Saved/Tracked lists.
 */
export const useAddressListSync = (
    category: 'saved' | 'tracked',
    items: BitcoinAddress[]
) => {
    return useQuery({
        queryKey: [category, 'balances', items.length],
        queryFn: async () => {
            if (items.length === 0) return [];
            const addresses = items.map(i => i.address);
            return await fetchAddressBalances(addresses);
        },
        enabled: items.length > 0,
        refetchOnWindowFocus: true,
        staleTime: 60000,
        retry: false,
    });
};

/**
 * useWalletTransactions
 * Hybird Hook: Loads from DB immediately, then syncs with API.
 */
export const useWalletTransactions = (walletId: string | undefined, addresses: string[]) => {
  const [cachedTxs, setCachedTxs] = useState<Transaction[]>([]);
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  // 1. Load from DB on mount or wallet change
  useEffect(() => {
    if (!walletId) {
        setCachedTxs([]);
        setIsDbLoaded(true);
        return;
    }
    
    let isMounted = true;
    dbGetTransactions(walletId).then(txs => {
        if (isMounted) {
            setCachedTxs(txs);
            setIsDbLoaded(true);
        }
    }).catch(e => {
        console.warn("Failed to load txs from DB", e);
        if (isMounted) setIsDbLoaded(true);
    });

    return () => { isMounted = false; };
  }, [walletId]);

  // 2. Network Query
  const query = useQuery({
    queryKey: ['wallet-transactions', walletId, addresses.length], 
    queryFn: async () => {
         if (!walletId || addresses.length === 0) return [];
         const newTxs = await fetchAddressTransactions(addresses);
         // Side-effect: Save to DB
         await dbSaveTransactions(walletId, newTxs, NETWORK_NAME);
         return newTxs;
    },
    enabled: !!walletId && addresses.length > 0,
    staleTime: 30000,
    retry: false,
  });

  // 3. Merge Strategy
  // If query has data, use it (it's freshest). If not, use cachedTxs.
  const transactions = query.data || cachedTxs;
  
  // Custom Loading State: We are "loading" only if we have NO data from DB and NO data from Network.
  // If we have DB data, we are NOT loading (user sees old data).
  const isLoading = !isDbLoaded || (query.isLoading && transactions.length === 0);

  return { 
      ...query, 
      data: transactions,
      isLoading 
  };
};

/**
 * useWalletUTXOs
 * Fetches UTXOs for the active wallet (for Coin Control)
 */
export const useWalletUTXOs = (addresses: string[]) => {
  return useQuery({
    queryKey: ['wallet-utxos', addresses.length],
    queryFn: () => fetchUTXOs(addresses),
    enabled: addresses.length > 0,
    staleTime: 30000,
    retry: false,
  });
};
import { useQuery } from '@tanstack/react-query';
import { fetchBitcoinBalance, fetchAddressBalances, fetchAddressInfoBatch, fetchAddressTransactions, fetchUTXOs } from '../services/bitcoin';
import { BitcoinAddress, Transaction } from '../types';
import { dbGetTransactions, dbSaveTransactions } from '../services/database';
import { NETWORK_NAME } from '../constants/network';
import { useState, useEffect } from 'react';
import { getTipHeight } from '../services/bitcoin'; 

export const useBalance = (address: string) => {
  return useQuery({
    queryKey: ['balance', address],
    queryFn: () => fetchBitcoinBalance(address),
    enabled: !!address,
    staleTime: 30000, 
    retry: false,
  });
};

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

export const useAddressListSync = (
    category: 'saved',
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

export const useWalletTransactions = (walletId: string | undefined, addresses: string[]) => {
  const [cachedTxs, setCachedTxs] = useState<Transaction[]>([]);
  const [isDbLoaded, setIsDbLoaded] = useState(false);

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

  const query = useQuery({
    queryKey: ['wallet-transactions', walletId, addresses.length], 
    queryFn: async () => {
         if (!walletId || addresses.length === 0) return [];
         const newTxs = await fetchAddressTransactions(addresses);
         
         // Immediately cache to SQLite for subsequent instant loads
         if (newTxs.length > 0) {
             await dbSaveTransactions(walletId, newTxs, NETWORK_NAME);
         }
         return newTxs;
    },
    enabled: !!walletId && addresses.length > 0,
    staleTime: 60000, // Increased to 60s to prevent excessive refetching during list scrolling
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // Ensure DB transactions show immediately, replaced by query data when fetch completes
  const transactions = (query.data && query.data.length > 0) ? query.data : cachedTxs;
  
  const isLoading = !isDbLoaded || (query.isLoading && transactions.length === 0);

  return { 
      ...query, 
      data: transactions,
      isLoading 
  };
};

export const useWalletUTXOs = (addresses: string[]) => {
  return useQuery({
    queryKey: ['wallet-utxos', addresses.length],
    queryFn: () => fetchUTXOs(addresses),
    enabled: addresses.length > 0,
    staleTime: 30000,
    retry: false,
  });
};

export const useTipHeight = () => {
  return useQuery({
    queryKey: ['tip-height'],
    queryFn: getTipHeight,
    staleTime: 60000 * 5,
    retry: false,
  });
};
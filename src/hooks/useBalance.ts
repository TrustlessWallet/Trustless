import { useQuery } from '@tanstack/react-query';
import { fetchBitcoinBalance, fetchAddressBalances, fetchAddressInfoBatch, fetchAddressTransactions, fetchUTXOs } from '../services/bitcoin';
import { BitcoinAddress, Transaction, DerivedAddress, DerivedAddressInfo } from '../types';
import { dbGetTransactions, dbSaveTransactions } from '../services/database';
import { NETWORK_NAME } from '../constants/network';
import { useState, useEffect } from 'react';
import { getTipHeight } from '../services/bitcoin';

export const useBalance = (address: string) => {
    return useQuery({
        queryKey: ['balance', address],
        queryFn: async () => {
            if (!address) return 0;
            return await fetchBitcoinBalance(address);
        },
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
        queryKey: ['wallet-balances', walletId, NETWORK_NAME, [...addresses]],
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
        queryKey: [category, 'balances', NETWORK_NAME, items.map(item => item.address)],
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

export const useWalletTransactions = (
    walletId: string | undefined,
    addresses: string[],
    limit?: number,
    offset: number = 0,
) => {
    const network = NETWORK_NAME;
    const [dbCache, setDbCache] = useState<{
        network: string;
        walletId: string;
        limit: number | undefined;
        offset: number;
        transactions: Transaction[];
    } | null>(null);
    const [loadedDbScope, setLoadedDbScope] = useState<string | null>(null);
    const dbScope = JSON.stringify([network, walletId, limit, offset]);

    useEffect(() => {
        if (!walletId) {
            setDbCache(null);
            setLoadedDbScope(dbScope);
            return;
        }

        let isMounted = true;

        setLoadedDbScope(null);

        dbGetTransactions(walletId, limit, offset)
            .then(txs => {
                if (isMounted) {
                    setDbCache({ network, walletId, limit, offset, transactions: txs });
                    setLoadedDbScope(dbScope);
                }
            })
            .catch(e => {
                console.warn("Failed to load txs from DB", e);

                if (isMounted) {
                    setDbCache({ network, walletId, limit, offset, transactions: [] });
                    setLoadedDbScope(dbScope);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [walletId, limit, offset, dbScope]);

    const cachedTxs = dbCache?.network === network &&
        dbCache?.walletId === walletId &&
        dbCache?.limit === limit &&
        dbCache?.offset === offset
        ? dbCache.transactions
        : [];

    const query = useQuery({
        queryKey: [
            'wallet-transactions',
            walletId,
            network,
            [...addresses],
            limit ?? 'all',
            offset,
        ],

        queryFn: async () => {
            if (!walletId || addresses.length === 0) return [];

            const newTxs = await fetchAddressTransactions(
                addresses,
                limit,
                offset,
            );

            if (newTxs.length > 0) {
                await dbSaveTransactions(
                    walletId,
                    newTxs,
                    network,
                );
            }

            return newTxs;
        },

        enabled: !!walletId && addresses.length > 0,

        staleTime: 60000,

        refetchOnMount: false,

        refetchOnWindowFocus: true,

        retry: false,
    });

    const transactions =
        query.data && query.data.length > 0
            ? query.data
            : cachedTxs;

    const isLoading =
        loadedDbScope !== dbScope ||
        (query.isLoading && transactions.length === 0);

    return {
        ...query,
        data: transactions,
        isLoading,
    };
};

// The single source of truth for "which addresses could hold spendable coins".
// SendScreen, CoinControlScreen, and BalanceDetailScreen all call this so they
// compute the exact same address set — which means they hit the exact same
// react-query cache entry below instead of each fetching UTXOs independently.
export const getWalletUtxoQueryAddresses = (
    wallet: { derivedChangeAddresses: DerivedAddress[]; derivedAddressInfoCache: DerivedAddressInfo[] } | null | undefined
): string[] => {
    if (!wallet) return [];

    const changeAddresses = wallet.derivedChangeAddresses.map(a => a.address);

    const usedReceiveAddresses = wallet.derivedAddressInfoCache
        .filter(info => info.tx_count > 0 || info.balance > 0)
        .map(info => info.address);

    return [...new Set([...usedReceiveAddresses, ...changeAddresses])];
};

export const useWalletUTXOs = (walletId: string | undefined, addresses: string[]) => {
    return useQuery({
        queryKey: ['wallet-utxos', walletId, addresses],
        queryFn: async () => {
            if (!walletId || addresses.length === 0) return [];
            return await fetchUTXOs(addresses);
        },
        enabled: !!walletId && addresses.length > 0,
        staleTime: 30000,
        retry: false,
    });
};

export const useTipHeight = (enabled: boolean = true) => {
    return useQuery({
        queryKey: ['tip-height'],
        queryFn: async () => {
            if (!enabled) return 0;
            return await getTipHeight();
        },
        staleTime: 60000 * 5,
        retry: false,
        enabled,
    });
};

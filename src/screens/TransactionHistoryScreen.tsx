import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl, SafeAreaView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Transaction } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { fetchAddressTransactions } from '../services/bitcoin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import { formatBitcoinAddressShort } from '../constants/format';

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const TX_CACHE_PREFIX = '@txCache:';
const TX_CACHE_STALE_MS = 240000; 

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionHistory'>;
type TransactionHistoryRouteProp = RouteProp<RootStackParamList, 'TransactionHistory'>;

const btcFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
});

const formatBalance = (sats: number) => {
    const btc = (sats || 0) / 100000000;
    return btcFormatter.format(btc).replace(/,/g, ' ');
};

const TransactionHistoryScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<TransactionHistoryRouteProp>();
    const mode = route.params?.mode || 'onchain';
    
    const { activeWallet, loading: walletLoading, lastRefreshTime, lightningTransactions } = useWallet();
    const { theme } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const [onchainTransactions, setOnchainTransactions] = useState<Transaction[]>([]);
    const [loadingData, setLoadingData] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [hideBalance, setHideBalance] = useState(false);
    const isFocused = useIsFocused();

    const walletAddressesSet = useMemo(() => {
        if (!activeWallet) return new Set<string>();
        return new Set([
            ...(activeWallet.derivedReceiveAddresses.map(a => a.address) ?? []),
            ...(activeWallet.derivedChangeAddresses.map(a => a.address) ?? [])
        ]);
    }, [activeWallet]);

    const fetchData = useCallback(async (options: { showSpinner?: boolean; bypassCache?: boolean } = {}) => {
      const { showSpinner = false, bypassCache = false } = options;
      const infoCache = activeWallet?.derivedAddressInfoCache ?? [];
      const receiveWithTxs = infoCache.filter(i => i.tx_count > 0).map(i => i.address);
      const changeAddresses = activeWallet?.derivedChangeAddresses.map(a => a.address) ?? [];
      const allAddresses = [...new Set([...receiveWithTxs, ...changeAddresses])];
      
      if (allAddresses.length === 0) {
        setLoadingData(false);
        return;
      }

      const cacheKey = `${TX_CACHE_PREFIX}${activeWallet?.id || 'no-wallet'}`;
      try {
        if (showSpinner) {
          setRefreshing(true);
        } else {
          if (!bypassCache) {
            const cachedStr = await AsyncStorage.getItem(cacheKey);
            if (cachedStr) {
              const cached = JSON.parse(cachedStr) as { transactions: Transaction[]; timestamp: number };
              const isFresh = Date.now() - cached.timestamp < TX_CACHE_STALE_MS;
              if (isFresh) {
                setOnchainTransactions(cached.transactions);
                setLoadingData(false);
                return; 
              } else {
                setOnchainTransactions(cached.transactions);
              }
            }
          }
          if (!bypassCache) {
            const cachedStr = await AsyncStorage.getItem(cacheKey);
            if (!cachedStr) setLoadingData(true);
          }
        }
        const fetchedTxs = await fetchAddressTransactions(allAddresses);
        setOnchainTransactions(fetchedTxs);
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ transactions: fetchedTxs, timestamp: Date.now() }));
      } catch (e) {
        console.error("TransactionHistoryScreen: Failed to fetch wallet data", e);
      } finally {
        if (showSpinner) {
            setRefreshing(false);
        }
        setLoadingData(false);
      }
    }, [activeWallet]);

    useEffect(() => {
        if (mode === 'onchain') {
            fetchData({ showSpinner: false, bypassCache: false });
        } else {
            setLoadingData(false);
        }
    }, [fetchData, mode]);

    useEffect(() => {
      if (activeWallet && mode === 'onchain') {
        fetchData({ showSpinner: false, bypassCache: true });
      }
    }, [lastRefreshTime, activeWallet?.id, mode]);

    useEffect(() => {
      const loadPreference = async () => {
        const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
        setHideBalance(savedPref === 'true');
      };
      if (isFocused) {
        loadPreference();
      }
    }, [isFocused]);

    const onRefresh = () => {
        if (mode === 'onchain') {
            fetchData({ showSpinner: true, bypassCache: true });
        }
    };

    const transactionsToDisplay = useMemo(() => {
        return mode === 'lightning' ? lightningTransactions : onchainTransactions;
    }, [mode, lightningTransactions, onchainTransactions]);

    const renderTransactionItem = useCallback(({ item }: { item: any }) => {
      const isLightning = 'paymentHash' in item;
      const isSend = item.type === 'send';
      
      const txId = isLightning ? item.paymentHash : item.txid;
      const amountSats = isLightning ? Math.floor(item.amountMsat / 1000) : item.amount;
      const timestamp = isLightning ? item.paymentTime : item.status?.block_time;
      const isConfirmed = isLightning ? item.status === 'complete' : item.status?.confirmed;

      let otherAddress = isLightning ? 'Lightning Payment' : 'Multiple';
      
      if (!isLightning) {
        if (isSend && item.vout) {
          const externalOutputs = item.vout.filter((o: any) => !walletAddressesSet.has(o.scriptpubkey_address));
          if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
        } else if (!isSend && item.vin) {
          const externalInputs = item.vin.filter((i: any) => !walletAddressesSet.has(i.prevout?.scriptpubkey_address));
          if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
        }
      }

      const txDate = timestamp
        ? new Date(timestamp * 1000).toLocaleString()
        : 'Pending confirmation';

      return (
        <TouchableOpacity style={styles.txRow} onPress={() => navigation.navigate('TransactionDetails', { transaction: item })}>
            <Feather 
                name={(isSend ? "arrow-up" : "arrow-down")} 
                size={24} 
                color={theme.colors.primary} 
                style={styles.txIcon} 
            />
            <View style={styles.txDetails}>
                <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                <Text style={styles.txAddress}>
                    {isLightning ? (item.description || otherAddress) : `${isSend ? "To" : "From"} ${formatBitcoinAddressShort(otherAddress || 'Unknown')}`}
                </Text>
                <Text style={styles.txDate}>{txDate}</Text>
            </View>
            <View style={styles.txAmountContainer}>
                <Text style={styles.txAmount}>
                    {hideBalance ? '*******' : (
                        <>{isSend ? '-' : '+'} {formatBalance(amountSats)} <Text style={styles.orangeSymbol}>₿</Text></>
                    )}
                </Text>
                <Text style={styles.txStatus}>{isConfirmed ? 'Confirmed' : 'Pending'}</Text>
            </View>
        </TouchableOpacity>
      );
    }, [walletAddressesSet, hideBalance, theme, navigation, styles]);

    if (walletLoading || (loadingData && !refreshing && mode === 'onchain')) {
        return <View style={styles.centeredContainer}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
    }

    if (!activeWallet) {
        return (
            <SafeAreaView style={styles.centeredContainer}>
                 <Text style={styles.noWalletText}>No wallet found.</Text>
            </SafeAreaView>
        );
    }

    return (
        <View style={styles.container}>
            <FlatList
                data={transactionsToDisplay}
                renderItem={renderTransactionItem}
                keyExtractor={(item) => item.paymentHash || item.txid}
                contentContainerStyle={styles.list}
                style={styles.scrollView}
                showsVerticalScrollIndicator={true}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.colors.primary}
                    />
                }
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>No transactions yet.</Text>
                    </View>
                }
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                updateCellsBatchingPeriod={50}
            />
        </View>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background 
    },
    scrollView: {
        flex: 1,
    },
    centeredContainer: {
        flex: 1,
        backgroundColor: theme.colors.background, 
        alignItems: 'center',
        justifyContent: 'center'
    },
    noWalletText: {
        fontSize: 18,
        color: theme.colors.muted 
    },
    list: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingVertical: 10
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 50
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.muted 
    },
    txRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: theme.colors.border 
    },
    txIcon: {
        marginRight: 16
    },
    txDetails: {
        flex: 1,
        gap: 4,
    },
    txDate: {
        fontSize: 14,
        color: theme.colors.muted, 
    },
    txType: {
        fontSize: 16,
        color: theme.colors.primary 
    },
    txAddress: {
        fontSize: 14,
        color: theme.colors.muted, 
        fontFamily: 'monospace'
    },
    txAmountContainer: {
        alignItems: 'flex-end'
    },
    txAmount: {
        fontSize: 16,
        color: theme.colors.primary 
    },
    txStatus: {
        fontSize: 14,
        color: theme.colors.muted 
    },
    orangeSymbol: {
      color: theme.colors.bitcoin, 
    },
});

export default TransactionHistoryScreen;
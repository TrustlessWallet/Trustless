import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Transaction } from '../types';
import { useWallet } from '../contexts/WalletContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import { useWalletTransactions, useWalletUTXOs } from '../hooks/useBalance';

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const formatBalance = (sats: number) => {
    const btc = (sats || 0) / 100000000;
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 8,
      minimumFractionDigits: 8,
    }).format(btc).replace(/,/g, ' ');
};

const formatAddress = (address: string) => {
  if (!address || address.length <= 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

const WalletScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { activeWallet, loading: walletLoading, triggerRefresh } = useWallet();
    const { theme } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const [hideBalance, setHideBalance] = useState(false);
    const isFocused = useIsFocused();

    // 1. Calculate Balance directly from Context (Instant)
    const balance = useMemo(() => {
        if (!activeWallet) return 0;
        return activeWallet.derivedAddressInfoCache.reduce((acc, curr) => acc + curr.balance, 0);
    }, [activeWallet]);

    // 2. Prepare addresses for History/UTXO fetching
    const queryAddresses = useMemo(() => {
        if (!activeWallet) return [];
        const changeAddresses = activeWallet.derivedChangeAddresses.map(a => a.address);
        const infoCache = activeWallet.derivedAddressInfoCache;
        // Only check addresses that have been used to save bandwidth
        const usedAddresses = infoCache.filter(i => i.tx_count > 0 || i.balance > 0).map(i => i.address);
        return [...new Set([...usedAddresses, ...changeAddresses])];
    }, [activeWallet]);

    // 3. Use Hybrid Hook (Instant Load from DB + Background Sync)
    const { 
        data: transactions, 
        isLoading: loadingTxs, 
        refetch: refetchTxs,
        isRefetching: isRefetchingTxs 
    } = useWalletTransactions(activeWallet?.id, queryAddresses);

    const { 
        data: utxos, 
        refetch: refetchUtxos 
    } = useWalletUTXOs(queryAddresses);

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
        triggerRefresh(); // Syncs balance
        refetchTxs();     // Syncs history
        refetchUtxos();   // Syncs UTXOs
    };

    const renderTransactionItem = ({ item }: { item: Transaction }) => {
      const walletAddresses = new Set([
        ...(activeWallet?.derivedReceiveAddresses.map(a => a.address) ?? []),
        ...(activeWallet?.derivedChangeAddresses.map(a => a.address) ?? [])
      ]);
      
      const isSend = item.type === 'send';
      let otherAddress = 'Multiple';
      
      if (isSend) {
        const externalOutputs = item.vout.filter(o => !walletAddresses.has(o.scriptpubkey_address));
        if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
      } else {
        const externalInputs = item.vin.filter(i => !walletAddresses.has(i.prevout?.scriptpubkey_address));
        if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
      }

      const txDate = item.status.block_time
        ? new Date(item.status.block_time * 1000).toLocaleString()
        : 'Pending confirmation';

      return (
        <TouchableOpacity style={styles.txRow} onPress={() => navigation.navigate('TransactionDetails', { transaction: item })}>
            <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
            <View style={styles.txDetails}>
                <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                <Text style={styles.txAddress}>{isSend ? "To" : "From"} {formatAddress(otherAddress || 'Unknown')}</Text>
                <Text style={styles.txDate}>{txDate}</Text>
            </View>
            <View style={styles.txAmountContainer}>
                <Text style={styles.txAmount}>
                    {hideBalance ? '*******' : (
                        <>{isSend ? '-' : '+'} {formatBalance(item.amount)} <Text style={styles.orangeSymbol}>₿</Text></>
                    )}
                </Text>
                <Text style={styles.txStatus}>{item.status.confirmed ? 'Confirmed' : 'Pending'}</Text>
            </View>
        </TouchableOpacity>
      );
    };

    const txList = transactions || [];
    const recentTxs = txList.slice(0, 3);
    const hasTransactions = txList.length > 0;

    if (walletLoading) {
        return <View style={styles.centeredContainer}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
    }

    if (!activeWallet) {
        return (
            <SafeAreaView style={styles.container} edges={['right', 'left']}>
                <View style={styles.emptyStateContainer}>
                    <TouchableOpacity style={styles.createButton} onPress={() => navigation.navigate('BackupIntro')}>
                        <Feather name="plus-circle" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.createButtonText}>Create a new wallet</Text>
                    </TouchableOpacity>
                    
                    <Text style={styles.orText}>Or</Text>
                    
                    <TouchableOpacity style={styles.importButton} onPress={() => navigation.navigate('RecoverWallet')}>
                        <Feather name="refresh-ccw" size={18} color={theme.colors.primary} />
                        <Text style={styles.importButtonText}>Import existing wallet</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['right', 'left']}>
            <View style={styles.topSection}>
                <TouchableOpacity style={styles.walletSelector} onPress={() => navigation.navigate('WalletSwitcher')}>
                    <Text style={styles.walletName}>{activeWallet.name}</Text>
                    <Feather name="chevron-down" size={22} color={theme.colors.muted} />
                </TouchableOpacity>
                <TouchableOpacity 
                    style={styles.balanceContainer} 
                    onPress={() => navigation.navigate('BalanceDetail', { utxos: utxos || [] })}
                >
                    <Text style={styles.balanceText}>
                        {hideBalance ? '*******' : <>{formatBalance(balance)} <Text style={styles.orangeSymbol}>₿</Text></>}
                    </Text>
                </TouchableOpacity>
                <View style={styles.actionsContainer}>
                    <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Receive')}>
                        <Feather name="arrow-down-circle" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.actionButtonText}>Receive</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Send')}>
                        <Feather name="arrow-up-circle" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.actionButtonText}>Send</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                style={styles.bottomSection}
                refreshControl={<RefreshControl refreshing={isRefetchingTxs} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
            >
                {loadingTxs ? <ActivityIndicator style={styles.loadingIndicator} color={theme.colors.primary} /> : (
                    hasTransactions ? (
                        <View style={styles.historyContainer}>
                            {recentTxs.map((tx) => (
                                <View key={tx.txid}>{renderTransactionItem({ item: tx })}</View>
                            ))}
                            {txList.length > 5 && (
                                <TouchableOpacity style={styles.showMoreButton} onPress={() => navigation.navigate('TransactionHistory')}>
                                    <Text style={styles.showMoreText}>Show full history</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    ) : (
                        <Text style={styles.noTxText}>No transactions yet.</Text>
                    )
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { 
        flex: 1, 
        backgroundColor: theme.colors.background 
    },
    centeredContainer: { 
        flex: 1, 
        backgroundColor: theme.colors.background, 
        alignItems: 'center', 
        justifyContent: 'center' 
    },
    emptyStateContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    createButton: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8, 
        backgroundColor: theme.colors.primary,
        paddingVertical: 16, 
        borderRadius: 8, 
        width: '100%' 
    },
    createButtonText: { 
        color: theme.colors.inversePrimary,
        fontSize: 16, 
        fontWeight: '600' 
    },
    orText: { 
        fontSize: 16, 
        color: theme.colors.muted,
        marginVertical: 16 
    },
    importButton: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8, 
        backgroundColor: theme.colors.background,
        paddingVertical: 16, 
        borderRadius: 8, 
        borderWidth: 1, 
        borderColor: theme.colors.primary,
        width: '100%' 
    },
    importButtonText: { 
        color: theme.colors.primary,
        fontSize: 16, 
        fontWeight: '600' 
    },
    topSection: {
        flex: 1.2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomSection: {
        flex: 1,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border, 
    },
    walletSelector: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8, 
        marginBottom: 8 
    },
    walletName: { 
        fontSize: 20, 
        color: theme.colors.muted, 
    },
    balanceContainer: { 
        alignItems: 'center', 
        height: 44, 
        justifyContent: 'center' 
    },
    balanceText: { 
        fontSize: 36, 
        fontWeight: 'bold', 
        color: theme.colors.primary 
    },
    orangeSymbol: { 
        color: theme.colors.bitcoin 
    },
    actionsContainer: { 
        flexDirection: 'row', 
        justifyContent: 'center', 
        paddingTop: 24, 
        paddingBottom: 16 
    },
    actionButton: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        gap: 8, 
        backgroundColor: theme.colors.primary, 
        paddingVertical: 16, 
        paddingHorizontal: 12, 
        borderRadius: 8, 
        marginHorizontal: 8, 
        minWidth: 128, 
        justifyContent: 'center' 
    },
    actionButtonText: { 
        color: theme.colors.inversePrimary, 
        fontSize: 16, 
        fontWeight: '600' 
    },
    historyContainer: { 
        paddingHorizontal: 20, 
        paddingBottom: 20 
    },
    noTxText: { 
        textAlign: 'center', 
        paddingVertical: 40,
        fontSize: 16, 
        color: theme.colors.muted 
    },
    loadingIndicator: {
        marginTop: 40
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
        gap: 4 
    },
    txType: { 
        fontSize: 16, 
        fontWeight: '500',
        color: theme.colors.primary 
    },
    txAddress: { 
        fontSize: 14, 
        color: theme.colors.muted, 
        fontFamily: 'monospace' 
    },
    txDate: { 
        fontSize: 14, 
        color: theme.colors.muted 
    },
    txAmountContainer: { 
        alignItems: 'flex-end' 
    },
    txAmount: { 
        fontSize: 16, 
        fontWeight: '600',
        color: theme.colors.primary 
    },
    txStatus: { 
        fontSize: 14, 
        color: theme.colors.muted 
    },
    showMoreButton: { 
        alignItems: 'center', 
        padding: 16 
    },
    showMoreText: { 
        color: theme.colors.primary, 
        fontWeight: '600', 
        fontSize: 16 
    },
});

export default WalletScreen;
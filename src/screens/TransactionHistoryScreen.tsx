import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '../components/StyledText';
import { formatBitcoinAddressShort } from '../constants/format';
import { Theme } from '../constants/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { useWalletTransactions } from '../hooks/useBalance';
import { LightningTransaction, RootStackParamList, Transaction } from '../types';

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionHistory'>;
type HistoryRouteProp = RouteProp<RootStackParamList, 'TransactionHistory'>;

const btcFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
  minimumFractionDigits: 8,
});

const formatBalance = (sats: number) =>
  btcFormatter.format((sats || 0) / 100000000).replace(/,/g, ' ');

const TransactionHistoryScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<HistoryRouteProp>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const { activeWallet, lightningTransactions, triggerRefresh } = useWallet();
  const [hideBalance, setHideBalance] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Freeze the mode selected on the wallet screen so the user sees the
  // matching on-chain or Lightning history after tapping the link.
  const mode = route.params?.mode ?? 'onchain';

  const queryAddresses = useMemo(() => {
    if (!activeWallet) return [];

    const usedReceiveAddresses = activeWallet.derivedAddressInfoCache
      .filter(address => address.tx_count > 0 || address.balance > 0)
      .map(address => address.address);
    const changeAddresses = activeWallet.derivedChangeAddresses.map(address => address.address);

    return [...new Set([...usedReceiveAddresses, ...changeAddresses])];
  }, [activeWallet]);

  const walletAddresses = useMemo(() => new Set([
    ...(activeWallet?.derivedReceiveAddresses.map(address => address.address) ?? []),
    ...(activeWallet?.derivedChangeAddresses.map(address => address.address) ?? []),
  ]), [activeWallet]);

  const {
    data: onchainTransactions,
    isLoading: isLoadingOnchainTransactions,
    refetch: refetchOnchainTransactions,
  } = useWalletTransactions(activeWallet?.id, queryAddresses);

  useEffect(() => {
    const loadPreference = async () => {
      setHideBalance(await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY) === 'true');
    };

    if (isFocused) loadPreference();
  }, [isFocused]);

  const transactions = useMemo<(Transaction | LightningTransaction)[]>(() => {
    if (mode === 'lightning') {
      return [...lightningTransactions].sort((a, b) => b.paymentTime - a.paymentTime);
    }

    // The service sorts this already; sorting here also keeps cached history
    // consistently newest-first.
    return [...(onchainTransactions ?? [])].sort(
      (a, b) => (b.status.block_time ?? 0) - (a.status.block_time ?? 0),
    );
  }, [lightningTransactions, mode, onchainTransactions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      triggerRefresh();
      if (mode === 'onchain') await refetchOnchainTransactions();
    } finally {
      setRefreshing(false);
    }
  }, [mode, refetchOnchainTransactions, triggerRefresh]);

  const renderItem = useCallback(({ item }: { item: Transaction | LightningTransaction }) => {
    if ('paymentHash' in item) {
      const transaction = item;
      const isSend = transaction.type === 'send';
      const amountSats = Math.floor(transaction.amountMsat / 1000);

      return (
        <TouchableOpacity
          style={styles.transactionRow}
          onPress={() => navigation.navigate('TransactionDetails', { transaction })}
        >
          <Feather name={isSend ? 'arrow-up' : 'arrow-down'} size={24} color={theme.colors.primary} style={styles.icon} />
          <View style={styles.details}>
            <Text style={styles.type}>{isSend ? 'Send' : 'Receive'}</Text>
            <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle">
              {transaction.description || 'Lightning payment'}
            </Text>
            <Text style={styles.date}>{new Date(transaction.paymentTime * 1000).toLocaleString()}</Text>
          </View>
          <View style={styles.amountContainer}>
            <Text style={styles.amount}>
              {hideBalance ? '*******' : <>{isSend ? '-' : '+'} {formatBalance(amountSats)} <Text style={styles.bitcoin}>₿</Text></>}
            </Text>
            <Text style={styles.status}>
              {transaction.status === 'complete' ? 'Complete' : transaction.status === 'failed' ? 'Failed' : 'Pending'}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    const transaction = item;
    const isSend = transaction.type === 'send';
    const externalAddresses = isSend
      ? transaction.vout.filter(output => !walletAddresses.has(output.scriptpubkey_address)).map(output => output.scriptpubkey_address)
      : transaction.vin.filter(input => !walletAddresses.has(input.prevout?.scriptpubkey_address)).map(input => input.prevout?.scriptpubkey_address);
    const otherAddress = externalAddresses.length === 1 ? externalAddresses[0] : 'Multiple';
    const date = transaction.status.block_time
      ? new Date(transaction.status.block_time * 1000).toLocaleString()
      : 'Pending confirmation';

    return (
      <TouchableOpacity
        style={styles.transactionRow}
        onPress={() => navigation.navigate('TransactionDetails', { transaction })}
      >
        <Feather name={isSend ? 'arrow-up' : 'arrow-down'} size={24} color={theme.colors.primary} style={styles.icon} />
        <View style={styles.details}>
          <Text style={styles.type}>{isSend ? 'Send' : 'Receive'}</Text>
          <Text style={styles.address}>{isSend ? 'To' : 'From'} {formatBitcoinAddressShort(otherAddress || 'Unknown')}</Text>
          <Text style={styles.date}>{date}</Text>
        </View>
        <View style={styles.amountContainer}>
          <Text style={styles.amount}>
            {hideBalance ? '*******' : <>{isSend ? '-' : '+'} {formatBalance(transaction.amount)} <Text style={styles.bitcoin}>₿</Text></>}
          </Text>
          <Text style={styles.status}>{transaction.status.confirmed ? 'Confirmed' : 'Pending'}</Text>
        </View>
      </TouchableOpacity>
    );
  }, [hideBalance, navigation, styles, theme.colors.primary, walletAddresses]);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={transactions}
        renderItem={renderItem}
        keyExtractor={item => 'paymentHash' in item ? item.paymentHash : item.txid}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        ListEmptyComponent={
          mode === 'onchain' && isLoadingOnchainTransactions
            ? <ActivityIndicator style={styles.loading} color={theme.colors.primary} />
            : <Text style={styles.empty}>No transactions yet</Text>
        }
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
      />
    </SafeAreaView>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { flexGrow: 1 },
  transactionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: theme.colors.border },
  icon: { marginRight: 16 },
  details: { flex: 1, gap: 4 },
  type: { fontSize: 16, color: theme.colors.primary },
  address: { fontSize: 14, color: theme.colors.muted, fontFamily: 'monospace' },
  date: { fontSize: 14, color: theme.colors.muted },
  amountContainer: { alignItems: 'flex-end' },
  amount: { fontSize: 16, color: theme.colors.primary },
  status: { fontSize: 14, color: theme.colors.muted },
  bitcoin: { color: theme.colors.bitcoin },
  loading: { marginTop: 40 },
  empty: { textAlign: 'center', paddingVertical: 40, fontSize: 16, color: theme.colors.muted },
});

export default TransactionHistoryScreen;

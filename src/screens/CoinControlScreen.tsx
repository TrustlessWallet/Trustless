import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, SafeAreaView } from 'react-native';
import { Text } from '../components/StyledText';
import { useNavigation, RouteProp, useRoute, useIsFocused } from '@react-navigation/native';
import { useWallet } from '../contexts/WalletContext';
import { useWalletUTXOs, getWalletUtxoQueryAddresses } from '../hooks/useBalance';
import { UTXO, RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatBitcoinAddressShort } from '../constants/format';

type RoutePropType = RouteProp<RootStackParamList, 'CoinControl'>;

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);
const formatTxidShort = (txid: string) => {
  if (!txid || txid.length <= 8) return txid;
  return `${txid.substring(0, 4)}...${txid.substring(txid.length - 4)}`;
};

const CoinControlScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<RoutePropType>();
  const isFocused = useIsFocused();
  const { onSelect, targetAmount } = route.params;
  const { activeWallet, getUtxoLabel } = useWallet();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);
  
  const [selectedUtxos, setSelectedUtxos] = useState<UTXO[]>([]);
  const [hideBalance, setHideBalance] = useState(false);

  // Same address set as SendScreen/BalanceDetailScreen, same react-query hook.
  // If SendScreen already fetched this wallet's UTXOs (which it does on focus),
  // opening Coin Control here reuses that cached result instead of re-fetching.
  const queryAddresses = useMemo(
    () => getWalletUtxoQueryAddresses(activeWallet),
    [activeWallet]
  );

  const {
    data: rawUtxos = [],
    isLoading: loading,
    refetch: refetchUtxos,
  } = useWalletUTXOs(activeWallet?.id, queryAddresses);

  const utxos = useMemo(
    () => [...rawUtxos].sort((a, b) => b.value - a.value),
    [rawUtxos]
  );

  useEffect(() => {
    if (isFocused && queryAddresses.length > 0) {
      void refetchUtxos();
    }
  }, [isFocused, queryAddresses.length, refetchUtxos]);

  useEffect(() => {
    const loadPreference = async () => {
      const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
      setHideBalance(savedPref === 'true');
    };
    if (isFocused) {
      loadPreference();
    }
  }, [isFocused]);

  const handleSelectUtxo = (utxo: UTXO) => {
    setSelectedUtxos(prev => {
      const isSelected = prev.some(u => u.txid === utxo.txid && u.vout === utxo.vout);
      if (isSelected) {
        return prev.filter(u => !(u.txid === utxo.txid && u.vout === utxo.vout));
      } else {
        return [...prev, utxo];
      }
    });
  };

  const handleConfirmSelection = () => {
    onSelect(selectedUtxos);
    navigation.goBack();
  };

  const handleAutomaticSelection = () => {
    onSelect([]); 
    navigation.goBack();
  };

  const totalSelected = selectedUtxos.reduce((sum, u) => sum + u.value, 0);
  const canConfirm = totalSelected >= targetAmount;

  const renderItem = ({ item }: { item: UTXO }) => {
    const isSelected = selectedUtxos.some(u => u.txid === item.txid && u.vout === item.vout);
    const label = getUtxoLabel(item.txid, item.vout) || 'UTXO';

    return (
      <TouchableOpacity
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => handleSelectUtxo(item)}
        activeOpacity={0.7}
      >
        <View style={styles.addressContainer}>
            <Text style={styles.utxoLabelText}>{label}</Text>
            <Text style={styles.addressText}>{formatBitcoinAddressShort(item.address)}</Text>
            <Text style={styles.txidText}>{formatTxidShort(item.txid)}:{item.vout}</Text>
        </View>
        <Text style={styles.balanceText}>
          {hideBalance ? '*******' : (
            <>{formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text></>
          )}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Required Amount</Text>
            <Text style={styles.amountText}>{formatBtc(targetAmount)} <Text style={styles.orangeSymbol}>₿</Text></Text>
        </View>
        <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>Selected Amount</Text>
            <Text style={[styles.amountText, totalSelected > 0 ? styles.selectedAmountText : {}]}>
              {hideBalance ? '*******' : (
                <>{formatBtc(totalSelected)} <Text style={styles.orangeSymbol}>₿</Text></>
              )}
            </Text>
        </View>
      </View>
      <FlatList
        data={utxos}
        renderItem={renderItem}
        keyExtractor={item => `${item.txid}:${item.vout}`}
        bounces={false}
        contentContainerStyle={styles.listContent}
        style={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No spendable coins found.</Text>
          </View>
        }
      />
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.autoButton} 
          onPress={handleAutomaticSelection}
        >
            <Text style={styles.autoButtonText}>Automatic selection</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.confirmButton, !canConfirm && styles.buttonDisabled]} 
          onPress={handleConfirmSelection} 
          disabled={!canConfirm}
        >
            <Text style={styles.confirmButtonText}>Use Selected Coins</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background 
  },
  centered: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20,
    backgroundColor: theme.colors.background, 
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: theme.colors.background, 
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
  },
  amountBox: {
    alignItems: 'center',
  },
  amountLabel: {
    fontSize: 14,
    color: theme.colors.muted, 
    marginBottom: 4,
  },
  amountText: {
    fontSize: 18,
    color: theme.colors.primary, 
  },
  selectedAmountText: {
    color: theme.colors.primary, 
  },
  list: {
    flex: 1,
    maxHeight: 450,
  },
  listContent: { 
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border, 
    borderRadius: 8,
    backgroundColor: theme.colors.surface, 
  },
  rowSelected: {
    borderColor: theme.colors.bitcoin, 
    borderWidth: 1,
  },
  addressContainer: { flex: 1, marginRight: 8 },
  utxoLabelText: {
    fontSize: 16, 
    color: theme.colors.primary, 
    marginBottom: 4,
  },
  addressText: { 
    fontSize: 14,
    color: theme.colors.muted, 
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  txidText: { 
    fontFamily: 'monospace', 
    fontSize: 14, 
    color: theme.colors.muted, 
    marginTop: 0 
  },
  balanceText: { 
    fontSize: 16, 
    color: theme.colors.primary 
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: { 
    fontSize: 16, 
    color: theme.colors.muted 
  },
  footer: {
    padding: 24,
    backgroundColor: theme.colors.background, 
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  autoButton: {
    paddingVertical: 16,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 12, 
  },
  autoButtonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: theme.colors.primary, 
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: theme.colors.inversePrimary, 
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5, 
  },
  orangeSymbol: {
    color: theme.colors.bitcoin, 
  },
});

export default CoinControlScreen;
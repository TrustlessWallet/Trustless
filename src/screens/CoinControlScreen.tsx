import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView } from 'react-native';
import { Text } from '../components/StyledText';
import { useNavigation, RouteProp, useRoute } from '@react-navigation/native';
import { useWallet } from '../contexts/WalletContext';
import { fetchUTXOs } from '../services/bitcoin';
import { UTXO, RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
type RoutePropType = RouteProp<RootStackParamList, 'CoinControl'>;
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);
const formatAddress = (address: string) => {
  if (!address || address.length <= 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};
const formatTxidShort = (txid: string) => {
  if (!txid || txid.length <= 8) return txid;
  return `${txid.substring(0, 4)}...${txid.substring(txid.length - 4)}`;
};
const CoinControlScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<RoutePropType>();
  const { onSelect, targetAmount } = route.params;
  const { activeWallet } = useWallet();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [utxos, setUtxos] = useState<UTXO[]>([]);
  const [selectedUtxos, setSelectedUtxos] = useState<UTXO[]>([]);
  const [loading, setLoading] = useState(true);
  const UTXO_CACHE_PREFIX = '@utxoCache:';
  const UTXO_CACHE_STALE_MS = 240000;
  useEffect(() => {
    const getUtxos = async () => {
      if (!activeWallet) {
        setLoading(false);
        return;
      }
      const cacheKey = `${UTXO_CACHE_PREFIX}${activeWallet.id}`;
      let servedFromCache = false;
      try {
        const cachedStr = await AsyncStorage.getItem(cacheKey);
        if (cachedStr) {
          const cached = JSON.parse(cachedStr) as { utxos: UTXO[]; balance: number; timestamp: number };
          setUtxos((cached.utxos || []).sort((a, b) => b.value - a.value));
          servedFromCache = true;
          setLoading(false);
          const isFresh = Date.now() - cached.timestamp < UTXO_CACHE_STALE_MS;
          if (isFresh) return; 
        }
      } catch {}
      try {
        const infoCache = activeWallet.derivedAddressInfoCache ?? [];
        const receiveForUtxos = infoCache.filter(i => i.balance > 0).map(i => i.address);
        const changeIndex = activeWallet.changeAddressIndex ?? 0;
        const changeAddresses = (activeWallet.derivedChangeAddresses ?? [])
          .filter(a => a.index <= changeIndex + 1)
          .map(a => a.address);
        const targetAddresses = [...new Set([...receiveForUtxos, ...changeAddresses])];
        if (targetAddresses.length === 0) {
          if (!servedFromCache) setLoading(false);
          setUtxos([]);
          return;
        }
        const fetchedUtxos = await fetchUTXOs(targetAddresses);
        const sorted = fetchedUtxos.sort((a, b) => b.value - a.value);
        setUtxos(sorted);
        await AsyncStorage.setItem(cacheKey, JSON.stringify({ utxos: sorted, balance: sorted.reduce((s, u) => s + u.value, 0), timestamp: Date.now() }));
      } catch (error) {
        if (!servedFromCache) Alert.alert("Error", "Could not fetch wallet UTXOs.");
      } finally {
        if (!servedFromCache) setLoading(false);
      }
    };
    getUtxos();
  }, [activeWallet, targetAmount]);
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
    return (
      <TouchableOpacity
        style={[styles.row, isSelected && styles.rowSelected]}
        onPress={() => handleSelectUtxo(item)}
      >
        <View style={styles.addressContainer}>
            <Text style={styles.addressText}>{formatAddress(item.address)}</Text>
            <Text style={styles.txidText}>{formatTxidShort(item.txid)}:{item.vout}</Text>
        </View>
        <Text style={styles.balanceText}>
          {formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text>
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
            <Text style={[styles.amountText, totalSelected > 0 && styles.selectedAmountText]}>{formatBtc(totalSelected)} <Text style={styles.orangeSymbol}>₿</Text></Text>
        </View>
      </View>
      <FlatList
        data={utxos}
        renderItem={renderItem}
        keyExtractor={item => `${item.txid}:${item.vout}`}
        contentContainerStyle={styles.listContent}
        style={styles.list}
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
const getStyles = (theme: Theme) => StyleSheet.create({
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
    fontWeight: '600',
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
  addressText: { 
    fontSize: 16, 
    color: theme.colors.primary, 
    fontWeight: '500' 
  },
  txidText: { 
    fontFamily: 'monospace', 
    fontSize: 12, 
    color: theme.colors.muted, 
    marginTop: 4 
  },
  balanceText: { 
    fontSize: 16, 
    fontWeight: '600', 
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
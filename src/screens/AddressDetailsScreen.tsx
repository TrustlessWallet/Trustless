import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Alert, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Transaction, UTXO } from '../types';
import { fetchAddressTransactions, fetchUTXOs, fetchBitcoinBalance } from '../services/bitcoin';
import QRCode from 'react-native-qrcode-svg';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL, DERIVATION_PARENT_PATH } from '../constants/network';
const QR_SIZE = 220;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddressDetails'>;
type RoutePropType = RouteProp<RootStackParamList, 'AddressDetails'>;
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);
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
const formatAddressInChunks = (address: string | undefined) => {
  if (!address) return '';
  return address.match(/.{1,4}/g)?.join(' ') || '';
};
const AddressDetailsScreen = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RoutePropType>();
  const { address } = route.params;
  const scrollRef = useRef<ScrollView>(null);
  const { activeWallet } = useWallet();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);
  const [balance, setBalance] = useState(0);
  const [utxos, setUtxos] = useState<UTXO[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const receiveData = activeWallet?.derivedReceiveAddresses.find(a => a.address === address);
  const changeData = activeWallet?.derivedChangeAddresses.find(a => a.address === address);
  const derivationPath = receiveData
    ? `${DERIVATION_PARENT_PATH}/0/${receiveData.index}`
    : changeData
      ? `${DERIVATION_PARENT_PATH}/1/${changeData.index}`
      : null;
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <Feather name="x" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, theme.colors.primary]);
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const balancePromise = fetchBitcoinBalance(address);
      const utxosPromise = fetchUTXOs([address]);
      const txsPromise = fetchAddressTransactions([address]);
      setBalance(await balancePromise);
      setUtxos(await utxosPromise);
      setTransactions(await txsPromise);
    } catch (e) {
      console.error("Failed to fetch address details", e);
      Alert.alert("Error", "Could not fetch address details.");
    } finally {
      setLoading(false);
    }
  }, [address]);
  useEffect(() => {
    fetchData();
  }, [fetchData]);
  const handleOpenExplorer = () => {
    const url = `${EXPLORER_UI_URL}/address/${address}`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open block explorer."));
  };
  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  return (
    <ScrollView 
      ref={scrollRef}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={true}
    >
      <View style={styles.header}>
        {derivationPath && (
          <Text style={styles.derivationPathDisplay}>{derivationPath}</Text>
        )}
        <View style={styles.qrWrapper}>
          <QRCode 
            value={address} 
            size={QR_SIZE} 
            backgroundColor={theme.colors.background}
            color={theme.colors.primary}
          />
        </View>
        <Text style={styles.addressText} selectable>{formatAddressInChunks(address)}</Text>
        <Text style={styles.balanceText}>
          {formatBtc(balance)} <Text style={styles.orangeSymbol}>₿</Text>
        </Text>
        <TouchableOpacity style={styles.explorerButton} onPress={handleOpenExplorer}>
          <Feather name="external-link" size={18} color={theme.colors.inversePrimary} />
          <Text style={styles.explorerButtonText}>View on Explorer</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Spendable Coins (UTXOs)</Text>
        {utxos.length === 0 ? (
          <Text style={styles.emptyText}>No spendable coins (utxos) found.</Text>
        ) : (
          <>
            {utxos.map((item) => (
              <View key={`${item.txid}:${item.vout}`} style={styles.utxoRow}>
                <View style={styles.itemDetails}>
                  <Text style={styles.itemTitle}>UTXO</Text>
                  <Text style={styles.itemTxid} selectable>
                    {item.txid.substring(0, 6)}...{item.txid.substring(item.txid.length - 6)}:{item.vout}
                  </Text>
                </View>
                <Text style={styles.itemAmount}>{formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text></Text>
              </View>
            ))}
          </>
        )}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction History</Text>
        {transactions.length === 0 ? (
          <Text style={styles.emptyText}>No transaction history found.</Text>
        ) : (
          <>
            {transactions.map((item) => {
              const isSend = item.type === 'send';
              let otherAddress = 'Multiple';
              if (isSend) {
                const externalOutputs = item.vout.filter(o => o.scriptpubkey_address !== address);
                if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
              } else {
                const externalInputs = item.vin.filter(i => i.prevout?.scriptpubkey_address !== address);
                if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
              }
              const txDate = item.status.block_time
                ? new Date(item.status.block_time * 1000).toLocaleString()
                : 'Pending confirmation';
              return (
                <TouchableOpacity 
                  key={item.txid} 
                  style={styles.txRow} 
                  onPress={() => navigation.navigate('TransactionDetails', { transaction: item })}
                >
                  <Feather 
                    name={isSend ? "arrow-up" : "arrow-down"} 
                    size={24} 
                    color={theme.colors.primary} 
                    style={styles.txIcon} 
                  />
                  <View style={styles.txDetails}>
                    <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                    <Text style={styles.txAddress}>
                      {isSend ? "To" : "From"} {formatAddress(otherAddress || 'Unknown')}
                    </Text>
                    <Text style={styles.txDate}>{txDate}</Text>
                  </View>
                  <View style={styles.txAmountContainer}>
                    <Text style={styles.txAmount}>
                      {isSend ? '-' : '+'} {formatBalance(item.amount)} <Text style={styles.orangeSymbol}>₿</Text>
                    </Text>
                    <Text style={styles.txStatus}>
                      {item.status.confirmed ? 'Confirmed' : 'Pending'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </View>
    </ScrollView>
  );
};
const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
    backgroundColor: theme.colors.background,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center'
  },
  header: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
    width: '100%',
    borderBottomWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background, 
  },
  derivationPathDisplay: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: theme.colors.muted,
    marginBottom: 8
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: theme.colors.background, 
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.3 : 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  addressText: {
    fontFamily: 'monospace',
    fontSize: 14,
    textAlign: 'center',
    color: theme.colors.primary,
    lineHeight: 24,
    paddingHorizontal: 72,
    marginBottom: 12,
  },
  balanceText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 8,
  },
  orangeSymbol: {
    color: theme.colors.bitcoin,
  },
  explorerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: theme.colors.primary,
    marginHorizontal: 24,
    marginBottom: 8,
    padding: 12,
    borderRadius: 8,
  },
  explorerButtonText: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.muted,
    textAlign: 'center',
    paddingVertical: 32,
  },
  utxoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: theme.colors.border
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.primary,
    marginBottom: 4,
  },
  itemTxid: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: theme.colors.muted,
  },
  itemAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginLeft: 12,
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
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
    fontSize: 13,
    color: theme.colors.muted,
  },
  txType: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.primary
  },
  txAddress: {
    fontSize: 13,
    color: theme.colors.muted,
    fontFamily: 'monospace'
  },
  txAmountContainer: {
    alignItems: 'flex-end',
    marginLeft: 12,
  },
  txAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 2,
  },
  txStatus: {
    fontSize: 13,
    color: theme.colors.muted,
  },
});
export default AddressDetailsScreen;
import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, Linking, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { RootStackParamList, Transaction } from '../types';
import { getTransactionDetails, getTipHeight } from '../services/bitcoin';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL } from '../constants/network'; 
type RoutePropType = RouteProp<RootStackParamList, 'TransactionDetails'>;
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);
const DetailRow = ({ label, value, isAddress, styles }: { label: string, value: string, isAddress?: boolean, styles: ReturnType<typeof getStyles> }) => (
  <View style={styles.detailRow}>
    <Text style={styles.label}>{label}</Text>
    <Text style={[styles.value, isAddress && styles.addressValue]} selectable>{value}</Text>
  </View>
);
const TransactionDetailsScreen = () => {
  const route = useRoute<RoutePropType>();
  const { transaction: txFromParams } = route.params || {};
  const { activeWallet } = useWallet();
  const { theme } = useTheme(); 
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [tx, setTx] = useState<Transaction | null>(txFromParams);
  const [tipHeight, setTipHeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(!txFromParams);
    useEffect(() => {
    const fetchTx = async () => {
      const receiveAddresses = activeWallet?.derivedReceiveAddresses.map(a => a.address) ?? [];
      const changeAddresses = activeWallet?.derivedChangeAddresses.map(a => a.address) ?? [];
      const allAddresses = [...new Set([...receiveAddresses, ...changeAddresses])];
      if (!tx?.vin && txFromParams?.txid && allAddresses.length > 0) {
        setLoading(true);
        try {
          const details = await getTransactionDetails(txFromParams.txid, allAddresses);
          setTx(details);
        } catch (error) {
          Alert.alert("Error", "Could not fetch transaction details.");
        } finally {
          setLoading(false);
        }
      }
    };
    fetchTx();
  }, [txFromParams, activeWallet]);
  useEffect(() => {
    const fetchTip = async () => {
      try {
        const h = await getTipHeight();
        setTipHeight(h);
      } catch {}
    };
    fetchTip();
  }, []);
  const handleOpenExplorer = () => {
    if (tx?.txid) {
      const url = `${EXPLORER_UI_URL}/tx/${tx.txid}`;
      Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open block explorer."));
    }
  };
    if (loading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }
  if (!tx) {
    return <View style={styles.centered}><Text style={{ color: theme.colors.primary }}>Transaction not found.</Text></View>;
  }
  const walletAddresses = new Set([
    ...(activeWallet?.derivedReceiveAddresses.map(a => a.address) ?? []),
    ...(activeWallet?.derivedChangeAddresses.map(a => a.address) ?? [])
  ]);
  const isSend = tx.type === 'send';
  let otherAddress = 'Multiple Addresses';
  if (isSend) {
    const externalOutputs = tx.vout.filter(o => !walletAddresses.has(o.scriptpubkey_address));
    if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
  } else {
    const externalInputs = tx.vin.filter(i => !walletAddresses.has(i.prevout?.scriptpubkey_address));
    if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
  }
  const confirmations = tx?.status?.confirmed && typeof tx.status.block_height === 'number' && tipHeight !== null
    ? Math.max(0, tipHeight - tx.status.block_height + 1)
    : 0;
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.amountText}>
          {isSend ? '-' : '+'} {formatBtc(tx.amount)} <Text style={styles.orangeSymbol}>₿</Text>
        </Text>
        <Text style={styles.statusText}>{tx.status.confirmed ? 'Confirmed' : 'Pending'}</Text>
      </View>
      <View style={styles.detailsContainer}>
        <DetailRow 
          label="Date" 
          value={tx.status.block_time ? new Date(tx.status.block_time * 1000).toLocaleString() : 'Pending'} 
          styles={styles} 
        />
        <DetailRow 
          label={isSend ? "To" : "From"} 
          value={otherAddress || 'Unknown'} 
          isAddress 
          styles={styles} 
        />
        <DetailRow 
          label="Confirmations" 
          value={`${confirmations}`} 
          styles={styles} 
        />
        <DetailRow 
          label="Network Fee" 
          value={`${tx.fee} sats`} 
          styles={styles} 
        />
        <DetailRow 
          label="Transaction ID" 
          value={tx.txid} 
          isAddress 
          styles={styles} 
        />
      </View>
      <TouchableOpacity style={styles.explorerButton} onPress={handleOpenExplorer}>
        <Feather name="external-link" size={18} color={theme.colors.inversePrimary} />
        <Text style={styles.explorerButtonText}>View on Block Explorer</Text>
      </TouchableOpacity>
    </ScrollView>
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
    backgroundColor: theme.colors.background 
  },
  header: { 
    alignItems: 'center', 
    padding: 24, 
    borderBottomWidth: 1, 
    borderColor: theme.colors.border 
  },
  amountText: { 
    fontSize: 32, 
    fontWeight: 'bold', 
    marginVertical: 8, 
    color: theme.colors.primary 
  },
  statusText: { 
    fontSize: 16, 
    color: theme.colors.muted, 
    fontWeight: '500' 
  },
  detailsContainer: { 
    paddingHorizontal: 24, 
    paddingTop: 16 
  },
  detailRow: { 
    marginBottom: 24 
  },
  label: { 
    fontSize: 16, 
    color: theme.colors.primary, 
    marginBottom: 4, 
    fontWeight: '500' 
  },
  value: { 
    fontSize: 16, 
    color: theme.colors.muted 
  },
  addressValue: { 
    fontFamily: 'monospace', 
    flexShrink: 1 
  },
  explorerButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    backgroundColor: theme.colors.primary, 
    marginHorizontal: 24, 
    padding: 16, 
    borderRadius: 8 
  },
  explorerButtonText: { 
    color: theme.colors.inversePrimary, 
    fontSize: 16, 
    fontWeight: '600' 
  },
  orangeSymbol: {
    color: theme.colors.bitcoin, 
  },
});
export default TransactionDetailsScreen;
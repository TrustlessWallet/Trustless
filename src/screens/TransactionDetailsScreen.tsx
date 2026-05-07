import React, { useMemo, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { RootStackParamList, Transaction, LightningTransaction } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL } from '../constants/network';
import { AddressText } from '../components/AddressText';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { validateBitcoinAddress, getTransactionDetails } from '../services/bitcoin';
import { useTipHeight } from '../hooks/useBalance';
import { useQuery } from '@tanstack/react-query';

type RoutePropType = RouteProp<RootStackParamList, 'TransactionDetails'>;
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);

const DetailRow = ({ label, value, isAddress, styles, valueStyle }: { label: string, value: string, isAddress?: boolean, styles: ReturnType<typeof getStyles>, valueStyle?: any }) => (
  <View style={styles.detailRow}>
    <Text style={styles.label}>{label}</Text>
    {isAddress ? (
      <AddressText style={[styles.value, styles.addressValue]} selectable address={value} />
    ) : (
      <Text style={[styles.value, valueStyle]} selectable>{value}</Text>
    )}
  </View>
);

const TransactionDetailsScreen = () => {
  const route = useRoute<RoutePropType>();
  const isFocused = useIsFocused();
  const { transaction: txFromParams } = route.params || {};
  const { activeWallet } = useWallet();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const [hideBalance, setHideBalance] = useState(false);

  const isLightning = Boolean(txFromParams && 'paymentHash' in txFromParams);

  const { data: tipHeight } = useTipHeight();

  const allAddresses = useMemo(() => {
    const receiveAddresses = activeWallet?.derivedReceiveAddresses.map(a => a.address) ?? [];
    const changeAddresses = activeWallet?.derivedChangeAddresses.map(a => a.address) ?? [];
    return [...new Set([...receiveAddresses, ...changeAddresses])];
  }, [activeWallet]);

  const queryTxId = txFromParams ? (isLightning ? (txFromParams as unknown as LightningTransaction).paymentHash : (txFromParams as unknown as Transaction).txid) : undefined;

  const { data: tx } = useQuery({
    queryKey: ['txDetails', queryTxId],
    queryFn: async () => {
      if (isLightning || !txFromParams || ('vin' in txFromParams)) return txFromParams;
      try {
        return await getTransactionDetails((txFromParams as unknown as Transaction).txid, allAddresses);
      } catch {
        return txFromParams; 
      }
    },
    initialData: txFromParams,
  });

  useEffect(() => {
    const loadPreference = async () => {
      const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
      setHideBalance(savedPref === 'true');
    };
    if (isFocused) loadPreference();
  }, [isFocused]);

  const handleOpenExplorer = () => {
    if (tx && !isLightning && 'txid' in tx) {
      const url = `${EXPLORER_UI_URL}/tx/${(tx as unknown as Transaction).txid}`;
      Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open block explorer."));
    }
  };

  if (!tx) {
    return <View style={styles.centered}><Text style={{ color: theme.colors.primary }}>Transaction not found.</Text></View>;
  }

  const isSend = tx.type === 'send';
  
  const lnTx = tx as unknown as LightningTransaction; 
  const ocTx = tx as unknown as Transaction; 
  
  const txId = isLightning ? lnTx.paymentHash : ocTx.txid;
  const amountSats = isLightning ? Math.floor(lnTx.amountMsat / 1000) : ocTx.amount;
  const feeSats = isLightning ? Math.floor(lnTx.feeMsat / 1000) : (ocTx.fee ?? '...');
  const lightningMethod = typeof lnTx.paymentMethod === 'number' ? lnTx.paymentMethod : null;
  const lightningFeeLabel = lightningMethod === 4 || lightningMethod === 5 ? "Swap / Setup fee" : "Fee";
  const timestamp = isLightning ? lnTx.paymentTime : ocTx.status?.block_time;
  const isConfirmed = isLightning ? lnTx.status === 'complete' : ocTx.status?.confirmed;
  const dateStr = timestamp ? new Date(timestamp * 1000).toLocaleString() : 'Pending';

  let otherAddress: string | unknown = isLightning ? (lnTx.description || 'Lightning invoice') : 'Multiple addresses';
  let isOtherAddressValid = false;

  if (!isLightning) {
    const walletAddresses = new Set(allAddresses);
    if (isSend && ocTx.vout) {
      const externalOutputs = ocTx.vout.filter((o: any) => !walletAddresses.has(o.scriptpubkey_address));
      if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
    } else if (!isSend && ocTx.vin) {
      const externalInputs = ocTx.vin.filter((i: any) => !walletAddresses.has(i.prevout?.scriptpubkey_address));
      if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
    }
    isOtherAddressValid = validateBitcoinAddress(otherAddress as string || '');
  }

  const confirmations = !isLightning && isConfirmed && typeof ocTx.status?.block_height === 'number' && tipHeight != null
    ? Math.max(0, tipHeight - ocTx.status.block_height + 1)
    : (isConfirmed ? '...' : null); 

  return (
    <ScrollView style={styles.container} bounces={false}>
      <View style={styles.header}>
        <Text style={styles.amountText}>
          {hideBalance ? '*******' : (
            <>{isSend ? '-' : '+'} {formatBtc(amountSats)} <Text style={styles.orangeSymbol}>₿</Text></>
          )}
        </Text>
      </View>
      <View style={styles.detailsContainer}>
        <DetailRow label="Date" value={dateStr} styles={styles} />
        <DetailRow label="Status" value={isConfirmed ? 'Completed' : 'Pending'} styles={styles} />

        {isLightning ? (
          <DetailRow label="Description" value={otherAddress as string} styles={styles} />
        ) : (
          <DetailRow label={isSend ? "To" : "From"} value={(otherAddress as string) || 'Unknown'} isAddress={isOtherAddressValid} styles={styles} />
        )}

        {!isLightning && confirmations !== null && (
          <DetailRow label="Confirmations" value={`${confirmations}`} styles={styles} />
        )}

        <DetailRow label={isLightning ? lightningFeeLabel : "Network fee"} value={`${feeSats} sats`} styles={styles} />
        <DetailRow label={isLightning ? "Payment hash" : "Transaction ID"} value={txId} valueStyle={styles.addressValue} styles={styles} />
      </View>

      {!isLightning && (
        <TouchableOpacity style={styles.explorerButton} onPress={handleOpenExplorer}>
          <Feather name="external-link" size={18} color={theme.colors.inversePrimary} />
          <Text style={styles.explorerButtonText}>View on block explorer</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
  header: { alignItems: 'center', padding: 24, borderBottomWidth: 1, borderColor: theme.colors.border },
  amountText: { fontSize: 32, fontWeight: 'bold', marginVertical: 8, color: theme.colors.primary },
  statusText: { fontSize: 16, color: theme.colors.muted, fontWeight: '500' },
  detailsContainer: { paddingHorizontal: 24, paddingTop: 16 },
  detailRow: { marginBottom: 24 },
  label: { fontSize: 16, color: theme.colors.primary, marginBottom: 4, fontWeight: '500' },
  value: { fontSize: 16, color: theme.colors.muted },
  addressValue: { fontFamily: 'monospace', flexShrink: 1 },
  explorerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: theme.colors.primary, marginHorizontal: 24, padding: 16, borderRadius: 8 },
  explorerButtonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '600' },
  orangeSymbol: { color: theme.colors.bitcoin, },
});

export default TransactionDetailsScreen;
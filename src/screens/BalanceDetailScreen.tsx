import React, { useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Linking, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, UTXO } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { EXPLORER_UI_URL, DERIVATION_PARENT_PATH } from '../constants/network';
type RoutePropType = RouteProp<RootStackParamList, 'BalanceDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'BalanceDetail'>;
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);
const formatAddressShort = (address: string) => {
  if (!address || address.length <= 8) return address;
  return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
};
const BalanceDetailScreen = () => {
  const route = useRoute<RoutePropType>();
  const navigation = useNavigation<NavigationProp>();
  const { activeWallet } = useWallet();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const { utxos } = route.params;
  const addressMap = new Map<string, string>([
    ...(activeWallet?.derivedReceiveAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/0/${a.index}`] as [string, string]) ?? []),
    ...(activeWallet?.derivedChangeAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/1/${a.index}`] as [string, string]) ?? [])
  ]);
  const handleOpenExplorer = (txid: string) => {
    const url = `${EXPLORER_UI_URL}/tx/${txid}`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open block explorer."));
  };
  const renderItem = ({ item }: { item: UTXO }) => {
    const derivationPath = addressMap.get(item.address);
    return (
      <TouchableOpacity 
        style={styles.row} 
        onPress={() => navigation.navigate('AddressDetails', { address: item.address })}
      >
        <View style={styles.addressContainer}>
          <Text style={styles.txidText} selectable>
            {item.txid.substring(0, 4)}...{item.txid.substring(item.txid.length - 4)}:{item.vout}
          </Text>
          <Text style={styles.addressShortText}>
            {formatAddressShort(item.address)}
          </Text>
          {derivationPath && (
            <Text style={styles.derivationPath}>
              {derivationPath}
            </Text>
          )}
        </View>
        <View style={styles.balanceContainer}>
          <Text style={styles.balanceText}>
            <>{formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text></>
          </Text>
          <TouchableOpacity onPress={() => handleOpenExplorer(item.txid)}>
              <Feather name="external-link" size={20} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };
  return (
    <FlatList
      data={utxos.sort((a, b) => b.value - a.value)}
      renderItem={renderItem}
      keyExtractor={(item) => `${item.txid}:${item.vout}`}
      contentContainerStyle={styles.list}
      style={styles.listStyle}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No spendable coins (UTXOs) found.</Text>
        </View>
      }
    />
  );
};
const getStyles = (theme: Theme) => StyleSheet.create({
  centered: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20,
    backgroundColor: theme.colors.background,
  },
  listStyle: {
    backgroundColor: theme.colors.background,
  },
  list: { 
    paddingHorizontal: 24, 
    paddingTop: 16,
    flexGrow: 1,
    backgroundColor: theme.colors.background,
  },
  row: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 16, 
    borderBottomWidth: 1, 
    borderColor: theme.colors.border,
  },
  addressContainer: { flex: 3, gap: 2 },
  addressShortText: { 
    fontSize: 14, 
    color: theme.colors.muted,
    fontFamily: 'monospace', 
    fontWeight: '600' 
  },
  derivationPath: { 
    fontSize: 14, 
    color: theme.colors.muted,
    fontFamily: 'monospace' 
  },
  txidText: { 
    fontFamily: 'monospace', 
    fontSize: 16, 
    color: theme.colors.primary,
  },
  balanceContainer: { 
    flex: 2, 
    flexDirection: 'row',
    alignItems: 'center', 
    justifyContent: 'flex-end',
    gap: 12,
  },
  balanceText: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: theme.colors.primary
  },
  emptyText: { 
    fontSize: 18, 
    color: theme.colors.muted,
    textAlign: 'center' 
  },
  orangeSymbol: {
    color: theme.colors.bitcoin,
  },
});
export default BalanceDetailScreen;
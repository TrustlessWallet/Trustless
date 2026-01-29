import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  Linking, 
  Alert, 
  TextInput, 
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Keyboard
} from 'react-native';
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
  const { activeWallet, getUtxoLabel, updateUtxoLabel } = useWallet();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);
  const { utxos } = route.params;

  const [editingUtxoKey, setEditingUtxoKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  
  const flatListRef = useRef<FlatList>(null);

  const sortedUtxos = useMemo(() => 
    [...utxos].sort((a, b) => b.value - a.value), 
    [utxos]
  );

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Feather name="x" size={24} color={theme.colors.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, theme.colors.primary]);

  // Scroll to the active item when editing starts
  useEffect(() => {
    if (editingUtxoKey && sortedUtxos.length > 0) {
      const index = sortedUtxos.findIndex(
        u => `${u.txid}:${u.vout}` === editingUtxoKey
      );
      
      if (index !== -1) {
        // Wait for keyboard animation
        const timer = setTimeout(() => {
          flatListRef.current?.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.5 
          });
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [editingUtxoKey, sortedUtxos]);

  const addressMap = useMemo(() => new Map<string, string>([
    ...(activeWallet?.derivedReceiveAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/0/${a.index}`] as [string, string]) ?? []),
    ...(activeWallet?.derivedChangeAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/1/${a.index}`] as [string, string]) ?? [])
  ]), [activeWallet]);

  const handleOpenExplorer = (txid: string) => {
    const url = `${EXPLORER_UI_URL}/tx/${txid}`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open block explorer."));
  };

  const startEditing = (utxo: UTXO, currentLabel: string) => {
    setEditingUtxoKey(`${utxo.txid}:${utxo.vout}`);
    setEditingLabel(currentLabel);
  };

  const stopEditing = async (txid: string, vout: number) => {
    if (!editingUtxoKey) return;
    
    const labelToSave = editingLabel.trim();
    setEditingUtxoKey(null);
    Keyboard.dismiss();

    if (labelToSave.length > 0) {
      await updateUtxoLabel(txid, vout, labelToSave);
    }
  };

  const renderItem = ({ item, index }: { item: UTXO, index: number }) => {
    const derivationPath = addressMap.get(item.address);
    const key = `${item.txid}:${item.vout}`;
    const label = getUtxoLabel(item.txid, item.vout) || `UTXO`;
    const isEditing = editingUtxoKey === key;

    return (
      <View style={styles.row}>
        <View style={styles.infoContainer}>
          <View style={styles.nameContainer}>
             {isEditing ? (
                 <TextInput
                    style={styles.nameInput}
                    value={editingLabel}
                    onChangeText={setEditingLabel}
                    onBlur={() => stopEditing(item.txid, item.vout)}
                    onSubmitEditing={() => stopEditing(item.txid, item.vout)}
                    returnKeyType="done"
                    autoFocus={true}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    placeholderTextColor={theme.colors.muted}
                    underlineColorAndroid="transparent"
                 />
             ) : (
                 <TouchableOpacity 
                    style={styles.nameTouchable}
                    onPress={() => startEditing(item, label)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, bottom: 10, left: 0, right: 20 }}
                 >
                    <Text style={styles.utxoNameText}>{label}</Text>
                    <Feather name="edit" style={styles.editIcon} />
                 </TouchableOpacity>
             )}
          </View>

          <TouchableOpacity onPress={() => handleOpenExplorer(item.txid)}>
             <Text style={styles.detailText} selectable>
                {item.txid.substring(0, 4)}...{item.txid.substring(item.txid.length - 4)}:{item.vout}
             </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('AddressDetails', { address: item.address })}>
            <Text style={styles.detailText}>
                {formatAddressShort(item.address)}
            </Text>
          </TouchableOpacity>

          {derivationPath && (
            <Text style={styles.detailText}>
              {derivationPath}
            </Text>
          )}
        </View>

        <View style={styles.balanceContainer}>
          <Text style={styles.balanceText}>
            {formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text>
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0} 
      >
        <FlatList
          ref={flatListRef}
          data={sortedUtxos}
          renderItem={renderItem}
          keyExtractor={(item) => `${item.txid}:${item.vout}`}
          style={styles.flatList}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          indicatorStyle={isDark ? 'white' : 'black'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScrollToIndexFailed={(info) => {
            flatListRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true
            });
          }}
          ListEmptyComponent={
            <View style={styles.centered}>
              <Text style={styles.emptyText}>No spendable coins (UTXOs) found.</Text>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </View>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1, 
    backgroundColor: theme.colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  flatList: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  centered: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20,
    marginTop: 50,
  },
  closeButton: {
    padding: 4,
  },
  row: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 16, 
    borderBottomWidth: 1, 
    borderColor: theme.colors.border,
  },
  infoContainer: { 
    flex: 3, 
    gap: 4 
  },
  nameContainer: {
    height: 30,
    justifyContent: 'center',
    marginBottom: 2,
  },
  nameTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  utxoNameText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginRight: 8,
  },
  editIcon: {
    fontSize: 16,
    color: theme.colors.primary, 
  },
  nameInput: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    padding: 0,
    margin: 0,
    minWidth: 150,
    // borderBottomWidth removed to disable underline
  },
  detailText: { 
    fontSize: 14, 
    color: theme.colors.muted,
    fontFamily: 'monospace', 
  },
  balanceContainer: { 
    flex: 2, 
    flexDirection: 'row',
    alignItems: 'center', 
    justifyContent: 'flex-end',
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
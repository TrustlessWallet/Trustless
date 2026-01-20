import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  View, 
  StyleSheet, 
  SafeAreaView,
  TouchableOpacity, 
  Linking, 
  Alert, 
  TextInput, 
  Keyboard,
  Platform,
  Dimensions
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
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming,
  runOnJS
} from 'react-native-reanimated';

type RoutePropType = RouteProp<RootStackParamList, 'BalanceDetail'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'BalanceDetail'>;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  const editInputRef = useRef<TextInput>(null);
  const scrollY = useSharedValue(0);
  const itemRefs = useRef<Map<string, View>>(new Map());

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

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        
        if (editingUtxoKey) {
          const itemView = itemRefs.current.get(editingUtxoKey);
          if (itemView) {
            itemView.measureInWindow((x, y, width, height) => {
              const itemBottom = y + height;
              const keyboardTop = SCREEN_HEIGHT - e.endCoordinates.height;
              
              if (itemBottom > keyboardTop) {
                const scrollAmount = itemBottom - keyboardTop + 50;
                scrollY.value = withTiming(scrollY.value + scrollAmount, { duration: 250 });
              }
            });
          }
        }
      }
    );

    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        scrollY.value = withTiming(0, { duration: 250 });
      }
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [editingUtxoKey]);

  useEffect(() => {
    if (editingUtxoKey && editInputRef.current) {
      setTimeout(() => {
        editInputRef.current?.focus();
      }, 100);
    }
  }, [editingUtxoKey]);

  const animatedScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollY.value }]
  }));

  const addressMap = new Map<string, string>([
    ...(activeWallet?.derivedReceiveAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/0/${a.index}`] as [string, string]) ?? []),
    ...(activeWallet?.derivedChangeAddresses.map(a => [a.address, `${DERIVATION_PARENT_PATH}/1/${a.index}`] as [string, string]) ?? [])
  ]);

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
    
    if (editingLabel.trim().length === 0) {
      setEditingUtxoKey(null);
      return;
    }

    await updateUtxoLabel(txid, vout, editingLabel.trim());
    setEditingUtxoKey(null);
  };

  const renderItem = (item: UTXO, index: number) => {
    const derivationPath = addressMap.get(item.address);
    const key = `${item.txid}:${item.vout}`;
    const isLastItem = index === sortedUtxos.length - 1;
    const label = getUtxoLabel(item.txid, item.vout) || `UTXO`;
    const isEditing = editingUtxoKey === key;

    return (
      <View 
        key={key}
        ref={(ref) => {
          if (ref) {
            itemRefs.current.set(key, ref);
          }
        }}
        style={[
          styles.row,
          isLastItem && styles.lastRow
        ]}
      >
        <View style={styles.infoContainer}>
          
          <View style={styles.nameContainer}>
             {isEditing ? (
                 <TextInput
                    ref={editInputRef}
                    style={styles.nameInput}
                    value={editingLabel}
                    onChangeText={setEditingLabel}
                    onBlur={() => stopEditing(item.txid, item.vout)}
                    onSubmitEditing={() => stopEditing(item.txid, item.vout)}
                    returnKeyType="done"
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    placeholderTextColor={theme.colors.muted}
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
    <SafeAreaView style={styles.container}>
      <View style={styles.container}>
        <Animated.ScrollView
          style={[styles.scrollView, animatedScrollStyle]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          contentInset={{ bottom: 100 }}
          contentOffset={{ x: 0, y: 0 }}
        >
          <View style={styles.contentWrapper}>
            {sortedUtxos.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptyText}>No spendable coins (UTXOs) found.</Text>
              </View>
            ) : (
              sortedUtxos.map((item, index) => renderItem(item, index))
            )}
          </View>
        </Animated.ScrollView>
        <SafeAreaView style={styles.bottomSafeArea} />
      </View>
    </SafeAreaView>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollView: {
    flex: 1,
  },
  contentWrapper: {
    paddingBottom: 100, // Add padding to ensure content is scrollable above the bottom safe area
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  bottomSafeArea: {
    backgroundColor: theme.colors.background,
  },
  centered: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20,
    marginTop: 50,
    minHeight: 400,
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
  lastRow: {
    borderBottomWidth: 0,
  },
});

export default BalanceDetailScreen;
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import { Text } from '../components/StyledText';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { BitcoinAddress } from '../types';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';

const HIDE_TRACKER_BALANCE_KEY = '@hideTrackerBalance';

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

type DashboardScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const DashboardScreen = () => {
  const { 
    trackedAddresses, 
    loadingTrackedAddresses, 
    refreshTrackedAddressBalances, 
    removeTrackedAddress, 
    updateTrackedAddressName 
  } = useWallet();
  
  const navigation = useNavigation<DashboardScreenNavigationProp>();
  const [refreshing, setRefreshing] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);
  const isFocused = useIsFocused();
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<TextInput>(null);
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);

  useEffect(() => {
    const loadPreference = async () => {
      const savedPref = await AsyncStorage.getItem(HIDE_TRACKER_BALANCE_KEY);
      setHideBalance(savedPref === 'true');
    };
    if (isFocused) {
      loadPreference();
      // Removed refreshBalances(false); -> React Query handles this now
    }
  }, [isFocused]);

  useEffect(() => {
    if (editingAddressId) {
      editInputRef.current?.focus();
    }
  }, [editingAddressId]);

  const refreshBalances = async (isManualRefresh = true) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      await refreshTrackedAddressBalances();
    } catch (error) {
      console.error("Failed to refresh balances", error);
    }
    if (isManualRefresh) setRefreshing(false);
  };

  const handleDeleteAddress = (addressId: string) => {
    Alert.alert(
      "Delete Address",
      "Are you sure you want to stop tracking this address?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await removeTrackedAddress(addressId);
            } catch (error) {
              Alert.alert("Error", "Could not delete address.");
            }
          }
        }
      ]
    );
  };

  const handleStartEditing = (address: BitcoinAddress) => {
    setEditingAddressId(address.id);
    setEditingName(address.name || '');
  };

  const handleEndEditing = async () => {
    if (!editingAddressId) return;
    try {
      await updateTrackedAddressName(editingAddressId, editingName.trim());
    } catch (error) {
      Alert.alert("Error", "Could not update name.");
    }
    setEditingAddressId(null);
  };

  const totalBalance = trackedAddresses.reduce((sum, addr) => sum + (addr.balance || 0), 0);

  const renderAddressItem = ({ item }: { item: BitcoinAddress }) => {
    const isEditing = editingAddressId === item.id;
    return (
      <View style={styles.addressItem}>
        <View style={styles.addressInfo}>
          {isEditing ? (
            <TextInput
              ref={editInputRef}
              style={styles.addressNameInput}
              value={editingName}
              onChangeText={setEditingName}
              onBlur={handleEndEditing}
              onSubmitEditing={handleEndEditing}
              autoFocus={true}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              placeholderTextColor={theme.colors.muted}
            />
          ) : (
            <TouchableOpacity style={styles.nameContainer} onPress={() => handleStartEditing(item)}>
              <Text style={styles.addressName}>{item.name || 'Unnamed Address'}</Text>
              <Feather name="edit" style={styles.editIcon} />
            </TouchableOpacity>
          )}
           <Text style={styles.addressText}>{formatAddress(item.address)}</Text>
        </View>
        <View style={styles.balanceInfo}>
          <Text style={styles.balanceText}>
            {hideBalance ? '*******' : <>
              {formatBalance(item.balance)}
              <Text style={styles.orangeSymbol}> ₿</Text>
            </>}
          </Text>
          <TouchableOpacity onPress={() => handleDeleteAddress(item.id)} style={styles.deleteButton}>
            <Feather name="trash-2" size={18} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const EmptyComponent = () => {
    if (loadingTrackedAddresses) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No addresses added yet.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['right', 'left']}> 
      <View style={styles.balanceContainer}>
        <Text style={styles.totalLabel}>Total balance</Text>
        <Text style={styles.totalBalance}>
          {hideBalance ? '*******' : <>
            {formatBalance(totalBalance)}
            <Text style={styles.orangeSymbol}> ₿</Text>
          </>}
        </Text>
      </View>

      <FlatList
        style={styles.flatList}
        data={trackedAddresses}
        renderItem={renderAddressItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={EmptyComponent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={() => refreshBalances(true)} 
            tintColor={theme.colors.primary} 
          />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
      
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => navigation.navigate('AddAddress')}
      >
        <View style={styles.addButtonContentRow}>
          <Feather name="plus-circle" size={18} color={theme.colors.inversePrimary} />
          <Text style={styles.addButtonText}>Add address</Text>
        </View>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  flatList: {
    flex: 1, 
  },
  centered: {
    padding: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceContainer: {
    backgroundColor: theme.colors.background,
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    zIndex: 10,
  },
  totalLabel: {
    fontSize: 16,
    color: theme.colors.muted,
  },
  totalBalance: {
    fontSize: 36,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginTop: 8,
  },
  orangeSymbol: {
    color: theme.colors.bitcoin,
  },
  listContent: {
    padding: 16,
    paddingBottom: 80,
  },
  addressItem: {
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  addressInfo: {
    flex: 1,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  addressName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  editIcon: {
    fontSize: 16,
    marginLeft: 8,
    color: theme.colors.primary
  },
  addressNameInput: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 4,
  },
  addressText: {
    fontSize: 14,
    color: theme.colors.muted,
    fontFamily: 'monospace',
  },
  balanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 16,
  },
  balanceText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    color: theme.colors.muted,
    fontSize: 16,
  },
  addButton: {
    position: 'absolute',
    bottom: 32,
    right: 32,
    backgroundColor: theme.colors.primary,
    width: 160,
    height: 50,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  addButtonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});

export default DashboardScreen;
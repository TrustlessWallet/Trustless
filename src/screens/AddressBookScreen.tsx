import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, TextInput, TouchableWithoutFeedback, Keyboard, SafeAreaView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { RootStackParamList, BitcoinAddress } from '../types';

type NavProp = NativeStackNavigationProp<RootStackParamList, 'AddressBook'>;
type RoutePropType = RouteProp<RootStackParamList, 'AddressBook'>;

const formatAddress = (address: string) => {
  if (!address || address.length <= 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

const AddressBookScreen = () => {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RoutePropType>();
  const { returnScreen } = route.params || {}; 
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const { 
    savedAddresses, 
    loadingSavedAddresses, 
    removeSavedAddress,
    updateSavedAddressName
  } = useWallet();

  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (editingAddressId) {
      editInputRef.current?.focus();
    }
  }, [editingAddressId]);

  const handleSelect = (address: string) => {
    if (editingAddressId) {
      handleEndEditing();
    }
    
    if (returnScreen) {
        const state = navigation.getState();
        const previousRoute = state.routes[state.index - 1];
        
        if (previousRoute && previousRoute.name === returnScreen) {
             navigation.dispatch({
                ...CommonActions.setParams({ selectedAddress: address }),
                source: previousRoute.key,
             });
             navigation.goBack();
        } else {
             const targetRoute = state.routes.find(r => r.name === returnScreen);
             if (targetRoute) {
                 navigation.dispatch({
                    ...CommonActions.setParams({ selectedAddress: address }),
                    source: targetRoute.key,
                 });
                 navigation.navigate(returnScreen as any); 
             } else {
                 navigation.navigate({ name: returnScreen, params: { selectedAddress: address } } as any);
             }
        }
    }
  };

  const handleDelete = (item: BitcoinAddress) => {
    Alert.alert(
      "Delete Address",
      `Are you sure you want to delete "${item.name || item.address}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await removeSavedAddress(item.id);
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
      await updateSavedAddressName(editingAddressId, editingName.trim());
    } catch (error) {
      Alert.alert("Error", "Could not update name.");
    }
    setEditingAddressId(null);
  };

  const renderItem = ({ item }: { item: BitcoinAddress }) => {
    const isEditing = editingAddressId === item.id;
    return (
      <TouchableOpacity 
        style={styles.itemContainer} 
        onPress={() => handleSelect(item.address)}
        activeOpacity={0.7}
      >
        <View style={styles.itemInfo}>
          {isEditing ? (
             <TextInput
              ref={editInputRef}
              style={styles.itemNameInput}
              value={editingName}
              onChangeText={setEditingName}
              onBlur={handleEndEditing}
              onSubmitEditing={handleEndEditing}
              autoFocus={true}
              keyboardAppearance={isDark ? 'dark' : 'light'}
              placeholderTextColor={theme.colors.muted}
            />
          ) : (
            <View style={styles.nameContainer}>
              <TouchableOpacity onPress={() => handleStartEditing(item)}>
                <Text style={styles.itemName}>{item.name || 'Unnamed'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editButton} onPress={() => handleStartEditing(item)}>
                <Feather name="edit" style={styles.editIcon} />
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.itemAddress}>{formatAddress(item.address)}</Text>
        </View>
        <View style={styles.actionsContainer}>
            <TouchableOpacity style={styles.actionButton} onPress={() => handleDelete(item)}>
            <Feather name="trash-2" size={18} color={theme.colors.primary} />
            </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.container}>
        {loadingSavedAddresses ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 20 }} />
        ) : (
          <FlatList
            data={savedAddresses}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No saved addresses yet.</Text>
              </View>
            }
          />
        )}
        <View style={styles.footer}>
            <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddSavedAddress')}>
            <Feather name="plus-circle" size={20} color={theme.colors.inversePrimary} />
            <Text style={styles.addButtonText}>Add new address</Text>
            </TouchableOpacity>
        </View>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background 
  },
  list: {
    flex: 1,
    maxHeight: 500,
  },
  listContent: { 
    padding: 16,
    paddingBottom: 20,
    gap: 8,
  },
  itemContainer: { 
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 64,
  },
  itemInfo: { 
    flex: 1,
    marginRight: 16,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  itemName: { 
    fontSize: 16, 
    fontWeight: '600', 
    color: theme.colors.primary 
  },
  editButton: {
    padding: 4,
    marginLeft: 4,
  },
  editIcon: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  itemNameInput: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    paddingBottom: 0,
  },
  itemAddress: { 
    fontSize: 14, 
    color: theme.colors.muted, 
    fontFamily: 'monospace', 
    marginTop: 2 
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
  },
  footer: {
    padding: 24,
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  addButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    backgroundColor: theme.colors.primary, 
    padding: 16, 
    borderRadius: 8 
  },
  addButtonText: { 
    color: theme.colors.inversePrimary, 
    fontSize: 16, 
    fontWeight: '600' 
  },
  emptyContainer: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingTop: 40,
  },
  emptyText: { 
    fontSize: 16, 
    color: theme.colors.muted, 
  },
});

export default AddressBookScreen;
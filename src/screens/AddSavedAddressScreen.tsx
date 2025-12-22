import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useWallet } from '../contexts/WalletContext';
import { validateBitcoinAddress } from '../services/bitcoin';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { StyledInput } from '../components/StyledInput';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddSavedAddress'>;

const AddSavedAddressScreen = () => {
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { savedAddresses, addSavedAddress } = useWallet();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const navigation = useNavigation<NavigationProp>();

  const handleSaveAddress = async () => {
    const trimmedAddress = address.trim();
    if (!trimmedAddress) {
      Alert.alert('Error', 'Please enter a Bitcoin address');
      return;
    }
    if (!validateBitcoinAddress(trimmedAddress)) {
      Alert.alert('Error', 'Please enter a valid Bitcoin address');
      return;
    }
    setLoading(true);
    try {
      const existing = savedAddresses.find(a => a.address === trimmedAddress);
      if (existing) {
        Alert.alert('Address Exists', 'This address is already in your list.');
        setLoading(false);
        return;
      }
      await addSavedAddress({
        address: trimmedAddress,
        name: name.trim() || '',
        balance: 0,
        lastUpdated: new Date(),
      });
      navigation.goBack();
    } catch (error) {
      console.error('Error saving address:', error);
      Alert.alert('Error', 'Could not save the address.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanPress = () => {
    navigation.navigate('QRScanner', {
      onScanSuccess: (scannedData) => {
        setAddress(scannedData);
      },
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Label (optional)</Text>
      <StyledInput
        placeholder="e.g., My Friend's Wallet"
        value={name}
        onChangeText={setName}
        editable={!loading}
        keyboardAppearance={isDark ? 'dark' : 'light'}
        containerStyle={styles.inputSpacing}
      />
      
      <Text style={styles.label}>Bitcoin address</Text>
      <StyledInput
        placeholder="Enter or scan a Bitcoin address"
        value={address}
        onChangeText={setAddress}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance={isDark ? 'dark' : 'light'}
        editable={!loading}
        containerStyle={styles.inputSpacing}
        rightElement={
          <TouchableOpacity 
            style={styles.scanButton} 
            onPress={handleScanPress}
            disabled={loading}
          >
            <Feather name="camera" size={20} color={theme.colors.primary} />
          </TouchableOpacity>
        }
      />
      
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSaveAddress}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.inversePrimary} />
        ) : (
          <View style={styles.buttonContentRow}>
            <Feather name="plus-circle" size={18} color={theme.colors.inversePrimary} />
            <Text style={styles.buttonText}>Add address</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background,
    padding: 24 
  },
  label: { 
    fontSize: 16, 
    marginBottom: 8, 
    color: theme.colors.primary,
    fontWeight: '500' 
  },
  inputSpacing: {
    marginBottom: 24
  },
  scanButton: { 
    padding: 10 
  },
  button: { 
    backgroundColor: theme.colors.primary,
    borderRadius: 8, 
    padding: 16, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  buttonDisabled: { 
    opacity: 0.5,
  },
  buttonText: { 
    color: theme.colors.inversePrimary,
    fontSize: 16, 
    fontWeight: '600' 
  },
  buttonContentRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8 
  },
});

export default AddSavedAddressScreen;
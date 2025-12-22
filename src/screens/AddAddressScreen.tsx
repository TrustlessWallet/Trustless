import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { validateBitcoinAddress, fetchBitcoinBalance } from '../services/bitcoin';

type AddAddressScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddAddress'>;

const AddAddressScreen = () => {
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const { trackedAddresses, addTrackedAddress } = useWallet();
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const navigation = useNavigation<AddAddressScreenNavigationProp>();

  const handleAddAddress = async () => {
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
      const existingAddress = trackedAddresses.find(a => a.address === trimmedAddress);
      if (existingAddress) {
        Alert.alert(
          'Error', 
          'This address is already being tracked.',
          [{ text: 'OK', onPress: () => navigation.popToTop() }]
        );
        setLoading(false);
        return;
      }
      const initialBalance = await fetchBitcoinBalance(trimmedAddress);
      await addTrackedAddress({
        address: trimmedAddress,
        name: name.trim(),
        balance: initialBalance,
        lastUpdated: new Date(),
      });
      navigation.popToTop();
    } catch (error) {
      console.error('Error adding address:', error);
      Alert.alert('Error', 'Failed to add Bitcoin address.');
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
      <Text style={styles.label}>Address label (optional)</Text>
      <StyledInput
        placeholder="e.g., My Savings"
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
        onPress={handleAddAddress}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.inversePrimary} />
        ) : (
          <View style={styles.buttonContentRowCentered}>
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
    padding: 24, 
  },
  label: { 
    fontSize: 16, 
    marginBottom: 8, 
    color: theme.colors.primary, 
    fontWeight: '500', 
  },
  inputSpacing: {
    marginBottom: 24,
  },
  scanButton: { 
    padding: 10, 
  },
  button: { 
    backgroundColor: theme.colors.primary, 
    borderRadius: 8, 
    alignItems: 'center', 
    height: 56, 
    justifyContent: 'center', 
  },
  buttonDisabled: { 
    opacity: 0.5,
  },
  buttonText: { 
    color: theme.colors.inversePrimary, 
    fontSize: 16, 
    fontWeight: '600', 
  },
  buttonContentRowCentered: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8 
  },
});

export default AddAddressScreen;
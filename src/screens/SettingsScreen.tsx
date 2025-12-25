import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator, Linking } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { CUSTOM_NODE_URL_KEY, testNodeConnection } from '../services/bitcoin';
import { EXPLORER_API_URL, NETWORK_NAME, IS_TESTNET, setNetwork } from '../constants/network'; 
import { setAppIsAuthenticated } from '../services/authState';
import { StyledInput } from '../components/StyledInput'; 

import buildInfo from '../constants/build.json';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';
const AUTO_LOCK_TIME_KEY = '@autoLockTime';
const HIDE_TRACKER_BALANCE_KEY = '@hideTrackerBalance';
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const DEFAULT_SCREEN_KEY = '@defaultScreen';
const NETWORK_PREF_KEY = '@network_preference';

const autoLockOptions = ['Off', 0, 1, 5, 30, 60];

const getAutoLockLabel = (value: string | number): string => {
  if (value === 'Off') return 'Off';
  const minutes = typeof value === 'string' ? parseInt(value, 10) : value;
  if (minutes === 0) return 'Immediate';
  if (minutes === 1) return '1 min';
  return `${minutes} mins`;
};

const SettingsScreen = () => {
  const { resetWallet, triggerRefresh } = useWallet();
  const { theme, isDark, toggleTheme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const navigation = useNavigation<NavigationProp>();
  
  const [isBiometricsEnabled, setIsBiometricsEnabled] = useState(false);
  const [autoLockTimeIndex, setAutoLockTimeIndex] = useState(3);
  const [hideTrackerBalance, setHideTrackerBalance] = useState(false);
  const [hideWalletBalance, setHideWalletBalance] = useState(false);
  const [defaultScreen, setDefaultScreen] = useState<'Wallet' | 'Tracker'>('Wallet');
  
  const [customNodeUrl, setCustomNodeUrl] = useState('');
  const [isEditingNode, setIsEditingNode] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  
  const isFocused = useIsFocused();
  const isTogglingRef = useRef(false);

  const checkBiometricStatus = useCallback(async () => {
    if (isTogglingRef.current) return;
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const savedSetting = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
    
    if (!isEnrolled && savedSetting === 'true') {
      await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'false');
      setIsBiometricsEnabled(false);
    } else {
      setIsBiometricsEnabled(savedSetting === 'true' && isEnrolled);
    }
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      const savedLockTime = await AsyncStorage.getItem(AUTO_LOCK_TIME_KEY);
      if (savedLockTime !== null) {
        const index = autoLockOptions.findIndex(opt => opt.toString() === savedLockTime);
        if (index !== -1) setAutoLockTimeIndex(index);
      }
      
      const savedTrackerPref = await AsyncStorage.getItem(HIDE_TRACKER_BALANCE_KEY);
      setHideTrackerBalance(savedTrackerPref === 'true');
      
      const savedWalletPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
      setHideWalletBalance(savedWalletPref === 'true');
      
      const savedDefaultScreen = await AsyncStorage.getItem(DEFAULT_SCREEN_KEY);
      // Logic changed: default to Wallet if savedDefaultScreen is null or explicitly 'Wallet'
      if (savedDefaultScreen === 'Tracker') {
        setDefaultScreen('Tracker');
      } else {
        setDefaultScreen('Wallet');
      }

      const savedNode = await AsyncStorage.getItem(CUSTOM_NODE_URL_KEY);
      if (savedNode) {
        setCustomNodeUrl(savedNode);
        setConnectionStatus('connected');
      }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    if (isFocused) {
      checkBiometricStatus();
    }
  }, [isFocused, checkBiometricStatus]);

  const toggleBiometrics = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    try {
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        Alert.alert(
          "Biometrics Not Available",
          "Biometric authentication is currently not available on this device.",
          [{ text: "OK" }]
        );
        isTogglingRef.current = false;
        return;
      }
      
      const promptMessage = isBiometricsEnabled 
        ? 'Confirm your identity to disable biometric authentication'
        : 'Confirm your identity to enable biometric authentication';
        
      const result = await LocalAuthentication.authenticateAsync({ promptMessage });
      
      if (result.success) {
        const newValue = !isBiometricsEnabled;
        await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, newValue.toString());
        if (newValue) setAppIsAuthenticated(true);
        setIsBiometricsEnabled(newValue);
      }
    } catch (error) {
      Alert.alert("Error", "An unexpected error occurred.");
    } finally {
      isTogglingRef.current = false;
    }
  };

  const handleReset = () => {
    Alert.alert(
      "Reset App",
      "This will erase all wallets and saved addresses. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Reset", 
          style: "destructive",
          onPress: async () => {
            try {
              await resetWallet();
              await AsyncStorage.multiRemove([
                DEFAULT_SCREEN_KEY,
                BIOMETRICS_ENABLED_KEY,
                AUTO_LOCK_TIME_KEY, 
                HIDE_TRACKER_BALANCE_KEY,
                HIDE_WALLET_BALANCE_KEY,
                CUSTOM_NODE_URL_KEY,
                NETWORK_PREF_KEY
              ]);
              setCustomNodeUrl('');
              setConnectionStatus('idle');
              Alert.alert("App Reset", "All data has been deleted.");
            } catch (error) {
              Alert.alert("Error", "Could not complete the reset process.");
            }
          }
        }
      ]
    );
  };

  const handleAutoLockChange = async (direction: 'next' | 'prev') => {
    const newIndex = direction === 'next' 
      ? (autoLockTimeIndex + 1) % autoLockOptions.length
      : (autoLockTimeIndex - 1 + autoLockOptions.length) % autoLockOptions.length;
    
    setAutoLockTimeIndex(newIndex);
    await AsyncStorage.setItem(AUTO_LOCK_TIME_KEY, autoLockOptions[newIndex].toString());
    await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
  };

  const toggleHideTrackerBalance = async () => {
    const newValue = !hideTrackerBalance;
    setHideTrackerBalance(newValue);
    await AsyncStorage.setItem(HIDE_TRACKER_BALANCE_KEY, newValue.toString());
  };

  const toggleHideWalletBalance = async () => {
    const newValue = !hideWalletBalance;
    setHideWalletBalance(newValue);
    await AsyncStorage.setItem(HIDE_WALLET_BALANCE_KEY, newValue.toString());
  };

  const handleDefaultScreenChange = async () => {
    const newValue = defaultScreen === 'Wallet' ? 'Tracker' : 'Wallet';
    setDefaultScreen(newValue);
    await AsyncStorage.setItem(DEFAULT_SCREEN_KEY, newValue);
  };

  const handleNetworkChange = async () => {
    const newNetwork = IS_TESTNET ? 'mainnet' : 'testnet';
    const newNetworkName = IS_TESTNET ? 'Mainnet' : 'Testnet';
    
    Alert.alert(
      "Switch Network",
      `Switch to ${newNetworkName}? The app will reload and your ${newNetworkName} wallets will be loaded.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Switch", 
          onPress: async () => {
            await AsyncStorage.setItem(NETWORK_PREF_KEY, newNetwork);
            setNetwork(newNetwork); 
          }
        }
      ]
    );
  };

  const handleSaveNodeUrl = async () => {
    const trimmed = customNodeUrl.trim();
    
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(CUSTOM_NODE_URL_KEY);
      setConnectionStatus('idle');
      Alert.alert("Reset", "Custom node removed. Reverted to default providers.");
      setIsEditingNode(false);
      triggerRefresh();
      return;
    }

    if (!trimmed.startsWith('http')) {
      Alert.alert("Invalid URL", "URL must start with http:// or https://.");
      return;
    }

    setConnectionStatus('testing');
    const isConnected = await testNodeConnection(trimmed);
    
    if (isConnected) {
      setConnectionStatus('connected');
      await AsyncStorage.setItem(CUSTOM_NODE_URL_KEY, trimmed);
      setIsEditingNode(false);
      Keyboard.dismiss();
      triggerRefresh();
      Alert.alert("Success", "Connected to custom node successfully.");
    } else {
      setConnectionStatus('failed');
      Alert.alert(
        "Connection Failed", 
        `Could not connect to the provided node or it is not on ${NETWORK_NAME}.`
      );
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Settings</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Theme</Text>
            <TouchableOpacity onPress={toggleTheme}>
              <View style={styles.switcher}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                <Text style={styles.switcherText}>{isDark ? 'Dark' : 'Light'}</Text>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Bitcoin Network</Text>
            <TouchableOpacity onPress={handleNetworkChange}>
              <View style={styles.switcher}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                <Text style={[styles.switcherText, { color: IS_TESTNET ? theme.colors.bitcoin : theme.colors.primary }]}>
                  {NETWORK_NAME}
                </Text>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Default Screen</Text>
            <TouchableOpacity onPress={handleDefaultScreenChange}>
              <View style={styles.switcher}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                <Text style={styles.switcherText}>{defaultScreen}</Text>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>

          <View style={styles.col}>
            <TouchableOpacity 
              style={styles.rowNoBorder} 
              onPress={() => setIsEditingNode(!isEditingNode)}
            >
              <View style={styles.rowHeaderGroup}>
                <Text style={styles.rowLabel}>Custom Node URL</Text>
                <View style={styles.statusRow}>
                  {connectionStatus === 'testing' && (
                    <View style={styles.testingContainer}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <Text style={styles.statusText}>Testing...</Text>
                    </View>
                  )}
                  {connectionStatus === 'connected' && <Text style={[styles.statusText, { color: theme.colors.bitcoin }]}>● Connected</Text>}
                  {connectionStatus === 'failed' && <Text style={[styles.statusText, { color: theme.colors.error }]}>● Failed</Text>}
                </View>
              </View>
              <Feather 
                name={isEditingNode ? "chevron-up" : "chevron-down"} 
                size={24} 
                color={theme.colors.primary} 
              />
            </TouchableOpacity>
            
            {isEditingNode && (
              <View style={styles.nodeInputContainer}>
                <Text style={styles.helperText}>
                  Enter Mempool/Esplora API URL for {NETWORK_NAME}.
                </Text>
                <StyledInput
                  containerStyle={styles.inputSpacing}
                  value={customNodeUrl}
                  onChangeText={(text) => {
                    setCustomNodeUrl(text);
                    if (connectionStatus === 'failed') setConnectionStatus('idle');
                  }}
                  placeholder={EXPLORER_API_URL}
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  textContentType="none"
                  autoCorrect={false}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                />
                <TouchableOpacity 
                  style={[styles.saveButton, connectionStatus === 'testing' && styles.disabledButton]}
                  onPress={handleSaveNodeUrl}
                  disabled={connectionStatus === 'testing'}
                >
                  <Feather name="save" size={16} color={theme.colors.inversePrimary} />
                  <Text style={styles.saveButtonText}>Save & Apply</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Hide Tracker Balance</Text>
            <TouchableOpacity onPress={toggleHideTrackerBalance}>
              <View style={styles.switcher}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                <Text style={styles.switcherText}>{hideTrackerBalance ? 'On' : 'Off'}</Text>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Hide Wallet Balance</Text>
            <TouchableOpacity onPress={toggleHideWalletBalance}>
              <View style={styles.switcher}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                <Text style={styles.switcherText}>{hideWalletBalance ? 'On' : 'Off'}</Text>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.row}>
            <Text style={styles.rowLabel}>Enable Biometrics</Text>
            <View style={styles.switcher}>
              <TouchableOpacity onPress={toggleBiometrics}>
                <Feather name="chevron-left" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
              <Text style={styles.switcherText}>{isBiometricsEnabled ? 'On' : 'Off'}</Text>
              <TouchableOpacity onPress={toggleBiometrics}>
                <Feather name="chevron-right" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {isBiometricsEnabled && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Auto Lock</Text>
              <View style={styles.switcher}>
                <TouchableOpacity onPress={() => handleAutoLockChange('prev')}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                </TouchableOpacity>
                <Text style={styles.switcherText}>{getAutoLockLabel(autoLockOptions[autoLockTimeIndex])}</Text>
                <TouchableOpacity onPress={() => handleAutoLockChange('next')}>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <TouchableOpacity 
            style={styles.row}
            onPress={() => Linking.openURL('https://github.com/pechen987/Trustless')}
          >
            <Text style={styles.rowLabel}>Github</Text>
            <Feather name="chevron-right" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.row}
            onPress={() => navigation.navigate('PrivacyPolicy')}
          >
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <Feather name="chevron-right" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.row}
            onPress={() => navigation.navigate('TermsConditions')}
          >
            <Text style={styles.rowLabel}>Terms & Conditions</Text>
            <Feather name="chevron-right" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
           {/* Added Support Row */}
           <TouchableOpacity 
            style={styles.row}
            onPress={() => navigation.navigate('Support' as any)}
          >
            <Text style={styles.rowLabel}>Support Trustless</Text>
            <Feather name="heart" size={24} color={theme.colors.bitcoin} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Danger Zone</Text>
          <TouchableOpacity 
            style={styles.buttonContainer}
            onPress={handleReset}
          >
            <View style={styles.button}>
              <View style={styles.buttonContentRowCentered}>
                <Feather name="alert-triangle" size={16} color={theme.colors.inversePrimary} />
                <Text style={styles.buttonText}>Reset App</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>
            Version 1.0.0
          </Text>
          <Text style={styles.commitText}>
            Commit: {buildInfo?.commitHash || 'Unknown'}
          </Text>
          <Text style={styles.commitText}>
            Built: {buildInfo?.buildDate ? new Date(buildInfo.buildDate).toLocaleDateString() : 'Unknown'}
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const getStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  contentContainer: {
    padding: 24,
    flexGrow: 1,
    paddingBottom: 40,
    paddingTop: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowNoBorder: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  col: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: {
    fontSize: 16,
    color: theme.colors.muted,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switcherText: {
    fontSize: 16,
    fontWeight: '600',
    minWidth: 90,
    textAlign: 'center',
    color: theme.colors.primary,
  },
  buttonContainer: {
    alignSelf: 'flex-start',
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {
    color: theme.colors.inversePrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  buttonContentRowCentered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  nodeInputContainer: {
    marginTop: 4,
    marginBottom: 16,
  },
  helperText: {
    fontSize: 12,
    color: theme.colors.muted,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  inputSpacing: {
    marginBottom: 8,
  },
  saveButton: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  disabledButton: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: theme.colors.inversePrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  rowHeaderGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.muted,
  },

  versionContainer: {
    alignItems: 'center',
    marginTop: 16,
    opacity: 0.6,
  },
  versionText: {
    fontSize: 12,
    color: theme.colors.muted,
    marginBottom: 2,
  },
  commitText: {
    fontSize: 12,
    color: theme.colors.muted,
    fontFamily: 'SpaceMono-Regular',
  }
});

export default SettingsScreen;
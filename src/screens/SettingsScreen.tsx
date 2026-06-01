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
import { NETWORK_NAME, IS_TESTNET, setNetwork } from '../constants/network'; 
import { StyledInput } from '../components/StyledInput'; 
import { getElectrumClient, resetActiveConnection, getActiveHostName, test_custom_node_connection } from '../services/electrum';

import build_info from '../constants/build.json';

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';
const AUTO_LOCK_TIME_KEY = '@autoLockTime';
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const DEFAULT_SCREEN_KEY = '@defaultScreen';
const NETWORK_PREF_KEY = '@network_preference';
const CUSTOM_NODE_URL_KEY = '@customNodeUrl';
const ALLOW_SELF_SIGNED_KEY = '@allowSelfSigned';
const DEFAULT_WALLET_MODE_KEY = '@defaultWalletMode';

const auto_lock_options = ['Off', 0, 1, 5, 30, 60];

const get_auto_lock_label = (value: string | number): string => {
  if (value === 'Off') return 'Off';
  const minutes = typeof value === 'string' ? parseInt(value, 10) : value;
  if (minutes === 0) return 'Immediate';
  if (minutes === 1) return '1 min';
  return `${minutes} mins`;
};

const SettingsScreen = () => {
  const {
    resetWallet,
    triggerRefresh,
    activeWallet,
    isLightningInitialized,
    lightningInitAttempted,
    lightningApiKeyPresent,
    lightningInitError,
  } = useWallet();
  const { theme, isDark, toggleTheme } = useTheme();
  const styles = useMemo(() => get_styles(theme), [theme]);
  const navigation = useNavigation<navigation_prop>();
  
  const [is_biometrics_enabled, set_is_biometrics_enabled] = useState(false);
  const [auto_lock_time_index, set_auto_lock_time_index] = useState(3);
  const [hide_wallet_balance, set_hide_wallet_balance] = useState(false);
  const [default_screen, set_default_screen] = useState<'Wallet'>('Wallet');
  const [default_wallet_mode, set_default_wallet_mode] = useState<'On-chain' | 'Lightning'>('On-chain');
  
  const [custom_node_url, set_custom_node_url] = useState('');
  const [allow_self_signed, set_allow_self_signed] = useState(false);
  const [is_editing_node, set_is_editing_node] = useState(false);
  const [connection_status, set_connection_status] = useState<'idle' | 'testing' | 'connected' | 'failed'>('idle');
  const [active_host, set_active_host] = useState<string | null>(null);
  const [is_viewing_lightning_status, set_is_viewing_lightning_status] = useState(false);
  
  const is_focused = useIsFocused();
  const is_toggling_ref = useRef(false);

  const check_biometric_status = useCallback(async () => {
    if (is_toggling_ref.current) return;
    const is_enrolled = await LocalAuthentication.isEnrolledAsync();
    const saved_setting = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
    
    if (!is_enrolled && saved_setting === 'true') {
      await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'false');
      set_is_biometrics_enabled(false);
    } else {
      set_is_biometrics_enabled(saved_setting === 'true' && is_enrolled);
    }
  }, []);

  useEffect(() => {
    const load_settings = async () => {
      const saved_lock_time = await AsyncStorage.getItem(AUTO_LOCK_TIME_KEY);
      if (saved_lock_time !== null) {
        const index = auto_lock_options.findIndex(opt => opt.toString() === saved_lock_time);
        if (index !== -1) set_auto_lock_time_index(index);
      }
      
      const saved_wallet_pref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
      set_hide_wallet_balance(saved_wallet_pref === 'true');

      const saved_wallet_mode = await AsyncStorage.getItem(DEFAULT_WALLET_MODE_KEY);
      if (saved_wallet_mode === 'Lightning') {
        set_default_wallet_mode('Lightning');
      } else {
        set_default_wallet_mode('On-chain');
      }

      const saved_node = await AsyncStorage.getItem(CUSTOM_NODE_URL_KEY);
      const saved_self_signed = await AsyncStorage.getItem(ALLOW_SELF_SIGNED_KEY);
      
      if (saved_node) {
        set_custom_node_url(saved_node);
        set_connection_status('connected');
      }
      
      if (saved_self_signed === 'true') {
        set_allow_self_signed(true);
      }

      set_active_host(getActiveHostName());
    };
    load_settings();
  }, []);

  useEffect(() => {
    if (is_focused) {
      check_biometric_status();
      set_active_host(getActiveHostName());
    }
  }, [is_focused, check_biometric_status]);

  const toggle_biometrics = async () => {
    if (is_toggling_ref.current) return;
    is_toggling_ref.current = true;
    try {
      const is_enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!is_enrolled) {
        Alert.alert(
          "Biometrics Not Available",
          "Biometric authentication is currently not available on this device.",
          [{ text: "OK" }]
        );
        is_toggling_ref.current = false;
        return;
      }
      
      const prompt_message = is_biometrics_enabled 
        ? 'Confirm your identity to disable biometric authentication'
        : 'Confirm your identity to enable biometric authentication';
        
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt_message });
      
      if (result.success) {
        const new_value = !is_biometrics_enabled;
        await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, new_value.toString());
        set_is_biometrics_enabled(new_value);
      }
    } catch (error) {
      Alert.alert("Error", "An unexpected error occurred.");
    } finally {
      is_toggling_ref.current = false;
    }
  };

  const handle_reset = () => {
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
              await AsyncStorage.multiRemove([
                '@hasCompletedOnboarding',
                DEFAULT_SCREEN_KEY,
                DEFAULT_WALLET_MODE_KEY,
                BIOMETRICS_ENABLED_KEY,
                AUTO_LOCK_TIME_KEY, 
                HIDE_WALLET_BALANCE_KEY,
                CUSTOM_NODE_URL_KEY,
                ALLOW_SELF_SIGNED_KEY,
                NETWORK_PREF_KEY,
                '@lastActiveTime'
              ]);

              set_custom_node_url('');
              set_allow_self_signed(false);
              set_connection_status('idle');
              set_default_wallet_mode('On-chain');
              resetActiveConnection();

              await resetWallet();
              
              Alert.alert("App Reset", "All data has been deleted.");
            } catch (error) {
              Alert.alert("Error", "Could not complete the reset process.");
            }
          }
        }
      ]
    );
  };

  const handle_auto_lock_change = async (direction: 'next' | 'prev') => {
    const new_index = direction === 'next' 
      ? (auto_lock_time_index + 1) % auto_lock_options.length
      : (auto_lock_time_index - 1 + auto_lock_options.length) % auto_lock_options.length;
    
    set_auto_lock_time_index(new_index);
    await AsyncStorage.setItem(AUTO_LOCK_TIME_KEY, auto_lock_options[new_index].toString());
    await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
  };

  const toggle_hide_wallet_balance = async () => {
    const new_value = !hide_wallet_balance;
    set_hide_wallet_balance(new_value);
    await AsyncStorage.setItem(HIDE_WALLET_BALANCE_KEY, new_value.toString());
  };

  const toggle_default_wallet_mode = async () => {
    const new_mode = default_wallet_mode === 'On-chain' ? 'Lightning' : 'On-chain';
    set_default_wallet_mode(new_mode);
    await AsyncStorage.setItem(DEFAULT_WALLET_MODE_KEY, new_mode);
  };

  const handle_network_change = async () => {
    const new_network = IS_TESTNET ? 'mainnet' : 'testnet';
    const new_network_name = IS_TESTNET ? 'Mainnet' : 'Testnet';
    
    Alert.alert(
      "Switch Network",
      `Switch to ${new_network_name}? The app will reload and your ${new_network_name} wallets will be loaded.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Switch", 
          onPress: async () => {
            await AsyncStorage.setItem(NETWORK_PREF_KEY, new_network);
            setNetwork(new_network); 
          }
        }
      ]
    );
  };

  const handle_save_node_url = async () => {
    const trimmed = custom_node_url.trim().replace(/^https?:\/\//, '');
    
    if (trimmed.length === 0) {
      await AsyncStorage.removeItem(CUSTOM_NODE_URL_KEY);
      await AsyncStorage.removeItem(ALLOW_SELF_SIGNED_KEY);
      set_connection_status('idle');
      set_is_editing_node(false);
      resetActiveConnection();
      triggerRefresh();
      setTimeout(() => set_active_host(getActiveHostName()), 1500);
      Alert.alert("Reset", "Custom node removed. Reverted to default providers.");
      return;
    }

    const parts = trimmed.split(':');
    if (parts.length < 2) {
      Alert.alert(
        "Invalid Format", 
        "Please use the format: host:port:protocol\n\nExample:\n192.168.1.50:50002:tls"
      );
      return;
    }

    set_connection_status('testing');
    
    const is_connected = await test_custom_node_connection(trimmed, allow_self_signed);

    if (is_connected) {
      await AsyncStorage.setItem(CUSTOM_NODE_URL_KEY, trimmed);
      await AsyncStorage.setItem(ALLOW_SELF_SIGNED_KEY, allow_self_signed ? 'true' : 'false');
      
      resetActiveConnection();
      await getElectrumClient(); 
      
      set_connection_status('connected');
      set_is_editing_node(false);
      Keyboard.dismiss();
      triggerRefresh();
      set_active_host(getActiveHostName());
      Alert.alert("Success", "Connected to custom node successfully.");
    } else {
      set_connection_status('failed');
      Alert.alert(
        "Connection Failed", 
        `Could not connect to ${trimmed}.\n\nThe node might be offline, or you have a typo. The app will continue using the active node.`
      );
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: theme.colors.background }}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content_container} keyboardShouldPersistTaps="handled" bounces={false}>
        
        <View style={styles.section}>
          <Text style={styles.section_title}>App Settings</Text>
          
          <View style={styles.row_wrapper}>
            <View style={styles.row}>
              <Text style={styles.row_label}>Theme</Text>
              <TouchableOpacity onPress={toggleTheme}>
                <View style={styles.switcher}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  <Text style={styles.switcher_text}>{isDark ? 'Dark' : 'Light'}</Text>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.row_wrapper}>
            <View style={styles.row}>
              <Text style={styles.row_label}>Default Wallet Mode</Text>
              <TouchableOpacity onPress={toggle_default_wallet_mode}>
                <View style={styles.switcher}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  <Text style={styles.switcher_text}>{default_wallet_mode}</Text>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.row_wrapper}>
            <View style={styles.row}>
              <Text style={styles.row_label}>Bitcoin Network</Text>
              <TouchableOpacity onPress={handle_network_change}>
                <View style={styles.switcher}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  <Text style={[styles.switcher_text, { color: IS_TESTNET ? theme.colors.bitcoin : theme.colors.primary }]}>
                    {NETWORK_NAME}
                  </Text>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.section_title}>Security & Network</Text>

          <View style={styles.col}>
            <TouchableOpacity
              style={styles.row_no_border}
              onPress={() => set_is_viewing_lightning_status(!is_viewing_lightning_status)}
            >
              <Text style={styles.row_label}>Lightning status</Text>
              <Feather
                name={is_viewing_lightning_status ? 'chevron-up' : 'chevron-down'}
                size={24}
                color={theme.colors.primary}
              />
            </TouchableOpacity>

            {is_viewing_lightning_status && (
              <View style={styles.lightning_details_container}>
                <Text style={styles.lightning_details_text}>
                  Status: {(() => {
                    if (!activeWallet) return 'No wallet';
                    if (activeWallet.type === 'watch-only') return 'Disabled';
                    if (isLightningInitialized) return 'Working';
                    if (!lightningApiKeyPresent) return 'Needs API key';
                    if (lightningInitError) return 'Needs attention';
                    if (!lightningInitAttempted) return 'Not started';
                    return 'Not ready';
                  })()}
                </Text>
                <Text style={styles.lightning_details_text}>
                  Wallet: {activeWallet ? (activeWallet.type === 'watch-only' ? 'Watch-only' : 'Standard') : 'None'}
                </Text>
                <Text style={styles.lightning_details_text}>
                  Initialized: {isLightningInitialized ? 'Yes' : 'No'}
                </Text>
                <Text style={styles.lightning_details_text}>
                  Breez API key: {lightningApiKeyPresent ? 'Present' : 'Missing'}
                </Text>
                <Text style={styles.lightning_details_text}>
                  Init attempted: {lightningInitAttempted ? 'Yes' : 'No'}
                </Text>
                {!!lightningInitError && (
                  <Text style={styles.lightning_details_text} numberOfLines={4}>
                    Error: {lightningInitError}
                  </Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.col}>
            <TouchableOpacity 
              style={styles.row_no_border} 
              onPress={() => set_is_editing_node(!is_editing_node)}
            >
              <View style={styles.row_header_group}>
                <Text style={styles.row_label}>Custom Node URL</Text>
                <View style={styles.status_row}>
                  {connection_status === 'testing' && (
                    <View style={styles.testing_container}>
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                      <Text style={styles.status_text}>Testing...</Text>
                    </View>
                  )}
                  {connection_status === 'connected' && <Text style={[styles.status_text, { color: theme.colors.bitcoin }]}>● Connected</Text>}
                  {connection_status === 'failed' && <Text style={[styles.status_text, { color: theme.colors.error }]}>● Failed</Text>}
                </View>
              </View>
              <Feather 
                name={is_editing_node ? "chevron-up" : "chevron-down"} 
                size={24} 
                color={theme.colors.primary} 
              />
            </TouchableOpacity>
            
            {is_editing_node && (
              <View style={styles.node_input_container}>

                <Text style={styles.helper_text}>
                  Connect to your own Electrum server or a public node.
                </Text>

                <StyledInput
                  containerStyle={styles.input_spacing}
                  value={custom_node_url}
                  onChangeText={(text) => {
                    set_custom_node_url(text);
                    if (connection_status === 'failed') set_connection_status('idle');
                  }}
                  placeholder="host:port:protocol"
                  placeholderTextColor={theme.colors.muted}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  textContentType="none"
                  autoCorrect={false}
                  keyboardAppearance={isDark ? 'dark' : 'light'}
                />

                <View style={styles.status_banner}>
                  <Text style={styles.banner_text}>Active node: {active_host || 'Disconnected'}</Text>
                </View>

                <TouchableOpacity 
                  style={styles.checkbox_row}
                  onPress={() => set_allow_self_signed(!allow_self_signed)}
                >
                  <Feather 
                    name={allow_self_signed ? "check-square" : "square"} 
                    size={20} 
                    color={theme.colors.primary} 
                  />
                  <Text style={styles.checkbox_label}>Allow self-signed certificates</Text>
                </TouchableOpacity>


                
                <TouchableOpacity 
                  style={[styles.save_button, connection_status === 'testing' && styles.disabled_button]}
                  onPress={handle_save_node_url}
                  disabled={connection_status === 'testing'}
                >
                  <Feather name="save" size={16} color={theme.colors.inversePrimary} />
                  <Text style={styles.save_button_text}>Save & apply</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          <View style={styles.row_wrapper}>
            <View style={styles.row}>
              <Text style={styles.row_label}>Hide Wallet Balance</Text>
              <TouchableOpacity onPress={toggle_hide_wallet_balance}>
                <View style={styles.switcher}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  <Text style={styles.switcher_text}>{hide_wallet_balance ? 'On' : 'Off'}</Text>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.row_wrapper}>
            <View style={styles.row}>
              <Text style={styles.row_label}>Enable Biometrics</Text>
              <TouchableOpacity onPress={toggle_biometrics}>
                <View style={styles.switcher}>
                  <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  <Text style={styles.switcher_text}>{is_biometrics_enabled ? 'On' : 'Off'}</Text>
                  <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {is_biometrics_enabled && (
            <View style={styles.row_wrapper}>
              <View style={styles.row}>
                <Text style={styles.row_label}>Auto Lock</Text>
                <View style={styles.switcher}>
                  <TouchableOpacity onPress={() => handle_auto_lock_change('prev')}>
                    <Feather name="chevron-left" size={24} color={theme.colors.primary} />
                  </TouchableOpacity>
                  <Text style={styles.switcher_text}>{get_auto_lock_label(auto_lock_options[auto_lock_time_index])}</Text>
                  <TouchableOpacity onPress={() => handle_auto_lock_change('next')}>
                    <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.section_title}>About</Text>
          
          <View style={styles.row_wrapper}>
            <TouchableOpacity 
              style={styles.row}
              onPress={() => Linking.openURL('https://github.com/TrustlessWallet/Trustless')}
            >
              <Text style={styles.row_label}>GitHub</Text>
              <Feather name="chevron-right" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.row_wrapper}>
            <TouchableOpacity 
              style={styles.row}
              onPress={() => Linking.openURL('https://tally.so/r/Y5RyOz')}
            >
              <Text style={styles.row_label}>Contact us</Text>
              <Feather name="chevron-right" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.row_wrapper}>
            <TouchableOpacity 
              style={styles.row}
              onPress={() => navigation.navigate('PrivacyPolicy')}
            >
              <Text style={styles.row_label}>Privacy Policy</Text>
              <Feather name="chevron-right" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.row_wrapper}>
            <TouchableOpacity 
              style={styles.row}
              onPress={() => navigation.navigate('TermsConditions')}
            >
              <Text style={styles.row_label}>Terms & Conditions</Text>
              <Feather name="chevron-right" size={24} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.row_wrapper}>
           <TouchableOpacity 
            style={styles.row}
            onPress={() => navigation.navigate('Support' as any)}
          >
            <Text style={styles.row_label}>Support Trustless</Text>
            <Feather name="heart" size={24} color={theme.colors.bitcoin} />
          </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.section_title}>Danger Zone</Text>
          <TouchableOpacity 
            style={styles.button_container}
            onPress={handle_reset}
          >
            <View style={styles.button}>
              <View style={styles.button_content_row_centered}>
                <Feather name="alert-triangle" size={16} color={theme.colors.inversePrimary} />
                <Text style={styles.button_text}>Reset App</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.version_container}>
          <Text style={styles.version_text}>
            Version 2.0.2
          </Text>
          <Text style={styles.commit_text}>
            Commit: {build_info?.commitHash || 'Unknown'}
          </Text>
          <Text style={styles.commit_text}>
            Built: {build_info?.buildDate ? new Date(build_info.buildDate).toLocaleDateString() : 'Unknown'}
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const get_styles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content_container: {
    padding: 24,
    flexGrow: 1,
    paddingBottom: 40,
    paddingTop: 32,
  },
  section: {
    marginBottom: 32,
  },
  section_title: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: 16,
  },
  row_wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  row_no_border: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  col: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  row_label: {
    fontSize: 16,
    color: theme.colors.muted,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  switcher_text: {
    fontSize: 16,
    minWidth: 90,
    textAlign: 'center',
    color: theme.colors.primary,
  },
  button_container: {
    alignSelf: 'flex-start',
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  button_text: {
    color: theme.colors.inversePrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  button_content_row_centered: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  node_input_container: {
    marginTop: 4,
    marginBottom: 16,
  },
  status_banner: {
    paddingVertical: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  banner_text: {
    fontSize: 12,
    color: theme.colors.muted,
    fontFamily: 'monospace',
  },
  helper_text: {
    fontSize: 12,
    color: theme.colors.muted,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  input_spacing: {
    marginBottom: 1,
  },
  checkbox_row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 8,
  },
  checkbox_label: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  save_button: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  disabled_button: {
    opacity: 0.5,
  },
  save_button_text: {
    color: theme.colors.inversePrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  row_header_group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  status_row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  testing_container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status_text: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.muted,
  },
  lightning_details_container: {
    marginTop: 4,
    marginBottom: 16,
  },
  lightning_details_text: {
    fontSize: 12,
    color: theme.colors.muted,
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  version_container: {
    alignItems: 'center',
    marginTop: 16,
    opacity: 0.6,
  },
  version_text: {
    fontSize: 12,
    color: theme.colors.muted,
    marginBottom: 2,
  },
  commit_text: {
    fontSize: 12,
    color: theme.colors.muted,
    fontFamily: 'SpaceMono-Regular',
  }
});

export default SettingsScreen;
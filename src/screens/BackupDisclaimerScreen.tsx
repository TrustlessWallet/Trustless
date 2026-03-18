import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, AppState } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { set_biometric_prompt_shown, set_backup_flow_active } from '../services/authState';
import { useFocusEffect } from '@react-navigation/native';

type navigation_prop = NativeStackNavigationProp<any>;
type route_prop_type = RouteProp<RootStackParamList, 'BackupDisclaimer'>;

const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';

const BulletPoint = ({ text, theme }: { text: string, theme: Theme }) => (
    <View style={get_styles(theme).bullet_container}>
        <Text style={get_styles(theme).bullet}>•</Text>
        <Text style={get_styles(theme).bullet_text}>{text}</Text>
    </View>
);

const BackupDisclaimerScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { walletId } = route.params;
    const { getMnemonicForWallet } = useWallet();
    const [is_loading_phrase, set_is_loading_phrase] = useState(false);
    const [is_loading_qr, set_is_loading_qr] = useState(false);
    const { theme } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);

    // Reset biometric flag when user returns to this screen
    useFocusEffect(
        React.useCallback(() => {
            // Only clear flags if app is in active state
            if (AppState.currentState === 'active') {
                set_backup_flow_active(false);
                set_biometric_prompt_shown(false);
            } else {
                // Wait for app to become active before clearing flags
                const subscription = AppState.addEventListener('change', (nextState: string) => {
                    if (nextState === 'active') {
                        set_backup_flow_active(false);
                        set_biometric_prompt_shown(false);
                        subscription?.remove();
                    }
                });
            }
            
            return () => {
                // Cleanup will be handled by subscription.remove()
            };
        }, [])
    );

    const authenticate_and_fetch = async (destination: string) => {
        try {
            const saved_setting = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
            
            // Start backup flow to prevent privacy overlay during entire process
            set_backup_flow_active(true);
            
            if (saved_setting === 'true') {
                // Set flag to prevent privacy overlay during biometric prompt
                set_biometric_prompt_shown(true);
                
                const auth_result = await LocalAuthentication.authenticateAsync({
                    promptMessage: 'Authenticate to view your recovery phrase',
                    fallbackLabel: 'Use Passcode',
                });
                
                if (!auth_result.success) {
                    // Reset flags immediately on failure
                    set_biometric_prompt_shown(false);
                    set_backup_flow_active(false);
                    return; 
                }
            }

            if (destination === 'ShowMnemonic') {
                set_is_loading_phrase(true);
            } else {
                set_is_loading_qr(true);
            }

            const mnemonic = await getMnemonicForWallet(walletId);
            
            set_is_loading_phrase(false);
            set_is_loading_qr(false);

            if (mnemonic) {
                // Navigate to mnemonic screen
                navigation.navigate(destination, { mnemonic, mode: 'backup' });
            } else {
                // Reset flags on error
                set_biometric_prompt_shown(false);
                set_backup_flow_active(false);
                Alert.alert("Error", "Could not retrieve recovery phrase for this wallet.");
            }
        } catch (error) {
            set_is_loading_phrase(false);
            set_is_loading_qr(false);
            // Reset flags in case of error
            set_biometric_prompt_shown(false);
            set_backup_flow_active(false);
            Alert.alert("Error", "An error occurred during authentication.");
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Backup recovery phrase</Text>
            <View style={styles.bullets_wrapper}>
                <BulletPoint text="You are about to view your secret recovery phrase." theme={theme} />
                <BulletPoint text="Ensure no one else is looking at your screen." theme={theme} />
                <BulletPoint text="This phrase is the only way to recover your funds." theme={theme} />
            </View>
            
            <View style={styles.buttons_wrapper}>
                <TouchableOpacity 
                    style={styles.button_primary} 
                    onPress={() => authenticate_and_fetch('ShowMnemonic')} 
                    disabled={is_loading_phrase || is_loading_qr}
                >
                    {is_loading_phrase ? (
                        <ActivityIndicator color={theme.colors.inversePrimary} />
                    ) : (
                        <View style={styles.button_content_row_centered}>
                            <Feather name="eye" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.button_text_primary}>Show phrase</Text>
                        </View>
                    )}
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.button_secondary} 
                    onPress={() => authenticate_and_fetch('ShowMnemonicQR')} 
                    disabled={is_loading_phrase || is_loading_qr}
                >
                    {is_loading_qr ? (
                        <ActivityIndicator color={theme.colors.primary} />
                    ) : (
                        <View style={styles.button_content_row_centered}>
                            <Feather name="grid" size={18} color={theme.colors.primary} />
                            <Text style={styles.button_text_secondary}>Show QR code</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
    container: { 
      flex: 1, 
      justifyContent: 'center', 
      padding: 24, 
      backgroundColor: theme.colors.background
    },
    title: { 
      fontSize: 24, 
      fontWeight: 'bold', 
      textAlign: 'center', 
      marginBottom: 24,
      color: theme.colors.primary
    },
    bullets_wrapper: { 
      alignSelf: 'center', 
      marginBottom: 32, 
      width: '90%' 
    },
    bullet_container: { 
      flexDirection: 'row', 
      alignItems: 'flex-start', 
      marginBottom: 16 
    },
    bullet: { 
      fontSize: 22, 
      marginRight: 12, 
      lineHeight: 28,
      color: theme.colors.primary
    },
    bullet_text: { 
      flex: 1, 
      fontSize: 18, 
      color: theme.colors.primary,
      lineHeight: 28 
    },
    buttons_wrapper: {
      gap: 16,
      width: '100%',
    },
    button_primary: { 
      backgroundColor: theme.colors.primary,
      paddingVertical: 16, 
      borderRadius: 8, 
      width: '100%',
      minHeight: 56
    },
    button_secondary: {
      backgroundColor: 'transparent',
      borderColor: theme.colors.primary,
      borderWidth: 1,
      paddingVertical: 16, 
      borderRadius: 8, 
      width: '100%',
      minHeight: 56
    },
    button_text_primary: { 
      color: theme.colors.inversePrimary,
      fontSize: 16, 
      fontWeight: '600', 
      textAlign: 'center' 
    },
    button_text_secondary: { 
      color: theme.colors.primary,
      fontSize: 16, 
      fontWeight: '600', 
      textAlign: 'center' 
    },
    button_content_row_centered: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      justifyContent: 'center', 
      gap: 8 
    },
});

export default BackupDisclaimerScreen;
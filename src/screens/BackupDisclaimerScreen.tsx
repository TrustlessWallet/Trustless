import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { begin_biometric_prompt } from '../services/authState';
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
    const request_id = useRef(0);
    const focused = useRef(false);
    const mounted = useRef(true);
    const cancel_active_wait = useRef<(() => void) | null>(null);
    const { theme } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);

    useFocusEffect(
        React.useCallback(() => {
            focused.current = true;
            return () => {
                focused.current = false;
                ++request_id.current;
                cancel_active_wait.current?.();
            };
        }, [])
    );

    useEffect(() => {
        mounted.current = true;
        const subscription = AppState.addEventListener('change', nextState => {
            if (nextState === 'background') {
                ++request_id.current;
                cancel_active_wait.current?.();
                set_is_loading_phrase(false);
                set_is_loading_qr(false);
            }
        });
        return () => {
            mounted.current = false;
            ++request_id.current;
            cancel_active_wait.current?.();
            subscription.remove();
        };
    }, []);

    const is_current = (id: number) =>
        mounted.current && focused.current && request_id.current === id && AppState.currentState !== 'background';

    const wait_until_active = async (): Promise<boolean> => {
        if (AppState.currentState === 'active') return true;
        return new Promise(resolve => {
            let settled = false;
            const finish = (active: boolean) => {
                if (settled) return;
                settled = true;
                subscription.remove();
                cancel_active_wait.current = null;
                resolve(active);
            };
            const subscription = AppState.addEventListener('change', state => {
                if (state === 'active' || state === 'background') {
                    finish(state === 'active');
                }
            });
            cancel_active_wait.current = () => finish(false);
        });
    };

    const authenticate_and_fetch = async (destination: string) => {
        const id = ++request_id.current;
        if (destination === 'ShowMnemonic') set_is_loading_phrase(true);
        else set_is_loading_qr(true);
        try {
            const saved_setting = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
            if (!is_current(id)) return;
            if (saved_setting === 'true') {
                const end_prompt = begin_biometric_prompt();
                let authenticated = false;
                try {
                    const auth_result = await LocalAuthentication.authenticateAsync({
                        promptMessage: 'Authenticate to view your recovery phrase',
                        fallbackLabel: 'Use Passcode',
                    });
                    authenticated = auth_result.success === true;
                } finally {
                    end_prompt();
                }
                if (!authenticated || !is_current(id) || !await wait_until_active() || !is_current(id)) return;
            }

            const mnemonic = await getMnemonicForWallet(walletId);
            if (!is_current(id) || !await wait_until_active() || !is_current(id)) return;
            if (mnemonic) {
                navigation.navigate(destination, { mnemonic, mode: 'backup' });
            } else {
                Alert.alert("Error", "Could not retrieve recovery phrase for this wallet.");
            }
        } catch (error) {
            if (is_current(id)) Alert.alert("Error", "An error occurred during authentication.");
        } finally {
            if (mounted.current && request_id.current === id) {
                set_is_loading_phrase(false);
                set_is_loading_qr(false);
            }
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
                        <ActivityIndicator color={theme.colors.bitcoin} />
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
                        <ActivityIndicator color={theme.colors.bitcoin} />
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

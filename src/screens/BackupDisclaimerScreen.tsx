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
            set_is_loading_phrase(false);
            set_is_loading_qr(false);
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
                navigation.navigate(destination, { mnemonic, mode: 'backup', walletId });
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

    const busy = is_loading_phrase || is_loading_qr;
    return (
        <View style={styles.container}>
            <Text style={styles.instruction}>Write down your recovery phrase in private.</Text>
            <Text style={styles.warning}>Anyone with the words or QR code can spend your bitcoin.</Text>
            {([
                ['eye', 'Show phrase', 'ShowMnemonic', is_loading_phrase],
                ['grid', 'Show QR code', 'ShowMnemonicQR', is_loading_qr],
            ] as const).map(([icon, label, destination, loading], index) => (
                <TouchableOpacity key={destination} accessibilityRole="button" accessibilityLabel={label}
                    accessibilityState={{ disabled: busy, busy: loading }} disabled={busy}
                    style={[styles.row, index === 0 && styles.divider]}
                    onPress={() => authenticate_and_fetch(destination)}>
                    <Feather name={icon} size={22} color={theme.colors.primary} />
                    <Text style={styles.label}>{label}</Text>
                    {loading ? <ActivityIndicator color={theme.colors.bitcoin} /> :
                        <Feather name="chevron-right" size={20} color={theme.colors.muted} />}
                </TouchableOpacity>
            ))}
        </View>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
    container: { backgroundColor: theme.colors.background, padding: 24 },
    instruction: { fontSize: 16, lineHeight: 24, color: theme.colors.primary },
    warning: { fontSize: 14, lineHeight: 21, color: theme.colors.muted, marginTop: 8, marginBottom: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64 },
    divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    label: { flex: 1, fontSize: 16, color: theme.colors.primary },
});

export default BackupDisclaimerScreen;

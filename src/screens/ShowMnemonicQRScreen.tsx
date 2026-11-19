import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import { NETWORK_NAME } from '../constants/network';
import { confirmWalletBackup } from '../services/firstLaunchWallet';
import { WalletQRCode, walletQRCardStyle } from '../components/WalletQRCode';

type navigation_prop = NativeStackNavigationProp<any>;
type route_prop_type = RouteProp<any>;

const ShowMnemonicQRScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { mnemonic, mode, walletId } = route.params as any;
    const is_backup_mode = mode === 'backup';
    const confirming_ref = useRef(false);
    const [confirming, set_confirming] = useState(false);
    const { theme, isDark } = useTheme(); 
    const styles = useMemo(() => get_styles(theme, isDark), [theme, isDark]); 

    const handle_continue = async () => {
        if (confirming_ref.current || navigation.isFocused?.() === false) return;
        confirming_ref.current = true;
        set_confirming(true);
        if (is_backup_mode) {
            if (walletId) {
                try { await confirmWalletBackup(NETWORK_NAME, walletId); }
                catch { Alert.alert('Backup confirmation failed', 'Please try again.'); confirming_ref.current = false; set_confirming(false); return; }
            }
            if (navigation.isFocused?.() !== false) navigation.popToTop();
        } else {
            navigation.navigate('VerifyMnemonic', { mnemonic });
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.warning}>
                This code contains your recovery phrase. Scan it only on a device you trust.
            </Text>
            
            <View style={styles.qr_wrapper}>
                <WalletQRCode value={mnemonic} />
            </View>

            <TouchableOpacity style={styles.button} onPress={handle_continue} disabled={confirming}>
                <View style={styles.button_content_row_centered}>
                    <Feather
                        name={is_backup_mode ? "check-circle" : "arrow-right-circle"}
                        size={18}
                        color={theme.colors.inversePrimary}
                    />
                    <Text style={styles.button_text}>
                        {is_backup_mode && walletId ? 'I saved my recovery phrase' : is_backup_mode ? 'Done' : 'Check my backup'}
                    </Text>
                </View>
            </TouchableOpacity>
        </ScrollView>
    );
};

const get_styles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: theme.colors.background 
    },
    warning: {
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.primary, 
        textAlign: 'center',
        marginBottom: 32,
    },
    qr_wrapper: { ...walletQRCardStyle(theme, isDark), marginBottom: 24 },
    button: {
        backgroundColor: theme.colors.primary, 
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center'
    },
    button_text: {
        color: theme.colors.inversePrimary, 
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    button_content_row_centered: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8 
    },
});

export default ShowMnemonicQRScreen;

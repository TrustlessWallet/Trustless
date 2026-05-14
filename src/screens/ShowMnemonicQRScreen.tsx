import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import QRCode from 'react-native-qrcode-svg';

type navigation_prop = NativeStackNavigationProp<any>;
type route_prop_type = RouteProp<any>;

const ShowMnemonicQRScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { mnemonic, mode } = route.params as any;
    const is_backup_mode = mode === 'backup';
    const { theme, isDark } = useTheme(); 
    const styles = useMemo(() => get_styles(theme, isDark), [theme, isDark]); 

    const handle_continue = () => {
        if (is_backup_mode) {
            navigation.popToTop();
        } else {
            navigation.navigate('VerifyMnemonic', { mnemonic });
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.warning}>
                Scan this QR code to import your recovery phrase. Do not share it with anyone.
            </Text>
            
            <View style={styles.qr_wrapper}>
                <QRCode
                    value={mnemonic}
                    size={250}
                    color={theme.colors.primary}
                    backgroundColor={theme.colors.background}
                />
            </View>

            <TouchableOpacity style={styles.button} onPress={handle_continue}>
                <View style={styles.button_content_row_centered}>
                    <Feather
                        name={is_backup_mode ? "check-circle" : "arrow-right-circle"}
                        size={18}
                        color={theme.colors.inversePrimary}
                    />
                    <Text style={styles.button_text}>
                        {is_backup_mode ? "Done" : "Continue to verification"}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    );
};

const get_styles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    container: {
        flex: 1,
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
    qr_wrapper: {
        padding: 24,
        backgroundColor: theme.colors.background,
        borderRadius: 8,
        shadowColor: theme.colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? 0.3 : 0.1,
        shadowRadius: 3,
        elevation: 3,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: 48,
    },
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
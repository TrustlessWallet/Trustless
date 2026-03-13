import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'WalletOptions'>;
type route_prop_type = RouteProp<RootStackParamList, 'WalletOptions'>;

const WalletOptionsScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { wallet_id } = route.params;
    
    const { wallets, removeWallet: remove_wallet, activeWallet: active_wallet } = useWallet();
    const { theme } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);

    const wallet = useMemo(() => wallets.find(w => w.id === wallet_id), [wallets, wallet_id]);

    const handle_show_public_key = () => {
        navigation.navigate('ShowPublicKey', { wallet_id });
    };

    const handle_backup_wallet = () => {
        navigation.navigate('BackupDisclaimer', { walletId: wallet_id });
    };

    const handle_remove_wallet = () => {
        if (!wallet) return;
        Alert.alert(
            "Remove Wallet",
            `Are you sure you want to remove "${wallet.name}"? This action cannot be undone.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Remove",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await remove_wallet(wallet.id);
                            navigation.goBack();
                        } catch (error) {
                            Alert.alert("Error", error instanceof Error ? error.message : "Could not remove wallet.");
                        }
                    },
                },
            ]
        );
    };

    if (!wallet) {
        return (
            <View style={styles.container}>
                <Text style={styles.error_text}>Wallet not found.</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.wallet_name}>{wallet.name}</Text>
                {active_wallet?.id === wallet.id && (
                    <Text style={styles.active_badge_text}>● Active</Text>
                )}
            </View>

            <View style={styles.options_container}>
                <TouchableOpacity style={styles.option_row} onPress={handle_show_public_key}>
                    <Feather name="key" size={18} color={theme.colors.primary} />
                    <Text style={styles.option_text}>Show public key</Text>
                </TouchableOpacity>

                {wallet.type !== 'watch-only' && (
                    <TouchableOpacity style={styles.option_row} onPress={handle_backup_wallet}>
                        <Feather name="shield" size={18} color={theme.colors.primary} />
                        <Text style={styles.option_text}>Backup wallet</Text>
                    </TouchableOpacity>
                )}

                <TouchableOpacity style={[styles.option_row, styles.remove_row]} onPress={handle_remove_wallet}>
                    <Feather name="trash-2" size={18} color={theme.colors.error} />
                    <Text style={[styles.option_text, styles.remove_text]}>Remove wallet</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
        padding: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
        gap: 8,
    },
    wallet_name: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.primary,
    },
    active_badge_text: {
        color: theme.colors.bitcoin,
        fontSize: 12,
        fontWeight: 'bold',
    },
    error_text: {
        color: theme.colors.error,
        fontSize: 16,
    },
    options_container: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    option_row: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: 12,
    },
    option_text: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    remove_row: {
        borderBottomWidth: 0, 
    },
    remove_text: {
        color: theme.colors.error,
    },
});

export default WalletOptionsScreen;
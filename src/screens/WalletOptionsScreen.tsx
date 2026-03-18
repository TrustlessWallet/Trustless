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
                <View style={styles.header_left}>
                    <Text style={styles.wallet_name}>{wallet.name}</Text>
                    {active_wallet?.id === wallet.id && (
                        <Text style={styles.active_badge_text}>● Active</Text>
                    )}
                </View>
                <TouchableOpacity style={styles.remove_button} onPress={handle_remove_wallet}>
                    <Feather name="trash-2" size={18} color={theme.colors.primary} />
                </TouchableOpacity>
            </View>

            <View style={styles.options_container}>
                <View style={styles.row_wrapper}>
                    <TouchableOpacity style={styles.row} onPress={handle_show_public_key}>
                        <View style={styles.row_left}>

                            <Text style={styles.row_label}>Show public key</Text>
                        </View>
                        <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                    </TouchableOpacity>
                </View>

                {wallet.type !== 'watch-only' && (
                    <View style={styles.row_wrapper}>
                        <TouchableOpacity style={styles.row} onPress={handle_backup_wallet}>
                            <View style={styles.row_left}>

                                <Text style={styles.row_label}>Backup wallet</Text>
                            </View>
                            <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                        </TouchableOpacity>
                    </View>
                )}
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
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    header_left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
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
    remove_button: {
        padding: 4,
    },
    error_text: {
        color: theme.colors.error,
        fontSize: 16,
    },
    options_container: {
        marginTop: 8,
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
    row_left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    row_label: {
        fontSize: 16,
        color: theme.colors.muted,
    },
});

export default WalletOptionsScreen;
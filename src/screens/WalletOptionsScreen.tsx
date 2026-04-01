import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, TextInput, TouchableWithoutFeedback, Keyboard } from 'react-native';
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

    const { wallets, removeWallet: remove_wallet, activeWallet: active_wallet, updateWalletName } = useWallet();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);
    const [is_editing_name, set_is_editing_name] = useState(false);
    const [editing_name, set_editing_name] = useState('');
    const edit_input_ref = useRef<TextInput>(null);

    const wallet = useMemo(() => wallets.find(w => w.id === wallet_id), [wallets, wallet_id]);

    useEffect(() => {
        if (is_editing_name) {
            edit_input_ref.current?.focus();
        }
    }, [is_editing_name]);

    const handle_show_public_key = () => {
        navigation.navigate('ShowPublicKey', { wallet_id });
    };

    const handle_start_editing_name = () => {
        set_editing_name(wallet?.name || '');
        set_is_editing_name(true);
    };

    const handle_end_editing_name = () => {
        if (!wallet) return;
        updateWalletName(wallet.id, editing_name.trim());
        set_is_editing_name(false);
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
                            const is_last_wallet = wallets.length <= 1;
                            await remove_wallet(wallet.id);

                            if (is_last_wallet) {
                                navigation.popToTop();
                            } else {
                                navigation.goBack();
                            }
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
                <Text style={{ color: theme.colors.muted }}>Wallet not found.</Text>
            </View>
        );
    }

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <View style={styles.header_content}>
                        <View style={styles.header_left}>
                            {is_editing_name ? (
                                <TextInput
                                    ref={edit_input_ref}
                                    style={styles.wallet_name_input}
                                    value={editing_name}
                                    onChangeText={set_editing_name}
                                    onBlur={handle_end_editing_name}
                                    onSubmitEditing={handle_end_editing_name}
                                    autoFocus={true}
                                    keyboardAppearance={isDark ? 'dark' : 'light'}
                                    placeholderTextColor={theme.colors.muted}
                                />
                            ) : (
                                <Text style={styles.wallet_name}>{wallet.name}</Text>
                            )}
                        </View>
                        {!is_editing_name && (
                            <TouchableOpacity style={styles.edit_button} onPress={handle_start_editing_name}>
                                <Feather name="edit" size={18} color={theme.colors.primary} />
                            </TouchableOpacity>
                        )}
                    </View>
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
                    <View style={styles.row_wrapper}>
                        <TouchableOpacity style={styles.row} onPress={handle_remove_wallet}>
                            <View style={styles.row_left}>
                                <Text style={[styles.row_label, styles.delete_text]}>Delete wallet</Text>
                            </View>
                            <Feather name="chevron-right" size={24} color={theme.colors.primary} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </TouchableWithoutFeedback>
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
        marginBottom: 8,
    },
    header_content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flex: 1,
        position: 'relative',
    },
    header_left: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 40,
    },
    wallet_name: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.primary,
    },
    wallet_name_input: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.primary,
        fontFamily: 'SpaceMono-Regular',
        flex: 1,
    },
    edit_button: {
        position: 'absolute',
        right: 0,
        top: 0,
        padding: 4,
    },
    error_text: {
        color: theme.colors.muted,
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
    delete_text: {
        color: theme.colors.muted,
    },
});

export default WalletOptionsScreen;
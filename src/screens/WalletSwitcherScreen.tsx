import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator, TouchableWithoutFeedback, Keyboard, SafeAreaView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Wallet } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'WalletSwitcher'>;

const WalletSwitcherScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const { wallets, activeWallet, switchWallet, updateWalletName } = useWallet();
    const { theme, isDark } = useTheme(); 
    const styles = useMemo(() => get_styles(theme), [theme]); 
    const [editing_wallet_id, set_editing_wallet_id] = useState<string | null>(null);
    const [editing_name, set_editing_name] = useState('');
    const [switching_to_wallet_id, set_switching_to_wallet_id] = useState<string | null>(null);
    const edit_input_ref = useRef<TextInput>(null);

    useEffect(() => {
        if (editing_wallet_id) {
            edit_input_ref.current?.focus();
        }
    }, [editing_wallet_id]);

    const handle_switch_wallet = async (wallet_id: string) => {
        if (switching_to_wallet_id || editing_wallet_id === wallet_id) return;
        if (wallet_id === activeWallet?.id) {
            navigation.goBack();
            return;
        }
        set_switching_to_wallet_id(wallet_id);
        try {
            await switchWallet(wallet_id);
            setTimeout(() => {
                navigation.goBack();
                set_switching_to_wallet_id(null);
            }, 500);
        } catch (error) {
            Alert.alert("Error", "Failed to switch wallet.");
            set_switching_to_wallet_id(null);
        }
    };

    const handle_start_editing = (wallet: Wallet) => {
        set_editing_wallet_id(wallet.id);
        set_editing_name(wallet.name || '');
    };

    const handle_end_editing = () => {
        if (!editing_wallet_id) return;
        updateWalletName(editing_wallet_id, editing_name.trim());
        set_editing_wallet_id(null);
    };

    const handle_open_options = (wallet_id: string) => {
        navigation.navigate('WalletOptions', { wallet_id });
    };

    const render_wallet_item = ({ item }: { item: Wallet }) => {
        const is_editing = editing_wallet_id === item.id;
        const is_active = activeWallet?.id === item.id;
        const is_switching = switching_to_wallet_id === item.id;
        const is_watch_only = item.type === 'watch-only';

        return (
            <TouchableOpacity
                style={[styles.wallet_item, is_active && styles.active_item]}
                onPress={() => handle_switch_wallet(item.id)}
                activeOpacity={0.7}
                disabled={is_switching}
            >
                <View style={styles.wallet_info}>
                    {is_editing ? (
                        <TextInput
                            ref={edit_input_ref}
                            style={styles.wallet_name_input}
                            value={editing_name}
                            onChangeText={set_editing_name}
                            onBlur={handle_end_editing}
                            onSubmitEditing={handle_end_editing}
                            autoFocus={true}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                            placeholderTextColor={theme.colors.muted}
                        />
                    ) : (
                        <View style={styles.name_container}>
                            <Text style={styles.wallet_name}>{item.name}</Text>
                            <TouchableOpacity style={styles.edit_button} onPress={() => handle_start_editing(item)}>
                                <Feather name="edit" style={styles.edit_icon} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
                {is_switching ? (
                    <ActivityIndicator style={styles.loader} color={theme.colors.primary} />
                ) : (
                    <View style={styles.actions_container}>
                        {is_watch_only && (
                            <View style={styles.watch_only_container}>
                                <Text style={{ color: theme.colors.muted }}>Watch-only </Text>
                                <Feather name="eye" size={16} color={theme.colors.muted} />
                            </View>
                        )}
                        <TouchableOpacity style={styles.action_button} onPress={() => handle_open_options(item.id)}>
                            <Feather name="more-vertical" size={20} color={theme.colors.primary} />
                        </TouchableOpacity>
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <SafeAreaView style={styles.container}>
                <FlatList
                    data={wallets}
                    renderItem={render_wallet_item}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list_content}
                    style={styles.list}
                    keyboardShouldPersistTaps="handled"
                />
                <View style={styles.footer}>
                    <TouchableOpacity style={styles.add_button} onPress={() => navigation.navigate('AddWalletOptions')}>
                        <Feather name="plus-circle" size={20} color={theme.colors.inversePrimary} />
                        <Text style={styles.add_button_text}>Add wallet</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </TouchableWithoutFeedback>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    list: {
        flex: 1,
    },
    list_content: {
        padding: 24,
        paddingBottom: 20,
        gap: 8,
    },
    wallet_item: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: 64,
    },
    active_item: {
        borderColor: theme.colors.bitcoin,
    },
    wallet_info: {
        flex: 1,
        marginRight: 16,
    },
    name_container: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
    },
    wallet_name: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    edit_button: {
        padding: 4,
        marginLeft: 4,
    },
    edit_icon: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    wallet_name_input: {
        fontSize: 16,
        color: theme.colors.primary,
        fontFamily: 'SpaceMono-Regular',
    },
    actions_container: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    action_button: {
        padding: 8,
    },
    loader: {
        padding: 8,
    },
    watch_only_container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 4,
    },
    footer: {
        padding: 24,
        backgroundColor: theme.colors.background,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    add_button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.primary,
        padding: 16,
        borderRadius: 8,
    },
    add_button_text: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontWeight: '600',
    },
});

export default WalletSwitcherScreen;
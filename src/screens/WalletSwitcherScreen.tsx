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
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'WalletSwitcher'>;
const WalletSwitcherScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { wallets, activeWallet, switchWallet, updateWalletName, removeWallet } = useWallet();
    const { theme, isDark } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [switchingToWalletId, setSwitchingToWalletId] = useState<string | null>(null);
    const editInputRef = useRef<TextInput>(null);
    useEffect(() => {
        if (editingWalletId) {
            editInputRef.current?.focus();
        }
    }, [editingWalletId]);
    const handleSwitchWallet = async (walletId: string) => {
        if (switchingToWalletId || editingWalletId === walletId) return;
        if (walletId === activeWallet?.id) {
            navigation.goBack();
            return;
        }
        setSwitchingToWalletId(walletId);
        try {
            await switchWallet(walletId, wallets);
            setTimeout(() => {
                navigation.goBack();
                setSwitchingToWalletId(null);
            }, 500);
        } catch (error) {
            Alert.alert("Error", "Failed to switch wallet.");
            setSwitchingToWalletId(null);
        }
    };
    const handleStartEditing = (wallet: Wallet) => {
        setEditingWalletId(wallet.id);
        setEditingName(wallet.name || '');
    };
    const handleEndEditing = () => {
        if (!editingWalletId) return;
        updateWalletName(editingWalletId, editingName.trim());
        setEditingWalletId(null);
    };
    const handleRemoveWallet = (wallet: Wallet) => {
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
                            await removeWallet(wallet.id);
                            if (activeWallet?.id === wallet.id) {
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
    const renderWalletItem = ({ item }: { item: Wallet }) => {
        const isEditing = editingWalletId === item.id;
        const isActive = activeWallet?.id === item.id;
        const isSwitching = switchingToWalletId === item.id;
        return (
            <TouchableOpacity
                style={[styles.walletItem, isActive && styles.activeItem]}
                onPress={() => handleSwitchWallet(item.id)}
                activeOpacity={0.7}
                disabled={isSwitching}
            >
                <View style={styles.walletInfo}>
                    {isEditing ? (
                        <TextInput
                            ref={editInputRef}
                            style={styles.walletNameInput}
                            value={editingName}
                            onChangeText={setEditingName}
                            onBlur={handleEndEditing}
                            onSubmitEditing={handleEndEditing}
                            autoFocus={true}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                            placeholderTextColor={theme.colors.muted}
                        />
                    ) : (
                        <View style={styles.nameContainer}>
                            <Text style={styles.walletName}>{item.name}</Text>
                            <TouchableOpacity style={styles.editButton} onPress={() => handleStartEditing(item)}>
                                <Feather name="edit" style={styles.editIcon} />
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
                {isSwitching ? (
                    <ActivityIndicator color={theme.colors.primary} />
                ) : (
                    <View style={styles.actionsContainer}>
                        <TouchableOpacity
                            style={styles.backupButton}
                            onPress={() => navigation.navigate('BackupDisclaimer', { walletId: item.id })}
                        >
                            <Feather name="shield" size={16} color={theme.colors.primary} />
                            <Text style={styles.backupButtonText}>Backup</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionButton} onPress={() => handleRemoveWallet(item)}>
                            <Feather name="trash-2" size={18} color={theme.colors.primary} />
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
                    renderItem={renderWalletItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    style={styles.list}
                    keyboardShouldPersistTaps="handled"
                />
                <View style={styles.footer}>
                    <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('AddWalletOptions')}>
                        <Feather name="plus-circle" size={20} color={theme.colors.inversePrimary} />
                        <Text style={styles.addButtonText}>Add Wallet</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </TouchableWithoutFeedback>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    list: {
        flex: 1,
        maxHeight: 500,
    },
    listContent: {
        padding: 16,
        paddingBottom: 20,
        gap: 8,
    },
    walletItem: {
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
    activeItem: {
        borderColor: theme.colors.primary,
    },
    walletInfo: {
        flex: 1,
        marginRight: 16,
    },
    nameContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
    },
    walletName: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.primary,
    },
    editButton: {
        padding: 4,
        marginLeft: 4,
    },
    editIcon: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    walletNameInput: {
        fontFamily: 'SpaceMono-Bold',
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.primary,
    },
    actionsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionButton: {
        padding: 8,
    },
    backupButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: 6,
    },
    backupButtonText: {
        color: theme.colors.primary,
        fontWeight: '600',
        fontSize: 14,
    },
    footer: {
        padding: 24,
        backgroundColor: theme.colors.background,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.primary,
        padding: 16,
        borderRadius: 8,
    },
    addButtonText: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontWeight: '600',
    },
});
export default WalletSwitcherScreen;
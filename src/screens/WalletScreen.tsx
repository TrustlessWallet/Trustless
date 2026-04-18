import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, RefreshControl, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Transaction, LightningTransaction } from '../types';
import { useWallet } from '../contexts/WalletContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { useWalletTransactions, useWalletUTXOs } from '../hooks/useBalance';
import { formatBitcoinAddressShort } from '../constants/format';

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const btcFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
});

const formatBalance = (sats: number) => {
    const btc = (sats || 0) / 100000000;
    return btcFormatter.format(btc).replace(/,/g, ' ');
};

const WalletScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const {
        activeWallet,
        loading: walletLoading,
        triggerRefresh,
        lightningBalance,
        lightningTransactions,
        isLightningInitialized
    } = useWallet();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const [hideBalance, setHideBalance] = useState(false);
    const [isLightningMode, setIsLightningMode] = useState(false);
    const isFocused = useIsFocused();

    const lightningAnim = useRef(new Animated.Value(0)).current;

    const onchainBalance = useMemo(() => {
        if (!activeWallet) return 0;
        return activeWallet.derivedAddressInfoCache.reduce((acc, curr) => acc + curr.balance, 0);
    }, [activeWallet]);

    const displayBalance = isLightningMode ? lightningBalance : onchainBalance;

    const queryAddresses = useMemo(() => {
        if (!activeWallet) return [];
        const changeAddresses = activeWallet.derivedChangeAddresses.map(a => a.address);
        const infoCache = activeWallet.derivedAddressInfoCache;
        const usedAddresses = infoCache.filter(i => i.tx_count > 0 || i.balance > 0).map(i => i.address);
        return [...new Set([...usedAddresses, ...changeAddresses])];
    }, [activeWallet]);

    const walletAddressesSet = useMemo(() => {
        if (!activeWallet) return new Set<string>();
        return new Set([
            ...(activeWallet.derivedReceiveAddresses.map(a => a.address) ?? []),
            ...(activeWallet.derivedChangeAddresses.map(a => a.address) ?? [])
        ]);
    }, [activeWallet]);

    const {
        data: onchainTransactions,
        isLoading: loadingTxs,
        refetch: refetchTxs,
        isRefetching: isRefetchingTxs
    } = useWalletTransactions(activeWallet?.id, queryAddresses);

    const {
        data: utxos,
        refetch: refetchUtxos
    } = useWalletUTXOs(queryAddresses);

    useEffect(() => {
        const loadPreference = async () => {
            const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
            setHideBalance(savedPref === 'true');
        };
        if (isFocused) {
            loadPreference();
        }
    }, [isFocused]);

    const onRefresh = () => {
        triggerRefresh();
        if (!isLightningMode) {
            refetchTxs();
            refetchUtxos();
        }
    };

    const toggleMode = () => {
        const nextMode = !isLightningMode;
        setIsLightningMode(nextMode);

        Animated.spring(lightningAnim, {
            toValue: nextMode ? 1 : 0,
            useNativeDriver: false,
            friction: 9,
            tension: 45
        }).start();
    };

    const expandedHeight = lightningAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 40]
    });

    const translateY = lightningAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-20, 0]
    });

    const fadeAnim = lightningAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp'
    });

    const renderTransactionItem = useCallback(({ item }: { item: any }) => {
        const isLightning = 'paymentHash' in item;

        if (isLightning) {
            const lnTx = item as LightningTransaction;
            const isSend = lnTx.type === 'send';
            const txDate = new Date(lnTx.paymentTime * 1000).toLocaleString();
            const amountSats = Math.floor(lnTx.amountMsat / 1000);

            return (
                <TouchableOpacity
                    key={lnTx.paymentHash}
                    style={styles.txRow}
                    onPress={() => navigation.navigate('TransactionDetails', { transaction: lnTx })}
                >
                    <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
                    <View style={styles.txDetails}>
                        <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                        <Text style={styles.txAddress}>{lnTx.description || 'Lightning Payment'}</Text>
                        <Text style={styles.txDate}>{txDate}</Text>
                    </View>
                    <View style={styles.txAmountContainer}>
                        <Text style={styles.txAmount}>
                            {hideBalance ? '*******' : (
                                <>{isSend ? '-' : '+'} {formatBalance(amountSats)} <Text style={styles.orangeSymbol}>₿</Text></>
                            )}
                        </Text>
                        <Text style={styles.txStatus}>{lnTx.status === 'complete' ? 'Complete' : 'Pending'}</Text>
                    </View>
                </TouchableOpacity>
            );
        }

        const ocTx = item as Transaction;
        const isSend = ocTx.type === 'send';
        let otherAddress = 'Multiple';

        if (isSend) {
            const externalOutputs = ocTx.vout.filter(o => !walletAddressesSet.has(o.scriptpubkey_address));
            if (externalOutputs.length === 1) otherAddress = externalOutputs[0].scriptpubkey_address;
        } else {
            const externalInputs = ocTx.vin.filter(i => !walletAddressesSet.has(i.prevout?.scriptpubkey_address));
            if (externalInputs.length === 1) otherAddress = externalInputs[0].prevout.scriptpubkey_address;
        }

        const txDate = ocTx.status.block_time
            ? new Date(ocTx.status.block_time * 1000).toLocaleString()
            : 'Pending confirmation';

        return (
            <TouchableOpacity
                key={ocTx.txid}
                style={styles.txRow}
                onPress={() => navigation.navigate('TransactionDetails', { transaction: ocTx })}
            >
                <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
                <View style={styles.txDetails}>
                    <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                    <Text style={styles.txAddress}>{isSend ? "To" : "From"} {formatBitcoinAddressShort(otherAddress || 'Unknown')}</Text>
                    <Text style={styles.txDate}>{txDate}</Text>
                </View>
                <View style={styles.txAmountContainer}>
                    <Text style={styles.txAmount}>
                        {hideBalance ? '*******' : (
                            <>{isSend ? '-' : '+'} {formatBalance(ocTx.amount)} <Text style={styles.orangeSymbol}>₿</Text></>
                        )}
                    </Text>
                    <Text style={styles.txStatus}>{ocTx.status.confirmed ? 'Confirmed' : 'Pending'}</Text>
                </View>
            </TouchableOpacity>
        );
    }, [walletAddressesSet, hideBalance, theme, navigation, styles]);

    const displayTransactions = isLightningMode ? lightningTransactions : (onchainTransactions || []);
    const recentTxs = displayTransactions.slice(0, 3);
    const hasTransactions = displayTransactions.length > 0;

    const ToggleIconElement = () => (
        <View style={styles.iconToggleInner}>
            <View style={[styles.iconWrapper, !isLightningMode && styles.iconWrapperActive]}>
                <Feather name="link" size={14} color={!isLightningMode ? theme.colors.inversePrimary : theme.colors.muted} />
            </View>
            <View style={[styles.iconWrapper, isLightningMode && styles.iconWrapperActive]}>
                <Feather name="zap" size={14} color={isLightningMode ? theme.colors.inversePrimary : (!isLightningInitialized ? theme.colors.border : theme.colors.muted)} />
            </View>
        </View>
    );

    if (walletLoading) {
        return <View style={styles.centeredContainer}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
    }

    if (!activeWallet) {
        return (
            <SafeAreaView style={styles.container} edges={['right', 'left']}>
                <View style={styles.emptyStateContainer}>
                    <TouchableOpacity style={styles.createButton} onPress={() => navigation.navigate('BackupIntro')}>
                        <Feather name="plus-circle" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.createButtonText}>Create a new wallet</Text>
                    </TouchableOpacity>
                    <View style={{ width: '100%' }}>
                        <Text style={styles.orText}>Or</Text>
                        <TouchableOpacity style={styles.importButton} onPress={() => navigation.navigate('RecoverWallet')}>
                            <Feather name="refresh-ccw" size={18} color={theme.colors.primary} />
                            <Text style={styles.importButtonText}>Import existing wallet</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.importButton} onPress={() => navigation.navigate('ImportWatchOnly')}>
                            <Feather name="eye" size={18} color={theme.colors.primary} />
                            <Text style={styles.importButtonText}>Import watch-only wallet</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['right', 'left']}>
            <View style={styles.topSection}>

                <View style={styles.headerRow}>
                    <TouchableOpacity
                        style={styles.toggleTouchable}
                        onPress={toggleMode}
                        activeOpacity={0.8}
                        disabled={!isLightningInitialized || activeWallet.type === 'watch-only'}
                    >
                        {activeWallet.type !== 'watch-only' && <ToggleIconElement />}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.walletSelector} onPress={() => navigation.navigate('WalletSwitcher')}>
                        <Text style={styles.walletName}>{activeWallet.name}</Text>
                        <Feather name="chevron-down" size={20} color={theme.colors.muted} />
                    </TouchableOpacity>

                    <View style={[styles.toggleTouchable, { opacity: 0 }]} pointerEvents="none">
                        {activeWallet.type !== 'watch-only' && <ToggleIconElement />}
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.balanceContainer}
                    onPress={() => !isLightningMode && navigation.navigate('BalanceDetail', { utxos: utxos || [] })}
                    disabled={isLightningMode}
                >
                    <Text style={styles.balanceText}>
                        {hideBalance ? '*******' : (
                            isLightningMode ? (
                                <>{new Intl.NumberFormat('en-US').format(displayBalance)} sats</>
                            ) : (
                                <>{formatBalance(displayBalance)} <Text style={styles.orangeSymbol}>₿</Text></>
                            )
                        )}
                    </Text>
                </TouchableOpacity>

                <View style={styles.actionsContainer}>
                    <View style={styles.actionColumn}>
                        <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('Receive', { mode: isLightningMode ? 'lightning' : 'onchain' } as any)}>
                            <Feather name="arrow-down-circle" size={16} color={theme.colors.inversePrimary} />
                            <Text style={styles.actionButtonText}>Receive</Text>
                        </TouchableOpacity>

                        <Animated.View style={{ position: 'absolute', top: 60, left: 0, right: 0, height: expandedHeight, opacity: fadeAnim, overflow: 'hidden' }}>
                            <Animated.View style={{ transform: [{ translateY }] }}>
                                <TouchableOpacity
                                    style={styles.secondaryActionButton}
                                    onPress={() => navigation.navigate('WithdrawToOnchain' as any)}
                                    disabled={!isLightningMode}
                                >
                                    <Feather name="minus" size={14} color={theme.colors.primary} />
                                    <Text style={styles.secondaryActionButtonText}>Withdraw</Text>
                                </TouchableOpacity>
                            </Animated.View>
                        </Animated.View>
                    </View>

                    <View style={styles.actionColumn}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => navigation.navigate('Send', { mode: isLightningMode ? 'lightning' : 'onchain' } as any)}
                        >
                            <Feather name="arrow-up-circle" size={16} color={theme.colors.inversePrimary} />
                            <Text style={styles.actionButtonText}>Send</Text>
                        </TouchableOpacity>

                        <Animated.View style={{ position: 'absolute', top: 60, left: 0, right: 0, height: expandedHeight, opacity: fadeAnim, overflow: 'hidden' }}>
                            <Animated.View style={{ transform: [{ translateY }] }}>
                                <TouchableOpacity
                                    style={styles.secondaryActionButton}
                                    onPress={() => navigation.navigate('LightningTopUp' as any)}
                                    disabled={!isLightningMode}
                                >
                                    <Feather name="plus" size={14} color={theme.colors.primary} />
                                    <Text style={styles.secondaryActionButtonText}>Top up</Text>
                                </TouchableOpacity>
                            </Animated.View>
                        </Animated.View>
                    </View>
                </View>
            </View>

            <ScrollView
                style={styles.bottomSection}
                refreshControl={<RefreshControl refreshing={!isLightningMode && isRefetchingTxs} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
            >
                {(!isLightningMode && loadingTxs) ? <ActivityIndicator style={styles.loadingIndicator} color={theme.colors.primary} /> : (
                    hasTransactions ? (
                        <View style={styles.historyContainer}>
                            {recentTxs.map((tx) => renderTransactionItem({ item: tx }))}
                            {displayTransactions.length > 1 && (
                                <TouchableOpacity style={styles.showMoreButton} onPress={() => navigation.navigate('TransactionHistory')}>
                                    <Text style={styles.showMoreText}>Show full history</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    ) : (
                        <Text style={styles.noTxText}>No transactions yet</Text>
                    )
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background
    },
    centeredContainer: {
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center'
    },
    emptyStateContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.primary,
        paddingVertical: 16,
        marginVertical: 6,
        borderRadius: 8,
        width: '100%'
    },
    createButtonText: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontWeight: '600'
    },
    orText: {
        fontSize: 16,
        color: theme.colors.muted,
        textAlign: 'center',
        marginVertical: 16
    },
    importButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.background,
        paddingVertical: 16,
        marginVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.primary,
        width: '100%'
    },
    importButtonText: {
        color: theme.colors.primary,
        fontSize: 16,
        fontWeight: '600'
    },
    topSection: {
        flex: 1.2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomSection: {
        flex: 1,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        zIndex: -1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    toggleTouchable: {
        width: 68,
        alignItems: 'center',
        justifyContent: 'center'
    },
    iconToggleInner: {
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderRadius: 20,
        padding: 2,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    iconWrapper: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 16,
    },
    iconWrapperActive: {
        backgroundColor: theme.colors.primary,
    },
    walletSelector: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginHorizontal: 12,
    },
    walletName: {
        fontSize: 20,
        color: theme.colors.muted,
    },
    balanceContainer: {
        alignItems: 'center',
        height: 44,
        justifyContent: 'center',
        marginBottom: 8,
    },
    balanceText: {
        fontSize: 36,
        fontFamily: 'SpaceMono-Bold',
        fontWeight: 'bold',
        color: theme.colors.primary,
        includeFontPadding: false,
        textAlignVertical: 'center'
    },
    orangeSymbol: {
        color: theme.colors.bitcoin
    },
    actionsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 24,
        gap: 12,
        zIndex: 10,
    },
    actionColumn: {
        flex: 1,
        maxWidth: 140,
        position: 'relative',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: theme.colors.primary,
        paddingVertical: 14,
        borderRadius: 8,
        width: '100%',
        zIndex: 2,
    },
    actionButtonText: {
        color: theme.colors.inversePrimary,
        fontSize: 15,
        fontWeight: '600'
    },
    secondaryActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: theme.colors.background,
        paddingVertical: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        width: '100%',
        height: 40,
    },
    secondaryActionButtonText: {
        color: theme.colors.primary,
        fontSize: 14,
        fontWeight: '500',
        includeFontPadding: false,
        textAlignVertical: 'center'
    },
    historyContainer: {
        paddingHorizontal: 20,
        paddingBottom: 20
    },
    noTxText: {
        textAlign: 'center',
        paddingVertical: 40,
        fontSize: 16,
        color: theme.colors.muted
    },
    loadingIndicator: {
        marginTop: 40
    },
    txRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: theme.colors.border
    },
    txIcon: {
        marginRight: 16
    },
    txDetails: {
        flex: 1,
        gap: 4
    },
    txType: {
        fontSize: 16,
        color: theme.colors.primary
    },
    txAddress: {
        fontSize: 14,
        color: theme.colors.muted,
        fontFamily: 'monospace'
    },
    txDate: {
        fontSize: 14,
        color: theme.colors.muted
    },
    txAmountContainer: {
        alignItems: 'flex-end'
    },
    txAmount: {
        fontSize: 16,
        color: theme.colors.primary
    },
    txStatus: {
        fontSize: 14,
        color: theme.colors.muted
    },
    showMoreButton: {
        alignItems: 'center',
        padding: 16
    },
    showMoreText: {
        color: theme.colors.primary,
        fontSize: 16
    },
});

export default WalletScreen;
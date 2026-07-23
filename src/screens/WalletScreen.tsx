import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, RefreshControl, Dimensions, Alert } from 'react-native';
import { scanLightningInvoice, NfcCancelledError, NfcUnsupportedError } from '../services/nfc';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/StyledText';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, Transaction, LightningTransaction } from '../types';
import { useWallet } from '../contexts/WalletContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { formatBitcoinAddressShort } from '../constants/format';
import { useWalletTransactions, useWalletUTXOs, useTipHeight } from '../hooks/useBalance';
import { LinearGradient } from 'expo-linear-gradient';

const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';
const DEFAULT_WALLET_MODE_KEY = '@defaultWalletMode';
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
    useTipHeight();
    const navigation = useNavigation<NavigationProp>();
    const insets = useSafeAreaInsets();
    const {
        activeWallet,
        loading: walletLoading,
        triggerRefresh,
        lightningBalance,
        lightningTransactions,
        isLightningInitialized
    } = useWallet();
    const { theme } = useTheme();

    // Using safe stable insets so the style object is always valid
    const styles = useMemo(() => getStyles(theme), [theme]);

    const [hideBalance, setHideBalance] = useState(false);
    const [isLightningMode, setIsLightningMode] = useState(false);
    const isFocused = useIsFocused();
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);

    const scrollY = useRef(new Animated.Value(0)).current;

    const shadowOpacity = scrollY.interpolate({
        inputRange: [100, 140],
        outputRange: [0, 1],
        extrapolate: 'clamp',
    });

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

    const [isScanningNfc, setIsScanningNfc] = useState(false);

    const handleNfcPay = useCallback(async () => {
        if (isScanningNfc) return;
        setIsScanningNfc(true);
        try {
            // 1. Call the updated invoice scanning function
            const payload = await scanLightningInvoice();

            if (!payload) {
                Alert.alert('Nothing found', 'The tag was read but had no payment data on it.');
                return;
            }

            // 2. Navigate using your app's expected mode and prefill parameters
            navigation.navigate('Send', { mode: 'lightning', prefill: payload, autoConfirm: true } as any);

        } catch (err) {
            if (err instanceof NfcCancelledError) {
                // user backed out of the OS scan sheet — no need to alert
            } else if (err instanceof NfcUnsupportedError) {
                Alert.alert('NFC not available', 'This device doesn\'t support NFC.');
            } else {
                console.warn('NFC scan error', err);
                Alert.alert('Scan failed', 'Could not read the tag. Please try again.');
            }
        } finally {
            setIsScanningNfc(false);
        }
    }, [isScanningNfc, navigation]);

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
        refetch: refetchTxs
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

    useEffect(() => {
        const loadInitialWalletMode = async () => {
            const savedMode = await AsyncStorage.getItem(DEFAULT_WALLET_MODE_KEY);
            if (savedMode === 'Lightning') {
                setIsLightningMode(true);
            }
        };
        loadInitialWalletMode();
    }, []);

    useEffect(() => {
        if (activeWallet?.type === 'watch-only' && isLightningMode) {
            setIsLightningMode(false);
        }
    }, [activeWallet?.type, isLightningMode]);

    const onRefresh = useCallback(async () => {
        setIsManualRefreshing(true);
        try {
            triggerRefresh();
            if (!isLightningMode) {
                await Promise.all([refetchTxs(), refetchUtxos()]);
            }
        } finally {
            setIsManualRefreshing(false);
        }
    }, [isLightningMode, triggerRefresh, refetchTxs, refetchUtxos]);

    const toggleMode = () => {
        setIsLightningMode(!isLightningMode);
    };

    const renderTransactionItem = useCallback(({ item }: { item: any }) => {
        const isLightning = 'paymentHash' in item;

        if (isLightning) {
            const lnTx = item as LightningTransaction;
            const isSend = lnTx.type === 'send';
            const txDate = new Date(lnTx.paymentTime * 1000).toLocaleString();
            const amountSats = Math.floor(lnTx.amountMsat / 1000);

            return (
                <TouchableOpacity
                    style={styles.txRow}
                    onPress={() => navigation.navigate('TransactionDetails', { transaction: lnTx })}
                >
                    <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
                    <View style={styles.txDetails}>
                        <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                        <Text style={styles.txAddress}>{lnTx.description || 'Lightning payment'}</Text>
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

    const ToggleIconElement = () => (
        <View style={styles.iconToggleInner}>
            <View style={[styles.iconWrapper, !isLightningMode && styles.iconWrapperActive]}>
                <MaterialIcons name="link" size={18} color={!isLightningMode ? theme.colors.inversePrimary : theme.colors.muted} />
            </View>
            <View style={[styles.iconWrapper, isLightningMode && styles.iconWrapperActive]}>
                <MaterialIcons name="bolt" size={18} color={isLightningMode ? theme.colors.inversePrimary : (!isLightningInitialized ? theme.colors.border : theme.colors.muted)} />
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
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.nativeTopHeaderBar,
                    {
                        height: insets.top + 48,
                        opacity: shadowOpacity
                    }
                ]}
            >
                <LinearGradient
                    colors={[
                        theme.colors.background,
                        theme.colors.background + 'CC',
                        theme.colors.background + '66',
                        theme.colors.background + '00',
                    ]}
                    locations={[0, 0.4, 0.7, 1]}
                    style={StyleSheet.absoluteFill}
                />
            </Animated.View>

            <Animated.FlatList
                extraData={theme}
                data={displayTransactions}
                renderItem={renderTransactionItem}
                keyExtractor={(item: any) => item.paymentHash || item.txid}
                onScroll={Animated.event(
                    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                    { useNativeDriver: true }
                )}
                scrollEventThrottle={16}
                ListHeaderComponent={
                    <View style={styles.topSection}>
                        <View style={styles.headerRow}>
                            <TouchableOpacity
                                style={styles.toggleTouchable}
                                onPress={toggleMode}
                                disabled={!isLightningInitialized || activeWallet?.type === 'watch-only'}
                            >
                                {activeWallet?.type !== 'watch-only' && <ToggleIconElement />}
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.walletSelector} onPress={() => navigation.navigate('WalletSwitcher')}>
                                <Text style={styles.walletName}>{activeWallet?.name}</Text>
                                <Feather name="chevron-down" size={20} color={theme.colors.muted} />
                            </TouchableOpacity>

                            <View style={[styles.toggleTouchable, { opacity: 0 }]} pointerEvents="none">
                                {activeWallet?.type !== 'watch-only' && <ToggleIconElement />}
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

                        <View style={styles.actionsWrapper}>
                            <View style={styles.actionsContainer}>
                                <TouchableOpacity
                                    style={styles.iconActionButton}
                                    onPress={() => navigation.navigate('Receive', { mode: isLightningMode ? 'lightning' : 'onchain' } as any)}
                                >
                                    <View style={styles.iconCircle}>
                                        <MaterialIcons name="qr-code" size={32} color={theme.colors.inversePrimary} />
                                    </View>
                                    <Text style={styles.iconActionText}>Receive</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.iconActionButton}
                                    onPress={() => navigation.navigate('Send', { mode: isLightningMode ? 'lightning' : 'onchain' } as any)}
                                >
                                    <View style={styles.iconCircle}>
                                        <Feather name="arrow-up-right" size={32} color={theme.colors.inversePrimary} />
                                    </View>
                                    <Text style={styles.iconActionText}>Send</Text>
                                </TouchableOpacity>

                                {isLightningMode && (
                                    <TouchableOpacity
                                        style={styles.iconActionButton}
                                        onPress={handleNfcPay}
                                        disabled={isScanningNfc}
                                    >
                                        <View style={styles.iconCircle}>
                                            {isScanningNfc ? (
                                                <ActivityIndicator size="small" color={theme.colors.inversePrimary} />
                                            ) : (
                                                <MaterialIcons name="nfc" size={32} color={theme.colors.inversePrimary} />
                                            )}
                                        </View>
                                        <Text style={styles.iconActionText}>{isScanningNfc ? 'Scanning...' : 'Pay'}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {isLightningMode && (
                                <View style={styles.secondaryActionsRow}>
                                    <TouchableOpacity
                                        style={styles.secondaryActionButton}
                                        onPress={() => navigation.navigate('WithdrawToOnchain' as any)}
                                    >
                                        <Feather name="minus-circle" size={14} color={theme.colors.primary} />
                                        <Text style={styles.secondaryActionButtonText}>Withdraw</Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={styles.secondaryActionButton}
                                        onPress={() => navigation.navigate('LightningTopUp' as any)}
                                    >
                                        <Feather name="plus-circle" size={14} color={theme.colors.primary} />
                                        <Text style={styles.secondaryActionButtonText}>Top-up</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    </View>
                }
                ListEmptyComponent={
                    (!isLightningMode && loadingTxs) ?
                        <ActivityIndicator style={styles.loadingIndicator} color={theme.colors.primary} /> :
                        <Text style={styles.noTxText}>No transactions yet</Text>
                }
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={isManualRefreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.colors.primary}
                        colors={[theme.colors.primary]}
                        progressViewOffset={SCREEN_HEIGHT * 0.1}
                    />
                }
                removeClippedSubviews={true}
                initialNumToRender={10}
                maxToRenderPerBatch={10}
                windowSize={5}
                updateCellsBatchingPeriod={50}
            />
        </SafeAreaView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    nativeTopHeaderBar: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: 'transparent',
    },
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    listContent: {
        flexGrow: 1,
        paddingVertical: 56,
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
        minHeight: SCREEN_HEIGHT * 0.55,
        paddingTop: 56,
        justifyContent: 'center',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingBottom: 0,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    toggleTouchable: {
        padding: 4,
        width: 68,
        alignItems: 'center',
        justifyContent: 'center',
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
        paddingVertical: 3,
        paddingHorizontal: 8,
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
        marginRight: -4,
        paddingHorizontal: 12,
    },
    walletName: {
        fontSize: 20,
        color: theme.colors.muted,
    },
    balanceContainer: {
        alignItems: 'center',
        height: 50,
        justifyContent: 'center',
        marginBottom: 28,
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
    actionsWrapper: {
        width: '100%',
        alignItems: 'center',
        height: 168,
        position: 'relative',
    },
    actionsContainer: {
        position: 'absolute',
        top: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        gap: 24,
    },
    iconActionButton: {
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: 100,
        gap: 6,
    },
    iconCircle: {
        width: 100,
        height: 60,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primary,
    },
    iconActionText: {
        color: theme.colors.primary,
        fontSize: 13,
        fontWeight: '500',
    },
    secondaryActionsRow: {
        position: 'absolute',
        top: 116,
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        gap: 24,
    },
    secondaryActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        width: 128,
        gap: 6,
        backgroundColor: theme.colors.background,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    secondaryActionButtonText: {
        color: theme.colors.primary,
        fontSize: 13,
        fontWeight: '500',
        includeFontPadding: false,
        textAlignVertical: 'center'
    },
    noTxText: {
        textAlign: 'center',
        paddingVertical: 40,
        fontSize: 16,
        color: theme.colors.muted
    },
    loadingIndicator: {
        marginTop: 40,
        color: theme.colors.primary
    },
    txRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 20,
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
    }
});

export default WalletScreen;
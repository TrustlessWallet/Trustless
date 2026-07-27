import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Animated, RefreshControl, Dimensions, Alert, Modal, Pressable, PanResponder, Vibration, Easing } from 'react-native';
import * as Haptics from 'expo-haptics';
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
const SHEET_CLOSED_OFFSET = 340; // Reduced for smaller sheet
const SHEET_DISMISS_THRESHOLD = 90;
const NFC_HOLD_DURATION = 400;

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'MainTabs'>;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const btcFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
});

const formatBalance = (sats: number) => {
    const btc = (sats || 0) / 100000000;
    return btcFormatter.format(btc).replace(/,/g, ' ');
};

const extractSatsFromBolt11 = (invoice: string): number => {
    const match = invoice.toLowerCase().match(/^ln(bc|tb|bcrt)(\d+)([munp]?)/);
    if (!match) return 0;

    const val = parseInt(match[2], 10);
    if (isNaN(val)) return 0;

    const mult = match[3];
    switch (mult) {
        case 'm': return val * 100000;
        case 'u': return val * 100;
        case 'n': return val * 0.1;
        case 'p': return val * 0.0001;
        default: return val * 100000000;
    }
};

const safeHaptic = (style: any) => {
    try {
        Haptics.impactAsync(style).catch(() => Vibration.vibrate());
    } catch {
        Vibration.vibrate();
    }
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

    const styles = useMemo(() => getStyles(theme), [theme]);

    const [hideBalance, setHideBalance] = useState(false);
    const [isLightningMode, setIsLightningMode] = useState(false);
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);
    const [isSheetMounted, setIsSheetMounted] = useState(false);

    const isFocused = useIsFocused();
    const scrollY = useRef(new Animated.Value(0)).current;

    const sheetTranslateY = useRef(new Animated.Value(SHEET_CLOSED_OFFSET)).current;

    const backdropOpacity = sheetTranslateY.interpolate({
        inputRange: [0, SHEET_CLOSED_OFFSET],
        outputRange: [1, 0],
        extrapolate: 'clamp',
    });

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

    const pressScale = useRef(new Animated.Value(1)).current;
    const holdCharge = useRef(new Animated.Value(0)).current;
    const ring1 = useRef(new Animated.Value(0)).current;
    const ring2 = useRef(new Animated.Value(0)).current;
    const nfcPulseAnim = useRef(new Animated.Value(1)).current; // New pulse anim

    // Reset hold charge when NFC scanning is finished/cancelled
    useEffect(() => {
        if (!isScanningNfc) {
            Animated.timing(holdCharge, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [isScanningNfc, holdCharge]);

    useEffect(() => {
        let loop1: Animated.CompositeAnimation | null = null;
        let loop2: Animated.CompositeAnimation | null = null;
        let pulseLoop: Animated.CompositeAnimation | null = null;
        let staggerTimeout: ReturnType<typeof setTimeout> | null = null;

        if (isScanningNfc) {
            ring1.setValue(0);
            ring2.setValue(0);
            nfcPulseAnim.setValue(1);

            loop1 = Animated.loop(
                Animated.timing(ring1, {
                    toValue: 1,
                    duration: 1300,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                })
            );
            loop1.start();

            staggerTimeout = setTimeout(() => {
                loop2 = Animated.loop(
                    Animated.timing(ring2, {
                        toValue: 1,
                        duration: 1300,
                        easing: Easing.out(Easing.quad),
                        useNativeDriver: true,
                    })
                );
                loop2.start();
            }, 650);

            // Pulsing animation for the center NFC icon
            pulseLoop = Animated.loop(
                Animated.sequence([
                    Animated.timing(nfcPulseAnim, {
                        toValue: 0.4,
                        duration: 600,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true,
                    }),
                    Animated.timing(nfcPulseAnim, {
                        toValue: 1,
                        duration: 600,
                        easing: Easing.inOut(Easing.ease),
                        useNativeDriver: true,
                    }),
                ])
            );
            pulseLoop.start();

        } else {
            ring1.setValue(0);
            ring2.setValue(0);
            nfcPulseAnim.setValue(1);
        }

        return () => {
            loop1?.stop();
            loop2?.stop();
            pulseLoop?.stop();
            if (staggerTimeout) clearTimeout(staggerTimeout);
        };
    }, [isScanningNfc, ring1, ring2, nfcPulseAnim]);

    const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
    const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] });
    const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
    const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] });

    const holdChargeHeight = holdCharge.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 60],
        extrapolate: 'clamp',
    });

    const openLiquiditySheet = useCallback(() => {
        setIsSheetMounted(true);
        sheetTranslateY.setValue(SHEET_CLOSED_OFFSET);
        Animated.spring(sheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 220,
            mass: 0.9,
        }).start();
    }, [sheetTranslateY]);

    const closeLiquiditySheet = useCallback((onDone?: () => void) => {
        Animated.timing(sheetTranslateY, {
            toValue: SHEET_CLOSED_OFFSET,
            duration: 200,
            useNativeDriver: true,
        }).start(() => {
            setIsSheetMounted(false);
            onDone?.();
        });
    }, [sheetTranslateY]);

    const sheetPanResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onPanResponderTerminationRequest: () => false,
            onMoveShouldSetPanResponder: (_evt, gestureState) => Math.abs(gestureState.dy) > 4,
            onPanResponderMove: (_evt, gestureState) => {
                if (gestureState.dy > 0) {
                    sheetTranslateY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_evt, gestureState) => {
                if (gestureState.dy > SHEET_DISMISS_THRESHOLD || gestureState.vy > 0.6) {
                    closeLiquiditySheet();
                } else {
                    Animated.spring(sheetTranslateY, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 20,
                        stiffness: 220,
                        mass: 0.9,
                    }).start();
                }
            },
        })
    ).current;

    const handleNfcPay = useCallback(async () => {
        if (isScanningNfc) return;

        safeHaptic(Haptics.ImpactFeedbackStyle.Medium);

        setIsScanningNfc(true);
        try {
            const payload = await scanLightningInvoice();

            if (!payload) {
                Alert.alert('Nothing found', 'The tag was read but had no payment data on it.');
                return;
            }

            const savedLimit = await AsyncStorage.getItem('@tapToPayLimit');
            const limitSats = savedLimit !== null ? parseInt(savedLimit, 10) : 100000;

            const invoiceSats = extractSatsFromBolt11(payload);
            const shouldAutoConfirm = invoiceSats > 0 && invoiceSats <= limitSats;

            navigation.navigate('Send', {
                mode: 'lightning',
                prefill: payload,
                autoConfirm: shouldAutoConfirm
            } as any);

        } catch (err) {
            if (err instanceof NfcCancelledError) {
                // user backed out
            } else if (err instanceof NfcUnsupportedError) {
                Alert.alert('NFC not available', 'This device doesn\'t support NFC.');
            } else {
                Alert.alert('Scan failed', 'Could not read the tag. Please try again.');
            }
        } finally {
            setIsScanningNfc(false);
        }
    }, [isScanningNfc, navigation]);

    const handleSendPressIn = useCallback(() => {
        Animated.spring(pressScale, {
            toValue: 0.94,
            useNativeDriver: true,
            speed: 40,
            bounciness: 3,
        }).start();

        if (isLightningMode) {
            safeHaptic(Haptics.ImpactFeedbackStyle.Light);
            holdCharge.setValue(0);
            Animated.timing(holdCharge, {
                toValue: 1,
                duration: NFC_HOLD_DURATION,
                easing: Easing.linear,
                useNativeDriver: false,
            }).start();
        }
    }, [isLightningMode, pressScale, holdCharge]);

    const handleSendPressOut = useCallback(() => {
        Animated.spring(pressScale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 40,
            bounciness: 3,
        }).start();

        if (isLightningMode && !isScanningNfc) {
            Animated.timing(holdCharge, {
                toValue: 0,
                duration: 150,
                useNativeDriver: false,
            }).start();
        }
    }, [isLightningMode, isScanningNfc, holdCharge, pressScale]);

    const walletAddressesSet = useMemo(() => {
        if (!activeWallet) return new Set<string>();
        return new Set([
            ...(activeWallet.derivedReceiveAddresses.map(a => a.address) ?? []),
            ...(activeWallet.derivedChangeAddresses.map(a => a.address) ?? [])
        ]);
    }, [activeWallet]);

    const { data: onchainTransactions, isLoading: loadingTxs, refetch: refetchTxs } = useWalletTransactions(activeWallet?.id, queryAddresses);
    const { data: utxos, refetch: refetchUtxos } = useWalletUTXOs(queryAddresses);

    useEffect(() => {
        const loadPreference = async () => {
            const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
            setHideBalance(savedPref === 'true');
        };
        if (isFocused) loadPreference();
    }, [isFocused]);

    useEffect(() => {
        const loadInitialWalletMode = async () => {
            const savedMode = await AsyncStorage.getItem(DEFAULT_WALLET_MODE_KEY);
            if (savedMode === 'Lightning') setIsLightningMode(true);
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

    const toggleMode = () => setIsLightningMode(!isLightningMode);

    const renderTransactionItem = useCallback(({ item }: { item: any }) => {
        const isLightning = 'paymentHash' in item;

        if (isLightning) {
            const lnTx = item as LightningTransaction;
            const isSend = lnTx.type === 'send';
            const txDate = new Date(lnTx.paymentTime * 1000).toLocaleString();
            const amountSats = Math.floor(lnTx.amountMsat / 1000);

            return (
                <TouchableOpacity style={styles.txRow} onPress={() => navigation.navigate('TransactionDetails', { transaction: lnTx })}>
                    <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
                    <View style={styles.txDetails}>
                        <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                        <Text style={styles.txAddress} numberOfLines={1} ellipsizeMode="middle">{lnTx.description || 'Lightning payment'}</Text>
                        <Text style={styles.txDate}>{txDate}</Text>
                    </View>
                    <View style={styles.txAmountContainer}>
                        <Text style={styles.txAmount}>
                            {hideBalance ? '*******' : (
                                <>{isSend ? '-' : '+'} {formatBalance(amountSats)} <Text style={styles.orangeSymbol}>₿</Text></>
                            )}
                        </Text>
                        <Text style={styles.txStatus}>
                            {lnTx.status === 'complete' ? 'Complete' : lnTx.status === 'failed' ? 'Failed' : 'Pending'}
                        </Text>
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

        const txDate = ocTx.status.block_time ? new Date(ocTx.status.block_time * 1000).toLocaleString() : 'Pending confirmation';

        return (
            <TouchableOpacity style={styles.txRow} onPress={() => navigation.navigate('TransactionDetails', { transaction: ocTx })}>
                <Feather name={isSend ? "arrow-up" : "arrow-down"} size={24} color={theme.colors.primary} style={styles.txIcon} />
                <View style={styles.txDetails}>
                    <Text style={styles.txType}>{isSend ? "Send" : "Receive"}</Text>
                    <Text style={styles.txAddress}>
                        {isSend ? "To" : "From"} {formatBitcoinAddressShort(otherAddress || 'Unknown')}
                    </Text>
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
                    style={styles.absoluteFillOverride}
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

                        <View style={styles.balanceRow}>
                            <View style={styles.balanceSideSpacer} />

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

                            <View style={styles.balanceSideSpacerRight}>
                                {isLightningMode && (
                                    <TouchableOpacity style={styles.liquidityPillSmall} onPress={openLiquiditySheet}>
                                        <Feather name="plus" size={14} color={theme.colors.primary} />
                                        <Feather name="minus" size={14} color={theme.colors.primary} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>

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
                                    activeOpacity={0.85}
                                    onPress={() => navigation.navigate('Send', { mode: isLightningMode ? 'lightning' : 'onchain' } as any)}
                                    onLongPress={isLightningMode ? handleNfcPay : undefined}
                                    onPressIn={handleSendPressIn}
                                    onPressOut={handleSendPressOut}
                                    delayLongPress={NFC_HOLD_DURATION}
                                    disabled={isScanningNfc}
                                >
                                    <View style={styles.nfcRingWrapper}>
                                        {isLightningMode && (
                                            <>
                                                <Animated.View
                                                    pointerEvents="none"
                                                    style={[
                                                        styles.sonarRing,
                                                        {
                                                            opacity: ring1Opacity,
                                                            transform: [{ scale: ring1Scale }],
                                                        },
                                                    ]}
                                                />
                                                <Animated.View
                                                    pointerEvents="none"
                                                    style={[
                                                        styles.sonarRing,
                                                        {
                                                            opacity: ring2Opacity,
                                                            transform: [{ scale: ring2Scale }],
                                                        },
                                                    ]}
                                                />
                                            </>
                                        )}

                                        <Animated.View style={[styles.iconCircle, { transform: [{ scale: pressScale }] }]}>
                                            {isLightningMode && (
                                                <Animated.View
                                                    pointerEvents="none"
                                                    style={[styles.chargeFill, { height: holdChargeHeight }]}
                                                />
                                            )}

                                            {isScanningNfc ? (
                                                <Animated.View style={{ opacity: nfcPulseAnim }}>
                                                    <MaterialIcons name="nfc" size={32} color={theme.colors.inversePrimary} />
                                                </Animated.View>
                                            ) : (
                                                <>
                                                    <Feather name="arrow-up-right" size={32} color={theme.colors.inversePrimary} />
                                                    {isLightningMode && (
                                                        <MaterialIcons name="nfc" size={14} color={theme.colors.inversePrimary} style={styles.nfcHintIconOriginal} />
                                                    )}
                                                </>
                                            )}
                                        </Animated.View>
                                    </View>
                                    <Text style={styles.iconActionText}>Send</Text>
                                </TouchableOpacity>
                            </View>
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
            />

            <Modal
                visible={isSheetMounted}
                transparent
                animationType="none"
                onRequestClose={() => closeLiquiditySheet()}
            >
                <View style={styles.sheetOverlay}>
                    <AnimatedPressable
                        style={[styles.sheetBackdrop, { opacity: backdropOpacity }]}
                        onPress={() => closeLiquiditySheet()}
                    />

                    <Animated.View
                        style={[
                            styles.sheetContent,
                            { transform: [{ translateY: sheetTranslateY }] }
                        ]}
                    >
                        <View {...sheetPanResponder.panHandlers} style={styles.dragZone}>
                            <View style={styles.sheetHandle} />
                            <Text style={styles.sheetTitle}>Manage liquidity</Text>
                            <Text style={styles.sheetSubtitle}>Move funds between your on-chain and lightning wallet.</Text>
                        </View>

                        <View style={styles.sheetButtonRow}>
                            <View style={styles.sheetActionCol}>
                                <TouchableOpacity
                                    style={styles.sheetPrimaryButton}
                                    onPress={() => {
                                        closeLiquiditySheet(() => navigation.navigate('LightningTopUp' as any));
                                    }}
                                >
                                    <Feather name="plus" size={18} color={theme.colors.inversePrimary} />
                                    <Text style={styles.sheetPrimaryButtonText}>Top-up</Text>
                                </TouchableOpacity>
                                <Text style={styles.sheetButtonSub}>On-chain to Lightning</Text>
                            </View>

                            <View style={styles.sheetActionCol}>
                                <TouchableOpacity
                                    style={styles.sheetPrimaryButton}
                                    onPress={() => {
                                        closeLiquiditySheet(() => navigation.navigate('WithdrawToOnchain' as any));
                                    }}
                                >
                                    <Feather name="minus" size={18} color={theme.colors.inversePrimary} />
                                    <Text style={styles.sheetPrimaryButtonText}>Withdraw</Text>
                                </TouchableOpacity>
                                <Text style={styles.sheetButtonSub}>Lightning to on-chain</Text>
                            </View>
                        </View>
                    </Animated.View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    absoluteFillOverride: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    sheetBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
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
    balanceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        width: '100%',
        marginBottom: 28,
        height: 50,
    },
    balanceSideSpacer: {
        flex: 1,
    },
    balanceSideSpacerRight: {
        flex: 1,
        alignItems: 'flex-start',
        paddingLeft: 16,
    },
    balanceContainer: {
        alignItems: 'center',
        justifyContent: 'center',
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
    liquidityPillSmall: {
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 20,
        paddingVertical: 6,
        paddingHorizontal: 6,
        gap: 6
    },
    actionsWrapper: {
        width: '100%',
        alignItems: 'center',
        height: 120,
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
    nfcRingWrapper: {
        width: 100,
        height: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sonarRing: {
        position: 'absolute',
        width: 100,
        height: 60,
        borderRadius: 10,
        borderWidth: 2,
        borderColor: theme.colors.primary,
    },
    iconCircle: {
        width: 100,
        height: 60,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primary,
        overflow: 'hidden',
    },
    chargeFill: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: theme.colors.muted + '55',
    },
    iconActionText: {
        color: theme.colors.primary,
        fontSize: 13,
        fontWeight: '500',
    },
    nfcHintIconOriginal: {
        position: 'absolute',
        top: 6,
        right: 8,
        opacity: 0.8,
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
    },
    sheetOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheetContent: {
        backgroundColor: theme.colors.background,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 48,
    },
    dragZone: {},
    sheetHandle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.border,
        alignSelf: 'center',
        marginBottom: 16,
    },
    sheetTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.primary,
        marginBottom: 8,
    },
    sheetSubtitle: {
        fontSize: 14,
        color: theme.colors.muted,
        marginBottom: 24,
    },
    sheetButtonRow: {
        flexDirection: 'row',
        gap: 16,
        marginTop: 4,
    },
    sheetActionCol: {
        flex: 1,
        alignItems: 'center',
        gap: 10,
    },
    sheetPrimaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.primary,
        paddingVertical: 14,
        borderRadius: 12,
        width: '100%',
        gap: 8,
    },
    sheetPrimaryButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.inversePrimary,
    },
    sheetButtonSub: {
        fontSize: 12,
        color: theme.colors.muted,
        textAlign: 'center',
        lineHeight: 16,
        paddingHorizontal: 4,
    },
});

export default WalletScreen;
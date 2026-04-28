import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    TextInput,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { fetchFeeEstimates, fetchUTXOs, broadcastTransaction } from '../services/bitcoin';

export const LightningTopUpScreen: React.FC = () => {
    const navigation = useNavigation();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const {
        activeWallet,
        isLightningInitialized,
        getLightningTopUpAddress,
        createAndSignTransaction,
        incrementChangeIndex,
        triggerRefresh
    } = useWallet();

    const onchainBalance = useMemo(() => {
        if (!activeWallet) return 0;
        return activeWallet.derivedAddressInfoCache.reduce((acc, curr) => acc + curr.balance, 0);
    }, [activeWallet]);

    const [amountStr, setAmountStr] = useState('');
    const [swapAddress, setSwapAddress] = useState<string | null>(null);
    const [limits, setLimits] = useState<{ minSats: number; maxSats: number } | null>(null);
    const [feeOptions, setFeeOptions] = useState<{ fast: number; normal: number; slow: number } | null>(null);

    const [selectedKey, setSelectedKey] = useState<'slow' | 'normal' | 'fast' | 'custom'>('normal');
    const [currentRate, setCurrentRate] = useState<number>(1);
    const [customRate, setCustomRate] = useState<string>('1');

    const [loadingData, setLoadingData] = useState(true);
    const [calculating, setCalculating] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [txMetrics, setTxMetrics] = useState<{ fee: number; hex: string; changeIndex: number | null, vsize: number, actualAmount: number } | null>(null);
    const [calculationError, setCalculationError] = useState<string | null>(null);

    useEffect(() => {
        const initData = async () => {
            try {
                if (!isLightningInitialized) return;

                const [fees, fetchedAddress] = await Promise.all([
                    fetchFeeEstimates(),
                    getLightningTopUpAddress()
                ]);

                setFeeOptions(fees);
                setSwapAddress(fetchedAddress);

                setCurrentRate(fees.normal);
                setCustomRate(fees.normal.toString());

            } catch (err: any) {
                console.error("[Breez Node UI] Init error:", err);
                Alert.alert("Initialization error", err.message || "Failed to connect to lightning node parameters.");
                navigation.goBack();
            } finally {
                setLoadingData(false);
            }
        };

        initData();
    }, [isLightningInitialized]);

    useEffect(() => {
        if (!amountStr || !activeWallet || !swapAddress) {
            setTxMetrics(null);
            setCalculationError(null);
            return;
        }
        
        const timer = setTimeout(() => {
            handleCalculate();
        }, 500);

        return () => clearTimeout(timer);
    }, [amountStr, activeWallet, swapAddress, currentRate, selectedKey]);

    
    const handleCalculate = async () => {
        if (!activeWallet || !swapAddress) return;
        const amountSats = parseInt(amountStr, 10);

        if (isNaN(amountSats) || amountSats <= 0) return;

        const minRequired = limits ? limits.minSats : 546;
        if (amountSats < minRequired) {
            setCalculationError(`Minimum: ${minRequired.toLocaleString()} sats`);
            return;
        }
        if (limits && amountSats > limits.maxSats) {
            setCalculationError(`Maximum: ${limits.maxSats.toLocaleString()} sats`);
            return;
        }

        setCalculating(true);
        setTxMetrics(null);
        setCalculationError(null);

        try {
            const fundedAddresses = activeWallet.derivedAddressInfoCache
                .filter(a => a.balance > 0)
                .map(a => a.address);

            if (fundedAddresses.length === 0) throw new Error("No funds available");

            const allUtxos = await fetchUTXOs(fundedAddresses);
            if (allUtxos.length === 0) throw new Error("No UTXOs found");

            allUtxos.sort((a: any, b: any) => b.value - a.value);
            let selectedUtxos = [];
            let accumulated = 0;
            let estimatedVsize = 0;
            let exactMinerFee = 0;
            let actualSendAmount = amountSats;

            for (const u of allUtxos) {
                selectedUtxos.push(u);
                accumulated += u.value;

                estimatedVsize = Math.ceil((selectedUtxos.length * 68) + (2 * 31) + 10.5);
                exactMinerFee = estimatedVsize * currentRate;

                if (accumulated >= amountSats + exactMinerFee) break;
            }

            if (accumulated < amountSats + exactMinerFee) {
                const totalBalance = allUtxos.reduce((sum, u) => sum + u.value, 0);
                const sweepVsize = Math.ceil((allUtxos.length * 68) + (1 * 31) + 10.5);
                const sweepFee = sweepVsize * currentRate;

                if (amountSats > totalBalance - sweepFee && amountSats <= totalBalance) {
                    actualSendAmount = amountSats - sweepFee;
                    selectedUtxos = allUtxos;
                    exactMinerFee = sweepFee;
                    estimatedVsize = sweepVsize;

                    if (actualSendAmount < minRequired) {
                        throw new Error(`Amount after fees (${actualSendAmount.toLocaleString()} sats) is below the minimum required.`);
                    }
                } else {
                    throw new Error(`Insufficient balance. Need ${(amountSats + exactMinerFee).toLocaleString()} sats`);
                }
            }

            const { txHex, usedChangeIndex } = await createAndSignTransaction(
                swapAddress,
                actualSendAmount,
                selectedUtxos,
                currentRate
            );

            if (!txHex) throw new Error("Failed to generate transaction hex.");

            estimatedVsize = Math.ceil((selectedUtxos.length * 68) + (usedChangeIndex !== null ? 2 : 1) * 31 + 10.5);
            exactMinerFee = estimatedVsize * currentRate;

            setTxMetrics({
                fee: exactMinerFee,
                hex: txHex,
                changeIndex: usedChangeIndex,
                vsize: estimatedVsize,
                actualAmount: actualSendAmount
            });

        } catch (err: any) {
            console.error("[Breez Node UI] Calculation Failed:", err);
            setCalculationError(err.message || "Transaction preparation failed");
        } finally {
            setCalculating(false);
        }
    };

    const handleExecuteTopUp = async () => {
        if (!txMetrics || !activeWallet) return;
        setExecuting(true);

        try {
            await broadcastTransaction(txMetrics.hex);
            if (txMetrics.changeIndex !== null) {
                await incrementChangeIndex(activeWallet.id, txMetrics.changeIndex);
            }
            triggerRefresh();
            Alert.alert(
                "Top-Up Initiated",
                "Your on-chain transaction has been broadcast. Your Lightning balance will update after 3 on-chain confirmations.",
                [{ text: "OK", onPress: () => navigation.goBack() }]
            );
        } catch (err: any) {
            Alert.alert("Broadcast Failed", err.message || "Failed to push transaction to the network.");
        } finally {
            setExecuting(false);
        }
    };

    const handleFeeSelection = (key: 'slow' | 'normal' | 'fast' | 'custom', rate: number) => {
        setSelectedKey(key);
        if (key !== 'custom') {
            setCurrentRate(rate);
            setCustomRate(rate.toString());
            setTxMetrics(null);
        }
    };

    const handleCustomRateChange = (text: string) => {
        setCustomRate(text);
        if (text && text.trim() !== '') {
            const rate = parseInt(text, 10);
            if (!isNaN(rate) && rate > 0) {
                setCurrentRate(rate);
                setTxMetrics(null);
            }
        }
    };

    const renderAddressChunks = () => {
        if (!swapAddress) return <Text style={styles.addressPreview}>Fetching...</Text>;
        const chunks = swapAddress.match(/.{1,6}/g) || [swapAddress];

        return (
            <Text style={styles.addressPreview} selectable>
                {chunks.map((chunk, index) => {
                    const isEdge = index === 0 || index === chunks.length - 1;
                    return (
                        <Text key={index} style={isEdge ? styles.orangeSymbol : undefined}>
                            {chunk}{index < chunks.length - 1 ? ' ' : ''}
                        </Text>
                    );
                })}
            </Text>
        );
    };

    if (loadingData || !feeOptions) {
        return (
            <SafeAreaView style={styles.centered} edges={['bottom', 'left', 'right']}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={styles.loadingText}>Synchronizing with Lightning Node...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={true}
                    bounces={false}
                >

                    <View style={styles.balanceContainer}>
                        <Text style={styles.balanceLabel}>Available to top up</Text>
                        <Text style={styles.balanceText}>
                            {new Intl.NumberFormat('en-US').format(onchainBalance)} sats
                        </Text>
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.label}>Top-up destination</Text>
                        <View style={styles.addressWrapper}>
                            {renderAddressChunks()}
                        </View>
                    </View>

                    <View style={[styles.section, styles.amountSection]}>
                        <Text style={styles.label}>Amount</Text>
                        <StyledInput
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={(t) => {
                                const cleanText = t.replace(/[^0-9]/g, '');
                                setAmountStr(cleanText);
                                if (cleanText !== amountStr) {
                                    setTxMetrics(null);
                                }
                            }}
                            placeholder="0"
                            editable={!executing}
                            rightElement={<Text style={styles.currencyLabel}>sats</Text>}
                        />
                        
                        {/* Alert is absolutely positioned to prevent any layout shifts */}
                        {calculationError && (
                            <View style={styles.statusMessageContainer}>
                                <Feather name="alert-circle" size={14} color={theme.colors.muted} />
                                <Text style={styles.statusText}> {calculationError}</Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.feeSelectorContainer}>
                        <Text style={styles.label}>Fee</Text>
                        <View style={styles.feeOptionsRow}>
                            {(['slow', 'normal', 'fast'] as const).map((key) => (
                                <TouchableOpacity
                                    key={key}
                                    onPress={() => handleFeeSelection(key, feeOptions[key])}
                                    style={[styles.feeOption, selectedKey === key && styles.feeOptionActive]}
                                    disabled={executing || calculating}
                                >
                                    <Text style={[styles.feeOptionText, selectedKey === key ? styles.feeOptionTextActive : {}]}>
                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                    </Text>
                                    <Text style={[styles.feeOptionRate, selectedKey === key ? styles.feeOptionRateActive : {}]}>
                                        {feeOptions[key]} s/vB
                                    </Text>
                                </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                                onPress={() => handleFeeSelection('custom', parseInt(customRate, 10) || 1)}
                                style={[styles.feeOption, selectedKey === 'custom' && styles.feeOptionActive]}
                                disabled={executing || calculating}
                            >
                                <Text style={[styles.feeOptionText, selectedKey === 'custom' ? styles.feeOptionTextActive : {}]}>Custom</Text>
                                <Text style={[styles.feeOptionRate, selectedKey === 'custom' ? styles.feeOptionRateActive : {}]}>Edit</Text>
                            </TouchableOpacity>
                        </View>
                        {selectedKey === 'custom' && (
                            <View style={styles.customFeeContainer}>
                                <Text style={styles.customFeeLabel}>Rate (sat/vB):</Text>
                                <TextInput
                                    style={styles.customFeeInput}
                                    keyboardType="numeric"
                                    value={customRate}
                                    onChangeText={handleCustomRateChange}
                                    placeholder="0"
                                    keyboardAppearance={isDark ? 'dark' : 'light'}
                                    placeholderTextColor={theme.colors.muted}
                                />
                            </View>
                        )}
                    </View>

                    <View style={styles.summaryBox}>
                        {txMetrics ? (
                            <>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>Transaction size</Text>
                                    <Text style={styles.value}>{txMetrics.vsize} vbytes</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>Total miner fee</Text>
                                    <View style={styles.valueContainer}>
                                        <Text style={styles.value}>{txMetrics.fee.toLocaleString()} sats</Text>
                                    </View>
                                </View>
                            </>
                        ): null}

                        {!calculationError && calculating ? (
                            <View style={styles.detailRow}>
                                <Text style={styles.statusText}>Calculating...</Text>
                            </View>
                        ) : txMetrics ? (
                            <View style={styles.detailRow}>
                                <Text style={styles.totalLabel}>Total</Text>
                                <Text style={styles.totalValue}>
                                    {`${(txMetrics.actualAmount + txMetrics.fee).toLocaleString()} sats`}
                                </Text>
                            </View>
                        ) : null}

                        <TouchableOpacity
                            key={`confirm-button-${txMetrics ? 'enabled' : 'disabled'}-${executing ? 'executing' : 'idle'}`}
                            style={[styles.confirmButton, (!txMetrics || executing) && styles.buttonDisabled]}
                            onPress={handleExecuteTopUp}
                            disabled={!txMetrics || executing}
                        >
                            {executing ? (
                                <ActivityIndicator color={theme.colors.inversePrimary} />
                            ) : (
                                <View style={styles.buttonContentRowCentered}>
                                    <Feather name="arrow-up-circle" size={18} color={theme.colors.inversePrimary} />
                                    <Text style={styles.buttonText}>Confirm & top-up</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.background,
    },
    loadingText: {
        marginTop: 16,
        color: theme.colors.muted,
        fontFamily: 'SpaceMono-Regular',
    },
    scrollContent: {
        padding: 24,
        paddingBottom: 400,
        flexGrow: 1,
    },
    balanceContainer: {
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 32,
    },
    balanceLabel: {
        fontSize: 16,
        color: theme.colors.muted,
    },
    balanceText: {
        fontSize: 36,
        fontFamily: 'SpaceMono-Bold',
        fontWeight: 'bold',
        color: theme.colors.primary,
        includeFontPadding: false,
        textAlignVertical: 'center'
    },
    section: {
        marginBottom: 32,
        position: 'relative',
    },
    amountSection: {
        zIndex: 10,
    },
    label: {
        fontSize: 16,
        fontWeight: '500',
        color: theme.colors.primary,
        marginBottom: 8,
    },
    addressWrapper: {
        backgroundColor: theme.colors.surface,
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    currencyLabel: {
        fontSize: 16,
        color: theme.colors.primary,
        fontFamily: 'SpaceMono-Bold',
        marginRight: 16,
    },
    limitText: {
        fontSize: 12,
        color: theme.colors.muted,
        marginTop: 8,
        textAlign: 'left',
    },
    addressPreview: {
        fontSize: 14,
        fontFamily: 'monospace',
        color: theme.colors.primary,
        lineHeight: 22,
    },
    feeSelectorContainer: {
        marginBottom: 32,
        zIndex: 1,
    },
    feeOptionsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    feeOption: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
    feeOptionActive: {
        backgroundColor: theme.colors.primary,
        borderColor: theme.colors.primary,
    },
    feeOptionText: {
        color: theme.colors.primary,
        fontWeight: '600',
        fontSize: 12,
    },
    feeOptionTextActive: {
        color: theme.colors.inversePrimary,
    },
    feeOptionRate: {
        color: theme.colors.muted,
        fontSize: 11,
        marginTop: 2,
    },
    feeOptionRateActive: {
        color: theme.colors.inversePrimary,
    },
    customFeeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        backgroundColor: theme.colors.surface,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    customFeeLabel: {
        fontSize: 14,
        marginRight: 12,
        color: theme.colors.primary,
    },
    customFeeInput: {
        flex: 1,
        backgroundColor: theme.colors.background,
        borderWidth: 1,
        borderColor: theme.colors.border,
        color: theme.colors.primary,
        borderRadius: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
        fontSize: 16,
        fontFamily: 'SpaceMono-Regular',
    },
    summaryBox: {
        paddingTop: 24,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    value: {
        fontSize: 16,
        color: theme.colors.primary,
        fontFamily: 'monospace',
    },
    valueContainer: {
        alignItems: 'flex-end',
    },
    totalLabel: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    totalValue: {
        fontSize: 16,
        color: theme.colors.primary,
    },
    orangeSymbol: {
        color: theme.colors.bitcoin,
        fontWeight: 'bold',
    },
    confirmButton: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        marginTop: 8,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    buttonText: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    buttonContentRowCentered: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    statusMessageContainer: {
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    statusText: {
        fontSize: 14,
        color: theme.colors.muted,
        flex: 1,
    },
});
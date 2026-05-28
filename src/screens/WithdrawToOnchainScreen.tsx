import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    Keyboard
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { validateBitcoinAddress } from '../services/bitcoin';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import * as Clipboard from 'expo-clipboard';

export const WithdrawToOnchainScreen: React.FC = () => {
    const navigation = useNavigation<any>();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const { scrollViewRef, paddingBottom, handleInputFocus } = useKeyboardScroll({
        basePaddingBottom: styles.scrollContent.paddingBottom,
    });

    const MIN_WITHDRAW_SATS = 1000;

    const {
        activeWallet,
        isLightningInitialized,
        lightningBalance,
        prepareWithdrawToOnchain,
        withdrawToOnchain,
        triggerRefresh
    } = useWallet();

    const [amountStr, setAmountStr] = useState('');
    const [destMode, setDestMode] = useState<'own' | 'custom'>('own');
    const [ownAddress, setOwnAddress] = useState<string>('');
    const [customAddress, setCustomAddress] = useState<string>('');
    const [selectedFeeTier, setSelectedFeeTier] = useState<'slow' | 'normal' | 'fast'>('normal');

    const [reviewStatus, setReviewStatus] = useState<'idle' | 'reviewing' | 'reviewed'>('idle');
    const [executing, setExecuting] = useState(false);
    
    const [localValidationErr, setLocalValidationErr] = useState<string | null>(null);
    const [calculationError, setCalculationError] = useState<string | null>(null);
    const [feeEstimates, setFeeEstimates] = useState<{ slow: number; normal: number; fast: number } | null>(null);

    const [txMetrics, setTxMetrics] = useState<{ totalFeeSats: number; prepareResponse: any } | null>(null);

    useEffect(() => {
        if (activeWallet) {
            setOwnAddress(activeWallet.address);
        }
    }, [activeWallet]);

    useEffect(() => {
        const fetchFeeEstimates = async () => {
            if (!activeWallet || !isLightningInitialized) return;

            try {
                const sampleAmount = 10000; 
                const sampleAddress = activeWallet.address;

                const estimates = await Promise.all([
                    prepareWithdrawToOnchain(sampleAddress, sampleAmount, 'slow').catch(() => null),
                    prepareWithdrawToOnchain(sampleAddress, sampleAmount, 'normal').catch(() => null),
                    prepareWithdrawToOnchain(sampleAddress, sampleAmount, 'fast').catch(() => null)
                ]);

                const extractFee = (estimate: any) => {
                    if (!estimate || !estimate.prepareResponse) return 0;
                    const quote = estimate.prepareResponse?.paymentMethod?.inner?.feeQuote;
                    const tierKey = estimate.feeTier === 'fast' ? 'speedFast' :
                        estimate.feeTier === 'slow' ? 'speedSlow' : 'speedMedium';
                    const speedObj = quote?.[tierKey];
                    return Number(speedObj?.l1BroadcastFeeSat || 0);
                };

                const slowFee = extractFee({ ...estimates[0], feeTier: 'slow' });
                const normalFee = extractFee({ ...estimates[1], feeTier: 'normal' });

                let fastFee = 0;
                if (estimates[2]) {
                    fastFee = extractFee({ ...estimates[2], feeTier: 'fast' });
                } else if (estimates[0] || estimates[1]) {
                    const successfulEstimate = estimates[0] || estimates[1];
                    const quote = successfulEstimate?.prepareResponse?.paymentMethod?.inner?.feeQuote;
                    const fastSpeedObj = quote?.speedFast;
                    fastFee = Number(fastSpeedObj?.l1BroadcastFeeSat || 0);
                }

                setFeeEstimates({
                    slow: slowFee,
                    normal: normalFee,
                    fast: fastFee
                });
            } catch (error) {
                console.error('Failed to fetch fee estimates:', error);
            }
        };

        fetchFeeEstimates();
    }, [activeWallet, isLightningInitialized]);

    useEffect(() => {
        if (reviewStatus === 'reviewed') {
            setTimeout(() => {
                if (scrollViewRef.current) {
                    scrollViewRef.current.scrollToEnd({ animated: true });
                }
            }, 150);
        }
    }, [reviewStatus]);

    const activeDestination = destMode === 'own' ? ownAddress : customAddress;
    
    const resetReviewState = () => {
        setTxMetrics(null);
        setCalculationError(null);
        setReviewStatus('idle');
    };

    const handleAmountChange = (val: string) => {
        const numericStr = val.replace(/[^0-9]/g, '');
        setAmountStr(numericStr);
        resetReviewState();
        
        const numSats = parseInt(numericStr, 10);
        if (!numericStr || isNaN(numSats)) {
            setLocalValidationErr(null);
        } else if (numSats < MIN_WITHDRAW_SATS) {
            setLocalValidationErr(`Minimum is ${MIN_WITHDRAW_SATS} sats`);
        } else if (numSats > lightningBalance) {
            setLocalValidationErr("Amount exceeds balance");
        } else {
            setLocalValidationErr(null);
        }
    };

    const handleReview = async () => {
        Keyboard.dismiss();
        if (!activeWallet || !activeDestination) return;
        const amountSats = parseInt(amountStr, 10);

        if (isNaN(amountSats) || amountSats <= 0 || localValidationErr) {
            return;
        }

        if (!validateBitcoinAddress(activeDestination)) {
            setCalculationError("Address is invalid");
            return;
        }

        setReviewStatus('reviewing');
        setCalculationError(null);

        try {
            const estimate = await prepareWithdrawToOnchain(activeDestination, amountSats, selectedFeeTier);

            let totalFeeSats = Math.ceil((estimate.senderFeeMsat + estimate.recipientFeeMsat) / 1000);

            if (totalFeeSats === 0 && estimate.prepareResponse) {
                const pr = estimate.prepareResponse;
                const pm = pr.paymentMethod?.inner || pr.paymentMethod;

                let tierKey = 'speedMedium';
                if (selectedFeeTier === 'fast') tierKey = 'speedFast';
                if (selectedFeeTier === 'slow') tierKey = 'speedSlow';

                const possibleFees = [
                    pm?.feeQuote?.[tierKey]?.totalFeeSat,
                    pm?.feeQuote?.[tierKey]?.fee,
                    pr.feeSats, pr.feesFeeSats, pr.fee, pr.fees,
                    pm?.fee, pm?.totalFeeSat, pm?.fees, pm?.lightningFeeSats
                ];

                for (const fee of possibleFees) {
                    if (fee !== undefined && fee !== null) {
                        const parsedFee = Number(fee);
                        if (parsedFee > 0) {
                            totalFeeSats = parsedFee;
                            break;
                        }
                    }
                }
            }

            if (amountSats + totalFeeSats > lightningBalance) {
                setCalculationError("Insufficient funds for fees");
                setReviewStatus('idle');
                return;
            }

            setTxMetrics({ totalFeeSats, prepareResponse: estimate.prepareResponse });
            setReviewStatus('reviewed');
        } catch (err: any) {
            let errorMsg = err.message || "Could not prepare the withdrawal transaction.";
            if (errorMsg.toLowerCase().includes("invalidinput") || errorMsg.toLowerCase().includes("invalid input")) {
                errorMsg = "Amount is too low";
            }
            setCalculationError(errorMsg);
            setReviewStatus('idle');
        }
    };

    const handleExecuteWithdrawal = async () => {
        if (!txMetrics || !activeWallet || !activeDestination) return;

        setExecuting(true);

        try {
            await withdrawToOnchain(txMetrics.prepareResponse, selectedFeeTier);
            triggerRefresh();
            Alert.alert(
                "Withdrawal initiated",
                "Your swap is in progress. Funds will appear in the on-chain balance shortly.",
                [{ text: "OK", onPress: () => navigation.goBack() }]
            );
        } catch (err: any) {
            Alert.alert("Withdrawal failed", err.message || "Failed to execute swap.");
        } finally {
            setExecuting(false);
        }
    };

    const renderAddressChunks = (address: string) => {
        if (!address) return null;
        const chunks = address.match(/.{1,6}/g) || [address];
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

    const displayError = localValidationErr || calculationError;
    const canReview = amountStr.length > 0 && !localValidationErr && activeDestination;

    return (
        <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    ref={scrollViewRef}
                    contentContainerStyle={[styles.scrollContent, { paddingBottom }]}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={true}
                    bounces={false}
                >

                    <View style={styles.balanceContainer}>
                        <Text style={styles.balanceLabel}>Available to withdraw</Text>
                        <Text style={styles.balanceText}>
                            {new Intl.NumberFormat('en-US').format(lightningBalance)} sats
                        </Text>
                    </View>

                    <View style={styles.section}>
                        <Text style={styles.label}>Withdraw to</Text>
                        <View style={styles.toggleContainer}>
                            <TouchableOpacity
                                style={[styles.toggleButton, destMode === 'own' && styles.toggleButtonActive]}
                                onPress={() => { setDestMode('own'); resetReviewState(); }}
                            >
                                <Text style={[styles.toggleText, destMode === 'own' && styles.toggleTextActive]}>My wallet</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.toggleButton, destMode === 'custom' && styles.toggleButtonActive]}
                                onPress={() => { setDestMode('custom'); resetReviewState(); }}
                            >
                                <Text style={[styles.toggleText, destMode === 'custom' && styles.toggleTextActive]}>External</Text>
                            </TouchableOpacity>
                        </View>

                        {destMode === 'own' ? (
                            <View style={styles.ownAddressContainer}>
                                <Text style={styles.label}>Address</Text>
                                <View style={styles.addressWrapper}>
                                    {renderAddressChunks(ownAddress)}
                                </View>
                                <Text style={styles.derivationPathText}>
                                    Derivation path: {activeWallet?.derivation_path || "m/84'/0'/0'"}/0/{activeWallet?.receiveAddressIndex}
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.customAddressWrapper}>
                                <Text style={styles.label}>Address</Text>
                                <StyledInput
                                    value={customAddress}
                                    onChangeText={(t) => { setCustomAddress(t); resetReviewState(); }}
                                    placeholder="bc1q..."
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    spellCheck={false}
                                    rightElement={
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <TouchableOpacity
                                                onPress={async () => {
                                                    const text = await Clipboard.getStringAsync();
                                                    if (text) {
                                                        setCustomAddress(text);
                                                        resetReviewState();
                                                    }
                                                }}
                                                style={styles.iconButton}
                                            >
                                                <Feather name="clipboard" size={20} color={theme.colors.primary} />
                                            </TouchableOpacity>

                                            <TouchableOpacity onPress={() => {
                                                const params = {
                                                    onScanSuccess: (data: string) => {
                                                        setCustomAddress(data);
                                                        resetReviewState();
                                                    }
                                                };
                                                navigation.navigate('QRScanner', params);
                                            }} style={styles.iconButton}>
                                                <Feather name="camera" size={20} color={theme.colors.primary} />
                                            </TouchableOpacity>
                                        </View>
                                    }
                                />
                                {customAddress.length > 0 && (
                                    <View style={{ marginTop: 8 }}>
                                        {renderAddressChunks(customAddress)}
                                    </View>
                                )}
                            </View>
                        )}
                    </View>

                    <View style={[styles.section, styles.amountSection]}>
                        <Text style={styles.label}>Amount</Text>
                        <StyledInput
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={handleAmountChange}
                            onFocus={handleInputFocus}
                            placeholder={`Min ${MIN_WITHDRAW_SATS} sats`}
                            editable={!executing && reviewStatus !== 'reviewing'}
                            rightElement={<Text style={styles.currencyLabel}>sats</Text>}
                            blurOnSubmit={false}
                        />

                        <View style={styles.staticErrorContainer}>
                            {displayError && (
                                <>
                                    <Feather name="alert-circle" size={14} color={theme.colors.muted} />
                                    <Text style={styles.statusText}> {displayError}</Text>
                                </>
                            )}
                        </View>
                    </View>

                    <View style={styles.feeSelectorContainer}>
                        <Text style={styles.label}>On-chain settlement priority</Text>
                        <View style={styles.feeOptionsContainer}>
                            <View style={styles.feeOptionsRow}>
                                {(['slow', 'normal', 'fast'] as const).map((key) => (
                                    <TouchableOpacity
                                        key={key}
                                        onPress={() => { setSelectedFeeTier(key); resetReviewState(); }}
                                        style={[styles.feeOption, selectedFeeTier === key && styles.feeOptionActive]}
                                        disabled={executing || reviewStatus === 'reviewing'}
                                    >
                                        <Text style={[styles.feeOptionText, selectedFeeTier === key ? styles.feeOptionTextActive : {}]}>
                                            {key.charAt(0).toUpperCase() + key.slice(1)}
                                        </Text>
                                        <Text style={[styles.feeOptionRate, selectedFeeTier === key ? styles.feeOptionRateActive : {}]}>
                                            {feeEstimates ? `${feeEstimates[key].toLocaleString()} sats` : '~ sats'}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </View>

                    <View style={styles.summaryBox}>
                        {reviewStatus === 'reviewed' && txMetrics ? (
                            <View style={styles.expandedSummary}>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>Miner fee</Text>
                                    <View style={styles.valueContainer}>
                                        <Text style={styles.value}>
                                            {(() => {
                                                const quote = txMetrics.prepareResponse?.paymentMethod?.inner?.feeQuote;

                                                let tierKey = 'speedMedium';
                                                if (selectedFeeTier === 'fast') tierKey = 'speedFast';
                                                if (selectedFeeTier === 'slow') tierKey = 'speedSlow';

                                                const speedObj = quote?.[tierKey];
                                                return Number(speedObj?.l1BroadcastFeeSat || 0).toLocaleString();
                                            })()} sats
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>LSP fee</Text>
                                    <View style={styles.valueContainer}>
                                        <Text style={styles.value}>
                                            {(() => {
                                                const quote = txMetrics.prepareResponse?.paymentMethod?.inner?.feeQuote;
                                                let tierKey = 'speedMedium';
                                                if (selectedFeeTier === 'fast') tierKey = 'speedFast';
                                                if (selectedFeeTier === 'slow') tierKey = 'speedSlow';

                                                const speedObj = quote?.[tierKey];
                                                return Number(speedObj?.userFeeSat || 0).toLocaleString();
                                            })()} sats
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>Total fees</Text>
                                    <Text style={styles.totalValue}>
                                        {txMetrics.totalFeeSats.toLocaleString()} sats
                                    </Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.totalLabel}>Total Deduction</Text>
                                    <Text style={styles.totalValue}>
                                        {(parseInt(amountStr, 10) + txMetrics.totalFeeSats).toLocaleString()} sats
                                    </Text>
                                </View>
                            </View>
                        ) : null}

                        {reviewStatus === 'idle' && (
                            <TouchableOpacity
                                style={[styles.confirmButton, (!canReview || !isLightningInitialized) && styles.buttonDisabled]}
                                onPress={handleReview}
                                disabled={!canReview || !isLightningInitialized}
                            >
                                <View style={styles.buttonContentRowCentered}>
                                    <Feather name="eye" size={18} color={theme.colors.inversePrimary} />
                                    <Text style={styles.buttonText}>Review withdrawal</Text>
                                </View>
                            </TouchableOpacity>
                        )}

                        {reviewStatus === 'reviewing' && (
                            <View style={styles.confirmButton}>
                                <ActivityIndicator color={theme.colors.inversePrimary} />
                            </View>
                        )}

                        {reviewStatus === 'reviewed' && txMetrics && (
                            <TouchableOpacity
                                style={styles.confirmButton}
                                onPress={handleExecuteWithdrawal}
                                disabled={executing}
                            >
                                {executing ? (
                                    <ActivityIndicator color={theme.colors.inversePrimary} />
                                ) : (
                                    <View style={styles.buttonContentRowCentered}>
                                        <Feather name="arrow-down-circle" size={18} color={theme.colors.inversePrimary} />
                                        <Text style={styles.buttonText}>Confirm withdrawal</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        )}
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
    scrollContent: {
        padding: 24,
        paddingBottom: 120,
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
        marginBottom: 24,
    },
    amountSection: {
        marginBottom: 8,
    },
    label: {
        fontSize: 16,
        fontWeight: '500',
        color: theme.colors.primary,
        marginBottom: 8,
    },
    currencyLabel: {
        fontSize: 16,
        color: theme.colors.primary,
        fontFamily: 'SpaceMono-Bold',
        marginRight: 16,
    },
    toggleContainer: {
        flexDirection: 'row',
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 4,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    toggleButton: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderRadius: 6,
    },
    toggleButtonActive: {
        backgroundColor: theme.colors.primary,
    },
    toggleText: {
        color: theme.colors.muted,
        fontWeight: '600',
        fontSize: 14,
    },
    toggleTextActive: {
        color: theme.colors.inversePrimary,
    },
    ownAddressContainer: {
        marginTop: 4,
    },
    addressWrapper: {
        backgroundColor: theme.colors.surface,
        padding: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: 10,
    },
    customAddressWrapper: {
        marginTop: 4,
    },
    iconButton: {
        padding: 8,
    },
    addressPreview: {
        fontSize: 14,
        fontFamily: 'monospace',
        color: theme.colors.primary,
        lineHeight: 22,
    },
    derivationPathText: {
        fontSize: 12,
        color: theme.colors.muted,
        fontFamily: 'monospace',
    },
    feeSelectorContainer: {
        marginBottom: 32,
    },
    feeOptionsContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 4,
        borderWidth: 1,
        borderColor: theme.colors.border,
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
        backgroundColor: theme.colors.surface,
        alignItems: 'center',
    },
    feeOptionActive: {
        backgroundColor: theme.colors.primary,
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
    confirmButton: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        marginTop: 8,
    },
    staticErrorContainer: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    statusText: {
        fontSize: 14,
        color: theme.colors.muted,
    },
    summaryBox: {
        paddingTop: 24,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
    },
    expandedSummary: {
        marginBottom: 16,
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
        fontFamily: 'monospace',
    },
    orangeSymbol: {
        color: theme.colors.bitcoin,
        fontWeight: 'bold',
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
    }
});
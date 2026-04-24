import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
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
import { validateBitcoinAddress } from '../services/bitcoin';

const btcFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
});

export const WithdrawToOnchainScreen: React.FC = () => {
    const navigation = useNavigation<any>();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

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

    const [calculating, setCalculating] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [autoCalculateTrigger, setAutoCalculateTrigger] = useState(0);
    const [calculationError, setCalculationError] = useState<string | null>(null);

    const [txMetrics, setTxMetrics] = useState<{ totalFeeSats: number; prepareResponse: any } | null>(null);

    useEffect(() => {
        if (activeWallet) {
            setOwnAddress(activeWallet.address);
        }
    }, [activeWallet]);

    const activeDestination = destMode === 'own' ? ownAddress : customAddress;

    // Auto-calculate fees when amount or fee tier changes
    useEffect(() => {
        if (amountStr && activeDestination && !executing) {
            const amountSats = parseInt(amountStr, 10);
            if (!isNaN(amountSats)) {
                const timer = setTimeout(() => {
                    handleCalculate();
                }, 800); // Debounce for 800ms
                return () => clearTimeout(timer);
            } else {
                setTxMetrics(null);
                setCalculationError(null);
            }
        } else {
            setTxMetrics(null);
            setCalculationError(null);
        }
    }, [amountStr, selectedFeeTier, activeDestination, autoCalculateTrigger]);

    const handleCalculate = async () => {
        if (!activeWallet || !activeDestination) return;
        const amountSats = parseInt(amountStr, 10);

        if (isNaN(amountSats) || amountSats <= 0) return;

        console.log('=== WITHDRAW FEE CALCULATION ===');
        console.log('Amount:', amountSats, 'sats');
        console.log('Destination:', activeDestination);
        console.log('Fee tier:', selectedFeeTier);

        if (!validateBitcoinAddress(activeDestination)) {
            setCalculationError("Address is invalid");
            return;
        }

        if (amountSats > lightningBalance) {
            setCalculationError("Amount exceeds balance");
            return;
        }

        setCalculating(true);
        setTxMetrics(null);
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
                return;
            }

            setTxMetrics({ totalFeeSats, prepareResponse: estimate.prepareResponse });
        } catch (err: any) {
            let errorMsg = err.message || "Could not prepare the withdrawal transaction.";
            if (errorMsg.toLowerCase().includes("invalidinput") || errorMsg.toLowerCase().includes("invalid input")) {
                errorMsg = "Amount is too low";
            }
            setCalculationError(errorMsg);
        } finally {
            setCalculating(false);
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

    return (
        <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
            <KeyboardAvoidingView>
                <ScrollView 
                    contentContainerStyle={styles.scrollContent} 
                    bounces={false}
                    keyboardShouldPersistTaps="handled"
                    automaticallyAdjustKeyboardInsets={true}
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
                                onPress={() => { setDestMode('own'); setTxMetrics(null); }}
                            >
                                <Text style={[styles.toggleText, destMode === 'own' && styles.toggleTextActive]}>My wallet</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.toggleButton, destMode === 'custom' && styles.toggleButtonActive]}
                                onPress={() => { setDestMode('custom'); setTxMetrics(null); }}
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
                                    onChangeText={(t) => { setCustomAddress(t); setTxMetrics(null); }}
                                    placeholder="bc1q..."
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    rightElement={
                                        <TouchableOpacity onPress={() => {
                                            const params = { 
                                                onScanSuccess: (data: string) => {
                                                    setCustomAddress(data);
                                                    setTxMetrics(null);
                                                }
                                            };
                                            navigation.navigate('QRScanner', params);
                                        }} style={styles.iconButton}>
                                            <Feather name="camera" size={20} color={theme.colors.primary} />
                                        </TouchableOpacity>
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

                    <View style={styles.section}>
                        <Text style={styles.label}>Amount</Text>
                        <StyledInput
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={(t) => {
                                setAmountStr(t.replace(/[^0-9]/g, ''));
                                setTxMetrics(null);
                            }}
                            placeholder="0"
                            editable={!executing}
                            rightElement={<Text style={styles.currencyLabel}>sats</Text>}
                            blurOnSubmit={false}
                        />
                        
                        {/* Always rendered to prevent height jumping */}
                        <View style={styles.feeEstimateRow}>
                            {calculationError ? (
                                <View style={styles.feeEstimateContent}>
                                    <Feather name="alert-circle" size={14} color={theme.colors.muted} />
                                    <Text style={styles.feeEstimateText}>
                                        {calculationError}
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.feeEstimateContent}>
                                    <Feather name="zap" size={14} color={theme.colors.muted} />
                                    <Text style={styles.feeEstimateText}>
                                        {calculating 
                                            ? 'Estimating fees...' 
                                            : (txMetrics !== null 
                                                ? (() => {
                                                    const quote = txMetrics.prepareResponse?.paymentMethod?.inner?.feeQuote;
                                                    let tierKey = 'speedMedium';
                                                    if (selectedFeeTier === 'fast') tierKey = 'speedFast';
                                                    if (selectedFeeTier === 'slow') tierKey = 'speedSlow';
                                                    
                                                    const speedObj = quote?.[tierKey];
                                                    const l1Fee = Number(speedObj?.l1BroadcastFeeSat || 0);
                                                    const lspFee = Number(speedObj?.userFeeSat || 0);
                                                    
                                                    if (l1Fee > 0 && lspFee > 0) {
                                                        return `Fees: ${l1Fee} (L1) + ${lspFee} (LSP) = ${txMetrics.totalFeeSats} sats`;
                                                    } else {
                                                        return `Fees: ~${txMetrics.totalFeeSats} sats`;
                                                    }
                                                })()
                                                : 'Fees: ~')}
                                    </Text>
                                </View>
                            )}
                        </View>

                    <View style={[styles.feeSelectorContainer, { marginBottom: 16 }]}>
                        <Text style={styles.label}>On-chain settlement priority</Text>
                        <View style={styles.feeOptionsContainer}>
                            <View style={styles.feeOptionsRow}>
                                {(['slow', 'normal', 'fast'] as const).map((key) => (
                                    <TouchableOpacity
                                        key={key}
                                        onPress={() => { setSelectedFeeTier(key); setTxMetrics(null); }}
                                        style={[styles.feeOption, selectedFeeTier === key && styles.feeOptionActive]}
                                        disabled={executing || calculating}
                                    >
                                        <Text style={[styles.feeOptionText, selectedFeeTier === key ? styles.feeOptionTextActive : {}]}>
                                            {key.charAt(0).toUpperCase() + key.slice(1)}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    </View>
                        
                        {/* Always rendered to prevent height jumping */}
                        <View style={styles.totalAmountContainer}>
                            <View style={styles.detailRow}>
                                <Text style={styles.totalLabel}>Total</Text>
                                <Text style={styles.totalValue}>
                                    {txMetrics && amountStr 
                                        ? `${(parseInt(amountStr, 10) + txMetrics.totalFeeSats).toLocaleString()} sats` 
                                        : '~ sats'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.confirmButton, (!amountStr || !isLightningInitialized || !activeDestination || !txMetrics) && styles.buttonDisabled]}
                        onPress={handleExecuteWithdrawal}
                        disabled={!amountStr || !isLightningInitialized || !activeDestination || !txMetrics || executing}
                    >
                        {executing ? (
                            <ActivityIndicator color={theme.colors.inversePrimary} />
                        ) : (
                            <View style={styles.buttonContentRowCentered}>
                                <Feather name="minus-circle" size={18} color={theme.colors.inversePrimary} />
                                <Text style={styles.buttonText}>Confirm withdrawal</Text>
                            </View>
                        )}
                    </TouchableOpacity>
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
        paddingBottom: 350,
    },
    balanceContainer: {
        alignItems: 'center',
        marginBottom: 16,
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
    label: {
        fontSize: 16,
        fontWeight: '500',
        color: theme.colors.primary,
        marginBottom: 8,
    },
    balanceRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
        marginBottom: 16,
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
        marginBottom: 8,
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
        marginBottom: 0,
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
        paddingVertical: 12,
        borderRadius: 8,
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
        fontSize: 14,
    },
    feeOptionTextActive: {
        color: theme.colors.inversePrimary,
    },
    confirmButton: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        marginTop: 6,
    },
    feeEstimateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        marginBottom: 16,
        minHeight: 20, // Prevents collapse when content switches
    },
    feeEstimateContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    feeEstimateText: {
        fontSize: 13,
        color: theme.colors.muted,
    },
    errorText: {
        fontSize: 13,
        color: theme.colors.muted,
    },
    totalAmountContainer: {
        paddingTop: 16,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
        marginTop: 8,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
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
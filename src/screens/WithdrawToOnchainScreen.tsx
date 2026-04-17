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

const btcFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 8,
    minimumFractionDigits: 8,
});

const formatBalance = (sats: number) => {
    const btc = (sats || 0) / 100000000;
    return btcFormatter.format(btc).replace(/,/g, ' ');
};

export const WithdrawToOnchainScreen: React.FC = () => {
    const navigation = useNavigation();
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

    const [txMetrics, setTxMetrics] = useState<{ totalFeeSats: number; prepareResponse: any } | null>(null);

    useEffect(() => {
        if (activeWallet) {
            setOwnAddress(activeWallet.address);
        }
    }, [activeWallet]);

    const activeDestination = destMode === 'own' ? ownAddress : customAddress;

    const handleCalculate = async () => {
        if (!activeWallet || !activeDestination) return;
        const amountSats = parseInt(amountStr, 10);

        if (isNaN(amountSats) || amountSats <= 0) return;

        if (amountSats > lightningBalance) {
            Alert.alert("Insufficient balance", `You only have ${lightningBalance.toLocaleString()} sats available.`);
            return;
        }

        setCalculating(true);
        setTxMetrics(null);

        try {
            const estimate = await prepareWithdrawToOnchain(activeDestination, amountSats, selectedFeeTier);
            const totalFeeSats = Math.ceil((estimate.senderFeeMsat + estimate.recipientFeeMsat) / 1000);

            if (amountSats + totalFeeSats > lightningBalance) {
                throw new Error(`Insufficient balance to cover swap fees. Total required: ${(amountSats + totalFeeSats).toLocaleString()} sats.`);
            }

            setTxMetrics({ totalFeeSats, prepareResponse: estimate.prepareResponse });
        } catch (err: any) {
            Alert.alert("Calculation failed", err.message || "Could not prepare the withdrawal transaction.");
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
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>

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
                                />
                            </View>
                        )}
                    </View>

                    <View style={styles.section}>
                        <View style={styles.balanceRow}>
                            <Text style={styles.label}>Amount</Text>
                        </View>
                        <StyledInput
                            keyboardType="numeric"
                            value={amountStr}
                            onChangeText={(t) => {
                                setAmountStr(t.replace(/[^0-9]/g, ''));
                                setTxMetrics(null);
                            }}
                            placeholder="0"
                            editable={!executing && !calculating}
                            rightElement={<Text style={styles.currencyLabel}>sats</Text>}
                        />
                    </View>

                    <View style={styles.feeSelectorContainer}>
                        <Text style={styles.label}>On-chain settlement priority</Text>
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

                    {txMetrics ? (
                        <View style={styles.summaryBox}>
                            <View style={styles.detailRow}>
                                <Text style={styles.label}>LSP & routing fees</Text>
                                <View style={styles.valueContainer}>
                                    <Text style={styles.value}>{txMetrics.totalFeeSats.toLocaleString()} sats</Text>
                                </View>
                            </View>

                            <View style={styles.separator} />
                            <View style={styles.detailRow}>
                                <Text style={styles.totalLabel}>Total deducted</Text>
                                <Text style={styles.totalValue}>
                                    {((parseInt(amountStr, 10) + txMetrics.totalFeeSats) / 100000000).toFixed(8)} <Text style={styles.orangeSymbol}>₿</Text>
                                </Text>
                            </View>

                            <TouchableOpacity
                                style={[styles.confirmButton, executing && styles.buttonDisabled]}
                                onPress={handleExecuteWithdrawal}
                                disabled={executing}
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
                        </View>
                    ) : (
                        <TouchableOpacity
                            style={[styles.confirmButton, styles.calculateButton, (!amountStr || !isLightningInitialized || !activeDestination) && styles.buttonDisabled]}
                            onPress={handleCalculate}
                            disabled={calculating || !amountStr || !isLightningInitialized || !activeDestination}
                        >
                            {calculating ? (
                                <ActivityIndicator color={theme.colors.inversePrimary} />
                            ) : (
                                <View style={styles.buttonContentRowCentered}>
                                    <Text style={styles.buttonText}>Calculate fees</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    )}
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
    scrollContent: {
        padding: 24,
        paddingBottom: 40,
    },
    balanceContainer: {
        alignItems: 'center',
        paddingVertical: 16,
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
        paddingVertical: 10,
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
    feeOptionsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    feeOption: {
        flex: 1,
        paddingVertical: 12,
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
        fontSize: 14,
    },
    feeOptionTextActive: {
        color: theme.colors.inversePrimary,
    },
    summaryBox: {
        paddingTop: 16,
        borderTopWidth: 1,
        borderColor: theme.colors.border,
        marginTop: 24,
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
    separator: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginBottom: 16,
        marginTop: 8,
    },
    totalLabel: {
        fontSize: 18,
        color: theme.colors.primary,
        fontWeight: 'bold',
    },
    totalValue: {
        fontSize: 18,
        color: theme.colors.primary,
        fontFamily: 'monospace',
        fontWeight: 'bold',
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
        marginTop: 32,
    },
    calculateButton: {
        marginTop: 24,
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
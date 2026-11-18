import React, { useState, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { formatBitcoinAddressShort } from '../constants/format';
import { AddressText } from '../components/AddressText';
import { StyledInput } from '../components/StyledInput';
import { calculateTransactionMetrics, calculateVSize, DUST_THRESHOLD } from '../services/bitcoin';
import { authenticate_transaction_action } from '../services/authState';


type RoutePropType = RouteProp<RootStackParamList, 'TransactionConfirm'>;
const formatSats = new Intl.NumberFormat('en-US');

const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);

const TransactionConfirmScreen = () => {
    const route = useRoute<RoutePropType>();
    const {
        recipientAddress,
        amount,
        unit,
        onConfirm,
        loading,
        fee,
        feeVSize,
        selectedRate,
        feeOptions,
        onSelectFeeOption,
        utxos
    } = route.params;
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const { activeWallet } = useWallet();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const safeFeeOptions = feeOptions ?? { fast: 1, normal: 1, slow: 1 };
    const safeSelectedRate = selectedRate ?? safeFeeOptions.normal;
    const safeOnSelectFeeOption = onSelectFeeOption ?? (() => { });

    const cleanAmount = amount.replace(',', '.');
    const amountInSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
    const totalInput = useMemo(() => utxos.reduce((acc, u) => acc + u.value, 0), [utxos]);

    const canEditFees = !route.params.isImported && !!feeOptions;
    const [currentRate, setCurrentRate] = useState(safeSelectedRate);
    const [customRate, setCustomRate] = useState(String(safeSelectedRate));
    const [feesOpen, setFeesOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const submitLock = useRef(false);

    const initialKey = safeSelectedRate === safeFeeOptions.normal ? 'normal'
        : safeSelectedRate === safeFeeOptions.fast ? 'fast'
        : safeSelectedRate === safeFeeOptions.slow ? 'slow' : 'custom';
    const [selectedKey, setSelectedKey] = useState<'slow' | 'normal' | 'fast' | 'custom'>(initialKey);

    const metricsForRate = (rate: number) => calculateTransactionMetrics(utxos.length, amountInSatoshis, totalInput, rate);
    const metrics = metricsForRate(currentRate);
    // Signing omits the change output in a one-output transaction.
    const effectiveFee = canEditFees && metrics.numOutputs === 1 ? totalInput - amountInSatoshis : metrics.fee;
    const currentFee = canEditFees ? Math.max(metrics.fee, effectiveFee) : fee;
    const estimatedChange = canEditFees ? Math.max(0, metrics.numOutputs === 2 ? metrics.change : 0)
        : Math.max(0, totalInput - amountInSatoshis - fee);
    const dustFee = canEditFees && metrics.numOutputs === 1 ? Math.max(0, metrics.change) : 0;
    const calculatedVSize = canEditFees ? metrics.vsize : feeVSize ?? calculateVSize(utxos.length || 1, estimatedChange > DUST_THRESHOLD ? 2 : 1);
    const feePercentage = amountInSatoshis > 0 ? currentFee / amountInSatoshis * 100 : 0;
    const showHighFeeWarning = feePercentage > 10;
    const invalidRate = canEditFees && selectedKey === 'custom'
        && (!/^\d+(?:\.\d+)?$/.test(customRate) || !Number.isFinite(Number(customRate)) || Number(customRate) <= 0
            || !Number.isSafeInteger(metricsForRate(Number(customRate)).fee));
    const insufficient = canEditFees && metrics.change < 0;
    const blocked = loading || isSubmitting || invalidRate || insufficient;
    const formatAmount = (value: number) => unit === 'BTC' ? formatBtc(value) + ' BTC' : formatSats.format(value) + ' sats';

    const applyRate = (rate: number) => {
        const quote = metricsForRate(rate);
        if (!Number.isSafeInteger(quote.fee)) return;
        setCurrentRate(rate);
        safeOnSelectFeeOption(rate, quote.fee);
    };

    const handleFeeSelection = (key: typeof selectedKey, rate: number) => {
        if (!canEditFees || submitLock.current) return;
        setSelectedKey(key);
        if (key !== 'custom') {
            setCustomRate(String(rate));
            applyRate(rate);
        }
    };

    const handleCustomRateChange = (text: string) => {
        if (!canEditFees || submitLock.current) return;
        const normalized = text.replace(',', '.');
        setCustomRate(normalized);
        if (/^\d+(?:\.\d+)?$/.test(normalized) && Number(normalized) > 0) {
            applyRate(Number(normalized));
        }
    };

    const inputDetails = useMemo(() => {
        if (!detailsOpen) return [];
        const map = new Map<string, number>();
        utxos.forEach(u => {
            map.set(u.address, (map.get(u.address) || 0) + u.value);
        });
        return Array.from(map.entries()).map(([address, val]) => {
            let pathSuffix = '';
            if (activeWallet) {
                const r = activeWallet.derivedReceiveAddresses.find(d => d.address === address);
                if (r) {
                    pathSuffix = `.../0/${r.index}`;
                } else {
                    const c = activeWallet.derivedChangeAddresses.find(d => d.address === address);
                    if (c) pathSuffix = `.../1/${c.index}`;
                }
            }
            return { address, value: val, pathSuffix };
        });
    }, [utxos, activeWallet, detailsOpen]);

    const submitConfirm = async () => {
        if (blocked || submitLock.current) return;
        submitLock.current = true;
        setIsSubmitting(true);
        Keyboard.dismiss();
        try {
            const authenticated = await authenticate_transaction_action('Authorize Bitcoin transaction');
            if (authenticated) await onConfirm(currentRate);
        } finally {
            submitLock.current = false;
            setIsSubmitting(false);
        }
    };

    const handleSignAndSend = () => {
        if (blocked || submitLock.current) return;
        if (showHighFeeWarning) {
            Alert.alert(
                'High fee warning',
                'You are about to pay a very high fee. Please reconsider and wait for better network fees.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Send anyway', onPress: () => { void submitConfirm(); } }
                ]
            );
        } else {
            void submitConfirm();
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={styles.hero}>
                    <Text style={styles.heroLabel}>Recipient receives</Text>
                    <Text style={styles.heroAmount} adjustsFontSizeToFit numberOfLines={1}>{formatAmount(amountInSatoshis)}</Text>
                </View>

                <View style={styles.recipient}>
                    <Text style={styles.heroLabel}>Recipient address</Text>
                    <AddressText style={styles.fullAddress} selectable address={recipientAddress} />
                </View>

                <View style={styles.summaryBox}>
                    <View style={styles.detailRow}>
                        <Text style={styles.label}>Network fee</Text>
                        <View style={styles.valueContainer}>
                            <Text style={styles.value}>{formatSats.format(currentFee)} sats</Text>
                            {feePercentage > 0.1 && <Text style={styles.subValue}>{feePercentage.toFixed(1)}% of amount</Text>}
                        </View>
                    </View>
                    <View style={styles.detailRow}>
                        <Text style={styles.totalLabel}>Total debited</Text>
                        <Text style={styles.totalValue}>{formatAmount(amountInSatoshis + currentFee)}</Text>
                    </View>
                </View>
                {canEditFees && (
                    <TouchableOpacity
                        style={styles.disclosure}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: feesOpen, disabled: isSubmitting }}
                        disabled={isSubmitting}
                        onPress={() => { if (feesOpen) Keyboard.dismiss(); setFeesOpen(!feesOpen); }}
                    >
                        <Text style={styles.label}>Fee rate</Text>
                        <Text style={styles.disclosureValue}>{currentRate} sat/vB</Text>
                        <Feather name={feesOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.muted} />
                    </TouchableOpacity>
                )}
                {canEditFees && feesOpen && (
                    <View style={styles.feeSelectorContainer}>
                        <View style={styles.feeOptionsRow}>
                            {(['slow', 'normal', 'fast'] as const).map((key) => (
                                <TouchableOpacity
                                    key={key}
                                    onPress={() => handleFeeSelection(key, safeFeeOptions[key])}
                                    style={[styles.feeOption, selectedKey === key && styles.feeOptionActive]}
                                    disabled={isSubmitting} accessibilityRole="button" accessibilityState={{ selected: selectedKey === key }}
                                >
                                    <Text style={[styles.feeOptionText, selectedKey === key ? styles.feeOptionTextActive : {}]}>
                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                    </Text>
                                    <Text style={[styles.feeOptionRate, selectedKey === key ? styles.feeOptionRateActive : {}]}>
                                        {safeFeeOptions[key]} sat/vB
                                    </Text>
                                </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                                onPress={() => handleFeeSelection('custom', currentRate)}
                                style={[styles.feeOption, selectedKey === 'custom' && styles.feeOptionActive]}
                                disabled={isSubmitting} accessibilityRole="button" accessibilityState={{ selected: selectedKey === 'custom' }}
                            >
                                <Text style={[styles.feeOptionText, selectedKey === 'custom' ? styles.feeOptionTextActive : {}]}>Custom</Text>
                                <Text style={[styles.feeOptionRate, selectedKey === 'custom' ? styles.feeOptionRateActive : {}]}>Edit</Text>
                            </TouchableOpacity>
                        </View>
                        {selectedKey === 'custom' && (
                            <StyledInput
                                accessibilityLabel="Custom fee rate"
                                containerStyle={styles.customFeeContainer}
                                keyboardType="decimal-pad"
                                value={customRate}
                                onChangeText={handleCustomRateChange}
                                editable={!isSubmitting}
                                placeholder="sat/vB"
                                rightElement={<Text style={styles.unit}>sat/vB</Text>}
                            />
                        )}
                    </View>
                )}
                {invalidRate && <Text style={styles.warningText}>Enter a valid fee rate above zero.</Text>}
                {insufficient && <Text style={styles.warningText}>The selected coins don’t cover this fee. Lower the rate or go back to change coins.</Text>}
                {dustFee > 0 && <Text style={styles.notice}>{formatSats.format(dustFee)} sats of small change is included in the network fee.</Text>}
                {showHighFeeWarning && (
                    <View style={styles.warningContainer}>
                        <Feather name="alert-triangle" size={18} color={theme.colors.bitcoin} />
                        <Text style={styles.label}>The fee is high compared to the amount you’re sending.</Text>
                    </View>
                )}

                <TouchableOpacity
                    style={styles.disclosure}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: detailsOpen }}
                    onPress={() => setDetailsOpen(!detailsOpen)}
                >
                    <Text style={styles.label}>Transaction details</Text>
                    <Feather name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.muted} />
                </TouchableOpacity>
                {detailsOpen && (
                    <View style={styles.details}>
                        <View style={styles.detailRow}>
                            <Text style={styles.label}>Change</Text>
                            <Text style={styles.value}>{formatAmount(estimatedChange)}</Text>
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={styles.label}>Estimated size</Text>
                            <Text style={styles.value}>{calculatedVSize} vB</Text>
                        </View>
                        {route.params.isImported && (
                            <View style={styles.detailRow}>
                                <Text style={styles.label}>Estimated fee rate</Text>
                                <Text style={styles.value}>{Math.round(currentFee / calculatedVSize)} sat/vB</Text>
                            </View>
                        )}
                        <Text style={styles.heroLabel}>Input addresses</Text>
                        {inputDetails.map(item => (
                            <View key={item.address} style={styles.detailRow}>
                                <View style={styles.inputAddress}>
                                    <Text style={styles.value} selectable>{formatBitcoinAddressShort(item.address)}</Text>
                                    {item.pathSuffix ? <Text style={styles.subValue}>{item.pathSuffix}</Text> : null}
                                </View>
                                <Text style={styles.value}>{formatAmount(item.value)}</Text>
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    style={[styles.confirmButton, blocked && styles.buttonDisabled]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: blocked, busy: loading || isSubmitting }}
                    onPress={handleSignAndSend}
                    disabled={blocked}
                >
                    {loading || isSubmitting ? <ActivityIndicator color={theme.colors.bitcoin} /> : (
                        <Text style={styles.buttonText}>{route.params.isImported ? 'Broadcast transaction' : 'Sign and send'}</Text>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
    hero: { alignItems: 'center', gap: 4, marginBottom: 24 },
    heroLabel: { fontSize: 13, color: theme.colors.muted },
    heroAmount: { fontSize: 32, fontWeight: 'bold', color: theme.colors.primary },
    recipient: { gap: 4, marginBottom: 16 },
    fullAddress: { fontSize: 14, lineHeight: 23, color: theme.colors.primary, textAlign: 'left' },
    summaryBox: { backgroundColor: theme.colors.surface, borderRadius: theme.LAYOUT.radius, padding: 14, gap: 12, marginBottom: 8 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
    label: { fontSize: 14, color: theme.colors.primary, flexShrink: 1 },
    value: { fontSize: 14, color: theme.colors.primary, textAlign: 'right', flexShrink: 1 },
    valueContainer: { alignItems: 'flex-end', flexShrink: 1 },
    subValue: { fontSize: 12, color: theme.colors.muted },
    totalLabel: { color: theme.colors.primary, fontWeight: 'bold', flexShrink: 1 },
    totalValue: { color: theme.colors.primary, fontWeight: 'bold', textAlign: 'right', flexShrink: 1 },
    disclosure: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    disclosureValue: { flex: 1, textAlign: 'right', fontSize: 13, color: theme.colors.muted },
    details: { gap: 12, paddingVertical: 12 },
    inputAddress: { flexShrink: 1, alignItems: 'flex-start' },
    feeSelectorContainer: { paddingVertical: 12 },
    feeOptionsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
    },
    feeOption: {
        flex: 1,
        paddingVertical: 8,
        minHeight: 44,
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
    customFeeContainer: { marginTop: 12 },
    unit: { color: theme.colors.muted, marginRight: 12 },
    notice: { color: theme.colors.muted, marginVertical: 8 },
    warningText: { color: theme.colors.error, marginVertical: 8 },
    warningContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.colors.surface, padding: 12, borderRadius: theme.LAYOUT.radius, marginVertical: 8 },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    confirmButton: { backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: theme.LAYOUT.radius, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: 'bold' },
});
export default TransactionConfirmScreen;

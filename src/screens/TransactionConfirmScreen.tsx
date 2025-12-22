import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 

type RoutePropType = RouteProp<RootStackParamList, 'TransactionConfirm'>;
const DUST_LIMIT = 546;

const formatAddress = (address: string) => {
  if (!address || address.length <= 12) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 6)}`;
};
const formatBtc = (sats: number) => (sats / 100000000).toFixed(8);

const TransactionConfirmModal = () => {
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
    const { theme, isDark } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const { activeWallet } = useWallet();
    const [currentRate, setCurrentRate] = useState<number>(selectedRate);
    const [currentFee, setCurrentFee] = useState<number>(fee);
    const [customRate, setCustomRate] = useState<string>(selectedRate.toString());
    const [showHighFeeWarning, setShowHighFeeWarning] = useState(false);
    const initialKey = selectedRate === feeOptions.normal
        ? 'normal'
        : selectedRate === feeOptions.fast
        ? 'fast'
        : selectedRate === feeOptions.slow
        ? 'slow' 
        : 'custom';
    const [selectedKey, setSelectedKey] = useState<'slow' | 'normal' | 'fast' | 'custom'>(initialKey);
    const cleanAmount = amount.replace(',', '.');
    const amountInSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
    const feePercentage = amountInSatoshis > 0 ? (currentFee / amountInSatoshis) * 100 : 0;
    const total = amountInSatoshis + currentFee;
    const totalInBtc = total / 100000000;
    
    // Calculate Change
    const totalInput = useMemo(() => utxos.reduce((acc, u) => acc + u.value, 0), [utxos]);
    const estimatedChange = Math.max(0, totalInput - amountInSatoshis - currentFee);
    const isDust = estimatedChange > 0 && estimatedChange <= DUST_LIMIT;

    useEffect(() => {
        const isHighFee = feePercentage > 25 && amountInSatoshis > 0;
        setShowHighFeeWarning(isHighFee);
    }, [feePercentage, amountInSatoshis]);

    const handleFeeSelection = (key: 'slow' | 'normal' | 'fast' | 'custom', rate: number) => {
        setSelectedKey(key);
        if (key !== 'custom') {
            const newFee = Math.ceil(feeVSize * rate);
            setCurrentRate(rate);
            setCurrentFee(newFee);
            setCustomRate(rate.toString());
            onSelectFeeOption(rate, newFee);
        }
    };

    const handleCustomRateChange = (text: string) => {
        setCustomRate(text);
        const rate = parseInt(text, 10);
        if (!isNaN(rate) && rate > 0) {
            const newFee = Math.ceil(feeVSize * rate);
            setCurrentRate(rate);
            setCurrentFee(newFee);
            onSelectFeeOption(rate, newFee);
        }
    };

    const inputDetails = useMemo(() => {
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
    }, [utxos, activeWallet]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
            <View style={styles.section}>
                <View style={styles.rowItem}>
                    <Text style={styles.label}>Sending to</Text>
                    <Text style={styles.valueMain} selectable>{formatAddress(recipientAddress)}</Text>
                </View>
            </View>
            <View style={styles.section}>
                <Text style={styles.label}>Sending from</Text>
                {inputDetails.map((item, index) => (
                    <View key={item.address} style={styles.inputRow}>
                        <View>
                            <View style={styles.addressRow}>
                                <Text style={styles.inputValue} selectable>{formatAddress(item.address)}</Text>
                                {!!item.pathSuffix && (
                                    <Text style={styles.pathBadge}>{item.pathSuffix}</Text>
                                )}
                            </View>
                        </View>
                        <Text style={styles.amountValue}>{formatBtc(item.value)} <Text style={styles.orangeSymbol}>₿</Text></Text>
                    </View>
                ))}
            </View>
            <View style={styles.feeSelectorContainer}>
                <Text style={styles.label}>Fee rate</Text>
                <View style={styles.feeOptionsRow}>
                    {(['slow', 'normal', 'fast'] as const).map((key) => (
                        <TouchableOpacity
                            key={key}
                            onPress={() => handleFeeSelection(key, feeOptions[key])}
                            style={[styles.feeOption, selectedKey === key && styles.feeOptionActive]}
                        >
                            <Text style={[styles.feeOptionText, selectedKey === key && styles.feeOptionTextActive]}>
                                {key.charAt(0).toUpperCase() + key.slice(1)}
                            </Text>
                            <Text style={[styles.feeOptionRate, selectedKey === key && styles.feeOptionRateActive]}>
                                {feeOptions[key]} s/vB
                            </Text>
                        </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                        onPress={() => handleFeeSelection('custom', parseInt(customRate, 10) || 1)}
                        style={[styles.feeOption, selectedKey === 'custom' && styles.feeOptionActive]}
                    >
                        <Text style={[styles.feeOptionText, selectedKey === 'custom' && styles.feeOptionTextActive]}>Custom</Text>
                        <Text style={[styles.feeOptionRate, selectedKey === 'custom' && styles.feeOptionRateActive]}>Edit</Text>
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
            {showHighFeeWarning && (
                <View style={styles.warningContainer}>
                    <Feather name="alert-triangle" size={18} color={theme.colors.bitcoin} />
                    <Text style={styles.warningText}>
                        The network fee is high compared to the amount you are sending.
                    </Text>
                </View>
            )}
            <View style={styles.summaryBox}>
                <View style={styles.detailRow}>
                    <Text style={styles.label}>Total fee</Text>
                    <View style={styles.valueContainer}>
                        <Text style={styles.value}>{currentFee} sats</Text>
                        {feePercentage > 0.1 && <Text style={styles.subValue}>({feePercentage.toFixed(1)}% of amount)</Text>}
                    </View>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.label}>Transaction Size</Text>
                    <Text style={styles.value}>{feeVSize} vbytes</Text>
                </View>
                
                <View style={styles.detailRow}>
                    <Text style={styles.label}>Change</Text>
                    <View style={styles.valueContainer}>
                        <Text style={[styles.value, isDust && styles.valueDust]}>
                            {formatBtc(estimatedChange)} <Text style={[styles.orangeSymbol]}>₿</Text>
                        </Text>
                        <Text style={[styles.subValue]}>
                            {estimatedChange} sats {isDust ? '(burned)' : ''}
                        </Text>
                    </View>
                </View>

                <View style={styles.separator} />
                <View style={styles.detailRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>{totalInBtc.toFixed(8)} <Text style={styles.orangeSymbol}>₿</Text></Text>
                </View>
            </View>
            <TouchableOpacity 
                style={[styles.confirmButton, loading && styles.buttonDisabled]} 
                onPress={() => onConfirm(currentRate)} 
                disabled={loading}
            >
                {loading ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.buttonContentRowCentered}>
                        <Feather name="arrow-up-circle" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.buttonText}>Sign and send</Text>
                    </View>
                )}
            </TouchableOpacity>
        </ScrollView>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background, 
    },
    scrollContent: {
        padding: 24,
        paddingBottom: 40,
    },
    section: {
        marginBottom: 24,
    },
    rowItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    inputRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginTop: 8,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderColor: theme.colors.border, 
    },
    addressRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    label: {
        fontSize: 16,
        color: theme.colors.muted, 
        fontWeight: '500',
    },
    valueMain: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.primary, 
        fontFamily: 'monospace',
    },
    inputValue: {
        fontSize: 14,
        color: theme.colors.primary, 
        fontFamily: 'monospace',
    },
    amountValue: {
        fontSize: 14,
        color: theme.colors.primary, 
        fontWeight: '600',
    },
    pathBadge: {
        fontSize: 10,
        color: theme.colors.muted, 
        backgroundColor: theme.colors.surface, 
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 4,
        overflow: 'hidden',
        fontFamily: 'monospace',
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    value: {
        fontSize: 16,
        fontWeight: '500',
        color: theme.colors.primary, 
        fontFamily: 'monospace',
    },
    valueDust: {
        textDecorationLine: 'line-through',
    },
    valueContainer: {
        alignItems: 'flex-end',
    },
    subValue: {
        fontSize: 12,
        color: theme.colors.muted, 
        fontFamily: 'monospace',
    },
    summaryBox: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderColor: theme.colors.border, 
    },
    separator: {
        height: 1,
        backgroundColor: theme.colors.border, 
        marginVertical: 16,
    },
    feeSelectorContainer: {
        marginBottom: 16,
    },
    feeOptionsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
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
        fontWeight: '600',
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
    warningContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: theme.colors.surface, 
        padding: 12,
        borderRadius: 8,
    },
    warningText: {
        flex: 1,
        color: theme.colors.primary, 
        fontWeight: '500',
    },
    totalLabel: {
        fontSize: 18,
        color: theme.colors.primary, 
        fontWeight: 'bold',
    },
    totalValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.colors.primary, 
    },
    orangeSymbol: {
      color: theme.colors.bitcoin, 
    },
    confirmButton: {
        backgroundColor: theme.colors.primary, 
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
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
export default TransactionConfirmModal;
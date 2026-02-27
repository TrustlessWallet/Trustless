import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput'; 
import { useNavigation, useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, UTXO } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { 
    validateBitcoinAddress, 
    fetchUTXOs, 
    fetchFeeEstimates,
    calculateTransactionMetrics,
    calculateVSize,
    DUST_THRESHOLD 
} from '../services/bitcoin';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Send'>;
type SendScreenRouteProp = RouteProp<RootStackParamList, 'Send'>;
type Unit = 'BTC' | 'sats';

const UTXO_CACHE_PREFIX = '@utxoCache:';
const UTXO_CACHE_STALE_MS = 240000; 

const select_utxos_for_amount = (utxos: UTXO[], target_amount: number, fee_rate: number) => {
    const sorted_utxos = [...utxos].sort((a, b) => b.value - a.value); 
    let selected = [];
    let total_value = 0;
    for (const utxo of sorted_utxos) {
        selected.push(utxo);
        total_value += utxo.value;
        const fee = calculateVSize(selected.length, 2) * fee_rate;
        if (total_value >= target_amount + fee) {
            return selected;
        }
    }
    if (total_value >= target_amount) {
        return selected;
    }
    return null;
};

const SendScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<SendScreenRouteProp>();
    const isFocused = useIsFocused(); 
    
    const { activeWallet, lastRefreshTime } = useWallet();
    const [recipientAddress, setRecipientAddress] = useState('');
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState<Unit>('BTC');
    const [balance, setBalance] = useState(0);
    const [utxos, setUtxos] = useState<UTXO[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingBalance, setLoadingBalance] = useState(true);
    const [selectedUtxos, setSelectedUtxos] = useState<UTXO[] | null>(null);
    const [network_rates, set_network_rates] = useState<{fast: number; normal: number; slow: number} | null>(null);
    
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    useEffect(() => {
        if (route.params?.selectedAddress) {
            setRecipientAddress(route.params.selectedAddress);
            navigation.setParams({ selectedAddress: undefined });
        }
    }, [route.params?.selectedAddress, navigation]);

    useEffect(() => {
        fetchFeeEstimates().then(set_network_rates).catch(() => {});
    }, []);

    const getBalance = React.useCallback(async (bypassCache: boolean = false) => {
            const info_cache = activeWallet?.derivedAddressInfoCache ?? [];
            const receive_for_utxos = info_cache.filter(i => i.balance > 0).map(i => i.address);
            const change_addresses = (activeWallet?.derivedChangeAddresses ?? []).map(a => a.address);
            const target_addresses = [...new Set([...receive_for_utxos, ...change_addresses])];
            const cache_key = `${UTXO_CACHE_PREFIX}${activeWallet?.id || 'no-wallet'}`;
            if (!bypassCache) {
                try {
                    const cached_str = await AsyncStorage.getItem(cache_key);
                    if (cached_str) {
                        const cached = JSON.parse(cached_str) as { utxos: UTXO[]; balance: number; timestamp: number };
                        const is_fresh = Date.now() - cached.timestamp < UTXO_CACHE_STALE_MS;
                        if (is_fresh) {
                            setUtxos(cached.utxos);
                            setBalance(cached.balance);
                            setLoadingBalance(false);
                            return; 
                        } else {
                            setUtxos(cached.utxos);
                            setBalance(cached.balance);
                        }
                    }
                } catch {}
            }
            if (target_addresses.length === 0) {
                setLoadingBalance(false);
                setUtxos([]);
                setBalance(0);
                return;
            }
            try {
                setLoadingBalance(true);
                const fetched_utxos = await fetchUTXOs(target_addresses);
                const available_to_send = fetched_utxos.reduce((sum, u) => sum + u.value, 0);
                setBalance(available_to_send);
                setUtxos(fetched_utxos);
                await AsyncStorage.setItem(cache_key, JSON.stringify({ utxos: fetched_utxos, balance: available_to_send, timestamp: Date.now() }));
            } catch (e) {
                console.error('Error fetching balance:', e);
                Alert.alert('Error', 'Could not fetch wallet balance.');
            } finally {
                setLoadingBalance(false);
            }
    }, [activeWallet]);

    useEffect(() => {
        getBalance(false);
    }, [getBalance]);

    useEffect(() => {
        if (activeWallet) {
            getBalance(true); 
        }
    }, [lastRefreshTime, activeWallet, getBalance]);

    const handle_confirm_press = async () => {
        const trimmed_recipient = recipientAddress.trim();
        if (!validateBitcoinAddress(trimmed_recipient)) {
            Alert.alert('Invalid Address', 'Please enter a valid bitcoin address.');
            return;
        }
        const clean_amount = amount.replace(',', '.');
        const amount_num = parseFloat(clean_amount);
        if (isNaN(amount_num) || amount_num <= 0) {
            Alert.alert('Invalid Amount', 'Please enter a valid amount.');
            return;
        }
        const amount_satoshis = unit === 'BTC' ? Math.round(amount_num * 100000000) : parseInt(clean_amount, 10);
        
        if (amount_satoshis < DUST_THRESHOLD) {
            Alert.alert('Amount Too Low', `The amount is too small. Please enter an amount greater than ${DUST_THRESHOLD} sats.`);
            return;
        }

        try {
            setLoading(true);
            let utxos_for_tx: UTXO[];
            let rate = network_rates?.normal || 15;
            let estimates = network_rates;
            
            if (!estimates) {
                try {
                    estimates = await fetchFeeEstimates();
                    rate = estimates.normal;
                    set_network_rates(estimates);
                } catch (e) { console.warn('Failed to fetch fee estimates, using default rate'); }
            }
            
            if (selectedUtxos && selectedUtxos.length > 0) {
                utxos_for_tx = selectedUtxos;
            } else {
                let candidate_utxos: UTXO[] = utxos;
                if (!candidate_utxos || candidate_utxos.length === 0) {
                    const info_cache = activeWallet?.derivedAddressInfoCache ?? [];
                    const receive_for_utxos = info_cache.filter(i => i.balance > 0).map(i => i.address);
                    const change_addresses = (activeWallet?.derivedChangeAddresses ?? []).map(a => a.address);
                    const target_addresses = [...new Set([...receive_for_utxos, ...change_addresses])];
                    if (target_addresses.length === 0) throw new Error('Wallet not ready');
                    candidate_utxos = await fetchUTXOs(target_addresses);
                }
                const auto_selected = select_utxos_for_amount(candidate_utxos, amount_satoshis, rate);
                if (!auto_selected) {
                    Alert.alert('Insufficient Funds', 'You do not have enough funds to cover the amount.');
                    setLoading(false);
                    return;
                }
                utxos_for_tx = auto_selected;
            }

            const total_selected_value = utxos_for_tx.reduce((sum, u) => sum + u.value, 0);
            
            if (total_selected_value < amount_satoshis) {
                Alert.alert('Insufficient Funds', 'The selected coins do not cover the amount you wish to send.');
                setLoading(false);
                return;
            }
            
            let { vsize, fee, change, numOutputs } = calculateTransactionMetrics(
                utxos_for_tx.length,
                amount_satoshis,
                total_selected_value,
                rate
            );

            if (change < 0) {
                fee = total_selected_value - amount_satoshis;
                change = 0;
                rate = Math.max(1, Math.floor(fee / vsize));
            }

            const proceed_to_confirm = () => {
                const fee_options = {
                    fast: estimates?.fast ?? rate * 1.5,
                    normal: estimates?.normal ?? rate,
                    slow: Math.max(1, estimates?.slow ?? rate * 0.8),
                };
                setLoading(false);
                navigation.navigate('TransactionConfirm', {
                    recipientAddress: trimmed_recipient,
                    amount,
                    unit,
                    fee,
                    feeVSize: vsize,
                    selectedRate: rate,
                    feeOptions: fee_options,
                    utxos: utxos_for_tx,
                } as any);
            };

            if (numOutputs === 1 && change > 0 && change <= DUST_THRESHOLD) {
                setLoading(false);
                Alert.alert(
                    'Dust Change Detected',
                    `This transaction has ${change} sats of change, which is too small to keep (dust).\n\nIt will be added to the miner fee unless you adjust the amount.`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        { 
                            text: 'Continue (Burn)', 
                            onPress: () => {
                                setLoading(true);
                                proceed_to_confirm(); 
                            }
                        }
                    ]
                );
                return;
            }

            proceed_to_confirm();

        } catch (err) {
            setLoading(false);
            console.error('Error preparing transaction:', err);
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to prepare transaction.');
        }
    };

    const handle_open_coin_control = () => {
        const clean_amount = amount.replace(',', '.');
        const amount_satoshis = unit === 'BTC' ? Math.round(parseFloat(clean_amount) * 100000000) : parseInt(clean_amount, 10);
        navigation.navigate('CoinControl', {
            targetAmount: amount_satoshis,
            onSelect: (selected: UTXO[]) => {
                setSelectedUtxos(selected);
            }
        });
    };

    const handle_scan_press = () => {
        navigation.navigate('QRScanner', {
          onScanSuccess: (scanned_data) => {
            const address = scanned_data.replace(/^(bitcoin:)/, '');
            setRecipientAddress(address);
          },
        });
    };

    const format_balance = (sats: number) => {
        if (unit === 'BTC') {
            return (sats / 100000000).toFixed(8);
        }
        return new Intl.NumberFormat('en-US').format(sats);
    };

    const is_coin_control_active = selectedUtxos && selectedUtxos.length > 0;
    const clean_amount_check = amount.replace(',', '.');
    const is_amount_entered = !isNaN(parseFloat(clean_amount_check)) && parseFloat(clean_amount_check) > 0;

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === "ios" ? "padding" : "height"} 
            style={styles.container}
            enabled={isFocused}
        >
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
                <View style={styles.balanceContainer}>
                    <Text style={styles.balanceLabel}>Available to Send</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('BalanceDetail', { utxos: utxos })}>
                        {loadingBalance ? (
                            <ActivityIndicator color={theme.colors.primary} />
                        ) : (
                            <Text style={styles.balanceText}>
                                {format_balance(balance)} {unit === 'sats' ? 'sats' : <Text style={styles.orangeSymbol}>₿</Text>}
                            </Text>
                        )}
                    </TouchableOpacity>
                </View>
                <Text style={styles.label}>Recipient Address</Text>
                <StyledInput
                    placeholder="Enter a bitcoin address"
                    value={recipientAddress}
                    onChangeText={setRecipientAddress}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    textContentType="none"
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    containerStyle={styles.inputSpacing}
                    rightElement={
                        <View style={styles.row}>
                            <TouchableOpacity 
                                onPress={() => navigation.navigate('AddressBook', { returnScreen: 'Send' })} 
                                style={styles.iconButton}
                            >
                                <Feather name="book-open" size={20} color={theme.colors.primary} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handle_scan_press} style={styles.iconButton}>
                                <Feather name="camera" size={20} color={theme.colors.primary} />
                            </TouchableOpacity>
                        </View>
                    }
                />
                <Text style={styles.label}>Amount</Text>
                <StyledInput
                    placeholder="0.00"
                    value={amount}
                    onChangeText={setAmount}
                    autoComplete="off"
                    spellCheck={false}
                    textContentType="none"
                    autoCorrect={false}
                    keyboardType="numeric"
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    containerStyle={styles.inputSpacing}
                    rightElement={
                        <View style={styles.unitSelector}>
                            <TouchableOpacity onPress={() => setUnit('BTC')} style={[styles.unitButton, unit === 'BTC' && styles.unitButtonActive]}>
                                <Text style={[styles.unitText, unit === 'BTC' && styles.unitTextActive]}>BTC</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setUnit('sats')} style={[styles.unitButton, unit === 'sats' && styles.unitButtonActive]}>
                                <Text style={[styles.unitText, unit === 'sats' && styles.unitTextActive]}>sats</Text>
                            </TouchableOpacity>
                        </View>
                    }
                />
                
                {is_amount_entered && network_rates && (
                    <Text style={styles.feeEstimateText}>
                        Est. network fee: ~{Math.ceil(calculateVSize(1, 2) * network_rates.normal)} sats ({network_rates.normal} s/vB)
                    </Text>
                )}

                <View style={styles.coinControlContainer}>
                    <View>
                        <Text style={styles.coinControlLabel}>Coin Control</Text>
                        <Text style={styles.coinControlSubText}>{is_coin_control_active ? `${selectedUtxos.length} UTXO(s) selected` : 'Automatic selection'}</Text>
                    </View>
                    <TouchableOpacity 
                        onPress={handle_open_coin_control} 
                        style={[styles.coinControlButton, !is_amount_entered && styles.buttonDisabled]}
                        disabled={!is_amount_entered}
                    >
                        <Text style={styles.coinControlButtonText}>{is_coin_control_active ? 'Change' : 'Select'}</Text>
                    </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={handle_confirm_press} style={[styles.sendButton, loading && styles.buttonDisabled]} disabled={loading}>
                    {loading ? <ActivityIndicator color={theme.colors.inversePrimary} /> : (
                        <View style={styles.buttonContentRowCentered}>
                            <Feather name="arrow-up-circle" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.sendButtonText}>View transaction</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { padding: 24, flexGrow: 1 },
    balanceContainer: { alignItems: 'center', marginBottom: 24, paddingVertical: 8 },
    balanceLabel: { fontSize: 16, color: theme.colors.muted },
    balanceText: { fontSize: 32, fontWeight: 'bold', color: theme.colors.primary, padding: 8 },
    label: { fontSize: 16, fontWeight: '500', marginBottom: 8, color: theme.colors.primary },
    row: { flexDirection: 'row', alignItems: 'center' },
    inputSpacing: { marginBottom: 16 },
    iconButton: { padding: 10 },
    unitSelector: { flexDirection: 'row', backgroundColor: theme.colors.border, borderRadius: 6, marginRight: 8, padding: 2 },
    unitButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 5 },
    unitButtonActive: { backgroundColor: theme.colors.primary },
    unitText: { fontWeight: '600', color: theme.colors.muted },
    unitTextActive: { color: theme.colors.inversePrimary },
    feeEstimateText: { fontSize: 12, color: theme.colors.muted, marginTop: -8, marginBottom: 16 },
    coinControlContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: theme.colors.surface, borderRadius: 8, marginBottom: 24 },
    coinControlLabel: { fontSize: 16, fontWeight: 'bold', color: theme.colors.primary },
    coinControlSubText: { fontSize: 14, color: theme.colors.muted, marginTop: 2 },
    coinControlButton: { backgroundColor: theme.colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6 },
    coinControlButtonText: { color: theme.colors.inversePrimary, fontWeight: '600' },
    sendButton: { backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center' },
    buttonDisabled: { opacity: 0.5 },
    sendButtonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '600' },
    buttonContentRowCentered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    orangeSymbol: { color: theme.colors.bitcoin },
});
export default SendScreen;
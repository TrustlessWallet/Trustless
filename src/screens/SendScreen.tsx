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
    broadcastTransaction, 
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

const selectUtxosForAmount = (utxos: UTXO[], targetAmount: number, feeRate: number) => {
    const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value); 
    let selected = [];
    let totalValue = 0;
    for (const utxo of sortedUtxos) {
        selected.push(utxo);
        totalValue += utxo.value;
        const fee = calculateVSize(selected.length, 2) * feeRate;
        if (totalValue >= targetAmount + fee) {
            return selected;
        }
    }
    return null;
};

const SendScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<SendScreenRouteProp>();
    const isFocused = useIsFocused(); 
    
    const { activeWallet, createAndSignTransaction, triggerRefresh, incrementChangeIndex, lastRefreshTime } = useWallet();
    const [recipientAddress, setRecipientAddress] = useState('');
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState<Unit>('BTC');
    const [balance, setBalance] = useState(0);
    const [utxos, setUtxos] = useState<UTXO[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingBalance, setLoadingBalance] = useState(true);
    const [selectedUtxos, setSelectedUtxos] = useState<UTXO[] | null>(null);
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    useEffect(() => {
        if (route.params?.selectedAddress) {
            setRecipientAddress(route.params.selectedAddress);
            navigation.setParams({ selectedAddress: undefined });
        }
    }, [route.params?.selectedAddress, navigation]);

    const getBalance = React.useCallback(async (bypassCache: boolean = false) => {
            const infoCache = activeWallet?.derivedAddressInfoCache ?? [];
            const receiveForUtxos = infoCache.filter(i => i.balance > 0).map(i => i.address);
            const changeAddresses = (activeWallet?.derivedChangeAddresses ?? []).map(a => a.address);
            const targetAddresses = [...new Set([...receiveForUtxos, ...changeAddresses])];
            const cacheKey = `${UTXO_CACHE_PREFIX}${activeWallet?.id || 'no-wallet'}`;
            if (!bypassCache) {
                try {
                    const cachedStr = await AsyncStorage.getItem(cacheKey);
                    if (cachedStr) {
                        const cached = JSON.parse(cachedStr) as { utxos: UTXO[]; balance: number; timestamp: number };
                        const isFresh = Date.now() - cached.timestamp < UTXO_CACHE_STALE_MS;
                        if (isFresh) {
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
            if (targetAddresses.length === 0) {
                setLoadingBalance(false);
                setUtxos([]);
                setBalance(0);
                return;
            }
            try {
                setLoadingBalance(true);
                const fetchedUtxos = await fetchUTXOs(targetAddresses);
                const availableToSend = fetchedUtxos.reduce((sum, u) => sum + u.value, 0);
                setBalance(availableToSend);
                setUtxos(fetchedUtxos);
                await AsyncStorage.setItem(cacheKey, JSON.stringify({ utxos: fetchedUtxos, balance: availableToSend, timestamp: Date.now() }));
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

    const handleTransaction = async (finalFeeRate: number, utxosToUse: UTXO[]) => {
        setLoading(true);
        if (!utxosToUse || utxosToUse.length === 0) {
            Alert.alert('Error', 'No UTXOs available for the transaction.');
            setLoading(false);
            return;
        }
        try {
            const cleanAmount = amount.replace(',', '.');
            const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
            
            const { txHex, usedChangeIndex } = await createAndSignTransaction(recipientAddress.trim(), amountSatoshis, utxosToUse, finalFeeRate);
            if (!txHex) throw new Error("Failed to sign the transaction.");

            if (usedChangeIndex !== null && activeWallet) {
              await incrementChangeIndex(activeWallet.id, usedChangeIndex);
            }

            const txid = await broadcastTransaction(txHex);
            
            Alert.alert(
                'Transaction Sent!',
                `Your transaction has been broadcasted.`,
                [{ 
                    text: 'OK', 
                    onPress: () => {
                        triggerRefresh();
                        navigation.popToTop();
                    }
                }]
            );
        } catch (error) {
            console.error(error);
            Alert.alert('Transaction Error', error instanceof Error ? error.message : 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPress = async () => {
        const trimmedRecipient = recipientAddress.trim();
        if (!validateBitcoinAddress(trimmedRecipient)) {
            Alert.alert('Invalid Address', 'Please enter a valid bitcoin address.');
            return;
        }
        const cleanAmount = amount.replace(',', '.');
        const amountNum = parseFloat(cleanAmount);
        if (isNaN(amountNum) || amountNum <= 0) {
            Alert.alert('Invalid Amount', 'Please enter a valid amount.');
            return;
        }
        const amountSatoshis = unit === 'BTC' ? Math.round(amountNum * 100000000) : parseInt(cleanAmount, 10);
        
        if (amountSatoshis < DUST_THRESHOLD) {
            Alert.alert('Amount Too Low', `The amount is too small. Please enter an amount greater than ${DUST_THRESHOLD} sats.`);
            return;
        }

        try {
            setLoading(true);
            let utxosForTx: UTXO[];
            let rate = 15;
            let estimates: { fast: number; normal: number; slow: number; } | null = null;
            try {
                estimates = await fetchFeeEstimates();
                rate = estimates.normal;
            } catch (e) { console.warn('Failed to fetch fee estimates, using default rate'); }
            
            if (selectedUtxos && selectedUtxos.length > 0) {
                utxosForTx = selectedUtxos;
            } else {
                let candidateUtxos: UTXO[] = utxos;
                if (!candidateUtxos || candidateUtxos.length === 0) {
                    const infoCache = activeWallet?.derivedAddressInfoCache ?? [];
                    const receiveForUtxos = infoCache.filter(i => i.balance > 0).map(i => i.address);
                    const changeAddresses = (activeWallet?.derivedChangeAddresses ?? []).map(a => a.address);
                    const targetAddresses = [...new Set([...receiveForUtxos, ...changeAddresses])];
                    if (targetAddresses.length === 0) throw new Error('Wallet not ready');
                    candidateUtxos = await fetchUTXOs(targetAddresses);
                }
                const autoSelected = selectUtxosForAmount(candidateUtxos, amountSatoshis, rate);
                if (!autoSelected) {
                    Alert.alert('Insufficient Funds', 'You do not have enough funds to cover the amount and network fee.');
                    setLoading(false);
                    return;
                }
                utxosForTx = autoSelected;
            }

            const totalSelectedValue = utxosForTx.reduce((sum, u) => sum + u.value, 0);
            
            const { vsize, fee, change, numOutputs } = calculateTransactionMetrics(
                utxosForTx.length,
                amountSatoshis,
                totalSelectedValue,
                rate
            );

            if (change < 0) {
                Alert.alert('Insufficient Funds', 'The selected coins do not cover the amount and estimated fee. Please select more coins.');
                setLoading(false);
                return;
            }

            const proceedToConfirm = () => {
                const feeOptions = {
                    fast: estimates?.fast ?? rate * 1.5,
                    normal: estimates?.normal ?? rate,
                    slow: Math.max(1, estimates?.slow ?? rate * 0.8),
                };
                setLoading(false);
                navigation.navigate('TransactionConfirm', {
                    recipientAddress: trimmedRecipient,
                    amount,
                    unit,
                    onConfirm: (finalFeeRate) => handleTransaction(finalFeeRate, utxosForTx),
                    loading: false,
                    fee,
                    feeVSize: vsize,
                    selectedRate: rate,
                    feeOptions,
                    onSelectFeeOption: (rate, fee) => {},
                    utxos: utxosForTx,
                });
            };

            // Dust Warning (Option A)
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
                                proceedToConfirm(); 
                            }
                        }
                    ]
                );
                return;
            }

            proceedToConfirm();

        } catch (err) {
            setLoading(false);
            console.error('Error preparing transaction:', err);
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to prepare transaction.');
        }
    };
    const handleOpenCoinControl = () => {
        const cleanAmount = amount.replace(',', '.');
        const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
        navigation.navigate('CoinControl', {
            targetAmount: amountSatoshis,
            onSelect: (utxos: UTXO[]) => {
                setSelectedUtxos(utxos);
            }
        });
    };
    const handleScanPress = () => {
        navigation.navigate('QRScanner', {
          onScanSuccess: (scannedData) => {
            const address = scannedData.replace(/^(bitcoin:)/, '');
            setRecipientAddress(address);
          },
        });
    };
    const formatBalance = (sats: number) => {
        if (unit === 'BTC') {
            return (sats / 100000000).toFixed(8);
        }
        return new Intl.NumberFormat('en-US').format(sats);
    };
    const isCoinControlActive = selectedUtxos && selectedUtxos.length > 0;
    const isAmountEntered = !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;
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
                                {formatBalance(balance)} {unit === 'sats' ? 'sats' : <Text style={styles.orangeSymbol}>₿</Text>}
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
                            <TouchableOpacity onPress={handleScanPress} style={styles.iconButton}>
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
                <View style={styles.coinControlContainer}>
                    <View>
                        <Text style={styles.coinControlLabel}>Coin Control</Text>
                        <Text style={styles.coinControlSubText}>{isCoinControlActive ? `${selectedUtxos.length} UTXO(s) selected` : 'Automatic selection'}</Text>
                    </View>
                    <TouchableOpacity 
                        onPress={handleOpenCoinControl} 
                        style={[styles.coinControlButton, !isAmountEntered && styles.buttonDisabled]}
                        disabled={!isAmountEntered}
                    >
                        <Text style={styles.coinControlButtonText}>{isCoinControlActive ? 'Change' : 'Select'}</Text>
                    </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={handleConfirmPress} style={[styles.sendButton, loading && styles.buttonDisabled]} disabled={loading}>
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
    container: { 
        flex: 1, 
        backgroundColor: theme.colors.background
    },
    scrollContent: { 
        padding: 24, 
        flexGrow: 1 
    },
    balanceContainer: { 
        alignItems: 'center', 
        marginBottom: 24, 
        paddingVertical: 8 
    },
    balanceLabel: { 
        fontSize: 16, 
        color: theme.colors.muted
    },
    balanceText: { 
        fontSize: 32, 
        fontWeight: 'bold', 
        color: theme.colors.primary,
        padding: 8 
    },
    label: { 
        fontSize: 16, 
        fontWeight: '500', 
        marginBottom: 8, 
        color: theme.colors.primary
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    inputSpacing: {
        marginBottom: 16,
    },
    iconButton: { 
        padding: 10,
    },
    unitSelector: { 
        flexDirection: 'row', 
        backgroundColor: theme.colors.border,
        borderRadius: 6, 
        marginRight: 8, 
        padding: 2 
    },
    unitButton: { 
        paddingVertical: 6, 
        paddingHorizontal: 12, 
        borderRadius: 5 
    },
    unitButtonActive: { 
        backgroundColor: theme.colors.primary
    },
    unitText: { 
        fontWeight: '600', 
        color: theme.colors.muted
    },
    unitTextActive: { 
        color: theme.colors.inversePrimary
    },
    coinControlContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        marginBottom: 24,
    },
    coinControlLabel: {
        fontSize: 16,
        fontWeight: 'bold',
        color: theme.colors.primary,
    },
    coinControlSubText: {
        fontSize: 14,
        color: theme.colors.muted,
        marginTop: 2,
    },
    coinControlButton: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 6,
    },
    coinControlButtonText: {
        color: theme.colors.inversePrimary,
        fontWeight: '600',
    },
    sendButton: { 
        backgroundColor: theme.colors.primary,
        paddingVertical: 16, 
        borderRadius: 8, 
        alignItems: 'center' 
    },
    buttonDisabled: { 
        opacity: 0.5,
    },
    sendButtonText: { 
        color: theme.colors.inversePrimary,
        fontSize: 16, 
        fontWeight: '600' 
    },
    buttonContentRowCentered: { 
        flexDirection: 'row', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: 8 
    },
    orangeSymbol: {
        color: theme.colors.bitcoin,
    },
});
export default SendScreen;
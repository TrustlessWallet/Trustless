import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView, TextInput, Keyboard } from 'react-native';
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
    DUST_THRESHOLD
} from '../services/bitcoin';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AddressText } from '../components/AddressText';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import * as Clipboard from 'expo-clipboard';
import { resolveLnurlOrAddress, fetchLnurlInvoice } from '../services/lnurl';
import { authenticate_transaction_action } from '../services/authState';


type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Send'>;
type SendScreenRouteProp = RouteProp<RootStackParamList, 'Send'>;
type Unit = 'BTC' | 'sats';

const UTXO_CACHE_PREFIX = '@utxoCache:';
const UTXO_CACHE_STALE_MS = 240000;
const HIDE_WALLET_BALANCE_KEY = '@hideWalletBalance';

const selectUtxosForAmount = (utxos: UTXO[], targetAmount: number, feeRate: number = 4) => {
    const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value);
    let selected: UTXO[] = [];
    let totalValue = 0;

    const estimateFee = (n_inputs: number) => {
        const vsize = Math.ceil((n_inputs * 68) + (1 * 31) + 10.5);
        return Math.ceil(vsize * feeRate);
    };

    for (const utxo of sortedUtxos) {
        selected.push(utxo);
        totalValue += utxo.value;

        const estimatedFee = estimateFee(selected.length);
        const requiredTotal = targetAmount + estimatedFee;

        if (totalValue >= requiredTotal) {
            return selected;
        }
    }
    return null;
};

const parseBolt11Amount = (invoice: string): number | null => {
    const cleanInvoice = invoice.replace(/^lightning:/i, '').trim().toLowerCase();

    if (!cleanInvoice.startsWith('lnbc') && !cleanInvoice.startsWith('lntb') && !cleanInvoice.startsWith('lnbcrt')) {
        return null;
    }

    const sepIndex = cleanInvoice.lastIndexOf('1');
    if (sepIndex === -1) return null;

    const hrp = cleanInvoice.substring(0, sepIndex);

    const prefixMatch = hrp.match(/^(lnbcrt|lntb|lnbc)/);
    if (!prefixMatch) return null;
    const prefix = prefixMatch[0];

    const amountStr = hrp.substring(prefix.length);
    if (!amountStr) return null;

    const multiplierMatch = amountStr.match(/([mupn])$/);
    let multiplierStr = '';
    let numberStr = amountStr;

    if (multiplierMatch) {
        multiplierStr = multiplierMatch[0];
        numberStr = amountStr.substring(0, amountStr.length - 1);
    }

    const val = parseFloat(numberStr);
    if (isNaN(val)) return null;

    let multiplier = 1;
    switch (multiplierStr) {
        case 'm': multiplier = 0.001; break;
        case 'u': multiplier = 0.000001; break;
        case 'n': multiplier = 0.000000001; break;
        case 'p': multiplier = 0.000000000001; break;
        default: multiplier = 1;
    }

    const btcValue = val * multiplier;
    return Math.round(btcValue * 100000000);
};

const SendScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<SendScreenRouteProp>();
    const isFocused = useIsFocused();
    const { scrollViewRef, paddingBottom, handleInputFocus } = useKeyboardScroll({
        basePaddingBottom: 32,
        animateLayoutChanges: true,
    });

    const {
        activeWallet,
        createAndSignTransaction,
        triggerRefresh,
        incrementChangeIndex,
        lastRefreshTime,
        lightningBalance,
        payLightningInvoice,
        estimateLightningFee
    } = useWallet();

    const isWatchOnly = activeWallet?.type === 'watch-only';

    const mode = route.params?.mode || 'onchain';

    const [recipientAddress, setRecipientAddress] = useState('');
    const [isRecipientAddressFocused, setIsRecipientAddressFocused] = useState(false);
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState<Unit>('BTC');
    const [balance, setBalance] = useState(0);
    const [utxos, setUtxos] = useState<UTXO[]>([]);
    const [selectedUtxos, setSelectedUtxos] = useState<UTXO[] | null>(null);
    const [feeOptions, setFeeOptions] = useState<{ fast: number; normal: number; slow: number } | null>(null);
    const [selectedFee, setSelectedFee] = useState<'slow' | 'normal' | 'fast' | 'custom'>('normal');
    const [customRate, setCustomRate] = useState('');

    const [lightningInvoice, setLightningInvoice] = useState('');
    const [lnAmount, setLnAmount] = useState('');
    const [hasFixedAmount, setHasFixedAmount] = useState(false);
    const [lnFeeEstimate, setLnFeeEstimate] = useState<number | null>(null);
    const [estimatingLnFee, setEstimatingLnFee] = useState(false);
    const [lnurlData, setLnurlData] = useState<any | null>(null);
    const [lnurlDomain, setLnurlDomain] = useState<string>('');

    const [loading, setLoading] = useState(false);
    const [loadingBalance, setLoadingBalance] = useState(true);
    const [hideBalance, setHideBalance] = useState(false);

    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);

    const handlePasteFromClipboard = async () => {
        const text = await Clipboard.getStringAsync();
        if (text) {
            setRecipientAddress(text);
        }
    };

    useEffect(() => {
        if (route.params?.selectedAddress) {
            setRecipientAddress(route.params.selectedAddress);
            navigation.setParams({ selectedAddress: undefined });
        }
    }, [route.params?.selectedAddress, navigation]);

    const [pendingAutoPay, setPendingAutoPay] = useState(false);

    useEffect(() => {
        if (route.params?.prefill && mode === 'lightning') {
            const invoice = route.params.prefill.replace(/^lightning:/i, '').trim();
            setLightningInvoice(invoice);
            setPendingAutoPay(!!route.params?.autoConfirm);
            navigation.setParams({ prefill: undefined, autoConfirm: undefined });
        }
    }, [route.params?.prefill, route.params?.autoConfirm, mode, navigation]);

    // Once the invoice resolves to a fixed amount, fire the payment if it was requested
    useEffect(() => {
        if (pendingAutoPay && hasFixedAmount && lightningInvoice.trim() && lnAmount && !loading) {
            setPendingAutoPay(false);
            handlePayLightning(true);
        }
    }, [pendingAutoPay, hasFixedAmount, lightningInvoice, lnAmount, loading]);

    useEffect(() => {
        let isMounted = true;

        const resolveInput = async () => {
            if (mode !== 'lightning' || !lightningInvoice.trim()) {
                if (isMounted) setHasFixedAmount(false);
                return;
            }

            // Manually resolve the string to see if it's an LNURL or Lightning Address
            const parsed = await resolveLnurlOrAddress(lightningInvoice.trim());
            if (!isMounted) return;

            if (parsed && parsed.tag === 'payRequest') {
                const minSats = Number(parsed.minSendable) / 1000;
                const maxSats = Number(parsed.maxSendable) / 1000;

                setLnurlData(parsed);

                // Try to extract a clean domain name for the UI label
                try {
                    const urlObj = new URL(parsed.callback);
                    setLnurlDomain(urlObj.hostname);
                } catch {
                    setLnurlDomain('');
                }

                if (minSats === maxSats && minSats > 0) {
                    setLnAmount(minSats.toString());
                    setHasFixedAmount(true);
                } else {
                    setHasFixedAmount(false);
                }
            } else {
                // Fallback: If it's a standard BOLT11, use original logic
                const parsedSats = parseBolt11Amount(lightningInvoice);
                if (parsedSats !== null && parsedSats > 0) {
                    setLnAmount(parsedSats.toString());
                    setHasFixedAmount(true);
                } else {
                    setHasFixedAmount(false);
                }
                setLnurlData(null);
                setLnurlDomain('');
            }
        };

        resolveInput();

        return () => { isMounted = false; };
    }, [lightningInvoice, mode]);

    // --- LIGHTNING FEE ESTIMATOR ---
    useEffect(() => {
        let isMounted = true;

        const sats = parseInt(lnAmount, 10);

        // Bail out if amount is invalid or invoice string is empty
        if (isNaN(sats) || sats <= 0 || !lightningInvoice.trim()) {
            if (isMounted) {
                setLnFeeEstimate(null);
                setEstimatingLnFee(false);
            }
            return;
        }

        const fetchAndEstimate = async () => {
            if (!isMounted) return;
            setEstimatingLnFee(true);

            try {
                let estimatedFee: number | null = null;

                if (lnurlData) {
                    // 1. LNURL: Fetch the BOLT11 invoice for the finalized amount
                    const invoicePr = await fetchLnurlInvoice(lnurlData.callback, sats * 1000);
                    if (!isMounted) return;
                    estimatedFee = await estimateLightningFee(invoicePr);
                } else {
                    // 2. BOLT11: Estimate directly. Pass amount if it's an amountless invoice.
                    estimatedFee = await estimateLightningFee(
                        lightningInvoice.trim(),
                        hasFixedAmount ? undefined : sats
                    );
                }

                if (isMounted) setLnFeeEstimate(estimatedFee);

            } catch (e) {
                console.log("[Lightning] Fee estimation failed:", e);
                if (isMounted) setLnFeeEstimate(null);
            } finally {
                if (isMounted) setEstimatingLnFee(false);
            }
        };

        // 800ms debounce, executes consistently whether typing or pasted
        const timeout = setTimeout(fetchAndEstimate, 800);

        return () => {
            isMounted = false;
            clearTimeout(timeout);
        };
    }, [lnAmount, lnurlData, lightningInvoice, hasFixedAmount, estimateLightningFee]);

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
            } catch { }
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

            const estimates = await fetchFeeEstimates();
            setFeeOptions(estimates);
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

    useEffect(() => {
        const loadPreference = async () => {
            const savedPref = await AsyncStorage.getItem(HIDE_WALLET_BALANCE_KEY);
            setHideBalance(savedPref === 'true');
        };
        if (isFocused) {
            loadPreference();
        }
    }, [isFocused]);

    const handleTransaction = async (finalFeeRate: number, utxosToUse: UTXO[]) => {
        setLoading(true);
        try {
            const cleanAmount = amount.replace(',', '.');
            const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);

            const { txHex, usedChangeIndex } = await createAndSignTransaction(recipientAddress.trim(), amountSatoshis, utxosToUse, finalFeeRate);
            if (!txHex) throw new Error("Failed to sign the transaction.");

            if (usedChangeIndex !== null && activeWallet) {
                await incrementChangeIndex(activeWallet.id, usedChangeIndex);
            }

            const txId = await broadcastTransaction(txHex);

            triggerRefresh();

            const totalSelectedValue = utxosToUse.reduce((sum, u) => sum + u.value, 0);
            const { fee } = calculateTransactionMetrics(
                utxosToUse.length,
                amountSatoshis,
                totalSelectedValue,
                finalFeeRate
            );

            const pendingTx = {
                txid: txId,
                type: 'send',
                amount: amountSatoshis,
                fee: fee,
                status: { confirmed: false, block_time: Math.floor(Date.now() / 1000) }
            };

            navigation.replace('TransactionSuccess', {
                type: 'onchain',
                txId,
                transaction: pendingTx as any
            });

        } catch (error) {
            console.error(error);
            Alert.alert('Transaction error', error instanceof Error ? error.message : 'An unexpected error occurred.');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPress = async () => {
        const trimmedRecipient = recipientAddress.trim();
        if (!validateBitcoinAddress(trimmedRecipient)) {
            Alert.alert('Invalid address', 'Please enter a valid bitcoin address.');
            return;
        }
        const cleanAmount = amount.replace(',', '.');
        const amountNum = parseFloat(cleanAmount);
        if (isNaN(amountNum) || amountNum <= 0) {
            Alert.alert('Invalid amount', 'Please enter a valid amount.');
            return;
        }
        const amountSatoshis = unit === 'BTC' ? Math.round(amountNum * 100000000) : parseInt(cleanAmount, 10);

        if (amountSatoshis < DUST_THRESHOLD) {
            Alert.alert('Amount too low', `The amount is too small. Please enter an amount greater than ${DUST_THRESHOLD} sats.`);
            return;
        }

        if (amountSatoshis > balance) {
            const formatAmount = (sats: number) => unit === 'BTC' ? (sats / 100000000).toFixed(8) : sats.toString();
            const denomSymbol = unit === 'BTC' ? 'BTC' : 'sats';
            Alert.alert('Insufficient balance', `You only have ${formatAmount(balance)} ${denomSymbol} available, but trying to send ${formatAmount(amountSatoshis)} ${denomSymbol}.`);
            return;
        }

        try {
            setLoading(true);
            let utxosForTx: UTXO[];

            let rate = 15;
            let estimates = feeOptions;
            if (!estimates) {
                try {
                    estimates = await fetchFeeEstimates();
                    setFeeOptions(estimates);
                } catch (e) { }
            }

            if (isWatchOnly && estimates) {
                if (selectedFee === 'custom') {
                    rate = parseInt(customRate, 10) || 1;
                } else {
                    rate = estimates[selectedFee];
                }
            } else if (estimates) {
                rate = estimates.normal;
            }

            if (selectedUtxos && selectedUtxos.length > 0) {
                utxosForTx = selectedUtxos;
            } else {
                let candidateUtxos = utxos;
                const autoSelected = selectUtxosForAmount(candidateUtxos, amountSatoshis, rate);
                if (!autoSelected) {
                    const totalBalance = candidateUtxos.reduce((sum, u) => sum + u.value, 0);
                    const formatAmount = (sats: number) => unit === 'BTC' ? (sats / 100000000).toFixed(8) : sats.toString();
                    const denomSymbol = unit === 'BTC' ? 'BTC' : 'sats';

                    if (totalBalance >= amountSatoshis) {
                        Alert.alert(
                            'Insufficient for fees',
                            `You have enough to send ${formatAmount(amountSatoshis)} ${denomSymbol}, but not enough to cover network fees. Try sending a smaller amount.`
                        );
                    } else {
                        Alert.alert(
                            'Insufficient balance',
                            `You only have ${formatAmount(totalBalance)} ${denomSymbol} available, but trying to send ${formatAmount(amountSatoshis)} ${denomSymbol}.`
                        );
                    }
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

            const completeNavigation = () => {
                setLoading(false);
                if (isWatchOnly) {
                    (navigation as any).navigate('ExportPSBT', {
                        recipientAddress: trimmedRecipient,
                        amount,
                        unit,
                        feeRate: rate,
                        fee,
                        utxos: utxosForTx,
                    });
                } else {
                    const options = {
                        fast: estimates?.fast ?? rate * 1.5,
                        normal: estimates?.normal ?? rate,
                        slow: Math.max(1, estimates?.slow ?? rate * 0.8),
                    };
                    navigation.navigate('TransactionConfirm', {
                        recipientAddress: trimmedRecipient,
                        amount,
                        unit,
                        onConfirm: (finalFeeRate) => handleTransaction(finalFeeRate ?? rate, utxosForTx),
                        loading: false,
                        fee,
                        feeVSize: vsize,
                        selectedRate: rate,
                        feeOptions: options,
                        onSelectFeeOption: () => { },
                        utxos: utxosForTx,
                    });
                }
            };

            if (numOutputs === 1 && change > 0 && change <= DUST_THRESHOLD) {
                setLoading(false);
                Alert.alert(
                    'Dust change detected',
                    `This transaction has ${change} sats of change, which is too small to keep (dust).\n\nIt will be added to the miner fee unless you adjust the amount.`,
                    [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Continue (burn)',
                            onPress: () => {
                                setLoading(true);
                                completeNavigation();
                            }
                        }
                    ]
                );
                return;
            }

            completeNavigation();
        } catch (err) {
            setLoading(false);
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to prepare transaction.');
        }
    };

    const handlePayLightning = async (skipAuth: boolean = false) => {
        if (!lightningInvoice.trim()) {
            Alert.alert('Invalid input', 'Please enter a valid lightning invoice or address.');
            return;
        }

        const sats = parseInt(lnAmount, 10);
        if (isNaN(sats) || sats <= 0) {
            Alert.alert('Invalid amount', 'Please enter a valid amount.');
            return;
        }

        if (sats > lightningBalance) {
            Alert.alert('Insufficient balance', `You do not have enough sats to pay this invoice.`);
            return;
        }

        if (!skipAuth) {
            const authenticated = await authenticate_transaction_action('Authorize Lightning payment');
            if (!authenticated) return;
        }

        setLoading(true);
        try {
            if (lnurlData) {
                // --- LNURL / LIGHTNING ADDRESS PATH ---
                // 1. Fetch the actual BOLT11 invoice from the LNURL provider for the requested amount
                const invoicePr = await fetchLnurlInvoice(lnurlData.callback, sats * 1000);

                // 2. Pay the returned invoice using your existing wallet context
                await payLightningInvoice(invoicePr);

                triggerRefresh();

                const pendingLnTx = {
                    paymentHash: lightningInvoice.trim(),
                    type: 'send',
                    amountMsat: sats * 1000,
                    feeMsat: (lnFeeEstimate || 0) * 1000,
                    status: 'complete',
                    paymentTime: Math.floor(Date.now() / 1000),
                    description: lnurlDomain ? `Paid ${lnurlDomain}` : 'LNURL Payment',
                };

                navigation.navigate('TransactionSuccess', {
                    type: 'lightning',
                    transaction: pendingLnTx as any
                });
            } else {
                // --- BOLT11 PATH ---
                await payLightningInvoice(
                    lightningInvoice.trim(),
                    hasFixedAmount ? undefined : sats
                );

                triggerRefresh();

                const pendingLnTx = {
                    paymentHash: lightningInvoice.trim(),
                    type: 'send',
                    amountMsat: sats * 1000,
                    feeMsat: (lnFeeEstimate || 0) * 1000,
                    status: 'complete',
                    paymentTime: Math.floor(Date.now() / 1000),
                    description: lightningInvoice.trim(),
                };

                navigation.navigate('TransactionSuccess', {
                    type: 'lightning',
                    transaction: pendingLnTx as any
                });
            }
        } catch (error: any) {
            console.error("Lightning payment failed:", error);
            Alert.alert('Payment error', error.message || 'Failed to process lightning payment.');
        } finally {
            setLoading(false);
        }
    };

    const handleOpenCoinControl = () => {
        Keyboard.dismiss();
        setTimeout(() => {
            const cleanAmount = amount.replace(',', '.');
            const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
            navigation.navigate('CoinControl', {
                targetAmount: amountSatoshis,
                onSelect: (utxos: UTXO[]) => {
                    setSelectedUtxos(utxos);
                }
            });
        }, 200);
    };

    const handleScanPress = () => {
        navigation.navigate('QRScanner', {
            onScanSuccess: (scannedData) => {
                if (mode === 'lightning') {
                    const invoice = scannedData.replace(/^(lightning:)/i, '');
                    setLightningInvoice(invoice);
                } else {
                    const address = scannedData.replace(/^(bitcoin:)/i, '');
                    setRecipientAddress(address);
                }
            },
        });
    };

    const formatBalance = (sats: number) => {
        if (mode === 'lightning' || unit === 'sats') return new Intl.NumberFormat('en-US').format(sats);
        return (sats / 100000000).toFixed(8);
    };

    const isCoinControlActive = selectedUtxos && selectedUtxos.length > 0;
    const clean_amount_check = amount.replace(',', '.');
    const is_amount_entered = !isNaN(parseFloat(clean_amount_check)) && parseFloat(clean_amount_check) > 0;
    const is_address_entered = recipientAddress.trim().length > 0;
    const is_fee_valid = !isWatchOnly || (selectedFee !== 'custom' || parseInt(customRate, 10) > 0);
    const is_onchain_form_valid = is_amount_entered && is_address_entered && is_fee_valid;

    const displayBalance = mode === 'lightning' ? lightningBalance : balance;
    const isBalanceLoading = mode === 'onchain' && loadingBalance;

    return (
        <ScrollView
            ref={scrollViewRef}
            style={styles.container}
            contentContainerStyle={[styles.scrollContent, { paddingBottom }]}
            keyboardShouldPersistTaps="handled"
            bounces={false}
        >

            <View style={styles.balanceContainer}>
                <Text style={styles.balanceLabel}>Available to send</Text>
                <TouchableOpacity
                    onPress={() => mode === 'onchain' && navigation.navigate('BalanceDetail', { utxos: utxos })}
                    disabled={mode === 'lightning'}
                >
                    {isBalanceLoading ? (
                        <ActivityIndicator style={{ marginTop: 16 }} color={theme.colors.primary} />
                    ) : (
                        <Text style={styles.balanceText}>
                            {hideBalance ? '*******' : (
                                <>{formatBalance(displayBalance)} {(mode === 'lightning' || unit === 'sats') ? 'sats' : <Text style={styles.orangeSymbol}>₿</Text>}</>
                            )}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>

            {mode === 'onchain' ? (
                <>
                    <Text style={styles.label}>Recipient address</Text>
                    <View style={styles.inputSpacing}>
                        <View style={[styles.addressInputWrapper, isRecipientAddressFocused && styles.addressInputWrapperFocused]}>
                            <TextInput
                                style={styles.addressInput}
                                multiline={true}
                                numberOfLines={2}
                                scrollEnabled={true}
                                placeholder="Enter a bitcoin address"
                                placeholderTextColor={theme.colors.muted}
                                value={recipientAddress}
                                onChangeText={setRecipientAddress}
                                onFocus={() => {
                                    setIsRecipientAddressFocused(true);
                                    handleInputFocus();
                                }}
                                onBlur={() => setIsRecipientAddressFocused(false)}
                                autoCapitalize="none"
                                autoCorrect={false}
                                spellCheck={false}
                                keyboardAppearance={isDark ? 'dark' : 'light'}
                            />
                            <View style={styles.addressInputRightElements}>
                                <TouchableOpacity onPress={handlePasteFromClipboard} style={styles.iconButton}>
                                    <Feather name="clipboard" size={20} color={theme.colors.primary} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => navigation.navigate('AddressBook', { returnScreen: 'Send' })} style={styles.iconButton}>
                                    <Feather name="book-open" size={20} color={theme.colors.primary} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleScanPress} style={styles.iconButton}>
                                    <Feather name="camera" size={20} color={theme.colors.primary} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>

                    <Text style={styles.label}>Amount</Text>
                    <StyledInput
                        placeholder="0.00"
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="numeric"
                        onFocus={handleInputFocus}
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

                    {isWatchOnly ? (
                        <View style={styles.feeSelectorContainer}>
                            <Text style={[styles.label, { marginTop: 16 }]}>Fee rate</Text>
                            <View style={styles.feeOptionsRow}>
                                {(['slow', 'normal', 'fast'] as const).map((key) => (
                                    <TouchableOpacity
                                        key={key}
                                        onPress={() => setSelectedFee(key)}
                                        style={[styles.feeOption, selectedFee === key && styles.feeOptionActive]}
                                    >
                                        <Text style={[styles.feeOptionText, selectedFee === key ? styles.feeOptionTextActive : {}]}>
                                            {key.charAt(0).toUpperCase() + key.slice(1)}
                                        </Text>
                                        <Text style={[styles.feeOptionRate, selectedFee === key ? styles.feeOptionRateActive : {}]}>
                                            {feeOptions?.[key] || '-'} s/vB
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity
                                    onPress={() => setSelectedFee('custom')}
                                    style={[styles.feeOption, selectedFee === 'custom' && styles.feeOptionActive]}
                                >
                                    <Text style={[styles.feeOptionText, selectedFee === 'custom' ? styles.feeOptionTextActive : {}]}>Custom</Text>
                                    <Text style={[styles.feeOptionRate, selectedFee === 'custom' ? styles.feeOptionRateActive : {}]}>Edit</Text>
                                </TouchableOpacity>
                            </View>
                            {selectedFee === 'custom' && (
                                <View style={styles.customFeeContainer}>
                                    <Text style={styles.customFeeLabel}>Rate (sat/vB):</Text>
                                    <TextInput
                                        style={styles.customFeeInput}
                                        keyboardType="numeric"
                                        value={customRate}
                                        onChangeText={setCustomRate}
                                        onFocus={handleInputFocus}
                                        placeholder="0"
                                        keyboardAppearance={isDark ? 'dark' : 'light'}
                                        placeholderTextColor={theme.colors.muted}
                                    />
                                </View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.feeEstimateRow}>
                            <View style={styles.feeEstimateContent}>
                                <Feather name="zap" size={14} color={theme.colors.muted} />
                                <Text style={styles.feeEstimateText}>
                                    {feeOptions?.normal ? `Fees: ~${feeOptions.normal} sat/vB` : 'Estimating fees...'}
                                </Text>
                            </View>
                        </View>
                    )}

                    <View style={styles.coinControlBanner}>
                        <View style={styles.coinControlHeader}>
                            <View style={styles.row}>
                                <Feather name="layers" size={16} color={theme.colors.primary} />
                                <Text style={styles.coinControlTitle}>Coin control</Text>
                            </View>
                            <TouchableOpacity
                                onPress={handleOpenCoinControl}
                                style={[styles.selectButton, !is_amount_entered && styles.buttonDisabled]}
                                disabled={!is_amount_entered}
                            >
                                <Text style={styles.selectButtonText}>
                                    {isCoinControlActive ? 'Change' : 'Select UTXOs'}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {isCoinControlActive && (
                            <View style={styles.selectedUtxosRow}>
                                <Text style={styles.selectedUtxosText}>
                                    {selectedUtxos.length} UTXO{selectedUtxos.length !== 1 ? 's' : ''} selected ({formatBalance(selectedUtxos.reduce((s, u) => s + u.value, 0))} {unit})
                                </Text>
                            </View>
                        )}
                    </View>

                    <TouchableOpacity
                        onPress={handleConfirmPress}
                        style={[styles.sendButton, (loading || !is_onchain_form_valid) && styles.buttonDisabled]}
                        disabled={loading || !is_onchain_form_valid}
                    >
                        {loading ? <ActivityIndicator color={theme.colors.inversePrimary} /> : (
                            <View style={styles.buttonContentRowCentered}>
                                <Feather name={isWatchOnly ? "upload" : "arrow-up-circle"} size={18} color={theme.colors.inversePrimary} />
                                <Text style={styles.sendButtonText}>
                                    {isWatchOnly ? 'Export transaction' : 'View transaction'}
                                </Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <Text style={styles.label}>{lnurlDomain ? `Paying to ${lnurlDomain}` : 'Lightning invoice'}</Text>
                    <View style={styles.inputSpacing}>
                        <StyledInput
                            placeholder="BOLT11 / LNURL / Lightning address"
                            value={lightningInvoice}
                            onChangeText={setLightningInvoice}
                            autoCapitalize="none"
                            onFocus={handleInputFocus}
                            spellCheck={false}
                            autoCorrect={false}
                            rightElement={
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <TouchableOpacity onPress={async () => {
                                        const text = await Clipboard.getStringAsync();
                                        if (text) setLightningInvoice(text);
                                    }} style={styles.iconButton}>
                                        <Feather name="clipboard" size={20} color={theme.colors.primary} />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={handleScanPress} style={styles.iconButton}>
                                        <Feather name="camera" size={20} color={theme.colors.primary} />
                                    </TouchableOpacity>
                                </View>
                            }
                        />
                    </View>

                    <Text style={styles.label}>Amount</Text>
                    <StyledInput
                        placeholder="0"
                        value={lnAmount}
                        onChangeText={setLnAmount}
                        keyboardType="numeric"
                        onFocus={handleInputFocus}
                        editable={!hasFixedAmount}
                        style={hasFixedAmount ? styles.inputDisabled : {}}
                        rightElement={<Text style={styles.currencyLabel}>sats</Text>}
                    />

                    <View style={styles.feeEstimateRow}>
                        <View style={styles.feeEstimateContent}>
                            <Feather name="zap" size={14} color={theme.colors.muted} />
                            <Text style={styles.feeEstimateText}>
                                {estimatingLnFee
                                    ? 'Estimating routing fee...'
                                    : (lnFeeEstimate !== null
                                        ? `Routing fee: ~${lnFeeEstimate} sats`
                                        : 'Routing fee: -')}
                            </Text>
                        </View>
                    </View>

                    <TouchableOpacity
                        onPress={() => handlePayLightning()}
                        style={[styles.sendButton, { marginTop: 8 }, (loading || !lightningInvoice.trim() || !lnAmount) && styles.buttonDisabled]}
                        disabled={loading || !lightningInvoice.trim() || !lnAmount}
                    >
                        {loading ? <ActivityIndicator color={theme.colors.inversePrimary} /> : (
                            <View style={styles.buttonContentRowCentered}>
                                <Feather name="zap" size={18} color={theme.colors.inversePrimary} />
                                <Text style={styles.sendButtonText}>Pay invoice</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </>
            )}
        </ScrollView>
    );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { padding: 24 },
    balanceContainer: { alignItems: 'center', marginBottom: 24, paddingVertical: 8 },
    balanceLabel: { fontSize: 16, color: theme.colors.muted },
    balanceText: { fontSize: 36, fontWeight: 'bold', color: theme.colors.primary, padding: 0 },
    label: { fontSize: 16, fontWeight: '500', marginBottom: 8, color: theme.colors.primary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inputSpacing: { marginBottom: 16 },
    addressInputWrapper: {
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface || theme.colors.background,
        height: 100
    },
    addressInputWrapperFocused: {
        borderColor: theme.colors.bitcoin,
    },
    addressInput: {
        flex: 1,
        paddingHorizontal: 16,
        paddingVertical: 16,
        fontSize: 16,
        fontFamily: 'monospace',
        color: theme.colors.primary,
        textAlignVertical: 'top'
    },
    inputText: {
        color: theme.colors.primary,
    },
    addressInputRightElements: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingRight: 8,
        paddingTop: 8
    },
    iconButton: { padding: 8 },
    unitSelector: { flexDirection: 'row', backgroundColor: theme.colors.border, borderRadius: 6, marginRight: 8, padding: 2 },
    unitButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 5 },
    unitButtonActive: { backgroundColor: theme.colors.primary },
    unitText: { fontWeight: '600', color: theme.colors.muted },
    unitTextActive: { color: theme.colors.inversePrimary },
    coinControlBanner: {
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 8,
        justifyContent: 'center',
        marginBottom: 24,
        marginTop: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    coinControlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 },
    coinControlTitle: { fontSize: 16, fontWeight: '500', color: theme.colors.primary },
    selectButton: { backgroundColor: theme.colors.primary, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
    selectButtonText: { color: theme.colors.inversePrimary, fontSize: 12, fontWeight: '600' },
    selectedUtxosRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.colors.border },
    selectedUtxosText: { fontSize: 13, color: theme.colors.primary },
    feeEstimateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, marginTop: 8 },
    feeEstimateText: { fontSize: 14, color: theme.colors.muted },
    feeEstimateContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sendButton: { backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
    buttonDisabled: { opacity: 0.5 },
    sendButtonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '600' },
    buttonContentRowCentered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    orangeSymbol: { color: theme.colors.bitcoin, fontWeight: 'bold' },
    feeSelectorContainer: {
        marginBottom: 16,
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
    inputDisabled: {
        opacity: 0.6,
    },
    currencyLabel: {
        fontSize: 16,
        color: theme.colors.primary,
        fontFamily: 'SpaceMono-Bold',
        marginRight: 16,
    }
});

export default SendScreen;
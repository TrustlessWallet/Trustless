import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView, TextInput, Keyboard, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useNavigation, useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, UTXO } from '../types';
import { useWallet } from '../contexts/WalletContext';
import {
    validateBitcoinAddress,
    broadcastTransaction,
    fetchFeeEstimates,
    calculateTransactionMetrics,
    DUST_THRESHOLD
} from '../services/bitcoin';
import { useWalletUTXOs, getWalletUtxoQueryAddresses } from '../hooks/useBalance';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { resolveLnurlOrAddress, fetchLnurlInvoice, isLightningAddress } from '../services/lnurl';
import { authenticate_transaction_action } from '../services/authState';


type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Send'>;
type SendScreenRouteProp = RouteProp<RootStackParamList, 'Send'>;
type Unit = 'BTC' | 'sats';

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
    const actionLock = useRef(false);

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
    const [amount, setAmount] = useState('');
    const [unit, setUnit] = useState<Unit>('BTC');

    // Seeded instantly from WalletContext's already-loaded balance (same number
    // WalletScreen shows) so there's never a blank/loading flash on first render.
    const [balance, setBalance] = useState(() => {
        if (!activeWallet) return 0;
        return activeWallet.derivedAddressInfoCache.reduce((acc, curr) => acc + curr.balance, 0);
    });

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
    const [resolvedLightningInput, setResolvedLightningInput] = useState('');
    const [resolutionError, setResolutionError] = useState('');
    const [resolutionRetry, setResolutionRetry] = useState(0);
    const currentLightningInput = lightningInvoice.trim();
    const isLnurlInput = /^(?:lightning:)?lnurl(?:[pw]:\/\/|1)/i.test(currentLightningInput);
    const isNetworkRecipient = currentLightningInput.includes('@') || isLnurlInput;
    const isLnurlPending = isNetworkRecipient && resolvedLightningInput !== currentLightningInput;
    const currentLnurlData = isNetworkRecipient && !isLnurlPending ? lnurlData : null;
    const canPayLightning = resolvedLightningInput === currentLightningInput && (!isNetworkRecipient || !!currentLnurlData);

    const [loading, setLoading] = useState(false);
    const [hideBalance, setHideBalance] = useState(false);

    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);

    const applyRecipient = (text: string) => {
        const addressOrRequest = text.trim().replace(/^bitcoin:/i, '');
        // Match the fixed-amount request generated by Receive, including scanner
        // results whose URI prefix has already been removed.
        const request = /^([^?]+)\?amount=(\d+(?:\.\d{1,8})?)$/.exec(addressOrRequest);
        if (request && validateBitcoinAddress(request[1])) {
            const sats = Math.round(Number(request[2]) * 100_000_000);
            if (Number.isSafeInteger(sats) && sats > 0 && sats <= 21_000_000 * 100_000_000) {
                setRecipientAddress(request[1]);
                setUnit('BTC');
                setAmount(request[2]);
                return;
            }
        }
        setRecipientAddress(addressOrRequest);
    };

    const handlePasteFromClipboard = async () => {
        const text = await Clipboard.getStringAsync();
        if (text) {
            applyRecipient(text);
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

    useEffect(() => {
        if (pendingAutoPay && hasFixedAmount && currentLightningInput && resolvedLightningInput === currentLightningInput && canPayLightning && lnAmount && !loading) {
            setPendingAutoPay(false);
            handlePayLightning(true);
        }
    }, [pendingAutoPay, hasFixedAmount, currentLightningInput, resolvedLightningInput, canPayLightning, lnAmount, loading]);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const input = currentLightningInput;
        setLnurlData(null);
        setLnurlDomain('');
        setResolvedLightningInput('');
        setResolutionError('');
        setHasFixedAmount(false);
        if (hasFixedAmount) setLnAmount('');

        if (mode !== 'lightning' || !input) {
            setLnAmount('');
            return () => { active = false; controller.abort(); };
        }

        const parsedSats = parseBolt11Amount(input);
        if (parsedSats !== null && parsedSats > 0) {
            setLnAmount(parsedSats.toString());
            setHasFixedAmount(true);
            setResolvedLightningInput(input);
            return () => { active = false; controller.abort(); };
        }

        // Amountless BOLT11 invoices use the amount the sender enters below.
        if (/^(?:lightning:)?(?:lnbcrt|lntb|lnbc)[0-9a-z]*1/i.test(input)) {
            setResolvedLightningInput(input);
            return () => { active = false; controller.abort(); };
        }

        if (!isNetworkRecipient || (!isLnurlInput && input.includes('@') && !isLightningAddress(input))) {
            return () => { active = false; controller.abort(); };
        }

        const resolveInput = async () => {
            try {
                const parsed = await resolveLnurlOrAddress(input, { signal: controller.signal });
                if (!active || controller.signal.aborted) return;

                setResolvedLightningInput(input);
                if (parsed && parsed.tag === 'payRequest') {
                    const minSats = Number(parsed.minSendable) / 1000;
                    const maxSats = Number(parsed.maxSendable) / 1000;

                    setLnurlData(parsed);

                    try {
                        const urlObj = new URL(parsed.callback);
                        setLnurlDomain(urlObj.hostname);
                    } catch {
                        setLnurlDomain('');
                    }

                    if (minSats === maxSats && minSats > 0) {
                        setLnAmount(minSats.toString());
                        setHasFixedAmount(true);
                    }
                }
            } catch (error) {
                if (active && !controller.signal.aborted) {
                    setResolvedLightningInput(input);
                    setLnurlData(null);
                    setResolutionError(error instanceof Error ? error.message : 'Could not resolve recipient.');
                }
            }
        };

        timeout = setTimeout(resolveInput, 300);

        return () => {
            active = false;
            if (timeout) clearTimeout(timeout);
            controller.abort();
        };
    }, [lightningInvoice, mode, resolutionRetry]);

    useEffect(() => {
        let isMounted = true;

        const sats = parseInt(lnAmount, 10);

        if (isNaN(sats) || sats <= 0 || !currentLightningInput || !canPayLightning) {
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

                if (currentLnurlData) {
                    const invoicePr = await fetchLnurlInvoice(currentLnurlData.callback, sats * 1000);
                    if (!isMounted) return;
                    estimatedFee = await estimateLightningFee(invoicePr);
                } else {
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

        const timeout = setTimeout(fetchAndEstimate, 800);

        return () => {
            isMounted = false;
            clearTimeout(timeout);
        };
    }, [lnAmount, currentLnurlData, lightningInvoice, hasFixedAmount, canPayLightning, estimateLightningFee]);

    // Always-instant balance, sourced from WalletContext's own synced cache
    // (the same number WalletScreen already shows). Kept live via useEffect
    // below so switching wallets or background syncs update it immediately.
    const contextBalance = useMemo(() => {
        if (!activeWallet) return 0;
        return activeWallet.derivedAddressInfoCache.reduce((acc, curr) => acc + curr.balance, 0);
    }, [activeWallet]);

    useEffect(() => {
        setBalance(contextBalance);
    }, [contextBalance]);

    // Same address set BalanceDetailScreen and CoinControlScreen use, passed to
    // the same react-query-backed hook — so all three screens share one cache
    // entry instead of each fetching UTXOs independently.
    const queryAddresses = useMemo(
        () => getWalletUtxoQueryAddresses(activeWallet),
        [activeWallet]
    );

    const {
        data: utxos = [],
        refetch: refetchUtxos,
    } = useWalletUTXOs(activeWallet?.id, queryAddresses);

    // Refines the instant context balance once real UTXOs are available
    // (needed anyway for coin selection at send time). Runs quietly — no
    // loading state, since `balance` already shows a correct number.
    useEffect(() => {
        if (utxos.length > 0) {
            setBalance(utxos.reduce((sum, u) => sum + u.value, 0));
        }
    }, [utxos]);

    useEffect(() => {
        if (isFocused && queryAddresses.length > 0) {
            void refetchUtxos();
        }
    }, [isFocused, queryAddresses.length, refetchUtxos]);

    useEffect(() => {
        if (activeWallet && lastRefreshTime > 0) {
            void refetchUtxos();
        }
    }, [lastRefreshTime]);

    useEffect(() => {
        let isMounted = true;

        if (mode === 'onchain') {
            fetchFeeEstimates()
                .then(estimates => {
                    if (isMounted && estimates) {
                        setFeeOptions(estimates);
                    }
                })
                .catch(err => console.log("Background fee fetch failed:", err));
        }

        return () => { isMounted = false; };
    }, [mode]);

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
            const metrics = calculateTransactionMetrics(
                utxosToUse.length,
                amountSatoshis,
                totalSelectedValue,
                finalFeeRate
            );

            const pendingTx = {
                txid: txId,
                type: 'send',
                amount: amountSatoshis,
                fee: metrics.numOutputs === 1 ? totalSelectedValue - amountSatoshis : metrics.fee,
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
        if (actionLock.current) return;
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

        actionLock.current = true;
        Keyboard.dismiss();
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

            if (isWatchOnly) {
                rate = selectedFee === 'custom' ? parseInt(customRate, 10) : estimates?.[selectedFee] ?? rate;
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
            const { fee, change, numOutputs } = calculateTransactionMetrics(
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
                        selectedRate: rate,
                        feeOptions: options,
                        onSelectFeeOption: () => { },
                        utxos: utxosForTx,
                    });
                }
            };

            if (change < 0) {
                Alert.alert('Insufficient for fees', 'The selected coins don’t cover the amount and network fee.');
                return;
            }

            if (isWatchOnly && numOutputs === 1 && change > 0 && change <= DUST_THRESHOLD) {
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
        } finally {
            actionLock.current = false;
            setLoading(false);
        }
    };

    const handlePayLightning = async (skipAuth: boolean = false) => {
        if (actionLock.current || !canPayLightning) return;
        if (!lightningInvoice.trim()) {
            Alert.alert('Invalid input', 'Please enter a valid lightning invoice or address.');
            return;
        }

        const sats = parseInt(lnAmount, 10);
        if (isNaN(sats) || sats <= 0) {
            Alert.alert('Invalid amount', 'Please enter a valid amount.');
            return;
        }

        // The SDK validates the actual quote and balance. A cached UI balance
        // may not yet include an incoming payment.

        actionLock.current = true;
        Keyboard.dismiss();
        setLoading(true);
        try {
            if (!skipAuth && !await authenticate_transaction_action('Authorize Lightning payment')) return;
            const paymentRequest = currentLnurlData
                ? await fetchLnurlInvoice(currentLnurlData.callback, sats * 1000)
                : lightningInvoice.trim();
            const transaction = await payLightningInvoice(paymentRequest, currentLnurlData || hasFixedAmount ? undefined : sats);
            navigation.navigate('TransactionSuccess', { type: 'lightning', transaction });
        } catch (error: any) {
            console.error("Lightning payment failed:", error);
            Alert.alert('Payment error', error.message || 'Failed to process lightning payment.');
        } finally {
            actionLock.current = false;
            setLoading(false);
        }
    };

    const handleOpenCoinControl = () => {
        Keyboard.dismiss();
        const cleanAmount = amount.replace(',', '.');
        const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
        navigation.navigate('CoinControl', {
            targetAmount: amountSatoshis,
            onSelect: setSelectedUtxos,
        });
    };

    const handleScanPress = () => {
        navigation.navigate('QRScanner', {
            onScanSuccess: (scannedData) => {
                if (mode === 'lightning') {
                    const invoice = scannedData.replace(/^(lightning:)/i, '');
                    setLightningInvoice(invoice);
                } else {
                    applyRecipient(scannedData);
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

    const changeUnit = (nextUnit: Unit) => {
        if (nextUnit === unit) return;
        if (amount.trim()) {
            const value = amount.replace(',', '.');
            const valid = unit === 'BTC' ? /^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/.test(value) : /^\d+$/.test(value);
            const sats = unit === 'BTC' ? Math.round(Number(value) * 100000000) : Number(value);
            if (!valid || !Number.isSafeInteger(sats)) return;
            setAmount(nextUnit === 'sats' ? String(sats) : (sats / 100000000).toFixed(8).replace(/\.?0+$/, ''));
        }
        setUnit(nextUnit);
    };

    const actionDisabled = loading || (mode === 'lightning' ? !canPayLightning || !lnAmount : !is_onchain_form_valid);
    const displayBalance = mode === 'lightning' ? lightningBalance : balance;

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                bounces={false}
            >

                <View style={styles.balanceContainer}>
                    <Text style={styles.balanceLabel}>Available to send</Text>
                    <TouchableOpacity
                        onPress={() => mode === 'onchain' && navigation.navigate('BalanceDetail', { utxos: utxos })}
                        disabled={mode === 'lightning'}
                    >
                        <Text style={styles.balanceText}>
                            {hideBalance ? '*******' : (
                                <>{formatBalance(displayBalance)} {(mode === 'lightning' || unit === 'sats') ? 'sats' : <Text style={styles.orangeSymbol}>₿</Text>}</>
                            )}
                        </Text>
                    </TouchableOpacity>
                </View>

                {mode === 'onchain' ? (
                    <>
                        <Text style={styles.label}>Recipient address</Text>
                        <View style={styles.inputSpacing}>
                            <StyledInput
                                accessibilityLabel="Recipient address"
                                multiline
                                numberOfLines={2}
                                style={styles.addressInput}
                                containerStyle={styles.recipientField}
                                placeholder="Bitcoin address"
                                value={recipientAddress}
                                onChangeText={setRecipientAddress}
                                autoCapitalize="none"
                                autoCorrect={false}
                                spellCheck={false}
                                editable={!loading}
                                rightElement={
                                    <View style={styles.row}>
                                        <TouchableOpacity onPress={handlePasteFromClipboard} disabled={loading} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Paste address">
                                            <Feather name="clipboard" size={19} color={theme.colors.primary} />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => navigation.navigate('AddressBook', { returnScreen: 'Send' })} disabled={loading} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Open address book">
                                            <Feather name="book-open" size={19} color={theme.colors.primary} />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={handleScanPress} disabled={loading} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Scan QR code">
                                            <Feather name="camera" size={19} color={theme.colors.primary} />
                                        </TouchableOpacity>
                                    </View>
                                }
                            />
                        </View>

                        <Text style={styles.label}>Amount</Text>
                        <StyledInput
                            placeholder={unit === 'BTC' ? '0.00' : '0'}
                            editable={!loading}
                            value={amount}
                            onChangeText={setAmount}
                            keyboardType={unit === 'BTC' ? 'decimal-pad' : 'number-pad'}
                            rightElement={
                                <View style={styles.unitSelector}>
                                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: unit === 'BTC' }} disabled={loading} onPress={() => changeUnit('BTC')} style={[styles.unitButton, unit === 'BTC' && styles.unitButtonActive]}>
                                        <Text style={[styles.unitText, unit === 'BTC' && styles.unitTextActive]}>BTC</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: unit === 'sats' }} disabled={loading} onPress={() => changeUnit('sats')} style={[styles.unitButton, unit === 'sats' && styles.unitButtonActive]}>
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

                        <TouchableOpacity
                            style={[styles.coinControlRow, !is_amount_entered && styles.buttonDisabled]}
                            onPress={handleOpenCoinControl}
                            disabled={loading || !is_amount_entered}
                            accessibilityRole="button"
                            accessibilityState={{ disabled: loading || !is_amount_entered }}
                        >
                            <Feather name="layers" size={17} color={theme.colors.primary} />
                            <Text style={styles.coinControlTitle}>Coin control</Text>
                            <Text style={styles.coinControlValue}>
                                {isCoinControlActive ? `${selectedUtxos.length} selected` : 'Automatic'}
                                {isCoinControlActive && !hideBalance ? (
                                    <Text style={styles.coinControlAmount}>{'\n'}{formatBalance(selectedUtxos.reduce((sum, coin) => sum + coin.value, 0))} {unit}</Text>
                                ) : null}
                            </Text>
                            <Feather name="chevron-right" size={18} color={theme.colors.muted} />
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        <Text style={styles.label}>{lnurlDomain ? `Paying to ${lnurlDomain}` : 'Lightning invoice'}</Text>
                        <View style={styles.inputSpacing}>
                            <StyledInput
                                accessibilityLabel="Lightning recipient"
                                placeholder="Invoice or Lightning address"
                                editable={!loading}
                                value={lightningInvoice}
                                onChangeText={setLightningInvoice}
                                autoCapitalize="none"
                                    spellCheck={false}
                                autoCorrect={false}
                                rightElement={
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <TouchableOpacity onPress={async () => {
                                            const text = await Clipboard.getStringAsync();
                                            if (text) setLightningInvoice(text);
                                        }} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Paste invoice">
                                            <Feather name="clipboard" size={20} color={theme.colors.primary} />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={handleScanPress} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Scan QR code">
                                            <Feather name="camera" size={20} color={theme.colors.primary} />
                                        </TouchableOpacity>
                                    </View>
                                }
                            />
                        </View>

                        {!!resolutionError && resolvedLightningInput === currentLightningInput && (
                            <View style={{ marginBottom: 12 }}>
                                <Text style={{ color: theme.colors.error }}>{resolutionError}</Text>
                                <TouchableOpacity onPress={() => setResolutionRetry(value => value + 1)} accessibilityRole="button" accessibilityLabel="Retry recipient resolution" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
                                    <Text style={{ color: theme.colors.primary }}>Retry</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        <Text style={styles.label}>Amount</Text>
                        <StyledInput
                            placeholder="0"
                            value={lnAmount}
                            onChangeText={setLnAmount}
                            keyboardType="numeric"
                            editable={!loading && !(hasFixedAmount && resolvedLightningInput === currentLightningInput)}
                            style={hasFixedAmount && resolvedLightningInput === currentLightningInput ? styles.inputDisabled : {}}
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

                    </>
                )}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity
                    onPress={mode === 'lightning' ? () => { void handlePayLightning(); } : handleConfirmPress}
                    style={[styles.sendButton, actionDisabled && styles.buttonDisabled]}
                    disabled={actionDisabled}
                    accessibilityRole="button"
                    accessibilityState={{ busy: loading }}
                >
                    {loading ? <ActivityIndicator color={theme.colors.bitcoin} /> : (
                        <Text style={styles.sendButtonText}>
                            {mode === 'lightning' ? 'Pay invoice' : isWatchOnly ? 'Export transaction' : 'Review payment'}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scrollContent: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
    balanceContainer: { alignItems: 'center', marginBottom: 20, gap: 4 },
    balanceLabel: { fontSize: 16, color: theme.colors.muted },
    balanceText: { fontSize: 28, fontWeight: 'bold', color: theme.colors.primary, padding: 0 },
    label: { fontSize: 16, fontWeight: '500', marginBottom: 8, color: theme.colors.primary },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inputSpacing: { marginBottom: 16 },
    recipientField: { height: 72 },
    addressInput: { paddingVertical: 12 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    unitSelector: { flexDirection: 'row', backgroundColor: theme.colors.border, borderRadius: 6, marginRight: 8, padding: 2 },
    unitButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 5 },
    unitButtonActive: { backgroundColor: theme.colors.primary },
    unitText: { fontWeight: '600', color: theme.colors.muted },
    unitTextActive: { color: theme.colors.inversePrimary },
    coinControlRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
    coinControlTitle: { fontSize: 14, color: theme.colors.primary, flexShrink: 1 },
    coinControlAmount: { fontSize: 12 },
    coinControlValue: { flex: 1, textAlign: 'right', fontSize: 12, color: theme.colors.muted },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    feeEstimateRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, marginTop: 8 },
    feeEstimateText: { fontSize: 14, color: theme.colors.muted },
    feeEstimateContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sendButton: { backgroundColor: theme.colors.primary, paddingVertical: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
    buttonDisabled: { opacity: 0.5 },
    sendButtonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: 'bold' },
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

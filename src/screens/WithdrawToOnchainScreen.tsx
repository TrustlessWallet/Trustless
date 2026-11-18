import React, { useRef, useState } from 'react';
import { Alert, Keyboard, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { AddressText } from '../components/AddressText';
import { StyledInput } from '../components/StyledInput';
import { NETWORK_NAME } from '../constants/network';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { authenticate_transaction_action } from '../services/authState';
import { validateBitcoinAddress } from '../services/bitcoin';
import type { RootStackParamList } from '../types';
import { cleanSats, feeLabels, feeTiers, formatSats, LightningTransferForm, TransferChoices, TransferDisclosure } from './LightningTransferForm';
import type { FeeTier } from './LightningTransferForm';

const MIN_WITHDRAW_SATS = 1000;
const quoteKeys = { fast: 'speedFast', normal: 'speedMedium', slow: 'speedSlow' } as const;
type Destination = 'own' | 'external';
type Prepared = {
    scope: string;
    amount: number;
    minerFee: number;
    providerFee: number;
    response: Awaited<ReturnType<ReturnType<typeof useWallet>['prepareWithdrawToOnchain']>>['prepareResponse'];
    tier: FeeTier;
    expiresAt: number;
};

export const WithdrawToOnchainScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const { theme } = useTheme();
    const { activeWallet, isLightningInitialized, lightningBalance, prepareWithdrawToOnchain, withdrawToOnchain, triggerRefresh } = useWallet();
    const [amount, setAmount] = useState('');
    const [destination, setDestination] = useState<Destination>('own');
    const [customAddress, setCustomAddress] = useState('');
    const [tier, setTier] = useState<FeeTier>('normal');
    const [destinationOpen, setDestinationOpen] = useState(false);
    const [priorityOpen, setPriorityOpen] = useState(false);
    const [working, setWorking] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [prepared, setPrepared] = useState<Prepared | null>(null);
    const locked = useRef(false);
    const addressRevision = useRef(0);
    const address = destination === 'own' ? activeWallet?.address ?? '' : customAddress.trim();
    const network = NETWORK_NAME;
    const scope = `${network}:${activeWallet?.id ?? ''}:${isLightningInitialized}:${address}:${amount}:${tier}`;
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const quote = prepared?.scope === scope ? prepared : null;

    const amountSats = Number(amount);
    const amountError = amount && (!/^\d+$/u.test(amount) || !Number.isSafeInteger(amountSats))
        ? 'Enter a whole amount in sats.' : null;
    const canReview = !!activeWallet && isLightningInitialized && !!address && !amountError && amountSats >= MIN_WITHDRAW_SATS;
    const invalidate = () => { setPrepared(null); setError(null); };
    const isCurrent = () => scope === currentScope.current && network === NETWORK_NAME && navigation.isFocused();

    const changeAddress = (value: string) => {
        if (locked.current) return;
        addressRevision.current++;
        setCustomAddress(value);
        invalidate();
    };

    const paste = async () => {
        const revision = ++addressRevision.current;
        try {
            const text = await Clipboard.getStringAsync();
            if (revision === addressRevision.current && isCurrent() && text.trim()) changeAddress(text);
        } catch {
            if (revision === addressRevision.current && isCurrent() && !locked.current) setError('Could not paste the address.');
        }
    };

    const scan = () => {
        const revision = ++addressRevision.current;
        Keyboard.dismiss();
        navigation.navigate('QRScanner', { onScanSuccess: text => {
            if (addressRevision.current === revision && scope === currentScope.current) changeAddress(text);
        } });
    };

    const review = async () => {
        if (!canReview || locked.current) return;
        if (!validateBitcoinAddress(address)) {
            setError('Enter a valid Bitcoin address for this network.');
            return;
        }

        locked.current = true;
        addressRevision.current++;
        setWorking(true);
        Keyboard.dismiss();
        invalidate();
        try {
            const { prepareResponse } = await prepareWithdrawToOnchain(address, amountSats, tier);
            const payment = prepareResponse?.paymentMethod;
            const feeQuote = payment?.tag === 'BitcoinAddress' ? payment.inner?.feeQuote : undefined;
            const fees = feeQuote?.[quoteKeys[tier]];
            const minerFee = Number(fees?.l1BroadcastFeeSat ?? NaN);
            const providerFee = Number(fees?.userFeeSat ?? NaN);
            if (!Number.isSafeInteger(minerFee) || !Number.isSafeInteger(providerFee) || minerFee < 0 || providerFee < 0
                || !Number.isSafeInteger(amountSats + minerFee + providerFee)) {
                throw new Error('The fee quote is unavailable. Review the withdrawal again.');
            }
            if (isCurrent()) setPrepared({ scope, amount: amountSats, minerFee, providerFee, response: prepareResponse, tier, expiresAt: Number(feeQuote?.expiresAt ?? 0) });
        } catch (cause) {
            if (isCurrent()) setError(cause instanceof Error ? cause.message : 'Could not prepare the withdrawal.');
        } finally {
            locked.current = false;
            setWorking(false);
        }
    };

    const confirm = async () => {
        if (!quote || completed || locked.current || !isCurrent()) return;
        locked.current = true;
        setWorking(true);
        Keyboard.dismiss();
        try {
            if (!await authenticate_transaction_action('Authorize Lightning to On-Chain swap') || !isCurrent()) return;
            if (quote.expiresAt > 0 && Date.now() >= quote.expiresAt * 1000) {
                setPrepared(null);
                setError('The fee quote expired. Review the withdrawal again.');
                return;
            }
            await withdrawToOnchain(quote.response, quote.tier);
            setCompleted(true);
            triggerRefresh();
            Alert.alert('Withdrawal initiated', 'Your withdrawal is in progress.',
                [{ text: 'OK', onPress: () => { if (navigation.isFocused()) navigation.goBack(); } }]);
        } catch (cause) {
            if (isCurrent()) {
                setPrepared(null);
                setError(cause instanceof Error ? cause.message : 'Could not complete the withdrawal.');
            }
        } finally {
            locked.current = false;
            setWorking(false);
        }
    };

    const busy = working || completed;
    return <LightningTransferForm from="Lightning wallet" to={destination === 'own' ? 'On-chain wallet' : 'External Bitcoin address'}
        balance={lightningBalance} amount={amount} onAmountChange={text => { setAmount(cleanSats(text)); invalidate(); }}
        amountHint={`Minimum ${formatSats(MIN_WITHDRAW_SATS)}`}
        error={amountError || error || (!isLightningInitialized ? 'Lightning is unavailable.' : null)}
        busy={busy} disabled={!canReview} action={quote ? 'Confirm withdrawal' : 'Review withdrawal'}
        onAction={quote ? confirm : review}
        onEdit={invalidate} quote={quote ? {
            amount: quote.amount,
            address: destination === 'external' ? address : undefined,
            fees: [{ label: 'Miner fee', amount: quote.minerFee }, { label: 'Provider fee', amount: quote.providerFee }],
        } : null}>
        <TransferDisclosure label="Destination" detail={destination === 'own' ? 'My wallet' : 'External address'}
            open={destinationOpen} onPress={() => setDestinationOpen(!destinationOpen)} disabled={busy} />
        {destinationOpen && (
            <TransferChoices<Destination> options={[{ key: 'own', label: 'My wallet' }, { key: 'external', label: 'External address' }]}
                selected={destination} disabled={busy} onSelect={key => {
                    addressRevision.current++;
                    setDestination(key);
                    invalidate();
                }} />
        )}
        {destination === 'own' && destinationOpen && address ? (
            <AddressText selectable address={address} style={{ color: theme.colors.primary, marginBottom: 8 }} />
        ) : null}
        {destination === 'external' && (
            <StyledInput accessibilityLabel="Bitcoin address" value={customAddress} onChangeText={changeAddress}
                placeholder="Bitcoin address" multiline containerStyle={styles.addressInput}
                autoCapitalize="none" autoCorrect={false} spellCheck={false} editable={!busy}
                rightElement={<View style={styles.actions}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Paste address" disabled={busy} style={styles.icon} onPress={paste}>
                        <Feather name="clipboard" size={19} color={theme.colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Scan address" disabled={busy} style={styles.icon} onPress={scan}>
                        <Feather name="camera" size={19} color={theme.colors.primary} />
                    </TouchableOpacity>
                </View>} />
        )}
        <TransferDisclosure label="Settlement speed" detail={feeLabels[tier]} open={priorityOpen}
            onPress={() => setPriorityOpen(!priorityOpen)} disabled={busy} />
        {priorityOpen && <TransferChoices options={feeTiers.map(key => ({ key, label: feeLabels[key] }))}
            selected={tier} onSelect={key => { setTier(key); invalidate(); }} disabled={busy} />}
    </LightningTransferForm>;
};

const styles = StyleSheet.create({
    addressInput: { height: 72, marginVertical: 8 },
    actions: { flexDirection: 'row' },
    icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Transaction } from 'bitcoinjs-lib';
import { AddressText } from '../components/AddressText';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { NETWORK_NAME } from '../constants/network';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { broadcastTransaction, calculateTransactionMetrics, calculateVSize, DUST_THRESHOLD, fetchFeeEstimates, fetchUTXOs } from '../services/bitcoin';
import type { UTXO } from '../types';
import { cleanSats, feeLabels, feeTiers, formatSats, LightningTransferForm, TransferChoices, TransferDisclosure } from './LightningTransferForm';

const MIN_TOPUP_SATS = DUST_THRESHOLD;
type Prepared = { fee: number; hex: string; changeIndex: number | null; amount: number; walletId: string; network: string; address: string };

export const LightningTopUpScreen = () => {
    const navigation = useNavigation();
    const { theme } = useTheme();
    const { activeWallet, isLightningInitialized, getLightningTopUpAddress, createAndSignTransaction, incrementChangeIndex, triggerRefresh } = useWallet();
    const balance = activeWallet?.derivedAddressInfoCache.reduce((sum, address) => sum + address.balance, 0) ?? 0;
    const [amount, setAmount] = useState('');
    const [swapAddress, setSwapAddress] = useState<string | null>(null);
    const [fees, setFees] = useState<Awaited<ReturnType<typeof fetchFeeEstimates>> | null>(null);
    const [tier, setTier] = useState<(typeof feeTiers)[number] | 'custom'>('normal');
    const [customRate, setCustomRate] = useState('');
    const [feeOpen, setFeeOpen] = useState(false);
    const [addressOpen, setAddressOpen] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [working, setWorking] = useState(false);
    const locked = useRef(false);
    const [completed, setCompleted] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [prepared, setPrepared] = useState<Prepared | null>(null);
    const walletId = activeWallet?.id;
    const network = NETWORK_NAME;
    const scope = `${network}:${walletId ?? ''}:${isLightningInitialized}`;
    const currentScope = useRef(scope);
    currentScope.current = scope;
    const [loadedScope, setLoadedScope] = useState('');
    const ready = loadedScope === scope && !loading && !loadError && !!fees && !!swapAddress;
    const quote = ready && prepared && prepared.walletId === walletId && prepared.network === network && prepared.address === swapAddress ? prepared : null;

    useEffect(() => {
        let current = true;
        setPrepared(null);
        setLoadError(false);
        setLoading(isLightningInitialized && !!walletId);
        if (isLightningInitialized && walletId) {
            void Promise.all([fetchFeeEstimates(), getLightningTopUpAddress()]).then(([options, address]) => {
                if (!current) return;
                if (!address) throw new Error('Deposit address unavailable');
                setFees(options);
                setSwapAddress(address);
                setLoadedScope(scope);
            }).catch(() => { if (current) setLoadError(true); })
                .finally(() => { if (current) setLoading(false); });
        }
        return () => { current = false; };
    }, [scope, loadAttempt]);

    const amountSats = Number(amount);
    const rate = tier === 'custom' ? Number(customRate) : fees?.[tier] ?? 0;
    const validRate = Number.isFinite(rate) && rate > 0 && (tier !== 'custom' || /^\d+(?:\.\d+)?$/u.test(customRate));
    const amountError = amount && (!/^\d+$/u.test(amount) || !Number.isSafeInteger(amountSats))
        ? 'Enter a whole amount in sats.'
        : amountSats > balance ? 'Amount exceeds available balance.' : null;
    const canReview = ready && !amountError && amountSats >= MIN_TOPUP_SATS && validRate;

    const invalidate = () => { setPrepared(null); setError(null); };
    const review = async () => {
        if (!canReview || locked.current || !activeWallet || !swapAddress) return;
        locked.current = true;
        setWorking(true);
        Keyboard.dismiss();
        invalidate();
        try {
            const funded = activeWallet.derivedAddressInfoCache.filter(item => item.balance > 0).map(item => item.address);
            if (!funded.length) throw new Error('No funds available.');
            const utxos = [...await fetchUTXOs(funded)].sort((a, b) => b.value - a.value);
            if (!utxos.length) throw new Error('No spendable coins found.');
            if (scope !== currentScope.current || network !== NETWORK_NAME || !navigation.isFocused()) return;
            const selected: UTXO[] = [];
            let inputTotal = 0;
            for (const coin of utxos) {
                selected.push(coin);
                inputTotal += coin.value;
                if (inputTotal >= amountSats + Math.ceil(calculateVSize(selected.length, 2) * rate)) break;
            }

            let recipientAmount = amountSats;
            const metrics = calculateTransactionMetrics(selected.length, amountSats, inputTotal, rate);
            if (metrics.change < 0) {
                const sweepFee = Math.ceil(calculateVSize(selected.length, 1) * rate);
                if (amountSats > inputTotal) throw new Error('Amount exceeds spendable balance.');
                recipientAmount = amountSats - sweepFee;
                if (recipientAmount < MIN_TOPUP_SATS) throw new Error('The amount after fees is below the minimum.');
            }

            const { txHex, usedChangeIndex } = await createAndSignTransaction(swapAddress, recipientAmount, selected, rate);
            if (!txHex) throw new Error('Could not prepare the top-up.');
            const fee = inputTotal - Transaction.fromHex(txHex).outs.reduce((sum, output) => sum + output.value, 0);
            if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('Could not verify the miner fee.');
            if (scope === currentScope.current && network === NETWORK_NAME && navigation.isFocused()) {
                setPrepared({ fee, amount: recipientAmount, hex: txHex, changeIndex: usedChangeIndex, walletId: activeWallet.id, network, address: swapAddress });
            }
        } catch (cause) {
            if (scope === currentScope.current) setError(cause instanceof Error ? cause.message : 'Could not prepare the top-up.');
        } finally {
            locked.current = false;
            setWorking(false);
        }
    };

    const confirm = async () => {
        if (!quote || completed || locked.current || quote.network !== NETWORK_NAME || !navigation.isFocused()) return;
        locked.current = true;
        setWorking(true);
        try {
            await broadcastTransaction(quote.hex);
            setCompleted(true);
            if (quote.changeIndex !== null) {
                await incrementChangeIndex(quote.walletId, quote.changeIndex).catch(() => {});
            }
            triggerRefresh();
            Alert.alert('Top-up initiated', 'Your Lightning balance will update after 3 on-chain confirmations.',
                [{ text: 'OK', onPress: () => { if (navigation.isFocused()) navigation.goBack(); } }]);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not broadcast the top-up.');
        } finally {
            locked.current = false;
            setWorking(false);
        }
    };

    const retry = isLightningInitialized && loadError;
    const busy = working || completed;
    return <LightningTransferForm from="On-chain wallet" to="Lightning wallet" balance={balance}
        amount={amount} onAmountChange={text => { setAmount(cleanSats(text)); invalidate(); }}
        amountHint={`Minimum ${formatSats(MIN_TOPUP_SATS)}`}
        error={amountError || (tier === 'custom' && !validRate ? 'Enter a fee rate above zero.' : null) || error || (loadError ? 'Could not load the deposit address or fees.' : !isLightningInitialized ? 'Lightning is unavailable.' : null)}
        busy={busy} disabled={!retry && (!canReview || loading)}
        onAction={retry ? () => setLoadAttempt(value => value + 1) : quote ? confirm : review}
        action={retry ? 'Retry connection' : quote ? 'Confirm top-up' : 'Review top-up'}
        onEdit={invalidate} quote={quote ? { amount: quote.amount, amountLabel: 'Deposit amount', fees: [{ label: 'Miner fee', amount: quote.fee }] } : null}>
        {loading ? <ActivityIndicator accessibilityLabel="Loading top-up details" color={theme.colors.bitcoin} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : null}
        <TransferDisclosure label="Fee rate" detail={ready && validRate ? `${rate} sat/vB` : undefined}
            open={feeOpen} onPress={() => setFeeOpen(!feeOpen)} disabled={!ready || busy} />
        {feeOpen && ready && fees && <View>
            <TransferChoices options={[...feeTiers, 'custom' as const].map(key => ({
                key, label: feeLabels[key], detail: key === 'custom' ? undefined : `${fees[key]} sat/vB`,
            }))} selected={tier} disabled={busy} onSelect={key => {
                if (key === 'custom' && tier !== 'custom') setCustomRate(String(rate));
                setTier(key); invalidate();
            }} />
            {tier === 'custom' && <StyledInput accessibilityLabel="Custom fee rate" placeholder="sat/vB" keyboardType="decimal-pad"
                value={customRate} onChangeText={text => { setCustomRate(text.replace(',', '.')); invalidate(); }} editable={!busy}
                rightElement={<Text style={{ color: theme.colors.muted, marginRight: 8 }}>sat/vB</Text>} />}
        </View>}
        <TransferDisclosure label="Deposit address" open={addressOpen} onPress={() => setAddressOpen(!addressOpen)} disabled={!ready} />
        {addressOpen && ready && swapAddress && <AddressText selectable address={swapAddress} style={{ color: theme.colors.primary, marginTop: 8 }} />}
    </LightningTransferForm>;
};

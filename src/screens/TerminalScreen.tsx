import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Clipboard, Modal, Pressable, ScrollView, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/StyledText';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { useTheme } from '../contexts/ThemeContext';
import { NETWORK_NAME } from '../constants/network';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearTerminalRequest, formatFiatMinor, formatTerminalAmount, loadTerminalRequest, parseFiatMinor, parseTerminalAmount, satsFromFiat, saveTerminalRequest, terminalNetwork, TerminalFiatQuote, TerminalRequest, TerminalUnit } from '../services/terminal';
import { FiatCurrency, getTerminalRates, TerminalRates } from '../services/terminalRates';

const PREFERRED_UNIT_KEY = '@terminalPreferredUnit';
const FIAT_UNITS: FiatCurrency[] = ['USD', 'EUR', 'CHF'];
const isFiat = (unit: TerminalUnit): unit is FiatCurrency => FIAT_UNITS.includes(unit as FiatCurrency);

type Stage = 'loading' | 'entry' | 'creating' | 'waiting' | 'received' | 'expired' | 'verificationUnavailable' | 'creationFailed' | 'walletChanged';

export default function TerminalScreen() {
  const { activeWallet, isLightningInitialized, lightningInitAttempted, lightningInitError, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice } = useWallet();
  const { setMode, changing } = useWalletMode();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [stage, setStage] = useState<Stage>('loading');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<TerminalUnit>('sats');
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [rates, setRates] = useState<TerminalRates | null>(null);
  const [rateError, setRateError] = useState('');
  const [rateLoading, setRateLoading] = useState(false);
  const [request, setRequest] = useState<TerminalRequest | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [now, setNow] = useState(Date.now());
  const [loadRevision, reload] = useState(0);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationRevision, retryValidation] = useState(0);
  const mounted = useRef(true);
  const activeRef = useRef(active);
  const generation = useRef(0);
  const busy = useRef(false);
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const rateFlight = useRef(false);
  const userSelectedUnit = useRef(false);
  const userEditedAmount = useRef(false);
  const hasRequestRef = useRef(false);
  hasRequestRef.current = !!request;
  const knownPaymentId = useRef<string | undefined>(undefined);
  const network = terminalNetwork(NETWORK_NAME);
  const scope = `${network}:${activeWallet?.id || ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const styles = makeStyles(theme.colors.background, theme.colors.primary, theme.colors.surface, theme.colors.muted, theme.colors.border, theme.colors.bitcoin);

  useEffect(() => {
    void AsyncStorage.getItem(PREFERRED_UNIT_KEY).then(saved => {
      if (mounted.current && !userSelectedUnit.current && !userEditedAmount.current && !hasRequestRef.current &&
          (saved === 'sats' || saved === 'BTC' || isFiat(saved as TerminalUnit))) setUnit(saved as TerminalUnit);
    }).catch(() => undefined);
  }, []);

  const refreshRates = useCallback(async () => {
    if (rateFlight.current) return;
    rateFlight.current = true;
    setRateLoading(true);
    setRateError('');
    try { const fetched = await getTerminalRates(); if (mounted.current) { setRates(fetched); setNow(Date.now()); } }
    catch { if (mounted.current) { setRates(null); setRateError('Price unavailable. Refresh price to charge in fiat.'); } }
    finally { rateFlight.current = false; if (mounted.current) setRateLoading(false); }
  }, []);

  useEffect(() => { if (isFiat(unit) && !request) void refreshRates(); }, [unit, request?.id, refreshRates]);
  useEffect(() => { if (!request && isFiat(unit)) { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); } }, [request?.id, unit]);

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => { activeRef.current = state === 'active'; setActive(state === 'active'); });
    return () => { mounted.current = false; ++generation.current; listener.remove(); };
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    const capturedScope = scope;
    busy.current = false;
    checking.current = false;
    lastCheck.current = 0;
    knownPaymentId.current = undefined;
    setRequest(null);
    setValidated(false);
    setError('');
    setHydrationFailed(false);
    setStage('loading');
    if (!activeWallet) { setStage('entry'); return; }
    loadTerminalRequest(activeWallet.id, network).then(saved => {
      if (!mounted.current || current !== generation.current || capturedScope !== scopeRef.current) return;
      if (saved) {
        setRequest(saved);
        setAmount(formatTerminalAmount(saved.amountSats, 'sats'));
        setUnit('sats');
        setStage('loading');
      } else setStage('entry');
    }).catch(() => {
      if (mounted.current && current === generation.current) {
        setHydrationFailed(true);
        setStage('creationFailed');
        setError('Cannot load the saved request. Retry before creating another.');
      }
    });
  }, [scope, loadRevision]);

  useEffect(() => {
    if (!request || validated || !isLightningInitialized || activeWallet?.id !== request.walletId || network !== request.network) return;
    const current = generation.current;
    const requestId = request.id;
    void validateTerminalInvoice(request.invoice, request.amountSats).then(expiresAt => {
      if (!mounted.current || current !== generation.current || scopeRef.current !== scope || requestId !== request.id) return;
      if (expiresAt !== request.expiresAt) throw new Error('Saved invoice expiry does not match.');
      setValidated(true);
      setError('');
      setStage(expiresAt <= Date.now() ? 'expired' : 'waiting');
    }).catch(() => {
      if (mounted.current && current === generation.current && scopeRef.current === scope) {
        setStage('verificationUnavailable');
        setError('Cannot validate the saved request. Retry before showing or sharing it.');
      }
    });
  }, [request?.id, validated, isLightningInitialized, activeWallet?.id, scope, validationRevision, validateTerminalInvoice]);

  const verify = useCallback(async (force = false) => {
    if (!request || !validated || !isLightningInitialized || !active || checking.current || stage === 'received' || stage === 'creating') return;
    if (!force && Date.now() - lastCheck.current < 5000) return;
    lastCheck.current = Date.now();
    const captured = generation.current;
    const capturedScope = scope;
    const requestId = request.id;
    checking.current = true;
    try {
      const result = await verifyTerminalInvoice(request.invoice, knownPaymentId.current);
      if (!mounted.current || !activeRef.current || captured !== generation.current || capturedScope !== scopeRef.current || requestId !== request.id) return;
      if (result.paymentId) knownPaymentId.current = result.paymentId;
      if (result.status === 'received') { setStage('received'); setError(''); }
      else { setStage(request.expiresAt <= Date.now() ? 'expired' : 'waiting'); setError(''); }
    } catch {
      if (mounted.current && activeRef.current && captured === generation.current && capturedScope === scopeRef.current) {
        setStage('verificationUnavailable');
        setError('Cannot verify payment right now. The invoice may still be paid.');
      }
    } finally { if (captured === generation.current) checking.current = false; }
  }, [request, validated, isLightningInitialized, active, stage, scope, verifyTerminalInvoice]);

  useEffect(() => {
    if (!request || !validated || !active || !isLightningInitialized || stage === 'received') return;
    void verify();
    const poll = setInterval(() => { void verify(); }, 6000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [request?.id, validated, active, isLightningInitialized, stage === 'received', verify]);

  useEffect(() => {
    if (request && now >= request.expiresAt && stage === 'waiting') setStage('expired');
  }, [now, request, stage]);

  const requestPayment = async () => {
    if (busy.current || request || hydrationFailed || !activeWallet || activeWallet.type === 'watch-only' || !isLightningInitialized) return;
    if (isFiat(unit) && (!rates || Date.now() < rates.fetchedAt || Date.now() - rates.fetchedAt >= 60_000 || rateError)) {
      setError('Price expired. Refresh price before charging.');
      return;
    }
    busy.current = true;
    const captured = ++generation.current;
    const capturedScope = scope;
    const walletId = activeWallet.id;
    const requestUnit = unit;
    const requestAmount = amount;
    const network = terminalNetwork(NETWORK_NAME);
    setStage('creating'); setError('');
    let sats: number;
    let fiatQuote: TerminalFiatQuote | undefined;
    try {
      if (isFiat(requestUnit)) {
        const minor = parseFiatMinor(requestAmount);
        // getTerminalRates reuses only a quote fetched within the last minute.
        const fresh = await getTerminalRates();
        if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
        sats = satsFromFiat(minor, fresh.rates[requestUnit]);
        fiatQuote = { currency: requestUnit, amountMinor: minor, rate: fresh.rates[requestUnit], fetchedAt: fresh.fetchedAt };
        setRates(fresh); setNow(Date.now()); setRateError('');
      } else sats = parseTerminalAmount(requestAmount, requestUnit);
      const created = await createTerminalInvoice(sats);
      if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
      const next: TerminalRequest = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        walletId, network, invoice: created.invoice, amountSats: sats,
        createdAt: Date.now(), expiresAt: created.expiresAt, fiat: fiatQuote,
        inputUnit: isFiat(requestUnit) ? undefined : requestUnit,
      };
      await saveTerminalRequest(next);
      if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
      setRequest(next);
      lastCheck.current = 0;
      setValidated(true);
      setStage(next.expiresAt <= Date.now() ? 'expired' : 'waiting');
    } catch (e) {
      if (mounted.current && captured === generation.current) {
        setStage('creationFailed');
        setError((e as Error)?.message || 'Could not create the request.');
      }
    } finally { if (captured === generation.current) busy.current = false; }
  };

  const endRequest = async () => {
    if (!request || busy.current) return;
    busy.current = true;
    try {
      await clearTerminalRequest(request);
      ++generation.current;
      checking.current = false;
      lastCheck.current = 0;
      knownPaymentId.current = undefined;
      setRequest(null); setStage('entry'); setAmount(''); setError('');
      setValidated(false);
    } catch { setError('Could not end the saved request. Please retry.'); }
    finally { busy.current = false; }
  };

  const confirmEnd = () => Alert.alert('End request?', 'This invoice can still be paid after you end it. Check your wallet for late payments.', [
    { text: 'Keep request', style: 'cancel' }, { text: 'End request', style: 'destructive', onPress: () => { void endRequest(); } },
  ]);

  const exit = () => {
    if (busy.current) return;
    const leave = () => { void setMode('wallet').catch(() => Alert.alert('Could not exit', 'Wallet mode could not be saved. Please retry.')); };
    if (request && stage !== 'received') Alert.alert('Exit terminal?', 'This invoice can still be paid. Your request will be here when you return.', [
      { text: 'Stay', style: 'cancel' }, { text: 'Exit terminal', onPress: leave },
    ]);
    else leave();
  };

  const selectUnit = (next: TerminalUnit) => {
    if (busy.current || next === unit) { setUnitPickerOpen(false); return; }
    const apply = () => {
      if (!isFiat(unit) && !isFiat(next)) {
        try { setAmount(formatTerminalAmount(parseTerminalAmount(amount, unit), next)); }
        catch { setAmount(''); }
      } else setAmount('');
      userSelectedUnit.current = true;
      setUnit(next); setError(''); setUnitPickerOpen(false);
      void AsyncStorage.setItem(PREFERRED_UNIT_KEY, next).catch(() => setError('Could not save preferred currency.'));
    };
    if ((isFiat(unit) || isFiat(next)) && amount && amount !== '0' && amount !== '0.00') {
      Alert.alert('Change currency?', 'The current amount will be cleared.', [
        { text: 'Keep amount', style: 'cancel' }, { text: 'Change currency', onPress: apply },
      ]);
    } else apply();
  };

  const key = (digit: string) => {
    if (busy.current) return;
    userEditedAmount.current = true;
    setError('');
    if (digit === 'back') { setAmount(v => v.slice(0, -1)); return; }
    if (digit === '.' && (unit === 'sats' || amount.includes('.'))) return;
    setAmount(v => {
      if (v.length >= 20 || (v.includes('.') && v.split('.')[1].length >= (isFiat(unit) ? 2 : 8))) return v;
      if (v === '' && digit === '.') return '0.';
      if (v === '0' && digit !== '.') return digit;
      return v + digit;
    });
  };

  const hasRequest = !!request;
  const isExpired = hasRequest && validated && (stage === 'expired' || now >= request.expiresAt);
  const rateFresh = !!rates && now >= rates.fetchedAt && now - rates.fetchedAt < 60_000;
  let approxSats: number | null = null;
  if (isFiat(unit) && rateFresh && amount) {
    try { approxSats = satsFromFiat(parseFiatMinor(amount), rates!.rates[unit]); } catch { /* incomplete keypad amount */ }
  }
  const amountPrefix = unit === 'USD' ? '$' : unit === 'EUR' ? '€' : unit === 'CHF' ? 'CHF ' : '';
  const frozenAmount = request?.fiat
    ? `${request.fiat.currency === 'USD' ? '$' : request.fiat.currency === 'EUR' ? '€' : 'CHF '}${formatFiatMinor(request.fiat.amountMinor)}`
    : request?.inputUnit === 'BTC' ? `${formatTerminalAmount(request.amountSats, 'BTC')} BTC`
      : `${request?.amountSats || 0} sats`;
  const frozenSecondary = request?.fiat || request?.inputUnit === 'BTC' ? `${request?.amountSats || 0} sats` : '';
  const entry = !!activeWallet && activeWallet.type !== 'watch-only' && !hasRequest && stage !== 'loading';

  return <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityLabel="Exit terminal" style={styles.exitButton} disabled={changing || stage === 'creating'} onPress={exit}>
        <Feather name="x" size={22} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
      {!activeWallet ? <Text style={styles.message}>Open a wallet to receive payments.</Text>
        : activeWallet.type === 'watch-only' ? <View style={styles.center}>
            <Feather name="eye" size={40} color={theme.colors.muted} />
            <Text style={styles.message}>This watch-only wallet cannot create Lightning payment requests.</Text>
            <TouchableOpacity style={styles.secondary} onPress={exit}><Text style={styles.secondaryText}>Exit terminal</Text></TouchableOpacity>
          </View>
        : stage === 'loading' && !hasRequest ? <ActivityIndicator color={theme.colors.bitcoin} />
        : !hasRequest ? <View style={styles.entry}>
            <View style={styles.amountArea}>
              <Text testID="terminal-amount" style={styles.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.45}>{amountPrefix}{amount || '0'}</Text>
              <TouchableOpacity accessibilityLabel="Choose currency" style={styles.unit} onPress={() => setUnitPickerOpen(true)}><Text style={styles.unitText}>{unit}  ▾</Text></TouchableOpacity>
              {isFiat(unit) ? <View style={styles.priceLine}>
                <Text style={styles.approx}>{approxSats !== null ? `≈ ${approxSats} sats` : rateLoading ? 'Fetching price…' : rateFresh ? 'Enter an amount' : 'Price unavailable'}</Text>
                {(!rateFresh || rateError) && <TouchableOpacity onPress={() => { void refreshRates(); }}><Text style={styles.refresh}>Refresh price</Text></TouchableOpacity>}
              </View> : null}
            </View>
            <View style={styles.padArea}>
              <View style={styles.keypad}>{['1','2','3','4','5','6','7','8','9',unit === 'sats' ? '' : '.', '0','back'].map((digit, i) =>
                <TouchableOpacity key={i} disabled={!digit} style={styles.key} activeOpacity={0.55} onPress={() => key(digit)}>
                  <Text style={styles.keyText}>{digit === 'back' ? '⌫' : digit}</Text>
                </TouchableOpacity>)}</View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {!isLightningInitialized ? <Text style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable.') : 'Connecting to Lightning…'}</Text> : null}
            </View>
          </View>
        : <View style={styles.checkout}>
            {stage === 'received' ? <Feather name="check-circle" size={70} color={theme.colors.bitcoin} /> : null}
            {validated ? <>
              <Text style={styles.checkoutAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{frozenAmount}</Text>
              {frozenSecondary ? <Text style={styles.approx}>{frozenSecondary}</Text> : null}
            </> : null}
            {validated && stage === 'waiting' && !isExpired ? <View testID="terminal-qr" style={styles.qrCard}><QRCode value={request.invoice.toUpperCase()} size={236} color="#000000" backgroundColor="#FFFFFF" /></View> : null}
            <Text style={styles.checkoutTitle}>{!validated ? stage === 'verificationUnavailable' ? 'Cannot validate request' : 'Checking saved request' : stage === 'received' ? 'Paid' : isExpired ? 'Request expired' : 'Waiting for payment'}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!validated && !isLightningInitialized ? <Text style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable. Retry when connected.') : 'Connecting to Lightning…'}</Text> : null}
            {stage !== 'received' && stage !== 'waiting' ? <TouchableOpacity style={styles.secondary} onPress={() => { if (validated) void verify(true); else retryValidation(v => v + 1); }}><Text style={styles.secondaryText}>{validated ? 'Check payment' : 'Retry validation'}</Text></TouchableOpacity> : null}
            {validated && stage !== 'received' && <View style={styles.actions}>
              <TouchableOpacity onPress={() => Clipboard.setString(request.invoice)}><Text style={styles.action}>Copy</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => { void Share.share({ message: request.invoice }); }}><Text style={styles.action}>Share</Text></TouchableOpacity>
            </View>}
            <TouchableOpacity style={stage === 'received' ? styles.primary : styles.secondary} onPress={stage === 'received' ? () => { void endRequest(); } : confirmEnd}><Text style={stage === 'received' ? styles.primaryText : styles.secondaryText}>{stage === 'received' ? 'New payment' : 'End request'}</Text></TouchableOpacity>
          </View>}
    </ScrollView>
    {entry && <TouchableOpacity testID="terminal-request" disabled={stage === 'creating' || (!isLightningInitialized && !hydrationFailed) || (isFiat(unit) && !rateFresh && !hydrationFailed)} style={[styles.charge, { paddingBottom: insets.bottom + 10 }, stage === 'creating' && styles.disabled]} onPress={() => { if (hydrationFailed) { setError(''); reload(v => v + 1); } else void requestPayment(); }}>
      <Text style={styles.chargeText}>{hydrationFailed ? 'Retry loading' : stage === 'creating' ? 'Creating request…' : 'Charge'}</Text>
    </TouchableOpacity>}
    <Modal visible={unitPickerOpen} transparent animationType="fade" onRequestClose={() => setUnitPickerOpen(false)}>
      <View style={styles.modalBackdrop} accessible={false}>
        <Pressable style={styles.modalOverlay} accessible={false} onPress={() => setUnitPickerOpen(false)} />
        <View style={styles.modalCard}>{(['USD','EUR','CHF','sats','BTC'] as TerminalUnit[]).map(choice =>
          <TouchableOpacity key={choice} accessibilityRole="button" accessibilityState={{ selected: choice === unit }} accessibilityLabel={choice} style={styles.modalRow} onPress={() => selectUnit(choice)}><Text style={[styles.modalText, choice === unit && { color: theme.colors.bitcoin }]}>{choice}</Text></TouchableOpacity>)}</View>
      </View>
    </Modal>
  </View>;
}

function makeStyles(background: string, primary: string, surface: string, muted: string, border: string, bitcoin: string) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: background },
    header: { height: 54, paddingHorizontal: 18, alignItems: 'flex-end', justifyContent: 'center' },
    exitButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: surface },
    scroll: { flex: 1 },
    content: { flexGrow: 1 },
    entry: { flex: 1, paddingHorizontal: 24 },
    amountArea: { flex: 1, minHeight: 150, alignItems: 'center', justifyContent: 'center' },
    amount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 62, textAlign: 'center', width: '100%' },
    unit: { marginTop: 14, minWidth: 96, height: 40, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: surface },
    unitText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    priceLine: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    approx: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 13, textAlign: 'center' },
    refresh: { color: bitcoin, fontFamily: 'SpaceMono-Bold', fontSize: 12, marginTop: 5 },
    padArea: { justifyContent: 'flex-end', paddingBottom: 14 },
    keypad: { flexDirection: 'row', flexWrap: 'wrap' },
    key: { width: '33.33%', height: 64, alignItems: 'center', justifyContent: 'center' },
    keyText: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: 27 },
    charge: { backgroundColor: bitcoin, minHeight: 70, alignItems: 'center', justifyContent: 'center', paddingTop: 10 },
    chargeText: { color: '#000000', fontFamily: 'SpaceMono-Bold', fontSize: 18 },
    disabled: { opacity: 0.55 },
    checkout: { flex: 1, paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center', justifyContent: 'center' },
    checkoutAmount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 40, textAlign: 'center', width: '100%' },
    checkoutTitle: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 14, textAlign: 'center', marginTop: 22 },
    qrCard: { padding: 18, backgroundColor: '#FFFFFF', borderRadius: 8, marginTop: 30 },
    actions: { flexDirection: 'row', gap: 42, marginTop: 24 },
    action: { color: bitcoin, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    primary: { backgroundColor: bitcoin, borderRadius: 8, minHeight: 54, minWidth: 210, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 28 },
    primaryText: { color: '#000000', fontFamily: 'SpaceMono-Bold', fontSize: 15 },
    secondary: { borderColor: border, borderWidth: 1, borderRadius: 8, minHeight: 46, minWidth: 150, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 20 },
    secondaryText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    message: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: 15, textAlign: 'center', marginTop: 18 },
    error: { color: '#CC0000', fontFamily: 'SpaceMono-Regular', fontSize: 12, textAlign: 'center', marginTop: 10 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
    modalOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    modalCard: { backgroundColor: background, borderRadius: 8, width: '100%', maxWidth: 320, paddingVertical: 8 },
    modalRow: { height: 54, paddingHorizontal: 24, justifyContent: 'center' },
    modalText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 17 },
  });
}

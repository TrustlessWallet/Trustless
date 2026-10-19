import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/StyledText';
import { GlassView } from '../components/GlassView';
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
export const isTerminalPollDue = (lastAttempt: number, intervalMs: number, now = Date.now()) => now < lastAttempt || now - lastAttempt >= intervalMs;

type Stage = 'loading' | 'entry' | 'creating' | 'waiting' | 'received' | 'expired' | 'verificationUnavailable' | 'creationFailed' | 'walletChanged';

export default function TerminalScreen() {
  const { activeWallet, isLightningInitialized, lightningInitAttempted, lightningInitError, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice } = useWallet();
  const { setMode, changing } = useWalletMode();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
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
  const lastUnfilteredCheck = useRef(0);
  const rateFlight = useRef(false);
  const userSelectedUnit = useRef(false);
  const preferredUnit = useRef<TerminalUnit>('sats');
  const pickerProgress = useRef(new Animated.Value(0)).current;
  const userEditedAmount = useRef(false);
  const hasRequestRef = useRef(false);
  hasRequestRef.current = !!request;
  const knownPaymentId = useRef<string | undefined>(undefined);
  const network = terminalNetwork(NETWORK_NAME);
  const scope = `${network}:${activeWallet?.id || ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const styles = makeStyles(theme.colors.background, theme.colors.primary, theme.colors.inversePrimary, theme.colors.surface, theme.colors.muted, theme.colors.border, theme.colors.bitcoin, screenHeight);

  useEffect(() => {
    void AsyncStorage.getItem(PREFERRED_UNIT_KEY).then(saved => {
      if (!userSelectedUnit.current && !userEditedAmount.current && (saved === 'sats' || saved === 'BTC' || isFiat(saved as TerminalUnit))) {
        preferredUnit.current = saved as TerminalUnit;
        if (mounted.current && !userSelectedUnit.current && !userEditedAmount.current && !hasRequestRef.current) {
          setUnit(saved as TerminalUnit);
        }
      }
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

  useEffect(() => {
    if (!request && active && isFiat(unit) && (!rates || Date.now() < rates.fetchedAt || Date.now() - rates.fetchedAt >= 60_000)) void refreshRates();
  }, [active, unit, request?.id, rates?.fetchedAt, now, refreshRates]);
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
    lastUnfilteredCheck.current = Date.now();
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
        setUnit(preferredUnit.current);
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
    if (!force && !isTerminalPollDue(lastCheck.current, 5000)) return;
    lastCheck.current = Date.now();
    const captured = generation.current;
    const capturedScope = scope;
    const requestId = request.id;
    checking.current = true;
    try {
      const useUnfilteredFallback = !knownPaymentId.current && (force || isTerminalPollDue(lastUnfilteredCheck.current, 60_000));
      if (useUnfilteredFallback) lastUnfilteredCheck.current = Date.now();
      const result = await verifyTerminalInvoice(request.invoice, request.createdAt, knownPaymentId.current, useUnfilteredFallback);
      if (!mounted.current || !activeRef.current || captured !== generation.current || capturedScope !== scopeRef.current || requestId !== request.id) return;
      if (result.paymentId) knownPaymentId.current = result.paymentId;
      if (result.status === 'received') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        setStage('received'); setError('');
      }
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
    if (!unitPickerOpen) { pickerProgress.setValue(0); return; }
    Animated.spring(pickerProgress, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.7 }).start();
  }, [unitPickerOpen, pickerProgress]);

  useEffect(() => {
    if (request && now >= request.expiresAt && stage === 'waiting') setStage('expired');
  }, [now, request, stage]);

  const requestPayment = async () => {
    if (busy.current || request || hydrationFailed || !activeWallet || activeWallet.type === 'watch-only') return;
    if (!isLightningInitialized) {
      setError(lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable.') : 'Connecting to Lightning…');
      return;
    }
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
      lastUnfilteredCheck.current = Date.now();
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
      lastUnfilteredCheck.current = Date.now();
      knownPaymentId.current = undefined;
      setRequest(null); setStage('entry'); setAmount(''); setUnit(preferredUnit.current); setError('');
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

  const close = () => {
    if (request) { void endRequest(); return; }
    exit();
  };

  const selectUnit = (next: TerminalUnit) => {
    if (busy.current || request || next === unit) { setUnitPickerOpen(false); return; }
    const apply = () => {
      if (!isFiat(unit) && !isFiat(next)) {
        try { setAmount(formatTerminalAmount(parseTerminalAmount(amount, unit), next)); }
        catch { setAmount(''); }
      } else setAmount('');
      userSelectedUnit.current = true;
      preferredUnit.current = next;
      setUnit(next); setError(''); setUnitPickerOpen(false);
      void AsyncStorage.setItem(PREFERRED_UNIT_KEY, next).catch(() => setError('Could not save preferred currency.'));
    };
    apply();
  };

  const key = (digit: string) => {
    if (busy.current) return;
    Haptics.selectionAsync().catch(() => undefined);
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
  const expiresIn = request ? Math.max(0, Math.ceil((request.expiresAt - now) / 1000)) : 0;
  const expiresLabel = `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')}`;
  const qrSize = Math.max(220, Math.min(280, screenWidth - 48));
  const entry = !!activeWallet && activeWallet.type !== 'watch-only' && !hasRequest && stage !== 'loading';

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      {!hasRequest ? <TouchableOpacity accessibilityLabel="Choose currency" style={styles.glassControl} onPress={() => setUnitPickerOpen(true)}>
          <GlassView width={92} height={40} shape="capsule" interactive={true} style={styles.glassSurface}>
            <View style={styles.glassRow}>
              <Text style={styles.glassLabel}>{unit}</Text>
              <Feather name="chevron-down" size={14} color={theme.colors.primary} />
            </View>
          </GlassView>
        </TouchableOpacity> : <View style={styles.glassControl} />}
      <TouchableOpacity accessibilityLabel={hasRequest ? 'Close invoice' : 'Exit terminal'} style={[styles.glassControl, styles.glassControlEnd]} disabled={changing || stage === 'creating'} onPress={close}>
        <GlassView width={40} height={40} shape="circle" interactive={true} style={styles.glassSurface}>
          <Feather name="x" size={21} color={theme.colors.primary} />
        </GlassView>
      </TouchableOpacity>
    </View>
    <View style={styles.content}>
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
              {isFiat(unit) ? <View style={styles.priceLine}>
                <Text style={styles.approx}>{approxSats !== null ? `≈ ${approxSats} sats` : rateLoading ? 'Fetching price…' : rateFresh ? '' : 'Price unavailable'}</Text>
                {(!rateFresh || rateError) && <TouchableOpacity onPress={() => { void refreshRates(); }}><Text style={styles.refresh}>Refresh price</Text></TouchableOpacity>}
              </View> : null}
            </View>
            <View style={styles.padArea}>
              <View style={styles.keypad}>{['1','2','3','4','5','6','7','8','9',unit === 'sats' ? '' : '.', '0','back'].map((digit, i) =>
                <TouchableOpacity key={i} disabled={!digit} style={styles.key} activeOpacity={0.55} onPress={() => key(digit)}>
                  <Text style={styles.keyText}>{digit === 'back' ? '⌫' : digit}</Text>
                </TouchableOpacity>)}</View>
              <View style={styles.feedbackArea}>
                {error ? <Text numberOfLines={2} style={styles.error}>{error}</Text> : null}
                {!error && !isLightningInitialized ? <Text numberOfLines={2} style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable.') : 'Connecting to Lightning…'}</Text> : null}
              </View>
            </View>
          </View>
        : <ScrollView style={styles.checkoutScroll} contentContainerStyle={styles.checkoutScrollContent} bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.checkout}>
            {stage === 'received' ? <Feather name="check-circle" size={70} color={theme.colors.bitcoin} /> : null}
            {validated ? <>
              <Text style={styles.checkoutAmount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{frozenAmount}</Text>
              {frozenSecondary ? <Text style={styles.approx}>{frozenSecondary}</Text> : null}
            </> : null}
            {!validated || stage === 'received' || isExpired ? <Text style={styles.checkoutTitle}>{!validated ? stage === 'verificationUnavailable' ? 'Cannot validate request' : 'Checking saved request' : stage === 'received' ? 'Paid' : 'Request expired'}</Text> : null}
            {validated && (stage === 'waiting' || stage === 'verificationUnavailable') && !isExpired ? <View style={styles.qrArea}>
              <View testID="terminal-qr" style={styles.qrCard}><QRCode value={request.invoice.toUpperCase()} size={qrSize} color={theme.colors.primary} backgroundColor={theme.colors.background} /></View>
              <Text style={styles.expiry}>{expiresLabel}</Text>
            </View> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {!validated && !isLightningInitialized ? <Text style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable. Retry when connected.') : 'Connecting to Lightning…'}</Text> : null}
            {stage !== 'received' && stage !== 'waiting' ? <TouchableOpacity style={styles.secondary} onPress={() => { if (validated) void verify(true); else retryValidation(v => v + 1); }}><Text style={styles.secondaryText}>{validated ? 'Check payment' : 'Retry validation'}</Text></TouchableOpacity> : null}
            {stage === 'received' ? <TouchableOpacity style={styles.primary} onPress={() => { void endRequest(); }}><Text style={styles.primaryText}>New payment</Text></TouchableOpacity> : null}
          </View>
        </ScrollView>}
    </View>
    {entry && <View style={styles.actionBar}>
      <TouchableOpacity testID="terminal-request" disabled={stage === 'creating'} style={[styles.primaryAction, stage === 'creating' && styles.disabled]} onPress={() => { if (hydrationFailed) { setError(''); reload(v => v + 1); } else void requestPayment(); }}>
        <Text style={styles.primaryActionText}>{hydrationFailed ? 'Retry loading' : stage === 'creating' ? 'Creating invoice…' : 'Generate invoice'}</Text>
      </TouchableOpacity>
    </View>}
    <Modal visible={unitPickerOpen} transparent animationType="none" onRequestClose={() => setUnitPickerOpen(false)}>
      <View style={[styles.modalBackdrop, { paddingTop: insets.top + 58 }]} accessible={false}>
        <Pressable style={styles.modalOverlay} accessible={false} onPress={() => setUnitPickerOpen(false)} />
        <Animated.View style={[styles.currencyPopover, { opacity: pickerProgress, transform: [{ scale: pickerProgress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }] }]}>
          <GlassView width={204} height={140} borderRadius={24} shape="roundedRectangle" interactive={true} style={styles.glassSurface}>
            <View style={styles.currencyGrid}>{(['USD','EUR','CHF','sats','BTC'] as TerminalUnit[]).map(choice =>
              <TouchableOpacity key={choice} accessibilityRole="button" accessibilityState={{ selected: choice === unit }} accessibilityLabel={choice} style={styles.currencyOption} onPress={() => selectUnit(choice)}><Text style={[styles.currencyText, choice === unit && styles.currencyTextSelected]}>{choice}</Text></TouchableOpacity>)}</View>
          </GlassView>
        </Animated.View>
      </View>
    </Modal>
  </View>;
}

function makeStyles(background: string, primary: string, inversePrimary: string, surface: string, muted: string, border: string, bitcoin: string, screenHeight: number) {
  const compact = screenHeight < 740;
  const short = screenHeight < 620;
  const keyHeight = short ? 56 : compact ? 64 : 70;
  const keyFontSize = short ? 26 : compact ? 28 : 30;
  const amountMinHeight = short ? 100 : compact ? 130 : 150;
  const keypadPadding = short ? 12 : compact ? 14 : 22;
  const feedbackHeight = short ? 38 : compact ? 40 : 44;
  const actionBottomPadding = short ? 30 : compact ? 40 : 48;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: background },
    header: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    glassControl: { width: 92, height: 44, justifyContent: 'center' },
    glassControlEnd: { alignItems: 'flex-end' },
    glassSurface: { overflow: 'visible' },
    glassRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    glassLabel: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 13, marginRight: 5 },
    content: { flex: 1 },
    entry: { flex: 1, paddingHorizontal: 24 },
    amountArea: { flex: 1, minHeight: amountMinHeight, alignItems: 'center', justifyContent: 'center' },
    amount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 62, textAlign: 'center', width: '100%' },
    priceLine: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    approx: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 13, textAlign: 'center' },
    refresh: { color: bitcoin, fontFamily: 'SpaceMono-Bold', fontSize: 12, marginTop: 5 },
    padArea: { justifyContent: 'flex-end', paddingBottom: keypadPadding },
    keypad: { flexDirection: 'row', flexWrap: 'wrap' },
    key: { width: '33.33%', height: keyHeight, alignItems: 'center', justifyContent: 'center' },
    keyText: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: keyFontSize },
    feedbackArea: { height: feedbackHeight, alignItems: 'center', justifyContent: 'center' },
    actionBar: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: actionBottomPadding },
    primaryAction: { backgroundColor: primary, minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    primaryActionText: { color: inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 16 },
    disabled: { opacity: 0.55 },
    checkoutScroll: { flex: 1 },
    checkoutScrollContent: { flexGrow: 1, paddingVertical: 12 },
    checkout: { flex: 1, paddingHorizontal: 24, paddingBottom: 20, alignItems: 'center', justifyContent: 'center' },
    checkoutAmount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 40, textAlign: 'center', width: '100%' },
    checkoutTitle: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 14, textAlign: 'center', marginTop: 12 },
    qrArea: { alignItems: 'center', alignSelf: 'stretch', marginTop: 18 },
    qrCard: { padding: 16, backgroundColor: background, borderRadius: 8, shadowColor: primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 3, elevation: 3, borderWidth: 1, borderColor: border },
    expiry: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, letterSpacing: 0.8, marginTop: 14 },
    primary: { backgroundColor: primary, borderRadius: 8, minHeight: 54, minWidth: 210, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 28 },
    primaryText: { color: inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 15 },
    secondary: { borderColor: border, borderWidth: 1, borderRadius: 8, minHeight: 46, minWidth: 150, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 20 },
    secondaryText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    message: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: 15, textAlign: 'center', marginTop: 18 },
    error: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, textAlign: 'center' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.16)', alignItems: 'flex-start', paddingLeft: 18 },
    modalOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    currencyPopover: { width: 204, height: 140 },
    currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 4 },
    currencyOption: { width: 58, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
    currencyText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    currencyTextSelected: { color: bitcoin },
  });
}

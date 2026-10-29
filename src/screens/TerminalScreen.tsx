import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SymbolView } from 'expo-symbols';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationProp } from '@react-navigation/native-stack';
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
import { clearTerminalRequest, formatFiatMinor, formatTerminalAmount, formatTerminalBasketAmount, formatTerminalSats, loadTerminalRequest, parseFiatMinor, parseTerminalAmount, satsFromFiat, saveTerminalRequest, terminalNetwork, TerminalBasket, TerminalBasketLine, TerminalFiatQuote, TerminalRequest, TerminalUnit } from '../services/terminal';
import { FiatCurrency, getTerminalRates, getTerminalReportingRate, TerminalRates, TerminalReportingRate } from '../services/terminalRates';
import { recordTerminalSale, updateTerminalSalePayment, TerminalSale } from '../services/terminalSales';
import TerminalSalesScreen from './TerminalSalesScreen';
import TerminalReportsScreen, { TerminalReportSelection } from './TerminalReportsScreen';
import TerminalSettingsScreen from './TerminalSettingsScreen';
import TerminalItemsScreen from './TerminalItemsScreen';
import TerminalReceiptSettingsScreen from './TerminalReceiptSettingsScreen';
import TerminalBackupScreen from './TerminalBackupScreen';
import TerminalItemEditorScreen from './TerminalItemEditorScreen';
import TerminalSheetHeader, { TerminalSheetInteractionContext } from './TerminalSheetHeader';
import TerminalQuickItemsScreen from './TerminalQuickItemsScreen';
import { listTerminalItems, TerminalItem } from '../services/terminalItems';

const PREFERRED_UNIT_KEY = '@terminalPreferredUnit';
const FIAT_UNITS: FiatCurrency[] = ['USD', 'EUR', 'CHF'];
const isFiat = (unit: TerminalUnit): unit is FiatCurrency => FIAT_UNITS.includes(unit as FiatCurrency);
export const isTerminalPollDue = (lastAttempt: number, intervalMs: number, now = Date.now()) => now < lastAttempt || now - lastAttempt >= intervalMs;

type TerminalStackParams = { Checkout: undefined; Settings: undefined; ReceiptSettings: undefined; Backup: undefined; Sales: undefined; SaleDetails: { walletId: string; network: ReturnType<typeof terminalNetwork>; sale: TerminalSale }; Reports: { walletId: string; network: ReturnType<typeof terminalNetwork>; selection: TerminalReportSelection }; Items: undefined; QuickItems: undefined; ItemEditor: { item?: TerminalItem } | undefined; Invoice: undefined };
const TerminalStack = createNativeStackNavigator<TerminalStackParams>();
type CheckoutNavigation = NativeStackNavigationProp<TerminalStackParams, 'Checkout'>;
type InvoiceNavigation = NativeStackNavigationProp<TerminalStackParams, 'Invoice'>;

function InvoiceRoute({ request, scope, onClose, onCanReplay, onCloseError, onFocusChange, children }: {
  request: TerminalRequest | null;
  scope: string;
  onClose: () => Promise<boolean>;
  onCanReplay: () => boolean;
  onCloseError: () => void;
  onFocusChange: (focused: boolean) => void;
  children: (height: number, width: number, dismiss: () => void) => React.ReactNode;
}) {
  const navigation = useNavigation<InvoiceNavigation>();
  const focused = useIsFocused();
  const [size, setSize] = useState({ height: 0, width: 0 });
  const mounted = useRef(true);
  const closeFlight = useRef<Promise<boolean> | null>(null);
  const cleared = useRef(false);
  const dismissStarted = useRef(false);
  const removed = useRef(false);
  const callbacks = useRef({ onClose, onCanReplay, onCloseError });
  callbacks.current = { onClose, onCanReplay, onCloseError };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onFocusChange(focused); return () => onFocusChange(false); }, [focused, onFocusChange]);
  const finishRequest = useCallback(() => {
    if (cleared.current) return Promise.resolve(true);
    if (!closeFlight.current) {
      const { onClose: close, onCloseError: reportError } = callbacks.current;
      closeFlight.current = Promise.resolve().then(close).then(result => {
        if (result) cleared.current = true;
        return result;
      }).catch(() => { reportError(); return false; }).finally(() => { closeFlight.current = null; });
    }
    return closeFlight.current;
  }, []);
  // A committed native swipe has already finished its dismissal animation.
  // Observe removal without cancelling it; a cancelled gesture never removes the route.
  useEffect(() => navigation.addListener('beforeRemove', () => { removed.current = true; void finishRequest(); }), [navigation, finishRequest]);
  const dismiss = () => {
    if (dismissStarted.current || removed.current) return;
    dismissStarted.current = true;
    const canDismiss = callbacks.current.onCanReplay;
    void finishRequest().then(success => {
      if (!success) { dismissStarted.current = false; return; }
      if (mounted.current && !removed.current && navigation.isFocused() && canDismiss()) navigation.goBack();
    });
  };
  return <View style={{ flex: 1 }} onLayout={event => setSize(event.nativeEvent.layout)}>{children(size.height, size.width, dismiss)}</View>;
}

function CheckoutVisibility({ onChange, children }: { onChange: (focused: boolean) => void; children: React.ReactNode }) {
  const focused = useIsFocused();
  useEffect(() => { onChange(focused); }, [focused, onChange]);
  return <>{children}</>;
}

function SalesRoute({ walletId, network, rootVisible, onClose, onOpenReports, onOpenSale, sale }: { walletId: string; network: ReturnType<typeof terminalNetwork>; rootVisible: boolean; onClose: () => void; onOpenReports?: (selection: TerminalReportSelection) => void; onOpenSale?: (sale: TerminalSale) => void; sale?: TerminalSale }) {
  const focused = useIsFocused();
  return <TerminalSalesScreen walletId={walletId} network={network} visible={rootVisible && focused} onClose={onClose} onOpenReports={onOpenReports} onOpenSale={onOpenSale} detailSale={sale} />;
}

function ReportsRoute({ walletId, network, rootVisible, selection, onClose }: { walletId: string; network: ReturnType<typeof terminalNetwork>; rootVisible: boolean; selection: TerminalReportSelection; onClose: () => void }) {
  const focused = useIsFocused();
  return <TerminalReportsScreen walletId={walletId} network={network} initialSelection={selection} visible={rootVisible && focused} onClose={onClose} />;
}

type Stage = 'loading' | 'entry' | 'creating' | 'waiting' | 'received' | 'expired' | 'verificationUnavailable' | 'creationFailed' | 'walletChanged';

export default function TerminalScreen({ visible = true, onExit }: { visible?: boolean; onExit?: () => void } = {}) {
  const { activeWallet, isLightningInitialized, lightningInitAttempted, lightningInitError, createTerminalInvoice, validateTerminalInvoice, verifyTerminalInvoice } = useWallet();
  const { setMode, changing, cashierState, cashierBusy, consumeCashierTerminalDraft } = useWalletMode();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [stage, setStage] = useState<Stage>('loading');
  const [amount, setAmount] = useState('');
  const [basketError, setBasketError] = useState('');
  const [basketLines, setBasketLines] = useState<TerminalBasketLine[]>([]);
  const [catalog, setCatalog] = useState<TerminalItem[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRevision, reloadCatalog] = useState(0);
  const [unit, setUnit] = useState<TerminalUnit>('sats');
  const [checkoutFocused, setCheckoutFocused] = useState(true);
  const [invoiceFocused, setInvoiceFocused] = useState(false);
  const [endingRequest, setEndingRequest] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [invoiceAmountLayout, setInvoiceAmountLayout] = useState({ id: '', height: 0 });
  const checkoutNavigation = useRef<CheckoutNavigation | null>(null);
  const presentedRequestId = useRef<string | null>(null);
  const [rates, setRates] = useState<TerminalRates | null>(null);
  const [rateError, setRateError] = useState('');
  const [rateLoading, setRateLoading] = useState(false);
  const [request, setRequest] = useState<TerminalRequest | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const [error, setError] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const active = foreground && visible && (checkoutFocused || invoiceFocused);
  const visibleRef = useRef(visible);
  visibleRef.current = visible && (checkoutFocused || invoiceFocused);
  const [now, setNow] = useState(Date.now());
  const [loadRevision, reload] = useState(0);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationRevision, retryValidation] = useState(0);
  const mounted = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const generation = useRef(0);
  const busy = useRef(false);
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const lastUnfilteredCheck = useRef(0);
  const rateFlight = useRef(false);
  const userSelectedUnit = useRef(false);
  const preferredUnit = useRef<TerminalUnit>('sats');
  const userEditedAmount = useRef(false);
  const hasRequestRef = useRef(false);
  hasRequestRef.current = !!request;
  const knownPaymentId = useRef<string | undefined>(undefined);
  const network = terminalNetwork(NETWORK_NAME);
  const scope = `${network}:${activeWallet?.id || ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const basketRef = useRef(basketLines);
  basketRef.current = basketLines;
  const basketUnitRef = useRef<TerminalUnit | null>(null);
  const styles = makeStyles(theme.colors.background, theme.colors.primary, theme.colors.inversePrimary, theme.colors.surface, theme.colors.muted, theme.colors.border, theme.colors.bitcoin, screenHeight, screenWidth);

  useEffect(() => {
    if (visible && checkoutFocused && activeWallet && activeWallet.type !== 'watch-only') {
      checkoutNavigation.current?.preload('Sales');
    }
  }, [visible, checkoutFocused, scope]);

  useEffect(() => {
    setEndingRequest(false); setTransitioning(false);
    basketRef.current = []; basketUnitRef.current = null; setBasketLines([]); setBasketError(''); setCatalog([]); setCatalogError(false);
    presentedRequestId.current = null;
  }, [scope]);

  useEffect(() => {
    if (!request) { presentedRequestId.current = null; return; }
    if (visible && checkoutFocused && presentedRequestId.current !== request.id) {
      presentedRequestId.current = request.id;
      checkoutNavigation.current?.navigate('Invoice');
    }
  }, [request?.id, visible, checkoutFocused]);

  useEffect(() => {
    if (!visible || !checkoutFocused || !activeWallet || activeWallet.type === 'watch-only') return;
    let current = true;
    void listTerminalItems(activeWallet.id, network).then(items => {
      if (current && scopeRef.current === scope) { setCatalog(items); setCatalogError(false); }
    }).catch(() => { if (current && scopeRef.current === scope) { setCatalog([]); setCatalogError(true); } });
    return () => { current = false; };
  }, [scope, visible, checkoutFocused, catalogRevision]);

  useEffect(() => {
    void AsyncStorage.getItem(PREFERRED_UNIT_KEY).then(saved => {
      if (!userSelectedUnit.current && !userEditedAmount.current && !basketRef.current.length && (saved === 'sats' || saved === 'BTC' || isFiat(saved as TerminalUnit))) {
        preferredUnit.current = saved as TerminalUnit;
        if (mounted.current && !userSelectedUnit.current && !userEditedAmount.current && !basketRef.current.length && !hasRequestRef.current) {
          setUnit(saved as TerminalUnit);
        }
      }
    }).catch(() => undefined);
  }, []);

  const refreshRates = useCallback(async () => {
    if (rateFlight.current) return;
    rateFlight.current = true;
    setRateLoading(true);
    try { const fetched = await getTerminalRates(); if (mounted.current) { setRates(fetched); setNow(Date.now()); setRateError(''); } }
    catch { if (mounted.current) setRateError('Price unavailable. Refresh price to charge in fiat.'); }
    finally { rateFlight.current = false; if (mounted.current) setRateLoading(false); }
  }, []);

  useEffect(() => {
    if (!request && active && isFiat(unit) && (!rates || Date.now() < rates.fetchedAt || Date.now() - rates.fetchedAt >= 60_000)) void refreshRates();
  }, [active, unit, request?.id, rates?.fetchedAt, now, refreshRates]);
  useEffect(() => {
    if (active && !request && stage === 'entry') void getTerminalReportingRate('USD'); // The provider returns all three currencies in one fetch.
  }, [active, request?.id, stage]);
  useEffect(() => { if (active && !request && isFiat(unit)) { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); } }, [active, request?.id, unit]);

  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => { activeRef.current = state === 'active' && visibleRef.current; setForeground(state === 'active'); });
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
    loadTerminalRequest(activeWallet.id, network).then(async saved => {
      if (!mounted.current || current !== generation.current || capturedScope !== scopeRef.current) return;
      // Migrate the existing active request before it can be dismissed.
      if (saved) await recordTerminalSale(saved);
      if (!mounted.current || current !== generation.current || capturedScope !== scopeRef.current) return;
      if (saved) {
        consumeCashierTerminalDraft(activeWallet.id, network);
        setRequest(saved);
        setAmount(formatTerminalAmount(saved.amountSats, 'sats'));
        setUnit(preferredUnit.current);
        setStage('loading');
      } else {
        const draft = consumeCashierTerminalDraft(activeWallet.id, network);
        if (draft) {
          const lines = draft.basketLines.map(line => ({ ...line }));
          userSelectedUnit.current = true; userEditedAmount.current = true; preferredUnit.current = draft.unit;
          basketRef.current = lines; basketUnitRef.current = lines.length ? draft.unit : null;
          setBasketLines(lines); setUnit(draft.unit); setAmount(draft.manualAmount);
        }
        setStage('entry');
      }
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
      // Retain a result for this exact invoice even if its screen was closed
      // while verification was running. It must never update a newer invoice.
      if (!mounted.current || capturedScope !== scopeRef.current) return;
      const sale = await updateTerminalSalePayment(request, result);
      if (!mounted.current || !activeRef.current || captured !== generation.current || capturedScope !== scopeRef.current || requestId !== request.id) return;
      if (sale.paymentId) knownPaymentId.current = sale.paymentId;
      if (sale.status === 'received') {
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
    return () => clearInterval(poll);
  }, [request?.id, validated, active, isLightningInitialized, stage === 'received', verify]);

  useEffect(() => { if (active) setNow(Date.now()); }, [active, request?.id]);

  useEffect(() => {
    if (!request || !active || stage === 'received') return;
    const remaining = request.expiresAt - Date.now();
    if (remaining <= 0) return;
    // Long-lived invoices can exceed the native timer's signed 32-bit range.
    const expiry = setTimeout(() => setNow(Date.now()), Math.min(remaining, 2_147_483_647));
    return () => clearTimeout(expiry);
  }, [request?.id, request?.expiresAt, active, stage === 'received', now]);

  useEffect(() => {
    if (request && now >= request.expiresAt && stage === 'waiting') setStage('expired');
  }, [now, request, stage]);

  const requestPayment = async () => {
    if (!hasValidAmount || busy.current || stage === 'loading' || request || hydrationFailed || !activeWallet || activeWallet.type === 'watch-only') return;
    if (!isLightningInitialized) {
      setError(lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable.') : 'Connecting to Lightning…');
      return;
    }
    const requestUnit = basketUnitRef.current ?? unit;
    if (isFiat(requestUnit) && (!rates || Date.now() < rates.fetchedAt || Date.now() - rates.fetchedAt >= 60_000 || rateError)) {
      setError('Price expired. Refresh price before charging.');
      return;
    }
    const lines = basketRef.current.map(line => ({ ...line }));
    const basketTotal = lines.reduce((sum, line) => sum + BigInt(line.total), 0n);
    if (basketTotal > BigInt(Number.MAX_SAFE_INTEGER)) { setError('Basket total is too large.'); return; }
    busy.current = true;
    const captured = ++generation.current;
    const capturedScope = scope;
    const walletId = activeWallet.id;
    const basket: TerminalBasket | undefined = lines.length ? { unit: requestUnit, lines, total: Number(basketTotal) } : undefined;
    const requestAmount = basket ? (isFiat(requestUnit) ? formatFiatMinor(basket.total) : formatTerminalAmount(basket.total, requestUnit)) : amount;
    const network = terminalNetwork(NETWORK_NAME);
    setStage('creating'); setError('');
    let sats: number;
    let fiatQuote: TerminalFiatQuote | undefined;
    let reportingRate: TerminalReportingRate | null = null;
    try {
      if (isFiat(requestUnit)) {
        const minor = parseFiatMinor(requestAmount);
        // getTerminalRates reuses only a quote fetched within the last minute.
        const fresh = await getTerminalRates();
        if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
        sats = satsFromFiat(minor, fresh.rates[requestUnit]);
        fiatQuote = { currency: requestUnit, amountMinor: minor, rate: fresh.rates[requestUnit], fetchedAt: fresh.fetchedAt };
        reportingRate = { currency: requestUnit, rate: fresh.rates[requestUnit], fetchedAt: fresh.fetchedAt, source: 'coinbase', status: 'fresh' };
        setRates(fresh); setNow(Date.now()); setRateError('');
      } else sats = parseTerminalAmount(requestAmount, requestUnit);
      const reportingFlight = fiatQuote ? Promise.resolve(reportingRate) : getTerminalReportingRate('USD');
      const created = await createTerminalInvoice(sats);
      reportingRate = await reportingFlight;
      if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
      const next: TerminalRequest = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        walletId, network, invoice: created.invoice, amountSats: sats,
        createdAt: Date.now(), expiresAt: created.expiresAt, fiat: fiatQuote,
        reportingRate,
        inputUnit: isFiat(requestUnit) ? undefined : requestUnit, basket,
      };
      await recordTerminalSale(next);
      await saveTerminalRequest(next);
      if (!mounted.current || captured !== generation.current || capturedScope !== scopeRef.current) return;
      setRequest(next);
      basketRef.current = []; basketUnitRef.current = null; setBasketLines([]); setBasketError('');
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

  const endRequest = async (): Promise<boolean> => {
    if (!request || busy.current || scopeRef.current !== scope || requestRef.current?.id !== request.id) return false;
    const closingRequest = request;
    const capturedGeneration = generation.current;
    const capturedScope = scope;
    const stillClosing = () => mounted.current && generation.current === capturedGeneration &&
      scopeRef.current === capturedScope && requestRef.current?.id === closingRequest.id;
    busy.current = true; setEndingRequest(true);
    try {
      await recordTerminalSale(closingRequest);
      await clearTerminalRequest(closingRequest);
      if (!stillClosing()) return false;
      ++generation.current;
      checking.current = false;
      lastCheck.current = 0;
      lastUnfilteredCheck.current = Date.now();
      knownPaymentId.current = undefined;
      busy.current = false;
      requestRef.current = null;
      setRequest(null); setStage('entry'); setAmount(''); setUnit(preferredUnit.current); setError('');
      basketRef.current = []; basketUnitRef.current = null; setBasketLines([]); setBasketError('');
      setValidated(false);
      return true;
    } catch {
      if (stillClosing()) setError('Could not end the saved request. Please retry.');
      return false;
    } finally {
      if (stillClosing()) busy.current = false;
      if (mounted.current && scopeRef.current === capturedScope) setEndingRequest(false);
    }
  };


  const exit = () => {
    if (busy.current) return;
    const leave = onExit ?? (() => { void setMode('wallet').catch(() => Alert.alert('Could not exit', 'Wallet mode could not be saved. Please retry.')); });
    if (request && stage !== 'received') Alert.alert('Exit terminal?', 'This invoice can still be paid. Your request will be here when you return.', [
      { text: 'Stay', style: 'cancel' }, { text: 'Exit terminal', onPress: leave },
    ]);
    else leave();
  };

  const close = () => {
    if (request) return;
    exit();
  };
  const getTerminalDraft = () => {
    if (!mounted.current || busy.current || requestRef.current || stage === 'creating' || !activeWallet || scopeRef.current !== scope) return null;
    return { walletId: activeWallet.id, network, unit: basketUnitRef.current ?? unit, manualAmount: amount, basketLines: basketRef.current.map(line => ({ ...line })) };
  };

  const selectUnit = (next: TerminalUnit) => {
    if (busy.current || request || next === unit) return;
    const apply = () => {
      const hadBasket = basketRef.current.length > 0;
      if (hadBasket) { basketRef.current = []; basketUnitRef.current = null; setBasketLines([]); setAmount(''); }
      if (!hadBasket && !isFiat(unit) && !isFiat(next)) {
        try { setAmount(formatTerminalAmount(parseTerminalAmount(amount, unit), next)); }
        catch { setAmount(''); }
      } else setAmount('');
      userSelectedUnit.current = true;
      preferredUnit.current = next;
      setUnit(next); setError(''); setBasketError('');
      void AsyncStorage.setItem(PREFERRED_UNIT_KEY, next).catch(() => setError('Could not save preferred currency.'));
    };
    apply();
  };

  const key = (digit: string) => {
    if (busy.current || stage === 'loading' || basketRef.current.length) return;
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

  const updateBasket = (item: TerminalItem, delta: number) => {
    if (busy.current || request) return;
    const current = basketRef.current;
    const basketUnit = basketUnitRef.current;
    if (current.length && item.unit !== basketUnit) { setBasketError('Clear the basket to choose another currency.'); return; }
    const index = current.findIndex(line => line.itemId === item.id);
    if (index < 0 && (delta < 1 || current.length >= 20)) { setBasketError('Basket limit reached.'); return; }
    const existing = current[index];
    const quantity = (existing?.quantity ?? 0) + delta;
    if (quantity > 99) { setBasketError('Maximum quantity is 99.'); return; }
    const next = index < 0 ? [...current, { itemId: item.id, name: item.name, unitPrice: item.unitPrice, quantity: 1, total: item.unitPrice }]
      : quantity < 1 ? current.filter((_, i) => i !== index)
        : current.map((line, i) => i === index ? { ...line, quantity, total: Number(BigInt(line.unitPrice) * BigInt(quantity)) } : line);
    const sum = next.reduce((total, line) => total + BigInt(line.total), 0n);
    if (sum > BigInt(Number.MAX_SAFE_INTEGER) || next.some(line => !Number.isSafeInteger(line.total))) { setBasketError('Basket total is too large.'); return; }
    userEditedAmount.current = true;
    if (!current.length && next.length) { basketUnitRef.current = item.unit; userSelectedUnit.current = true; preferredUnit.current = item.unit; setUnit(item.unit); setAmount(''); }
    if (!next.length) basketUnitRef.current = null;
    basketRef.current = next; setBasketLines(next); setBasketError(''); setError('');
  };
  const hasRequest = !!request;
  const basketTotal = basketLines.reduce((total, line) => total + line.total, 0);
  const entryAmount = basketLines.length ? (isFiat(unit) ? formatFiatMinor(basketTotal) : formatTerminalAmount(basketTotal, unit)) : amount;
  const isExpired = hasRequest && validated && (stage === 'expired' || now >= request.expiresAt);
  let approxSats: number | null = null;
  if (isFiat(unit) && rates && entryAmount) {
    try { approxSats = satsFromFiat(parseFiatMinor(entryAmount), rates.rates[unit]); } catch { /* incomplete keypad amount */ }
  }
  let hasValidAmount = false;
  try {
    hasValidAmount = (isFiat(unit) ? parseFiatMinor(entryAmount) : parseTerminalAmount(entryAmount, unit)) > 0;
  } catch { /* Empty, zero and incomplete keypad values keep Generate inactive. */ }
  const requestDisabled = (stage === 'loading' && !hasRequest) || stage === 'creating' || endingRequest || (!hasRequest && !hydrationFailed && !hasValidAmount);
  const settingsButton = <Pressable accessibilityRole="button" accessibilityLabel="Terminal settings" disabled={stage === 'creating' || endingRequest} style={styles.glassControl} onPress={() => checkoutNavigation.current?.navigate('Settings')}>
    <GlassView width={40} height={40} shape="circle" interactive={checkoutFocused && !transitioning && stage !== 'creating' && !endingRequest} style={styles.glassSurface}>
      {Platform.OS === 'ios' ? <SymbolView name="gearshape" size={21} tintColor={theme.colors.primary} /> : <Feather name="settings" size={21} color={theme.colors.primary} />}
    </GlassView>
  </Pressable>;
  const amountPrefix = unit === 'USD' ? '$' : unit === 'EUR' ? '€' : unit === 'CHF' ? 'CHF' : '';
  const frozenPrefix = request?.fiat
    ? request.fiat.currency === 'USD' ? '$' : request.fiat.currency === 'EUR' ? '€' : 'CHF'
    : '';
  const frozenAmount = request?.fiat
    ? formatFiatMinor(request.fiat.amountMinor)
    : request?.inputUnit === 'BTC' ? formatTerminalAmount(request.amountSats, 'BTC')
      : formatTerminalSats(request?.amountSats || 0);
  const frozenSuffix = request?.fiat ? '' : request?.inputUnit === 'BTC' ? '₿' : 'sats';
  const checkoutAmount = (width: number) => <View style={styles.amountRow}>
    <View style={[styles.symbolRail, styles.prefixRail]}>{frozenPrefix ? <Text style={styles.unitLabel}>{frozenPrefix}</Text> : null}</View>
    <Text testID="terminal-checkout-number" style={[styles.checkoutAmount, { flexShrink: 1, maxWidth: Math.max(90, (width || screenWidth) - 48 - 2 * 69) }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.2}>{frozenAmount}</Text>
    <View style={[styles.symbolRail, styles.suffixRail]}>{frozenSuffix ? <Text style={[styles.unitLabel, frozenSuffix === '₿' && styles.orangeSymbol]}>{frozenSuffix}</Text> : null}</View>
  </View>;
  const frozenSecondary = request?.fiat || request?.inputUnit === 'BTC' ? `${formatTerminalSats(request?.amountSats || 0)} sats` : '';
  const entry = !!activeWallet && activeWallet.type !== 'watch-only';
  const renderInvoice = (sheetHeight: number, sheetWidth: number, dismiss: () => void) => {
    const qrSize = Math.max(140, Math.min(280, (sheetWidth || screenWidth) - 82, (sheetHeight || screenHeight * 0.9) - 330));
    const showQr = !!request && validated && (stage === 'waiting' || stage === 'verificationUnavailable') && !isExpired;
    const amountHeight = invoiceAmountLayout.id === request?.id ? invoiceAmountLayout.height : 0;
    // Center the QR itself in the measured sheet, reserving room for its amount above.
    const qrTop = Math.max(20, sheetHeight / 2 - 56 - amountHeight - 24 - (qrSize + 34) / 2);
    return <View style={styles.root}>
      <TerminalSheetHeader title="Invoice" closeLabel="Close invoice" disabled={endingRequest} onClose={dismiss} />
      <ScrollView style={styles.checkoutScroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.checkoutScrollContent, showQr && { paddingTop: qrTop }]} bounces={false} showsVerticalScrollIndicator={false}>
        <View style={[styles.checkout, !showQr && { flexGrow: 1 }, showQr && { opacity: amountHeight > 0 ? 1 : 0 }]}>
          {stage === 'received' ? <Feather name="check-circle" size={70} color={theme.colors.bitcoin} /> : null}
          {validated ? <View key={request?.id} style={{ alignItems: 'center' }} onLayout={event => { if (request?.id && requestRef.current?.id === request.id) setInvoiceAmountLayout({ id: request.id, height: event.nativeEvent.layout.height }); }}>{checkoutAmount(sheetWidth)}{frozenSecondary ? <Text style={styles.approx}>{frozenSecondary}</Text> : null}</View> : null}
          {showQr ? <View testID="terminal-qr" style={[styles.qrCard, { marginTop: 24 }]}><QRCode value={request.invoice.toUpperCase()} size={qrSize} color={theme.colors.primary} backgroundColor={theme.colors.background} /></View> : null}
          {!validated || stage === 'received' || isExpired ? <Text style={styles.checkoutTitle}>{!validated ? stage === 'verificationUnavailable' ? 'Cannot validate request' : 'Checking saved request' : stage === 'received' ? 'Paid' : 'Request expired'}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!validated && !isLightningInitialized ? <Text style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable. Retry when connected.') : 'Connecting to Lightning…'}</Text> : null}
          {stage === 'verificationUnavailable' || isExpired ? <TouchableOpacity style={styles.secondary} onPress={() => { if (validated) void verify(true); else retryValidation(value => value + 1); }}><Text style={styles.secondaryText}>{validated ? 'Check payment' : 'Retry validation'}</Text></TouchableOpacity> : null}
        </View>
      </ScrollView>
    </View>;
  };
  const checkout = <View pointerEvents={checkoutFocused && !transitioning ? 'auto' : 'none'} style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}>
      {settingsButton}
      <Pressable accessibilityRole="button" accessibilityLabel="Sales" disabled={stage === 'creating'} onPress={() => checkoutNavigation.current?.navigate('Sales')}>
        <GlassView width={80} height={40} shape="capsule" interactive={checkoutFocused && !transitioning} style={styles.glassSurface}>
          <Text style={styles.salesLabel}>Sales</Text>
        </GlassView>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Exit terminal" style={[styles.glassControl, styles.glassControlEnd]} disabled={changing || cashierBusy || stage === 'creating' || hasRequest} onPress={close}>
        <GlassView width={40} height={40} shape="circle" interactive={checkoutFocused && !transitioning} style={styles.glassSurface}>
          <Feather name="x" size={21} color={theme.colors.primary} />
        </GlassView>
      </Pressable>
    </View>
    <View style={styles.content}>
      {!activeWallet ? <Text style={styles.message}>Open a wallet to receive payments.</Text>
        : activeWallet.type === 'watch-only' ? <View style={styles.center}>
            <Feather name="eye" size={40} color={theme.colors.muted} />
            <Text style={styles.message}>This watch-only wallet cannot create Lightning payment requests.</Text>
            <TouchableOpacity style={styles.secondary} onPress={exit}><Text style={styles.secondaryText}>Exit terminal</Text></TouchableOpacity>
          </View>
        : <View style={styles.entry}>
            <View style={styles.amountArea}>
              <View style={[styles.amountRow, styles.entryAmountRow]}>
                <View style={[styles.symbolRail, styles.prefixRail]}>{amountPrefix ? <Text style={styles.unitLabel}>{amountPrefix}</Text> : null}</View>
                <Text testID="terminal-amount" style={[styles.amount, styles.numberWidth]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.18}>{entryAmount || '0'}</Text>
                <View style={[styles.symbolRail, styles.suffixRail]}>{unit === 'sats' || unit === 'BTC' ? <Text style={[styles.unitLabel, unit === 'BTC' && styles.orangeSymbol]}>{unit === 'BTC' ? '₿' : 'sats'}</Text> : null}</View>
              </View>
              <View style={styles.priceLine}>
                <Text style={styles.approx}>{approxSats !== null ? `≈ ${formatTerminalSats(approxSats)} sats` : ''}</Text>
                {isFiat(unit) && rateError ? <TouchableOpacity disabled={rateLoading} onPress={() => { void refreshRates(); }}><Text style={styles.refresh}>Refresh price</Text></TouchableOpacity> : null}
              </View>
            </View>
            <View style={styles.padArea}>
              <View style={styles.keypad}>{['1','2','3','4','5','6','7','8','9',unit === 'sats' ? '' : '.', '0','back'].map((digit, i) =>
                <TouchableOpacity key={i} disabled={!digit} style={styles.key} activeOpacity={0.55} onPress={() => key(digit)}>
                  <Text style={styles.keyText}>{digit === 'back' ? '⌫' : digit}</Text>
                </TouchableOpacity>)}</View>
              <View style={styles.feedbackArea}>
                {error ? <Text numberOfLines={2} style={styles.error}>{error}</Text> : null}
                {!error && !isLightningInitialized ? <Text numberOfLines={2} style={styles.error}>{lightningInitAttempted ? (lightningInitError || 'Lightning is unavailable.') : 'Connecting to Lightning…'}</Text> : null}
                {!error && isLightningInitialized && catalogError ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry items" onPress={() => reloadCatalog(v => v + 1)}><Text style={styles.error}>Items unavailable · Retry</Text></TouchableOpacity> : null}
              </View>
              <View style={styles.itemsRow}>
                {catalog.length || basketLines.length ? <Pressable accessibilityRole="button" accessibilityLabel="Items" disabled={stage === 'creating'} style={styles.itemsCapsule} onPress={() => checkoutNavigation.current?.navigate('QuickItems')}><GlassView width={80} height={36} shape="capsule" interactive={checkoutFocused && !transitioning} style={styles.glassSurface}><Text style={styles.salesLabel}>Items</Text></GlassView></Pressable> : null}
              </View>
            </View>
          </View>
        }
    </View>
    {entry && <View style={styles.actionBar}>
      <TouchableOpacity testID="terminal-request" disabled={requestDisabled} style={[styles.primaryAction, requestDisabled && styles.disabled]} onPress={() => { if (busy.current) return; if (request) { checkoutNavigation.current?.navigate('Invoice'); return; } if (hydrationFailed) { setError(''); reload(v => v + 1); } else void requestPayment(); }}>
        {endingRequest || stage === 'creating' ? <ActivityIndicator accessibilityLabel={endingRequest ? 'Closing invoice' : 'Generating invoice'} color={theme.colors.bitcoin} /> : <Text style={styles.primaryActionText}>{hasRequest ? 'Resume invoice' : hydrationFailed ? 'Retry loading' : 'Generate invoice'}</Text>}
      </TouchableOpacity>
    </View>}
  </View>;

  const sheetOptions = Platform.OS === 'android' ? { presentation: 'formSheet' as const, sheetAllowedDetents: [0.95], sheetCornerRadius: 24, sheetGrabberVisible: true, animation: 'slide_from_bottom' as const } : { presentation: 'modal' as const, animation: 'slide_from_bottom' as const };
  const quickItemsSheetOptions = { presentation: 'formSheet' as const, sheetAllowedDetents: [0.5], sheetInitialDetentIndex: 0, sheetCornerRadius: 24, sheetGrabberVisible: true, animation: 'slide_from_bottom' as const };
  return <TerminalSheetInteractionContext.Provider value={!transitioning}><TerminalStack.Navigator key={scope} screenListeners={{ transitionStart: () => setTransitioning(true), transitionEnd: () => setTransitioning(false), gestureCancel: () => setTransitioning(false) }} screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: theme.colors.background } }}>
    <TerminalStack.Screen name="Checkout">
      {({ navigation }) => {
        checkoutNavigation.current = navigation;
        return <CheckoutVisibility onChange={setCheckoutFocused}>{checkout}</CheckoutVisibility>;
      }}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Settings" options={sheetOptions}>
      {({ navigation }) => <TerminalSettingsScreen unit={unit} onSelectUnit={selectUnit} getTerminalDraft={getTerminalDraft} onOpenItems={() => navigation.navigate('Items')} onOpenReceipts={() => navigation.navigate('ReceiptSettings')} onOpenBackup={() => navigation.navigate('Backup')} onClose={() => navigation.goBack()} />}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Sales" options={sheetOptions}>
      {({ navigation }) => activeWallet ? <SalesRoute walletId={activeWallet.id} network={network} rootVisible={visible} onClose={() => navigation.goBack()} onOpenReports={selection => navigation.navigate('Reports', { walletId: activeWallet.id, network, selection })} onOpenSale={sale => navigation.navigate('SaleDetails', { walletId: activeWallet.id, network, sale })} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="SaleDetails" options={sheetOptions}>
      {({ navigation, route }) => activeWallet?.id === route.params.walletId && network === route.params.network ? <SalesRoute walletId={route.params.walletId} network={route.params.network} sale={route.params.sale} rootVisible={visible} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Reports" options={sheetOptions}>
      {({ navigation, route }) => activeWallet?.id === route.params.walletId && network === route.params.network ? <ReportsRoute walletId={route.params.walletId} network={route.params.network} rootVisible={visible} selection={route.params.selection} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Items" options={sheetOptions}>
      {({ navigation }) => activeWallet ? <TerminalItemsScreen walletId={activeWallet.id} network={network} preferredUnit={unit} onEdit={item => navigation.navigate('ItemEditor', { item })} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="QuickItems" options={quickItemsSheetOptions}>
      {({ navigation }) => <TerminalQuickItemsScreen error={basketError} catalog={catalog} lines={basketLines} unit={unit} busy={stage === 'creating'} onAdd={item => updateBasket(item, 1)} onRemoveOne={line => updateBasket({ id: line.itemId, name: line.name, unit, unitPrice: line.unitPrice }, -1)} onClose={() => navigation.goBack()} />}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="ItemEditor" options={sheetOptions}>
      {({ navigation, route }) => activeWallet ? <TerminalItemEditorScreen walletId={activeWallet.id} network={network} preferredUnit={unit} initialItem={route.params?.item} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="ReceiptSettings" options={sheetOptions}>
      {({ navigation }) => activeWallet ? <TerminalReceiptSettingsScreen walletId={activeWallet.id} network={network} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Backup" options={sheetOptions}>
      {({ navigation }) => activeWallet ? <TerminalBackupScreen walletId={activeWallet.id} network={network} onClose={() => navigation.goBack()} /> : null}
    </TerminalStack.Screen>
    <TerminalStack.Screen name="Invoice" options={sheetOptions}>
      {() => <InvoiceRoute request={request} scope={scope} onClose={endRequest} onCanReplay={() => mounted.current && scopeRef.current === scope && requestRef.current === null} onCloseError={() => { if (mounted.current && scopeRef.current === scope) setError('Could not end the saved request. Please retry.'); }} onFocusChange={setInvoiceFocused}>{renderInvoice}</InvoiceRoute>}
    </TerminalStack.Screen>
  </TerminalStack.Navigator></TerminalSheetInteractionContext.Provider>;
}

function makeStyles(background: string, primary: string, inversePrimary: string, surface: string, muted: string, border: string, bitcoin: string, screenHeight: number, screenWidth: number) {
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
    header: { height: 56, zIndex: 2, elevation: 2, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    glassControl: { width: 92, height: 44, justifyContent: 'center' },
    glassControlEnd: { alignItems: 'flex-end' },
    glassSurface: { overflow: 'visible' },
    salesLabel: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: 13, textAlign: 'center' },
    content: { flex: 1 },
    entry: { flex: 1, paddingHorizontal: 24 },
    amountArea: { flex: 1, minHeight: amountMinHeight, alignItems: 'center', justifyContent: 'center' },
    amountRow: { alignSelf: 'center', flexDirection: 'row', alignItems: 'baseline' },
    entryAmountRow: { minHeight: 70 },
    numberWidth: { flexShrink: 1, maxWidth: Math.max(134, screenWidth - 48 - 2 * 69) },
    symbolRail: { width: 69, justifyContent: 'center' },
    prefixRail: { alignItems: 'flex-end', paddingRight: 5 },
    suffixRail: { alignItems: 'flex-start', paddingLeft: 5 },
    amount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 62, includeFontPadding: false, textAlign: 'center' },
    priceLine: { minHeight: 20, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
    approx: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 13, textAlign: 'center' },
    refresh: { color: bitcoin, fontFamily: 'SpaceMono-Bold', fontSize: 12, marginTop: 5 },
    padArea: { justifyContent: 'flex-end', paddingBottom: keypadPadding },
    keypad: { flexDirection: 'row', flexWrap: 'wrap' },
    key: { width: '33.33%', height: keyHeight, alignItems: 'center', justifyContent: 'center' },
    keyText: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: keyFontSize },
    feedbackArea: { height: feedbackHeight, alignItems: 'center', justifyContent: 'center' },
    itemsRow: { height: 36, alignItems: 'center', justifyContent: 'center' },
    itemsCapsule: { width: 80, height: 36 },
    actionBar: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: actionBottomPadding },
    primaryAction: { backgroundColor: primary, minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    primaryActionText: { color: inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 16 },
    disabled: { opacity: 0.55 },
    checkoutScroll: { flex: 1, minHeight: 0 },
    checkoutScrollContent: { flexGrow: 1, paddingTop: 20, paddingBottom: 36 },
    checkout: { paddingHorizontal: 24, paddingBottom: 20, alignItems: 'center', justifyContent: 'center' },
    checkoutAmount: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 40, textAlign: 'center' },
    checkoutTitle: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 14, textAlign: 'center', marginTop: 12 },
    qrCard: { padding: 16, backgroundColor: background, borderRadius: 8, shadowColor: primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.16, shadowRadius: 3, elevation: 3, borderWidth: 1, borderColor: border },
    unitLabel: { fontFamily: 'SpaceMono-Regular', fontSize: 24, color: muted },
    orangeSymbol: { color: bitcoin },
    primary: { backgroundColor: primary, borderRadius: 8, minHeight: 54, minWidth: 210, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 28 },
    primaryText: { color: inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 15 },
    secondary: { borderColor: border, borderWidth: 1, borderRadius: 8, minHeight: 46, minWidth: 150, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 20 },
    secondaryText: { color: primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    message: { color: primary, fontFamily: 'SpaceMono-Regular', fontSize: 15, textAlign: 'center', marginTop: 18 },
    error: { color: muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, textAlign: 'center' },
  });
}

import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, RefreshControl, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import TerminalSheetHeader, { TerminalSheetInteractionContext } from './TerminalSheetHeader';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import GlassIconButton from '../components/GlassIconButton';
import { SHEET_HEADER_HEIGHT } from '../constants/theme';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { formatFiatMinor, formatTerminalAmount, formatTerminalBasketAmount, formatTerminalSats, TerminalNetwork, TerminalRequest } from '../services/terminal';
import { getTerminalSale, getTerminalSalesSummary, listTerminalSalesPage, subscribeTerminalSales, terminalSaleDisplayStatus, updateTerminalSalePayment, TerminalSale } from '../services/terminalSales';
import { getTerminalRefundTotal, listTerminalRefundsForSale, remainingTerminalRefundSats, subscribeTerminalRefunds, TerminalRefundAttempt } from '../services/terminalRefunds';
import { shareTerminalReceipt } from '../services/terminalReceipt';
import { exportTerminalSalesCsv } from '../services/terminalSalesExport';
import { CustomSalesDateRange, localSalesDateKey, SalesPeriod, terminalSalesPeriodBounds } from '../services/terminalSalesPeriod';
import TerminalRefundScreen from './TerminalRefundScreen';
import { TerminalDateRangeDraft } from '../components/TerminalDateRangePicker';
import TerminalSalesPeriodControls from '../components/TerminalSalesPeriodControls';
import type { TerminalReportSelection } from './TerminalReportsScreen';

type Props = { walletId: string; network: TerminalNetwork; onClose: () => void; visible?: boolean; onOpenReports?: (selection: TerminalReportSelection) => void };
type Cursor = { at: number; id: string };
type SalesSummary = Awaited<ReturnType<typeof getTerminalSalesSummary>>;
type LoadState = {
  identity: string;
  sales: TerminalSale[];
  nextCursor: Cursor | null;
  summary: SalesSummary | null;
  refundedSats: bigint | null;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  pageLoading: boolean;
  pageError: boolean;
};
const periods: { value: SalesPeriod; title: string; label: string; exportLabel: string }[] = [
  { value: 'today', title: 'Today', label: 'Today sales', exportLabel: 'Export today’s activity' },
  { value: 'week', title: '7 days', label: 'Last 7 days sales', exportLabel: 'Export last 7 days activity' },
  { value: 'month', title: 'This month', label: 'This month sales', exportLabel: 'Export this month’s activity' },
  { value: 'all', title: 'All', label: 'All sales', exportLabel: 'Export all activity' },
  { value: 'custom', title: 'Custom', label: 'Custom sales range', exportLabel: 'Export custom activity' },
];

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const formatLongDate = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const formatBigSats = (value: bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} sats`;
const safeRefundRemaining = (sale: TerminalSale, attempts: TerminalRefundAttempt[]): number | null => {
  try { return remainingTerminalRefundSats(sale, attempts); } catch { return null; }
};

const saleTime = (sale: TerminalSale) => sale.receivedAt ?? sale.request.createdAt;
const isPaid = (sale: TerminalSale) => sale.status === 'received';
const displayAmount = (request: TerminalRequest) => request.fiat
  ? `${request.fiat.currency === 'USD' ? '$' : request.fiat.currency === 'EUR' ? '€' : 'CHF '}${formatFiatMinor(request.fiat.amountMinor)}`
  : request.inputUnit === 'BTC'
    ? `${formatTerminalAmount(request.amountSats, 'BTC')} ₿`
    : `${formatTerminalSats(request.amountSats)} sats`;

function totalsFor(summary: SalesSummary | null): { label: string; amount: string }[] {
  if (!summary) return [];
  const totals = new Map<string, bigint>(Object.entries(summary.fiatMinor).filter((entry): entry is [string, bigint] => entry[1] !== undefined));
  if (summary.bitcoinSats > 0n) totals.set('sats', summary.bitcoinSats);
  const order = ['USD', 'EUR', 'CHF', 'sats'];
  return order.filter(currency => totals.has(currency)).map(currency => {
    const amount = totals.get(currency)!;
    if (currency === 'sats') return { label: 'SATS', amount: `${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} sats` };
    const minor = amount.toString().padStart(3, '0');
    const whole = minor.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const prefix = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : 'CHF ';
    return { label: currency, amount: `${prefix}${whole}.${minor.slice(-2)}` };
  });
}

function statusFor(sale: TerminalSale, now: number): { label: string; tone: 'paid' | 'quiet' } {
  switch (terminalSaleDisplayStatus(sale, now)) {
    case 'received': return { label: 'Paid', tone: 'paid' };
    case 'pending': return { label: 'Pending', tone: 'quiet' };
    case 'expired': return { label: 'Expired', tone: 'quiet' };
    default: return { label: 'Unpaid', tone: 'quiet' };
  }
}

export default function TerminalSalesScreen({ walletId, network, onClose, visible = true, onOpenReports }: Props) {
  const { theme } = useTheme();
  const focused = useIsFocused();
  const headerEnabled = useContext(TerminalSheetInteractionContext) && focused;
  const { activeWallet, isLightningInitialized, validateTerminalInvoice, verifyTerminalInvoice } = useWallet();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const scope = `${network}:${walletId}`;
  const [periodState, setPeriodState] = useState<{ scope: string; value: SalesPeriod }>({ scope, value: 'today' });
  const period = periodState.scope === scope ? periodState.value : 'today';
  const [customRangeState, setCustomRangeState] = useState<{ scope: string; value: CustomSalesDateRange | null }>({ scope, value: null });
  const customRange = customRangeState.scope === scope ? customRangeState.value : null;
  const [customEditor, setCustomEditor] = useState<{ scope: string; draft: TerminalDateRangeDraft } | null>(null);
  const editingCustom = customEditor?.scope === scope ? customEditor : null;
  const [selected, setSelected] = useState<{ scope: string; id: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const day = new Date(now);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const periodDay = useMemo(() => new Date(dayStart), [dayStart]);
  const range = useMemo(() => terminalSalesPeriodBounds(period, periodDay, customRange ?? undefined), [period, periodDay, customRange]);
  const rangeKey = range ? `${range.start}:${range.end}` : 'all';
  const loadIdentity = `${scope}:${period}:${rangeKey}`;
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundState, setRefundState] = useState<{ scope: string; attempts: TerminalRefundAttempt[]; loading: boolean; error: boolean }>({ scope: '', attempts: [], loading: true, error: false });
  const [detailState, setDetailState] = useState<{ key: string; sale: TerminalSale | null }>({ key: '', sale: null });
  const [receiptError, setReceiptError] = useState('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);
  const refundGeneration = useRef(0);
  const checkBusy = useRef(false);
  const checkEpoch = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<LoadState>({ identity: loadIdentity, sales: [], nextCursor: null, summary: null, refundedSats: null, loading: true, refreshing: false, error: false, pageLoading: false, pageError: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const loadGeneration = useRef(0);
  const pageBusy = useRef(false);
  const refreshInFlight = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentLoadIdentity = useRef(loadIdentity);
  currentLoadIdentity.current = loadIdentity;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const selectedKey = useRef('');
  selectedKey.current = selected ? `${selected.scope}:${selected.id}` : '';
  const customRangeKey = customRange ? `${customRange.startDate}:${customRange.endDate}` : '';
  const exportIdentity = `${scope}:${period}:${customRangeKey}:${visible}:${selectedKey.current}`;
  const exportRevision = useRef({ identity: exportIdentity, value: 0 });
  if (exportRevision.current.identity !== exportIdentity) {
    exportRevision.current = { identity: exportIdentity, value: exportRevision.current.value + 1 };
    exportBusy.current = false;
  }

  const refresh = useCallback(async (showLoading = true, userInitiated = false) => {
    const generation = ++loadGeneration.current;
    refreshInFlight.current = generation;
    const identity = loadIdentity;
    const prior = stateRef.current;
    const retainedCount = !showLoading && prior.identity === identity ? Math.max(50, prior.sales.length) : 50;
    pageBusy.current = false;
    if (showLoading) setState(previous => ({
      identity,
      sales: previous.identity === identity ? previous.sales : [],
      nextCursor: previous.identity === identity ? previous.nextCursor : null,
      summary: previous.identity === identity ? previous.summary : null,
      refundedSats: previous.identity === identity ? previous.refundedSats : null,
      loading: true, refreshing: userInitiated, error: false, pageLoading: false, pageError: false,
    }));
    else setState(previous => previous.identity === identity ? { ...previous, pageLoading: false, pageError: false } : previous);
    try {
      const [firstPage, summary, refundedSats] = await Promise.all([
        listTerminalSalesPage(walletId, network, { range, limit: 50 }),
        getTerminalSalesSummary(walletId, network, range),
        getTerminalRefundTotal(walletId, network, range),
      ]);
      if (generation !== loadGeneration.current || identity !== currentLoadIdentity.current) return;
      const sales = [...firstPage.items];
      const ids = new Set(sales.map(sale => sale.request.id));
      let nextCursor = firstPage.nextCursor;
      while (!showLoading && sales.length < retainedCount && nextCursor) {
        const page = await listTerminalSalesPage(walletId, network, { range, cursor: nextCursor, limit: 50 });
        if (generation !== loadGeneration.current || identity !== currentLoadIdentity.current) return;
        for (const sale of page.items) if (!ids.has(sale.request.id)) { ids.add(sale.request.id); sales.push(sale); }
        nextCursor = page.nextCursor;
      }
      setState({ identity, sales, nextCursor, summary, refundedSats, loading: false, refreshing: false, error: false, pageLoading: false, pageError: false });
    } catch {
      if (generation !== loadGeneration.current || identity !== currentLoadIdentity.current) return;
      setState(previous => !showLoading && previous.identity === identity && previous.summary !== null
        ? { ...previous, loading: false, refreshing: false, pageLoading: false, pageError: false }
        : { ...previous, identity, sales: [], nextCursor: null, summary: null, refundedSats: null, loading: false, refreshing: false, error: true, pageLoading: false, pageError: false });
    } finally {
      if (refreshInFlight.current === generation) refreshInFlight.current = 0;
    }
  }, [loadIdentity, walletId, network, range]);

  const loadNextPage = useCallback(async () => {
    if (!visibleRef.current || pageBusy.current || refreshInFlight.current || state.identity !== loadIdentity || state.loading || state.error || !state.nextCursor) return;
    const generation = loadGeneration.current;
    const identity = loadIdentity;
    const cursor = state.nextCursor;
    pageBusy.current = true;
    setState(previous => previous.identity === identity ? { ...previous, pageLoading: true, pageError: false } : previous);
    try {
      const page = await listTerminalSalesPage(walletId, network, { range, cursor, limit: 50 });
      if (generation !== loadGeneration.current || identity !== currentLoadIdentity.current) return;
      setState(previous => {
        if (previous.identity !== identity) return previous;
        const ids = new Set(previous.sales.map(sale => sale.request.id));
        return { ...previous, sales: [...previous.sales, ...page.items.filter(sale => !ids.has(sale.request.id))], nextCursor: page.nextCursor, pageLoading: false, pageError: false };
      });
    } catch {
      if (generation === loadGeneration.current && identity === currentLoadIdentity.current) setState(previous => previous.identity === identity ? { ...previous, pageLoading: false, pageError: true } : previous);
    } finally {
      if (generation === loadGeneration.current && identity === currentLoadIdentity.current) pageBusy.current = false;
    }
  }, [state.identity, state.loading, state.error, state.nextCursor, loadIdentity, walletId, network, range]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++checkEpoch.current; };
  }, []);

  useEffect(() => {
    // Preloaded sales stay current through local storage notifications without
    // starting payment checks or visible refresh indicators.
    void refresh();
    const unsubscribe = subscribeTerminalSales((changedWallet, changedNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) void refresh(false);
    });
    return () => { ++loadGeneration.current; pageBusy.current = false; refreshInFlight.current = 0; unsubscribe(); };
  }, [refresh]);

  useEffect(() => { ++checkEpoch.current; setChecking(false); setCheckError(''); checkBusy.current = false; }, [scope, selected?.id, visible]);
  useEffect(() => { setRefundOpen(false); setReceiptError(''); }, [scope, selected?.id]);
  useEffect(() => { setSelected(null); setPeriodState({ scope, value: 'today' }); setCustomRangeState({ scope, value: null }); setCustomEditor(null); }, [scope]);
  useEffect(() => { setExportError(''); setExporting(false); }, [exportIdentity]);

  const refreshDetail = useCallback(async () => {
    const key = selected?.scope === scope ? `${scope}:${selected.id}` : '';
    if (!key || !selected) { setDetailState({ key: '', sale: null }); return; }
    try {
      const sale = await getTerminalSale(walletId, network, selected.id);
      if (selectedKey.current === key) setDetailState({ key, sale });
    } catch {
      // Keep the last immutable snapshot when an incidental detail refresh fails.
    }
  }, [scope, walletId, network, selected]);

  useEffect(() => {
    void refreshDetail();
    const unsubscribe = subscribeTerminalSales((changedWallet, changedNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) void refreshDetail();
    });
    return unsubscribe;
  }, [walletId, network, refreshDetail]);

  const refreshRefunds = useCallback(async (showLoading = true) => {
    const generation = ++refundGeneration.current;
    const capturedScope = scope;
    const selectedId = selected?.scope === scope ? selected.id : null;
    if (!selectedId) {
      setRefundState({ scope: capturedScope, attempts: [], loading: false, error: false });
      return;
    }
    if (showLoading) setRefundState({ scope: capturedScope, attempts: [], loading: true, error: false });
    try {
      const attempts = await listTerminalRefundsForSale(walletId, network, selectedId);
      if (generation === refundGeneration.current && capturedScope === currentScope.current && selectedKey.current === `${capturedScope}:${selectedId}`) setRefundState({ scope: capturedScope, attempts, loading: false, error: false });
    } catch {
      if (generation === refundGeneration.current && capturedScope === currentScope.current) setRefundState({ scope: capturedScope, attempts: [], loading: false, error: true });
    }
  }, [scope, walletId, network, selected]);

  useEffect(() => {
    void refreshRefunds();
    const unsubscribe = subscribeTerminalRefunds((changedWallet, changedNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) {
        void refreshRefunds(false);
        void refresh(false);
      }
    });
    return () => { ++refundGeneration.current; unsubscribe(); };
  }, [scope, walletId, network, selected?.id, refreshRefunds, refresh]);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(clock);
  }, [visible]);

  const sales = state.identity === loadIdentity ? state.sales : [];
  const loading = state.identity !== loadIdentity || state.loading;
  const error = state.identity === loadIdentity && state.error;
  const summary = state.identity === loadIdentity ? state.summary : null;
  const shown = sales;
  const paidCount = summary?.receivedCount ?? 0;
  const totals = useMemo(() => totalsFor(summary), [summary]);
  const detailKey = selected?.scope === scope ? `${scope}:${selected.id}` : '';
  const detail = detailState.key === detailKey ? detailState.sale ?? undefined : undefined;
  const refundsLoaded = refundState.scope === scope && !refundState.loading && !refundState.error;
  const refunds = refundsLoaded && detail ? refundState.attempts : [];
  const refundRemaining = refundsLoaded && detail && isPaid(detail) ? safeRefundRemaining(detail, refunds) : null;
  const refundsReady = refundsLoaded && refundRemaining !== null;
  const completedRefund = refunds.reduce((total, attempt) => attempt.status === 'complete' ? total + BigInt(attempt.amountSats) : total, 0n);
  const reservedRefund = refunds.reduce((total, attempt) => attempt.status === 'unknown' || attempt.status === 'pending' ? total + BigInt(attempt.amountSats) : total, 0n);
  const refundedSats = state.identity === loadIdentity ? state.refundedSats : null;
  const close = () => { ++checkEpoch.current; checkBusy.current = false; onClose(); };
  const checkPayment = async () => {
    if (!detail || checkBusy.current) return;
    if (!isLightningInitialized || activeWallet?.id !== walletId) { setCheckError('Open this wallet and connect to Lightning to check payment.'); return; }
    checkBusy.current = true;
    setChecking(true);
    setCheckError('');
    const epoch = checkEpoch.current;
    const request = detail.request;
    const capturedScope = scope;
    const capturedSelection = `${scope}:${detail.request.id}`;
    const stillCurrent = () => mounted.current && visibleRef.current && capturedScope === currentScope.current && capturedSelection === selectedKey.current && epoch === checkEpoch.current;
    try {
      const expiresAt = await validateTerminalInvoice(request.invoice, request.amountSats);
      if (expiresAt !== request.expiresAt) throw new Error('Saved invoice expiry does not match.');
      if (!stillCurrent()) return;
      const result = await verifyTerminalInvoice(request.invoice, request.createdAt, detail.paymentId, true);
      if (!stillCurrent()) return;
      await updateTerminalSalePayment(request, result);
      if (stillCurrent() && result.status === 'unknown') setCheckError('No matching payment found yet. You can check again later.');
    } catch {
      if (stillCurrent()) setCheckError('Couldn’t verify this payment. Please try again.');
    } finally {
      if (stillCurrent()) { checkBusy.current = false; setChecking(false); }
    }
  };
  const shareReceipt = async () => {
    if (!detail || !isPaid(detail) || !refundsReady) return;
    const capturedScope = scope;
    const capturedSelection = `${scope}:${detail.request.id}`;
    setReceiptError('');
    try { await shareTerminalReceipt(detail, refunds); }
    catch { if (mounted.current && visibleRef.current && capturedScope === currentScope.current && capturedSelection === selectedKey.current) setReceiptError('Couldn’t share the receipt. Please try again.'); }
  };

  const exportSales = async () => {
    if (exportBusy.current || !visibleRef.current || selectedKey.current) return;
    const capturedScope = scope;
    const capturedPeriod = period;
    const capturedCustomRange = customRange ? { ...customRange } : undefined;
    const capturedDay = new Date(now);
    const capturedRevision = exportRevision.current.value;
    const isCurrent = () => mounted.current && visibleRef.current && currentScope.current === capturedScope && !selectedKey.current && exportRevision.current.value === capturedRevision;
    exportBusy.current = true;
    setExporting(true);
    setExportError('');
    try { await exportTerminalSalesCsv({ walletId, network, period: capturedPeriod, day: capturedDay, customRange: capturedCustomRange, isCurrent }); }
    catch (failure) {
      if (isCurrent()) setExportError(failure instanceof Error && failure.message === 'Sharing unavailable on this device.'
        ? failure.message : 'Couldn’t export sales. Try again.');
    } finally {
      if (exportRevision.current.value === capturedRevision) {
        exportBusy.current = false;
        if (mounted.current) setExporting(false);
      }
    }
  };

  const sectionTitle = period === 'today' ? 'TODAY’S ACTIVITY' : period === 'week' ? 'LAST 7 DAYS’ ACTIVITY' : period === 'month' ? 'THIS MONTH’S ACTIVITY' : period === 'custom' ? 'CUSTOM ACTIVITY' : 'ALL ACTIVITY';

  const openCustomEditor = () => {
    ++checkEpoch.current;
    checkBusy.current = false;
    setSelected(null);
    const today = localSalesDateKey(new Date(now));
    setCustomEditor({ scope, draft: customRange ? { ...customRange } : { startDate: today, endDate: today } });
  };
  const applyCustomRange = () => {
    if (!editingCustom || editingCustom.draft.startDate > editingCustom.draft.endDate) return;
    const applied = { ...editingCustom.draft };
    setCustomRangeState({ scope, value: applied });
    setPeriodState({ scope, value: 'custom' });
    setCustomEditor(null);
  };

  const header = <>
    <TerminalSalesPeriodControls period={period} customRange={customRange} draft={editingCustom?.draft ?? null} day={day} disabled={!visible || !headerEnabled}
      detailCaption={detail ? formatLongDate(saleTime(detail)) : undefined}
      onSelect={value => {
        if (value === 'custom') { openCustomEditor(); return; }
        ++checkEpoch.current; checkBusy.current = false; setSelected(null); setCustomEditor(null); setPeriodState({ scope, value });
      }} onDraftChange={draft => setCustomEditor({ scope, draft })} onApply={applyCustomRange} onCancel={() => setCustomEditor(null)} />
    {!detail ? <>
      {exportError ? <Text style={styles.exportError}>{exportError}</Text> : null}
      {!error && (!loading || sales.length > 0) ? <View style={styles.summary}>
        <Text style={styles.summaryLabel}>PAID SALES</Text>
        <Text style={styles.paidCount}>{paidCount}</Text>
        <View style={styles.summaryRule} />
        {totals.length ? totals.map(total => <View key={total.label} style={styles.totalRow}><Text style={styles.totalLabel}>{total.label}</Text><Text style={styles.totalAmount}>{total.amount}</Text></View>) : <Text style={styles.noTotals}>No paid sales {period === 'today' ? 'today' : period === 'all' ? 'yet' : 'in this period'}</Text>}
        {refundedSats !== null ? <View style={styles.refundedRow}><Text style={styles.totalLabel}>REFUNDED</Text><Text style={styles.totalAmount}>{formatBigSats(refundedSats)}</Text></View> : null}
        {period !== 'all' ? <Text style={styles.summaryNote}>By local verification date</Text> : null}
      </View> : null}
      {onOpenReports ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Open reports" disabled={!visible || !headerEnabled} onPress={() => onOpenReports({ period, ...(customRange ? { customRange: { ...customRange } } : {}), day: now })} style={styles.reportsRow}>
        <Feather name="bar-chart-2" size={18} color={theme.colors.primary} /><Text style={styles.reportsText}>Reports</Text><Feather name="chevron-right" size={18} color={theme.colors.muted} />
      </TouchableOpacity> : null}
      {!error && (!loading || sales.length > 0) ? <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{sectionTitle}</Text><Text style={styles.sectionCount}>{summary?.activityCount ?? shown.length}</Text></View> : null}
    </> : null}
  </>;

  if (refundOpen && detail && isPaid(detail) && refundsReady) return <TerminalRefundScreen sale={detail} attempts={refundState.attempts} onClose={() => setRefundOpen(false)} visible={visible} />;

  return <View style={styles.root}>

    <TerminalSheetHeader title={detail ? 'Sale details' : 'Sales'} closeLabel="Close sales" onClose={close} leading={!detail ? <GlassIconButton accessibilityLabel={periods.find(item => item.value === period)!.exportLabel} disabled={exporting || !visible || !headerEnabled} busy={exporting} onPress={() => { void exportSales(); }} visualSize={40} align="flex-start">
        {exporting ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Feather name="download" size={19} color={theme.colors.primary} />}
    </GlassIconButton> : undefined} />
    {detail ? <ScrollView style={styles.scroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
      {header}
      <View style={styles.detailCard}>
        <View style={styles.detailStatus}><View style={[styles.statusDot, isPaid(detail) && styles.paidDot]} /><Text style={[styles.statusText, isPaid(detail) && styles.paidText]}>{statusFor(detail, now).label}</Text></View>
        <Text style={styles.detailAmount} adjustsFontSizeToFit numberOfLines={1}>{displayAmount(detail.request)}</Text>
        {detail.request.fiat || detail.request.inputUnit === 'BTC' ? <Text style={styles.detailSats}>{formatTerminalSats(detail.request.amountSats)} sats</Text> : null}
      </View>
      {detail.request.basket ? <View style={styles.itemsDetail}>
        <Text style={styles.fieldLabel}>ITEMS</Text>
        {detail.request.basket.lines.map(line => <View key={line.itemId} style={styles.itemsDetailRow}>
          <Text style={styles.itemsDetailName}>{line.name} × {line.quantity}</Text>
          <Text style={styles.itemsDetailPrice}>{formatTerminalBasketAmount(line.total, detail.request.basket!.unit)}</Text>
        </View>)}
        <Text style={styles.itemsDetailPrice}>Total {formatTerminalBasketAmount(detail.request.basket.total, detail.request.basket.unit)}</Text>
      </View> : null}
      <View style={styles.detailsList}>
        <DetailField label="CREATED" value={formatLongDate(detail.request.createdAt)} styles={styles} />
        {detail.receivedAt ? <DetailField label="VERIFIED" value={formatLongDate(detail.receivedAt)} styles={styles} /> : null}
        <DetailField label="EXPIRES" value={formatLongDate(detail.request.expiresAt)} styles={styles} />
        {detail.paymentId ? <DetailField label="PAYMENT ID" value={detail.paymentId} styles={styles} selectable /> : null}
        <DetailField label="INVOICE" value={detail.request.invoice} styles={styles} selectable />
      </View>
      {isPaid(detail) ? <View style={styles.checkArea}>
        {refundState.scope === scope && refundState.error ? <><Text style={styles.checkError}>Refund records unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry refund records" onPress={() => { void refreshRefunds(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry</Text></TouchableOpacity></> : null}
        {refundsLoaded && refundRemaining === null ? <Text style={styles.checkError}>Refund records need attention. Refund and receipt are unavailable.</Text> : null}
        {refundsReady ? <>
          {refunds.length ? <View style={styles.refundSummary}><Text style={styles.fieldLabel}>REFUNDS</Text>{refunds.map(attempt => <Text key={attempt.id} style={styles.refundSummaryLine}>{formatTerminalSats(attempt.amountSats)} sats · {attempt.status === 'complete' ? 'Sent' : attempt.status === 'failed' ? 'Failed' : attempt.status === 'pending' ? 'Pending' : 'Outcome uncertain'}</Text>)}<Text style={styles.refundRemaining}>Refunded: {formatBigSats(completedRefund)}</Text>{reservedRefund > 0n ? <Text style={styles.refundRemaining}>Reserved: {formatBigSats(reservedRefund)}</Text> : null}<Text style={styles.refundRemaining}>Remaining: {formatTerminalSats(refundRemaining)} sats</Text></View> : null}
          {receiptError ? <Text style={styles.checkError}>{receiptError}</Text> : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Share receipt" onPress={() => { void shareReceipt(); }} style={styles.checkButton}><Text style={styles.checkText}>Share receipt</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Refund sale" onPress={() => setRefundOpen(true)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refund</Text></TouchableOpacity>
        </> : refundState.scope !== scope || refundState.loading ? <Text style={styles.checkError}>Loading refund records…</Text> : null}
      </View> : null}
      {!isPaid(detail) ? <View style={styles.checkArea}>
        {checkError ? <Text style={styles.checkError}>{checkError}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check payment" disabled={checking} style={[styles.checkButton, checking && styles.checkDisabled]} onPress={() => { void checkPayment(); }}><Text style={styles.checkText}>{checking ? 'Checking…' : 'Check payment'}</Text></TouchableOpacity>
      </View> : null}
    </ScrollView> : <FlatList
      style={styles.scroll}

      scrollEventThrottle={16}
      data={error ? [] : shown}
      keyExtractor={item => item.request.id}
      ListHeaderComponent={header}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 28 }]}
      refreshControl={<RefreshControl refreshing={state.identity === loadIdentity && state.refreshing} onRefresh={() => { void refresh(true, true); }} tintColor={theme.colors.bitcoin} colors={[theme.colors.bitcoin]} progressViewOffset={SHEET_HEADER_HEIGHT} />}
      onEndReached={() => { void loadNextPage(); }}
      onEndReachedThreshold={0.35}
      renderItem={({ item }) => {
        const status = statusFor(item, now);
        return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${displayAmount(item.request)}, ${status.label}, ${formatLongDate(saleTime(item))}`} style={styles.saleRow} onPress={() => { ++checkEpoch.current; checkBusy.current = false; setDetailState({ key: `${scope}:${item.request.id}`, sale: item }); setSelected({ scope, id: item.request.id }); }}>
          <View style={[styles.rowIcon, status.tone === 'paid' && styles.paidRowIcon]}><Feather name={status.tone === 'paid' ? 'check' : 'clock'} size={18} color={status.tone === 'paid' ? theme.colors.bitcoin : theme.colors.muted} /></View>
          <View style={styles.rowMiddle}><Text style={styles.rowAmount} numberOfLines={1}>{displayAmount(item.request)}</Text><Text style={styles.rowMeta}>{period === 'today' ? formatTime(saleTime(item)) : `${formatDate(saleTime(item))} · ${formatTime(saleTime(item))}`}</Text></View>
          <View style={styles.rowEnd}><Text style={[styles.rowStatus, status.tone === 'paid' && styles.paidText]}>{status.label}</Text><Feather name="chevron-right" size={17} color={theme.colors.muted} /></View>
        </TouchableOpacity>;
      }}
      ListEmptyComponent={<View style={styles.empty}>
        {error ? <><Feather name="alert-circle" size={27} color={theme.colors.muted} /><Text style={styles.emptyTitle}>Sales unavailable</Text><Text style={styles.emptyBody}>Couldn’t load saved sales. Try again.</Text><TouchableOpacity accessibilityRole="button" onPress={() => { void refresh(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></>
          : loading ? null
            : <><Feather name="shopping-bag" size={27} color={theme.colors.muted} /><Text style={styles.emptyTitle}>{period === 'today' ? 'No sales today' : period === 'all' ? 'No sales yet' : 'No sales in this period'}</Text><Text style={styles.emptyBody}>{period === 'today' ? 'New payment requests will appear here.' : period === 'all' ? 'Payment requests from this wallet will appear here.' : 'Payment requests in this period will appear here.'}</Text></>}
      </View>}
      ListFooterComponent={state.identity === loadIdentity && state.pageLoading
        ? <View style={styles.pageFooter}><ActivityIndicator size="small" color={theme.colors.bitcoin} /></View>
        : state.identity === loadIdentity && state.pageError
          ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading more sales" onPress={() => { void loadNextPage(); }} style={styles.pageFooter}><Feather name="refresh-cw" size={18} color={theme.colors.bitcoin} /></TouchableOpacity>
          : null}
      showsVerticalScrollIndicator={false}
    />}
  </View>;
}

function DetailField({ label, value, styles, selectable = false }: { label: string; value: string; styles: ReturnType<typeof makeStyles>; selectable?: boolean }) {
  return <View style={styles.detailField}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldValue} selectable={selectable}>{value}</Text></View>;
}

function makeStyles(colors: { background: string; primary: string; inversePrimary: string; surface: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1, minHeight: 0 },
    exportError: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginHorizontal: 24, marginTop: 12 },
    reportsRow: { minHeight: 52, marginHorizontal: 24, marginTop: 16, paddingHorizontal: 16, gap: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
    reportsText: { flex: 1, color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    summary: { marginHorizontal: 24, marginTop: 26, padding: 22, borderRadius: 18, backgroundColor: colors.surface },
    summaryLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.5 },
    paidCount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 48, marginTop: 3 },
    summaryRule: { height: 1, backgroundColor: colors.border, marginTop: 10, marginBottom: 12 },
    totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
    totalLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
    totalAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 16, flexShrink: 1, textAlign: 'right' },
    refundedRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 12, gap: 12 },
    noTotals: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    summaryNote: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10, marginTop: 12 },
    sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 24, marginTop: 35, marginBottom: 9 },
    sectionTitle: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.5 },
    sectionCount: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 11 },
    listContent: { paddingTop: 20 },
    saleRow: { minHeight: 82, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
    rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginRight: 15 },
    paidRowIcon: { backgroundColor: colors.bitcoin + '20' },
    rowMiddle: { flex: 1, minWidth: 0 },
    rowAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 15 },
    rowMeta: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 11, marginTop: 5 },
    rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 8 },
    rowStatus: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
    paidText: { color: colors.bitcoin },
    empty: { alignItems: 'center', paddingHorizontal: 28, paddingTop: 38 },
    emptyTitle: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 16, marginTop: 12, textAlign: 'center' },
    emptyBody: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19, marginTop: 8, textAlign: 'center' },
    retry: { marginTop: 20, paddingHorizontal: 24, minHeight: 42, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    pageFooter: { minHeight: 54, alignItems: 'center', justifyContent: 'center' },
    detailContent: { paddingTop: 20, paddingBottom: 28 },
    detailCard: { marginHorizontal: 24, padding: 24, backgroundColor: colors.surface, borderRadius: 18 },
    detailStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
    paidDot: { backgroundColor: colors.bitcoin },
    statusText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    detailAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 31, marginTop: 22 },
    detailSats: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 8 },
    itemsDetail: { marginHorizontal: 24, marginTop: 24, padding: 18, borderRadius: 12, backgroundColor: colors.surface },
    itemsDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 12 },
    itemsDetailName: { color: colors.primary, fontSize: 13, flex: 1 },
    itemsDetailPrice: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 12 },
    detailsList: { marginHorizontal: 24, marginTop: 24 },
    detailField: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    fieldLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.2 },
    fieldValue: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 20, marginTop: 9 },
    checkArea: { marginHorizontal: 24, marginTop: 24, alignItems: 'center' },
    checkError: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
    checkButton: { backgroundColor: colors.primary, borderRadius: 8, minHeight: 52, width: '100%', alignItems: 'center', justifyContent: 'center' },
    checkDisabled: { opacity: 0.6 },
    checkText: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    secondaryButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, minHeight: 48, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    secondaryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    refundSummary: { alignSelf: 'stretch', marginBottom: 22 },
    refundSummaryLine: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 9 },
    refundRemaining: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 12 },
  });
}

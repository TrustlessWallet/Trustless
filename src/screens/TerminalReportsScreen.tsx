import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TerminalSheetHeader from './TerminalSheetHeader';
import TerminalSalesPeriodControls from '../components/TerminalSalesPeriodControls';
import TerminalItemsReport, { PreparedItemReport } from '../components/TerminalItemsReport';
import TerminalSavedReports from '../components/TerminalSavedReports';
import { TerminalReportPreset } from '../services/terminalReportPresets';
import { getTerminalSalesComparison } from '../services/terminalSalesComparison';
import TerminalPeriodComparison from '../components/TerminalPeriodComparison';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { getTerminalSalesSummary, subscribeTerminalSales, TerminalRange, TerminalSalesSummary } from '../services/terminalSales';
import { getTerminalRefundTotal, subscribeTerminalRefunds } from '../services/terminalRefunds';
import { createTerminalItemPerformanceSnapshot, readTerminalItemPerformancePage, removeTerminalItemPerformanceSnapshot } from '../services/terminalItemPerformance';
import { CustomSalesDateRange, localSalesDateKey, previousTerminalSalesPeriodBounds, SalesPeriod, terminalSalesPeriodBounds } from '../services/terminalSalesPeriod';

export type TerminalReportSelection = { period: SalesPeriod; customRange?: CustomSalesDateRange; day: number };
type Props = { walletId: string; network: TerminalNetwork; initialSelection: TerminalReportSelection; onClose: () => void; visible?: boolean };
type FilterState = { scope: string; period: SalesPeriod; customRange: CustomSalesDateRange | null; draft: CustomSalesDateRange | null; tab: 'overview' | 'items'; unit: 'USD' | 'EUR' | 'CHF' | 'sats' | null; sort: 'quantity' | 'gross' };
type PreparedOverview = { identity: string; summary: TerminalSalesSummary; refunds: bigint; comparison?: Awaited<ReturnType<typeof getTerminalSalesComparison>> };

const localDayStart = (value: number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const initialFilter = (scope: string, selection: TerminalReportSelection): FilterState => {
  const validCustom = selection.period === 'custom' && selection.customRange;
  return { scope, period: validCustom ? 'custom' : selection.period === 'custom' ? 'today' : selection.period, customRange: validCustom ? { ...selection.customRange! } : null, draft: null, tab: 'overview', unit: null, sort: 'quantity' };
};

export default function TerminalReportsScreen({ walletId, network, initialSelection, onClose, visible = true }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const insets = useSafeAreaInsets();
  const scope = `${network}:${walletId}`;
  const [filterState, setFilterState] = useState(() => initialFilter(scope, initialSelection));
  const filter = filterState.scope === scope ? filterState : initialFilter(scope, initialSelection);
  const [dayStart, setDayStart] = useState(() => localDayStart(initialSelection.day));
  const [revision, setRevision] = useState(0);
  const pendingGeneration = useRef(0);
  const pendingToken = useRef<string | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const currentDayStart = useRef(dayStart);
  currentDayStart.current = dayStart;
  const currentRevision = useRef(revision);
  currentRevision.current = revision;
  const overviewCache = useRef(new Map<string, PreparedOverview>());
  const [preparedOverview, setPreparedOverview] = useState<PreparedOverview | null>(null);
  const [preparedItems, setPreparedItems] = useState<PreparedItemReport | null>(null);
  const [pendingPeriod, setPendingPeriod] = useState<SalesPeriod | null>(null);
  const [periodError, setPeriodError] = useState(false);
  const previousScope = useRef(scope);
  const effectiveDayStart = filterState.scope === scope ? dayStart : localDayStart(initialSelection.day);
  const activeTab = filter.tab;
  const day = useMemo(() => new Date(effectiveDayStart), [effectiveDayStart]);
  const rangeDay = filter.period === 'custom' ? 0 : effectiveDayStart;
  const range = useMemo(() => terminalSalesPeriodBounds(filter.period, new Date(rangeDay || effectiveDayStart), filter.customRange ?? undefined), [filter.period, filter.customRange, rangeDay]);

  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    ++pendingGeneration.current;
    if (pendingToken.current) { void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); pendingToken.current = null; }
    overviewCache.current.clear();
    setPreparedOverview(null);
    setPreparedItems(null);
    setPendingPeriod(null);
    setPeriodError(false);
    setFilterState(initialFilter(scope, initialSelection));
    setDayStart(localDayStart(initialSelection.day));
  }, [scope]);

  useEffect(() => {
    return () => { ++pendingGeneration.current; if (pendingToken.current) void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const sync = () => {
      const nextDay = localDayStart(Date.now());
      if (nextDay !== dayStart) {
        ++pendingGeneration.current;
        if (pendingToken.current) { void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); pendingToken.current = null; }
        setPreparedItems(null);
        setPendingPeriod(null);
        overviewCache.current.clear();
        setDayStart(nextDay);
      }
    };
    sync();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const clock = setTimeout(sync, Math.max(250, next - now.getTime() + 50));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => { clearTimeout(clock); subscription.remove(); };
  }, [visible, dayStart]);

  useEffect(() => {
    if (visible) return;
    ++pendingGeneration.current;
    if (pendingToken.current) { void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); pendingToken.current = null; }
    setPreparedItems(null);
    setPendingPeriod(null);
  }, [visible]);

  useEffect(() => {
    const changed = (changedWallet: string, changedNetwork: TerminalNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) { ++pendingGeneration.current; if (pendingToken.current) { void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); pendingToken.current = null; } setPreparedItems(null); setPendingPeriod(null); overviewCache.current.clear(); setRevision(value => value + 1); }
    };
    const unsubscribeSales = subscribeTerminalSales(changed);
    const unsubscribeRefunds = subscribeTerminalRefunds(changed);
    return () => { unsubscribeSales(); unsubscribeRefunds(); };
  }, [walletId, network]);

  const cancelPending = () => {
    ++pendingGeneration.current;
    if (pendingToken.current) { void removeTerminalItemPerformanceSnapshot(pendingToken.current).catch(() => undefined); pendingToken.current = null; }
    setPreparedItems(null);
    setPendingPeriod(null);
  };
  const stageFilter = (next: FilterState, nextDayStart = effectiveDayStart) => {
    cancelPending();
    setPeriodError(false);
    if (filter.draft) setFilterState(previous => ({ ...previous, draft: null }));
    const request = pendingGeneration.current;
    const nextDay = new Date(nextDayStart);
    const nextRange = terminalSalesPeriodBounds(next.period, nextDay, next.customRange ?? undefined);
    const rangeKey = nextRange ? `${nextRange.start}:${nextRange.end}` : 'all';
    const identity = `${scope}:${next.period}:${rangeKey}:${revision}`;
    if (next.period === filter.period && JSON.stringify(next.customRange) === JSON.stringify(filter.customRange) && next.tab === filter.tab && next.unit === filter.unit && next.sort === filter.sort && nextDayStart === effectiveDayStart) return;
    const sourceDayStart = effectiveDayStart;
    const valid = () => request === pendingGeneration.current && scope === currentScope.current && revision === currentRevision.current && sourceDayStart === currentDayStart.current;
    const commit = () => { if (!valid()) return false; setDayStart(nextDayStart); setFilterState(next); setPendingPeriod(null); return true; };
    setPendingPeriod(next.period);
    if (next.tab === 'overview') {
      const cached = overviewCache.current.get(identity);
      if (cached) { setPreparedOverview(cached); commit(); return; }
      const previousRange = previousTerminalSalesPeriodBounds(next.period, nextDay, next.customRange ?? undefined);
      void Promise.all([getTerminalSalesSummary(walletId, network, nextRange), getTerminalRefundTotal(walletId, network, nextRange), previousRange ? getTerminalSalesComparison(walletId, network, previousRange) : Promise.resolve(undefined)])
        .then(([summary, refunds, comparison]) => {
          if (!valid()) return;
          const prepared = { identity, summary, refunds, comparison };
          overviewCache.current.set(identity, prepared);
          if (overviewCache.current.size > 6) overviewCache.current.delete(overviewCache.current.keys().next().value!);
          setPreparedOverview(prepared);
          commit();
        }).catch(() => { if (valid()) { setPendingPeriod(null); setPeriodError(true); } });
      return;
    }
    void (async () => {
      let token: string | null = null;
      try {
        const snapshot = await createTerminalItemPerformanceSnapshot(walletId, network, nextRange, { unit: next.unit, sort: next.sort });
        token = snapshot.token;
        if (!valid()) return;
        pendingToken.current = token;
        const page = await readTerminalItemPerformancePage(token, 0, 20);
        if (!valid()) return;
        const reportKey = `${scope}:${rangeKey}:${next.unit ?? 'all'}:${next.sort}`;
        setPreparedItems({ identity: `${reportKey}:${revision}`, reportKey, token, items: page.items, nextSeq: page.nextSeq, totalCount: snapshot.totalCount, paidWithoutItems: snapshot.paidWithoutItems });
        token = null;
        commit();
      } catch { if (valid()) { setPendingPeriod(null); setPeriodError(true); } }
      finally { if (token) { if (pendingToken.current === token) pendingToken.current = null; void removeTerminalItemPerformanceSnapshot(token).catch(() => undefined); } }
    })();
  };
  const selectPeriod = (period: SalesPeriod) => {
    if (period === 'custom') {
      const today = localSalesDateKey(day);
      setFilterState({ ...filter, draft: filter.customRange ? { ...filter.customRange } : { startDate: today, endDate: today } });
      return;
    }
    stageFilter({ ...filter, period, draft: null });
  };
  const applyCustom = () => {
    if (!filter.draft || filter.draft.startDate > filter.draft.endDate) return;
    stageFilter({ ...filter, period: 'custom', customRange: { ...filter.draft }, draft: null });
  };

  const preset: TerminalReportPreset = { period: filter.period, ...(filter.period === 'custom' && filter.customRange ? { customRange: filter.customRange } : {}), tab: activeTab, unit: activeTab === 'items' ? filter.unit : null, sort: activeTab === 'items' ? filter.sort : 'quantity' };
  const applyPreset = (value: TerminalReportPreset) => {
    if (!visible) return;
    const presetDay = localDayStart(Date.now());
    stageFilter({ scope, period: value.period, customRange: value.customRange ?? null, draft: null, tab: value.tab, unit: value.unit, sort: value.sort }, presetDay);
  };
  const consumePreparedItems = useCallback(() => { pendingToken.current = null; setPreparedItems(null); }, []);
  const reportHeader = <>
      <TerminalSalesPeriodControls period={filter.period} pendingPeriod={pendingPeriod} customRange={filter.customRange} draft={filter.draft} day={day} onSelect={selectPeriod} onDraftChange={draft => setFilterState({ ...filter, draft })} onApply={applyCustom} onCancel={() => setFilterState({ ...filter, draft: null })} disabled={!visible} />
      {periodError ? <Text accessibilityRole="alert" style={styles.smallNote}>Couldn’t open that period. Try again.</Text> : null}
      <View style={styles.reportTabs}>
        <TouchableOpacity accessibilityRole="tab" accessibilityLabel="Overview reports" accessibilityState={{ selected: activeTab === 'overview', disabled: !visible }} disabled={!visible} onPress={() => { cancelPending(); setFilterState({ ...filter, tab: 'overview' }); }} style={[styles.reportTab, activeTab === 'overview' && styles.activeTab]}><Text style={[styles.reportTabText, activeTab === 'overview' && styles.activeText]}>Overview</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="tab" accessibilityLabel="Item reports" accessibilityState={{ selected: activeTab === 'items', disabled: !visible }} disabled={!visible} onPress={() => { cancelPending(); setFilterState({ ...filter, tab: 'items' }); }} style={[styles.reportTab, activeTab === 'items' && styles.activeTab]}><Text style={[styles.reportTabText, activeTab === 'items' && styles.activeText]}>Items</Text></TouchableOpacity>
      </View>
      <TerminalSavedReports key={scope} walletId={walletId} network={network} current={preset} visible={visible} onApply={applyPreset} />
  </>;
  return <View style={styles.root}>
    {activeTab !== 'items' ? <TerminalSheetHeader title="Reports" closeLabel="Close reports" onClose={onClose} disabled={!visible} /> : null}
    {activeTab === 'items' ? <TerminalItemsReport walletId={walletId} network={network} scope={scope} range={range} visible={visible} revision={revision} listHeader={reportHeader} selection={{ unit: filter.unit, sort: filter.sort }} onSelectionChange={value => { cancelPending(); setFilterState({ ...filter, ...value }); }} exportSelection={{ period: filter.period, day, customRange: filter.customRange ?? undefined }} prepared={preparedItems} onPreparedConsumed={consumePreparedItems} renderSheetHeader={leading => <TerminalSheetHeader title="Reports" closeLabel="Close reports" onClose={onClose} disabled={!visible} leading={leading} />} />
      : <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {reportHeader}
        {visible ? <ReportsOverview walletId={walletId} network={network} scope={scope} period={filter.period} customRange={filter.customRange} day={day} range={range} revision={revision} prepared={preparedOverview} /> : null}
      </ScrollView>}
  </View>;
}

type OverviewProps = { walletId: string; network: TerminalNetwork; scope: string; period: SalesPeriod; customRange: CustomSalesDateRange | null; day: Date; range: TerminalRange; revision: number; prepared?: PreparedOverview | null };
type OverviewState = { identity: string; loading: boolean; error: boolean; summary: TerminalSalesSummary | null; refunds: bigint | null };

function ReportsOverview({ walletId, network, scope, period, customRange, day, range, revision, prepared }: OverviewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const rangeKey = range ? `${range.start}:${range.end}` : 'all';
  const displayIdentity = `${scope}:${period}:${rangeKey}:`;
  const identity = `${displayIdentity}${revision}`;
  const retained = prepared?.identity.startsWith(displayIdentity) ? prepared : null;
  const [state, setState] = useState<OverviewState>({ identity, loading: true, error: false, summary: retained?.summary ?? null, refunds: retained?.refunds ?? null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState(previous => previous.identity === identity && previous.loading ? previous : { identity, loading: true, error: false,
      summary: previous.identity.startsWith(displayIdentity) ? previous.summary : retained?.summary ?? null,
      refunds: previous.identity.startsWith(displayIdentity) ? previous.refunds : retained?.refunds ?? null });
    try {
      const [summary, refunds] = await Promise.all([getTerminalSalesSummary(walletId, network, range), getTerminalRefundTotal(walletId, network, range)]);
      if (mounted.current && request === generation.current) setState({ identity, loading: false, error: false, summary, refunds });
    } catch {
      if (mounted.current && request === generation.current) setState({ identity, loading: false, error: true, summary: null, refunds: null });
    }
  }, [identity, displayIdentity, walletId, network, range, retained]);
  useEffect(() => {
    if (prepared?.identity === identity) setState({ identity, loading: false, error: false, summary: prepared.summary, refunds: prepared.refunds });
    else void load();
    return () => { ++generation.current; };
  }, [load, prepared, identity]);

  const current = prepared?.identity === identity ? { identity, loading: false, error: false, summary: prepared.summary, refunds: prepared.refunds }
    : state.identity === identity ? state : state.identity.startsWith(displayIdentity) ? { ...state, identity, loading: true, error: false }
      : { identity, loading: true, error: false, summary: null, refunds: null };
  const previous = useMemo(() => previousTerminalSalesPeriodBounds(period, day, customRange ?? undefined), [period, day, customRange]);
  return <View style={styles.overview} accessibilityLabel="Reports overview">
    <View style={styles.blockHeading}><Text style={styles.blockTitle}>PAID SALES</Text>{current.loading ? <ActivityIndicator accessibilityLabel="Loading reports overview" size="small" color={theme.colors.bitcoin} /> : null}</View>
    {current.error ? <View style={styles.errorRow}><Text style={styles.smallNote}>Reports unavailable</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry reports overview" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : null}
    {current.summary && current.refunds !== null ? <>
      <Text style={styles.paidCount}>{current.summary.receivedCount}</Text>
      <View style={styles.rule} />
      {overviewTotals(current.summary).map(total => <View key={total.label} style={styles.totalRow}><Text style={styles.totalLabel}>{total.label}</Text><Text style={styles.totalAmount}>{total.value}</Text></View>)}
      <View style={styles.refundedRow}><Text style={styles.totalLabel}>REFUNDED</Text><Text style={styles.totalAmount}>{formatSats(current.refunds)}</Text></View>
      {range && previous ? <TerminalPeriodComparison walletId={walletId} network={network} scope={scope} periodDay={day} currentRange={range} previousRange={previous} currentSummary={current.summary} currentRefunds={current.refunds} prepared={prepared?.identity === identity ? prepared.comparison : undefined} /> : null}
    </> : null}
  </View>;
}

const formatSats = (value: bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} sats`;
function overviewTotals(summary: TerminalSalesSummary) {
  const result: { label: string; value: string }[] = [];
  for (const unit of ['USD', 'EUR', 'CHF'] as const) {
    const amount = summary.fiatMinor[unit];
    if (amount === undefined) continue;
    const digits = amount.toString().padStart(3, '0');
    const prefix = unit === 'USD' ? '$' : unit === 'EUR' ? '€' : 'CHF ';
    result.push({ label: unit, value: `${prefix}${digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${digits.slice(-2)}` });
  }
  if (summary.bitcoinSats > 0n) result.push({ label: 'SATS', value: formatSats(summary.bitcoinSats) });
  return result;
}

function makeStyles(colors: { background: string; primary: string; surface: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    reportTabs: { flexDirection: 'row', marginHorizontal: 24, marginTop: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
    reportTab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    activeTab: { borderBottomColor: colors.bitcoin },
    reportTabText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    activeText: { color: colors.primary },
    overview: { marginHorizontal: 24, marginTop: 24, padding: 22, borderRadius: 18, backgroundColor: colors.surface },
    blockHeading: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    blockTitle: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 12, letterSpacing: 1.3 },
    paidCount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 48, marginTop: 3 },
    rule: { height: 1, backgroundColor: colors.border, marginTop: 10, marginBottom: 12 },
    totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
    totalLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    totalAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 17, flexShrink: 1, textAlign: 'right' },
    refundedRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 12, gap: 12 },
    errorRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    smallNote: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
  });
}

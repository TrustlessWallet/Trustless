import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TerminalSheetHeader from './TerminalSheetHeader';
import TerminalSalesPeriodControls from '../components/TerminalSalesPeriodControls';
import TerminalItemsReport from '../components/TerminalItemsReport';
import TerminalPeriodComparison from '../components/TerminalPeriodComparison';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { getTerminalSalesSummary, subscribeTerminalSales, TerminalRange, TerminalSalesSummary } from '../services/terminalSales';
import { getTerminalRefundTotal, subscribeTerminalRefunds } from '../services/terminalRefunds';
import { CustomSalesDateRange, localSalesDateKey, previousTerminalSalesPeriodBounds, SalesPeriod, terminalSalesPeriodBounds } from '../services/terminalSalesPeriod';

export type TerminalReportSelection = { period: SalesPeriod; customRange?: CustomSalesDateRange; day: number };
type Props = { walletId: string; network: TerminalNetwork; initialSelection: TerminalReportSelection; onClose: () => void; visible?: boolean };
type FilterState = { scope: string; period: SalesPeriod; customRange: CustomSalesDateRange | null; draft: CustomSalesDateRange | null };

const localDayStart = (value: number) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};
const initialFilter = (scope: string, selection: TerminalReportSelection): FilterState => {
  const validCustom = selection.period === 'custom' && selection.customRange;
  return { scope, period: validCustom ? 'custom' : selection.period === 'custom' ? 'today' : selection.period, customRange: validCustom ? { ...selection.customRange! } : null, draft: null };
};

export default function TerminalReportsScreen({ walletId, network, initialSelection, onClose, visible = true }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const insets = useSafeAreaInsets();
  const scope = `${network}:${walletId}`;
  const [filterState, setFilterState] = useState(() => initialFilter(scope, initialSelection));
  const filter = filterState.scope === scope ? filterState : initialFilter(scope, initialSelection);
  const [dayStart, setDayStart] = useState(() => localDayStart(initialSelection.day));
  const [tab, setTab] = useState<'overview' | 'items'>('overview');
  const [revision, setRevision] = useState(0);
  const previousScope = useRef(scope);
  const effectiveDayStart = filterState.scope === scope ? dayStart : localDayStart(initialSelection.day);
  const activeTab = filterState.scope === scope ? tab : 'overview';
  const day = useMemo(() => new Date(effectiveDayStart), [effectiveDayStart]);
  const rangeDay = filter.period === 'custom' ? 0 : effectiveDayStart;
  const range = useMemo(() => terminalSalesPeriodBounds(filter.period, new Date(rangeDay || effectiveDayStart), filter.customRange ?? undefined), [filter.period, filter.customRange, rangeDay]);

  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    setFilterState(initialFilter(scope, initialSelection));
    setDayStart(localDayStart(initialSelection.day));
    setTab('overview');
  }, [scope]);

  useEffect(() => {
    if (!visible) return;
    const sync = () => setDayStart(localDayStart(Date.now()));
    sync();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const clock = setTimeout(sync, Math.max(250, next - now.getTime() + 50));
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => { clearTimeout(clock); subscription.remove(); };
  }, [visible, dayStart]);

  useEffect(() => {
    if (!visible) return;
    const changed = (changedWallet: string, changedNetwork: TerminalNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) setRevision(value => value + 1);
    };
    const unsubscribeSales = subscribeTerminalSales(changed);
    const unsubscribeRefunds = subscribeTerminalRefunds(changed);
    return () => { unsubscribeSales(); unsubscribeRefunds(); };
  }, [visible, walletId, network]);

  const selectPeriod = (period: SalesPeriod) => {
    if (period === 'custom') {
      const today = localSalesDateKey(day);
      setFilterState({ ...filter, draft: filter.customRange ? { ...filter.customRange } : { startDate: today, endDate: today } });
      return;
    }
    setFilterState({ scope, period, customRange: filter.customRange, draft: null });
  };
  const applyCustom = () => {
    if (!filter.draft || filter.draft.startDate > filter.draft.endDate) return;
    setFilterState({ scope, period: 'custom', customRange: { ...filter.draft }, draft: null });
  };

  const reportHeader = <>
      <TerminalSalesPeriodControls period={filter.period} customRange={filter.customRange} draft={filter.draft} day={day} onSelect={selectPeriod} onDraftChange={draft => setFilterState({ ...filter, draft })} onApply={applyCustom} onCancel={() => setFilterState({ ...filter, draft: null })} disabled={!visible} />
      <View style={styles.reportTabs}>
        <TouchableOpacity accessibilityRole="tab" accessibilityLabel="Overview reports" accessibilityState={{ selected: activeTab === 'overview', disabled: !visible }} disabled={!visible} onPress={() => setTab('overview')} style={[styles.reportTab, activeTab === 'overview' && styles.activeTab]}><Text style={[styles.reportTabText, activeTab === 'overview' && styles.activeText]}>Overview</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="tab" accessibilityLabel="Item reports" accessibilityState={{ selected: activeTab === 'items', disabled: !visible }} disabled={!visible} onPress={() => setTab('items')} style={[styles.reportTab, activeTab === 'items' && styles.activeTab]}><Text style={[styles.reportTabText, activeTab === 'items' && styles.activeText]}>Items</Text></TouchableOpacity>
      </View>
  </>;
  return <View style={styles.root}>
    {activeTab !== 'items' ? <TerminalSheetHeader title="Reports" closeLabel="Close reports" onClose={onClose} disabled={!visible} /> : null}
    {activeTab === 'items' ? <TerminalItemsReport walletId={walletId} network={network} scope={scope} range={range} visible={visible} revision={revision} listHeader={reportHeader} exportSelection={{ period: filter.period, day, customRange: filter.customRange ?? undefined }} renderSheetHeader={leading => <TerminalSheetHeader title="Reports" closeLabel="Close reports" onClose={onClose} disabled={!visible} leading={leading} />} />
      : <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {reportHeader}
        {visible ? <ReportsOverview walletId={walletId} network={network} scope={scope} period={filter.period} customRange={filter.customRange} day={day} range={range} revision={revision} /> : null}
      </ScrollView>}
  </View>;
}

type OverviewProps = { walletId: string; network: TerminalNetwork; scope: string; period: SalesPeriod; customRange: CustomSalesDateRange | null; day: Date; range: TerminalRange; revision: number };
type OverviewState = { identity: string; loading: boolean; error: boolean; summary: TerminalSalesSummary | null; refunds: bigint | null };

function ReportsOverview({ walletId, network, scope, period, customRange, day, range, revision }: OverviewProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const rangeKey = range ? `${range.start}:${range.end}` : 'all';
  const identity = `${scope}:${period}:${rangeKey}:${revision}`;
  const [state, setState] = useState<OverviewState>({ identity, loading: true, error: false, summary: null, refunds: null });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState(previous => previous.identity === identity && previous.loading ? previous : { identity, loading: true, error: false, summary: null, refunds: null });
    try {
      const [summary, refunds] = await Promise.all([getTerminalSalesSummary(walletId, network, range), getTerminalRefundTotal(walletId, network, range)]);
      if (mounted.current && request === generation.current) setState({ identity, loading: false, error: false, summary, refunds });
    } catch {
      if (mounted.current && request === generation.current) setState({ identity, loading: false, error: true, summary: null, refunds: null });
    }
  }, [identity, walletId, network, range]);
  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);

  const current = state.identity === identity ? state : { identity, loading: true, error: false, summary: null, refunds: null };
  const previous = useMemo(() => previousTerminalSalesPeriodBounds(period, day, customRange ?? undefined), [period, day, customRange]);
  return <View style={styles.overview} accessibilityLabel="Reports overview">
    <View style={styles.blockHeading}><Text style={styles.blockTitle}>PAID SALES</Text>{current.loading ? <ActivityIndicator accessibilityLabel="Loading reports overview" size="small" color={theme.colors.bitcoin} /> : null}</View>
    {current.error ? <View style={styles.errorRow}><Text style={styles.smallNote}>Reports unavailable</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry reports overview" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : null}
    {current.summary && current.refunds !== null ? <>
      <Text style={styles.paidCount}>{current.summary.receivedCount}</Text>
      <View style={styles.rule} />
      {overviewTotals(current.summary).map(total => <View key={total.label} style={styles.totalRow}><Text style={styles.totalLabel}>{total.label}</Text><Text style={styles.totalAmount}>{total.value}</Text></View>)}
      <View style={styles.refundedRow}><Text style={styles.totalLabel}>REFUNDED</Text><Text style={styles.totalAmount}>{formatSats(current.refunds)}</Text></View>
      {range && previous ? <TerminalPeriodComparison walletId={walletId} network={network} scope={scope} periodDay={day} currentRange={range} previousRange={previous} currentSummary={current.summary} currentRefunds={current.refunds} /> : null}
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

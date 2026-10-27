import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import GlassIconButton from './GlassIconButton';
import { exportTerminalItemsCsv } from '../services/terminalItemsExport';
import { CustomSalesDateRange, SalesPeriod } from '../services/terminalSalesPeriod';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { TerminalRange } from '../services/terminalSales';
import {
  createTerminalItemPerformanceSnapshot, formatTerminalItemGross, ItemSort, ItemUnit,
  readTerminalItemPerformancePage, removeTerminalItemPerformanceSnapshot, TerminalItemPerformanceRow,
} from '../services/terminalItemPerformance';

type Props = { walletId: string; network: TerminalNetwork; scope: string; range: TerminalRange; visible: boolean; revision: number; listHeader: React.ReactNode; selection?: { unit: ItemUnit | null; sort: ItemSort }; onSelectionChange?: (value: { unit: ItemUnit | null; sort: ItemSort }) => void; exportSelection?: { period: SalesPeriod; day: Date; customRange?: CustomSalesDateRange }; renderSheetHeader?: (exportButton: React.ReactNode) => React.ReactNode };
type State = {
  identity: string; reportKey: string; items: TerminalItemPerformanceRow[]; nextSeq: number | null;
  totalCount: number; paidWithoutItems: number; loading: boolean; refreshing: boolean; error: boolean; pageLoading: boolean; pageError: boolean;
};
const units: { value: ItemUnit | null; title: string }[] = [{ value: null, title: 'All currencies' }, { value: 'USD', title: 'USD' }, { value: 'EUR', title: 'EUR' }, { value: 'CHF', title: 'CHF' }, { value: 'sats', title: 'sats' }];
const quantityText = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function TerminalItemsReport({ walletId, network, scope, range, visible, revision, listHeader, exportSelection, renderSheetHeader, selection, onSelectionChange }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const insets = useSafeAreaInsets();
  const [localSelection, setLocalSelection] = useState<{ unit: ItemUnit | null; sort: ItemSort }>({ unit: null, sort: 'quantity' });
  const { unit, sort } = selection ?? localSelection;
  const select = onSelectionChange ?? setLocalSelection;
  const [currencyChooser, setCurrencyChooser] = useState<'filter' | 'sales' | null>(null);
  const choosingSalesCurrency = currencyChooser === 'sales';
  const [infoOpen, setInfoOpen] = useState(false);
  const rangeKey = range ? `${range.start}:${range.end}` : 'all';
  const reportKey = `${scope}:${rangeKey}:${unit ?? 'all'}:${sort}`;
  const identity = `${reportKey}:${revision}`;
  useEffect(() => { setCurrencyChooser(null); setInfoOpen(false); }, [reportKey, visible]);
  const [state, setState] = useState<State>({ identity, reportKey, items: [], nextSeq: null, totalCount: 0, paidWithoutItems: 0, loading: true, refreshing: false, error: false, pageLoading: false, pageError: false });
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  const generation = useRef(0);
  const pageBusy = useRef(false);
  const ownedToken = useRef<string | null>(null);
  const exportKey = `${reportKey}:${exportSelection?.period ?? ''}:${exportSelection?.day.getTime() ?? ''}`;
  const exportContext = useRef({ key: exportKey, visible, epoch: 0 });
  if (exportContext.current.key !== exportKey || exportContext.current.visible !== visible) {
    exportContext.current = { key: exportKey, visible, epoch: exportContext.current.epoch + 1 };
  }
  const exportBusy = useRef<number | null>(null);
  const [exportState, setExportState] = useState({ epoch: -1, busy: false, error: '' });
  const exporting = exportState.epoch === exportContext.current.epoch && exportState.busy;
  const exportError = exportState.epoch === exportContext.current.epoch ? exportState.error : '';
  const exportItems = async () => {
    if (!visible || !exportSelection || exportBusy.current === exportContext.current.epoch) return;
    const epoch = exportContext.current.epoch;
    const isCurrent = () => mounted.current && exportContext.current.visible && exportContext.current.epoch === epoch;
    exportBusy.current = epoch;
    setExportState({ epoch, busy: true, error: '' });
    try {
      await exportTerminalItemsCsv({ walletId, network, ...exportSelection, unit, sort, isCurrent });
    } catch (error) {
      if (isCurrent()) setExportState({ epoch, busy: false, error: error instanceof Error && error.message === 'Sharing unavailable on this device.' ? error.message : 'Couldn’t export items. Try again.' });
    } finally {
      if (exportBusy.current === epoch) exportBusy.current = null;
      if (isCurrent()) setExportState(previous => ({ ...previous, busy: false }));
    }
  };


  const removeToken = useCallback((token: string | null) => {
    if (!token) return;
    if (ownedToken.current === token) ownedToken.current = null;
    void removeTerminalItemPerformanceSnapshot(token).catch(() => undefined);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current; pageBusy.current = false; removeToken(ownedToken.current); };
  }, [removeToken]);

  const load = useCallback(async () => {
    if (!visible) return;
    const request = ++generation.current;
    pageBusy.current = false;
    const prior = stateRef.current;
    const refresh = prior.reportKey === reportKey && prior.items.length > 0;
    const retainedCount = refresh ? Math.max(20, prior.items.length) : 20;
    setState(refresh
      ? { ...prior, identity, reportKey, refreshing: true, error: false, pageLoading: false, pageError: false }
      : { identity, reportKey, items: [], nextSeq: null, totalCount: 0, paidWithoutItems: 0, loading: true, refreshing: false, error: false, pageLoading: false, pageError: false });
    if (!refresh) removeToken(ownedToken.current);
    let createdToken: string | null = null;
    try {
      const snapshot = await createTerminalItemPerformanceSnapshot(walletId, network, range, { sort, unit });
      createdToken = snapshot.token;
      if (!mounted.current || request !== generation.current) { removeToken(createdToken); return; }
      const items: TerminalItemPerformanceRow[] = [];
      let nextSeq: number | null = 0;
      while (nextSeq !== null && items.length < retainedCount) {
        const page = await readTerminalItemPerformancePage(createdToken, nextSeq, 20);
        if (!mounted.current || request !== generation.current) { removeToken(createdToken); return; }
        items.push(...page.items);
        nextSeq = page.nextSeq;
      }
      const replaced = ownedToken.current;
      ownedToken.current = createdToken;
      createdToken = null;
      if (replaced && replaced !== ownedToken.current) removeToken(replaced);
      setState({ identity, reportKey, items, nextSeq, totalCount: snapshot.totalCount, paidWithoutItems: snapshot.paidWithoutItems, loading: false, refreshing: false, error: false, pageLoading: false, pageError: false });
    } catch {
      removeToken(createdToken);
      if (!mounted.current || request !== generation.current) return;
      if (refresh) setState({ ...prior, identity, reportKey, refreshing: false, error: true, pageLoading: false, pageError: false });
      else setState({ identity, reportKey, items: [], nextSeq: null, totalCount: 0, paidWithoutItems: 0, loading: false, refreshing: false, error: true, pageLoading: false, pageError: false });
    }
  }, [visible, identity, reportKey, walletId, network, range, sort, unit, removeToken]);

  useEffect(() => {
    if (visible) void load();
    else removeToken(ownedToken.current);
    return () => { ++generation.current; pageBusy.current = false; };
  }, [visible, load, removeToken]);

  const loadNext = useCallback(async () => {
    const current = stateRef.current;
    const token = ownedToken.current;
    if (!visible || pageBusy.current || current.identity !== identity || current.loading || current.refreshing || current.error || !token || current.nextSeq === null) return;
    const request = generation.current;
    const next = current.nextSeq;
    pageBusy.current = true;
    setState(previous => previous.identity === identity ? { ...previous, pageLoading: true, pageError: false } : previous);
    try {
      const page = await readTerminalItemPerformancePage(token, next, 20);
      if (!mounted.current || request !== generation.current || token !== ownedToken.current) return;
      setState(previous => previous.identity === identity ? { ...previous, items: [...previous.items, ...page.items], nextSeq: page.nextSeq, pageLoading: false, pageError: false } : previous);
    } catch {
      if (mounted.current && request === generation.current && token === ownedToken.current) setState(previous => previous.identity === identity ? { ...previous, pageLoading: false, pageError: true } : previous);
    } finally {
      if (request === generation.current) pageBusy.current = false;
    }
  }, [visible, identity]);

  const current = state.identity === identity ? state : state.reportKey === reportKey
    ? { ...state, identity, refreshing: true, error: false, pageLoading: false, pageError: false }
    : { identity, reportKey, items: [], nextSeq: null, totalCount: 0, paidWithoutItems: 0, loading: true, refreshing: false, error: false, pageLoading: false, pageError: false };
  const selectedUnit = units.find(option => option.value === unit)!.title;
  const currencyChoices = <View style={styles.currencyOptions}>{(choosingSalesCurrency ? units.filter(option => option.value !== null) : units).map(option => <TouchableOpacity key={option.title} accessibilityRole="button" accessibilityLabel={`Item currency option ${option.title}`} accessibilityState={{ selected: unit === option.value, disabled: !visible }} disabled={!visible} onPress={() => { select({ unit: option.value, sort: option.value === null ? 'quantity' : choosingSalesCurrency ? 'gross' : sort }); setCurrencyChooser(null); }} style={[styles.currencyOption, unit === option.value && styles.currencySelected]}><Text style={[styles.optionText, unit === option.value && styles.selectedText]}>{option.title}</Text></TouchableOpacity>)}</View>;
  const controls = <>
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Item currency ${selectedUnit}`} accessibilityState={{ expanded: currencyChooser === 'filter', disabled: !visible }} disabled={!visible} onPress={() => { setCurrencyChooser(mode => mode === 'filter' ? null : 'filter'); setInfoOpen(false); }} style={styles.currencyButton}><Text style={styles.controlText}>{selectedUnit}</Text><Feather name={currencyChooser === 'filter' ? 'chevron-up' : 'chevron-down'} size={14} color={theme.colors.muted} /></TouchableOpacity>
      <View style={styles.resultCount}><Text style={styles.caption}>{current.loading || (current.error && !current.items.length) ? '' : `${current.totalCount} ${current.totalCount === 1 ? 'result' : 'results'}`}</Text>{current.loading || current.refreshing ? <ActivityIndicator accessibilityLabel="Loading item report" size="small" color={theme.colors.bitcoin} /> : null}</View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="About item reports" accessibilityState={{ expanded: infoOpen, disabled: !visible }} disabled={!visible} onPress={() => { setInfoOpen(open => !open); setCurrencyChooser(null); }} style={styles.infoButton}><Feather name="info" size={18} color={theme.colors.muted} /></TouchableOpacity>
    </View>
    {currencyChooser === 'filter' ? <View style={styles.currencyPicker}>{currencyChoices}</View> : null}
    {infoOpen ? <View style={styles.infoDetails}>
      <Text style={styles.pickerNote}>Paid sales with item details only. Quantities and amounts are before refunds; refunds aren’t assigned to individual items.</Text>
      {!current.loading && current.paidWithoutItems > 0 ? <Text style={styles.pickerNote}>{quantityText(BigInt(current.paidWithoutItems))} paid {current.paidWithoutItems === 1 ? 'sale without item details is' : 'sales without item details are'} excluded across all currencies in this period.</Text> : null}
    </View> : null}
    <View style={styles.sortSection}>
      <Text style={styles.sortLabel}>Sort by</Text>
      <View style={styles.sortControl}>
        {(['quantity', 'gross'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={`Sort items by ${value === 'gross' ? 'sales amount' : 'quantity'}`} accessibilityHint={value === 'gross' && unit === null ? 'Choose a currency first' : undefined} accessibilityState={{ selected: sort === value, disabled: !visible, ...(value === 'gross' && unit === null ? { expanded: choosingSalesCurrency } : {}) }} disabled={!visible} onPress={() => { if (value === 'gross' && unit === null) { setCurrencyChooser(mode => mode === 'sales' ? null : 'sales'); setInfoOpen(false); } else { setCurrencyChooser(null); select({ unit, sort: value }); } }} style={[styles.sortButton, sort === value && styles.sortSelected]}><Text style={[styles.controlText, sort === value && styles.selectedText]}>{value === 'quantity' ? 'Quantity' : 'Sales amount'}</Text>{value === 'gross' && unit === null ? <Feather name={choosingSalesCurrency ? 'chevron-up' : 'chevron-down'} size={12} color={theme.colors.primary} /> : null}</TouchableOpacity>)}
      </View>
      {choosingSalesCurrency ? <View style={styles.salesCurrencyChoices}><Text style={styles.pickerNote}>Choose currency</Text>{currencyChoices}</View> : null}
    </View>
    {exportError ? <Text accessibilityRole="alert" style={styles.note}>{exportError}</Text> : null}
    {current.error ? <View style={styles.errorRow}><Text style={[styles.note, styles.inlineNote]}>{current.items.length ? 'Couldn’t refresh item report' : 'Item report unavailable'}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry item report" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : null}
  </>;

  return <View style={styles.list}>
    {renderSheetHeader?.(<GlassIconButton accessibilityLabel="Export item report" disabled={!visible || exporting || !exportSelection} busy={exporting} onPress={() => { void exportItems(); }} visualSize={40} align="flex-start">
      {exporting ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Feather name="download" size={19} color={theme.colors.primary} />}
    </GlassIconButton>)}
    <FlatList
    key={reportKey}
    testID="terminal-items-report"
    style={styles.list}
    data={current.error && !current.items.length ? [] : current.items}
    keyExtractor={item => `${item.itemId}:${item.unit}`}
    ListHeaderComponent={<>{listHeader}{controls}</>}
    renderItem={({ item }) => <View style={styles.itemRow} accessibilityLabel={`${item.name}, quantity ${quantityText(item.quantity)}, gross ${formatTerminalItemGross(item.gross, item.unit)}`}><View style={styles.itemTop}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemQuantity}>× {quantityText(item.quantity)}</Text></View><Text style={styles.itemGross}>{formatTerminalItemGross(item.gross, item.unit)}</Text></View>}
    ListEmptyComponent={!current.loading && !current.error ? <Text style={styles.empty}>{unit ? `No ${unit} item sales in this period` : 'No item sales in this period'}</Text> : null}
    ListFooterComponent={current.pageLoading ? <View style={styles.footer}><ActivityIndicator size="small" color={theme.colors.bitcoin} /></View> : current.pageError ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading more items" onPress={() => { void loadNext(); }} style={styles.footer}><Text style={styles.retryText}>Retry</Text></TouchableOpacity> : null}
    onEndReached={() => { void loadNext(); }}
    onEndReachedThreshold={0.35}
    contentInsetAdjustmentBehavior="never"
    automaticallyAdjustContentInsets={false}
    contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
    showsVerticalScrollIndicator={false}
  /></View>;
}

function makeStyles(colors: { background: string; primary: string; surface: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    list: { flex: 1, backgroundColor: colors.background },
    controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 12 },
    resultCount: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 6 },
    infoButton: { width: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
    infoDetails: { marginHorizontal: 24, paddingVertical: 10, gap: 8 },
    sortSection: { marginHorizontal: 24, marginTop: 10, marginBottom: 8, gap: 7 },
    sortLabel: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    currencyButton: { minHeight: 44,  paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    sortControl: { minHeight: 50, flexDirection: 'row', padding: 3, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    sortButton: { flex: 1, minHeight: 44, flexDirection: 'row', gap: 6, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
    salesCurrencyChoices: { paddingTop: 5, gap: 8 },
    sortSelected: { backgroundColor: colors.primary },
    controlText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    selectedText: { color: colors.background },
    currencyPicker: { marginHorizontal: 24, marginTop: 8, gap: 8 },
    pickerNote: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 18 },
    currencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    currencyOption: { minHeight: 44, minWidth: 54, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    currencySelected: { backgroundColor: colors.primary },
    optionText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    caption: { minHeight: 18, color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 18 },
    note: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 18, marginHorizontal: 24, marginTop: 7 },
    errorRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginHorizontal: 24 },
    inlineNote: { flex: 1, marginHorizontal: 0, marginTop: 0 },
    retry: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    itemRow: { minHeight: 70, paddingHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    itemName: { flex: 1, color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 14, lineHeight: 20 },
    itemQuantity: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 13, lineHeight: 20 },
    itemGross: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13, lineHeight: 20, marginTop: 4 },
    empty: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 13, lineHeight: 20, marginHorizontal: 24, marginTop: 24 },
    footer: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  });
}

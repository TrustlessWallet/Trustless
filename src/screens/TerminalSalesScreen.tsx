import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { formatFiatMinor, formatTerminalAmount, formatTerminalSats, TerminalNetwork, TerminalRequest } from '../services/terminal';
import { listTerminalSales, subscribeTerminalSales, terminalSaleDisplayStatus, updateTerminalSalePayment, TerminalSale } from '../services/terminalSales';

type Props = { walletId: string; network: TerminalNetwork; onClose: () => void; visible?: boolean };
type LoadState = { scope: string; sales: TerminalSale[]; loading: boolean; error: boolean };
type Tab = 'today' | 'all';

const sameLocalDay = (timestamp: number, day: Date) => {
  const value = new Date(timestamp);
  return value.getFullYear() === day.getFullYear() && value.getMonth() === day.getMonth() && value.getDate() === day.getDate();
};

const formatTime = (timestamp: number) => new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const formatLongDate = (timestamp: number) => new Date(timestamp).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const saleTime = (sale: TerminalSale) => sale.receivedAt ?? sale.request.createdAt;
const isPaid = (sale: TerminalSale) => sale.status === 'received';
const displayAmount = (request: TerminalRequest) => request.fiat
  ? `${request.fiat.currency === 'USD' ? '$' : request.fiat.currency === 'EUR' ? '€' : 'CHF '}${formatFiatMinor(request.fiat.amountMinor)}`
  : request.inputUnit === 'BTC'
    ? `${formatTerminalAmount(request.amountSats, 'BTC')} ₿`
    : `${formatTerminalSats(request.amountSats)} sats`;

function totalsFor(sales: TerminalSale[]): { label: string; amount: string }[] {
  const totals = new Map<string, bigint>();
  for (const sale of sales) {
    if (!isPaid(sale)) continue;
    const currency = sale.request.fiat?.currency ?? 'sats';
    const amount = BigInt(sale.request.fiat?.amountMinor ?? sale.request.amountSats);
    totals.set(currency, (totals.get(currency) ?? 0n) + amount);
  }
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

export default function TerminalSalesScreen({ walletId, network, onClose, visible = true }: Props) {
  const { theme } = useTheme();
  const { activeWallet, isLightningInitialized, validateTerminalInvoice, verifyTerminalInvoice } = useWallet();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const scope = `${network}:${walletId}`;
  const [tab, setTab] = useState<Tab>('today');
  const [selected, setSelected] = useState<{ scope: string; id: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const checkBusy = useRef(false);
  const checkEpoch = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState<LoadState>({ scope, sales: [], loading: true, error: false });
  const loadGeneration = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const selectedKey = useRef('');
  selectedKey.current = selected ? `${selected.scope}:${selected.id}` : '';

  const refresh = useCallback(async (showLoading = true) => {
    const generation = ++loadGeneration.current;
    const capturedScope = scope;
    if (showLoading) setState(previous => ({ scope: capturedScope, sales: previous.scope === capturedScope ? previous.sales : [], loading: true, error: false }));
    try {
      const sales = await listTerminalSales(walletId, network);
      if (generation !== loadGeneration.current || capturedScope !== currentScope.current) return;
      setState({ scope: capturedScope, sales, loading: false, error: false });
    } catch {
      if (generation !== loadGeneration.current || capturedScope !== currentScope.current) return;
      setState({ scope: capturedScope, sales: [], loading: false, error: true });
    }
  }, [scope, walletId, network]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++checkEpoch.current; };
  }, []);

  useEffect(() => {
    if (!visible) { ++loadGeneration.current; return; }
    setNow(Date.now());
    void refresh();
    const unsubscribe = subscribeTerminalSales((changedWallet, changedNetwork) => {
      if (changedWallet === walletId && changedNetwork === network) void refresh(false);
    });
    return () => { ++loadGeneration.current; unsubscribe(); };
  }, [visible, refresh]);

  useEffect(() => { ++checkEpoch.current; setChecking(false); setCheckError(''); checkBusy.current = false; }, [scope, selected?.id, visible]);

  useEffect(() => {
    if (!visible) return;
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(clock);
  }, [visible]);

  const sales = state.scope === scope ? state.sales : [];
  const loading = state.scope !== scope || state.loading;
  const error = state.scope === scope && state.error;
  const day = new Date(now);
  const shown = sales.filter(sale => tab === 'all' || sameLocalDay(saleTime(sale), day))
    .sort((a, b) => saleTime(b) - saleTime(a));
  const paidCount = shown.filter(isPaid).length;
  const totals = totalsFor(shown);
  const detail = selected?.scope === scope ? sales.find(sale => sale.request.id === selected.id) : undefined;
  const back = () => { ++checkEpoch.current; checkBusy.current = false; if (detail) setSelected(null); else onClose(); };
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

  const header = <>
    <View style={styles.heading}>
      <Text style={styles.title}>{detail ? 'Sale details' : tab === 'today' ? 'Today' : 'History'}</Text>
      <Text style={styles.subheading}>{detail ? formatLongDate(saleTime(detail)) : tab === 'today' ? formatDate(now) : 'All sales for this wallet'}</Text>
    </View>
    {!detail ? <>
      <View style={styles.tabs}>
        {(['today', 'all'] as const).map(item => <TouchableOpacity key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} accessibilityLabel={item === 'today' ? 'Today sales' : 'All sales'} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.activeTab]}>
          <Text style={[styles.tabText, tab === item && styles.activeTabText]}>{item === 'today' ? 'Today' : 'All'}</Text>
        </TouchableOpacity>)}
      </View>
      {!error && (!loading || sales.length > 0) ? <View style={styles.summary}>
        <Text style={styles.summaryLabel}>PAID SALES</Text>
        <Text style={styles.paidCount}>{paidCount}</Text>
        <View style={styles.summaryRule} />
        {totals.length ? totals.map(total => <View key={total.label} style={styles.totalRow}><Text style={styles.totalLabel}>{total.label}</Text><Text style={styles.totalAmount}>{total.amount}</Text></View>) : <Text style={styles.noTotals}>No paid sales {tab === 'today' ? 'today' : 'yet'}</Text>}
        {tab === 'today' ? <Text style={styles.summaryNote}>By local verification date</Text> : null}
      </View> : null}
      {!error && (!loading || sales.length > 0) ? <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{tab === 'today' ? 'TODAY’S ACTIVITY' : 'ALL ACTIVITY'}</Text><Text style={styles.sectionCount}>{shown.length}</Text></View> : null}
    </> : null}
  </>;

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.topBar}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={detail ? 'Back to sales' : 'Back to terminal'} onPress={back} style={styles.backButton}>
        <GlassView width={40} height={40} shape="circle" interactive style={styles.glass}><Feather name="arrow-left" size={20} color={theme.colors.primary} /></GlassView>
      </TouchableOpacity>
      <View style={styles.backButton} />
    </View>
    {detail ? <ScrollView contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
      {header}
      <View style={styles.detailCard}>
        <View style={styles.detailStatus}><View style={[styles.statusDot, isPaid(detail) && styles.paidDot]} /><Text style={[styles.statusText, isPaid(detail) && styles.paidText]}>{statusFor(detail, now).label}</Text></View>
        <Text style={styles.detailAmount} adjustsFontSizeToFit numberOfLines={1}>{displayAmount(detail.request)}</Text>
        {detail.request.fiat || detail.request.inputUnit === 'BTC' ? <Text style={styles.detailSats}>{formatTerminalSats(detail.request.amountSats)} sats</Text> : null}
      </View>
      <View style={styles.detailsList}>
        <DetailField label="CREATED" value={formatLongDate(detail.request.createdAt)} styles={styles} />
        {detail.receivedAt ? <DetailField label="VERIFIED" value={formatLongDate(detail.receivedAt)} styles={styles} /> : null}
        <DetailField label="EXPIRES" value={formatLongDate(detail.request.expiresAt)} styles={styles} />
        {detail.paymentId ? <DetailField label="PAYMENT ID" value={detail.paymentId} styles={styles} selectable /> : null}
        <DetailField label="INVOICE" value={detail.request.invoice} styles={styles} selectable />
      </View>
      {!isPaid(detail) ? <View style={styles.checkArea}>
        {checkError ? <Text style={styles.checkError}>{checkError}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Check payment" disabled={checking} style={[styles.checkButton, checking && styles.checkDisabled]} onPress={() => { void checkPayment(); }}><Text style={styles.checkText}>{checking ? 'Checking…' : 'Check payment'}</Text></TouchableOpacity>
      </View> : null}
    </ScrollView> : <FlatList
      data={error ? [] : shown}
      keyExtractor={item => item.request.id}
      ListHeaderComponent={header}
      contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 28 }]}
      refreshControl={<RefreshControl refreshing={loading && state.scope === scope} onRefresh={() => { void refresh(); }} tintColor={theme.colors.bitcoin} />}
      renderItem={({ item }) => {
        const status = statusFor(item, now);
        return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${displayAmount(item.request)}, ${status.label}, ${formatLongDate(saleTime(item))}`} style={styles.saleRow} onPress={() => { ++checkEpoch.current; checkBusy.current = false; setSelected({ scope, id: item.request.id }); }}>
          <View style={[styles.rowIcon, status.tone === 'paid' && styles.paidRowIcon]}><Feather name={status.tone === 'paid' ? 'check' : 'clock'} size={18} color={status.tone === 'paid' ? theme.colors.bitcoin : theme.colors.muted} /></View>
          <View style={styles.rowMiddle}><Text style={styles.rowAmount} numberOfLines={1}>{displayAmount(item.request)}</Text><Text style={styles.rowMeta}>{tab === 'today' ? formatTime(saleTime(item)) : `${formatDate(saleTime(item))} · ${formatTime(saleTime(item))}`}</Text></View>
          <View style={styles.rowEnd}><Text style={[styles.rowStatus, status.tone === 'paid' && styles.paidText]}>{status.label}</Text><Feather name="chevron-right" size={17} color={theme.colors.muted} /></View>
        </TouchableOpacity>;
      }}
      ListEmptyComponent={<View style={styles.empty}>
        {error ? <><Feather name="alert-circle" size={27} color={theme.colors.muted} /><Text style={styles.emptyTitle}>Sales unavailable</Text><Text style={styles.emptyBody}>Couldn’t load saved sales. Try again.</Text><TouchableOpacity accessibilityRole="button" onPress={() => { void refresh(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></>
          : loading ? <Text style={styles.emptyBody}>Loading sales…</Text>
            : <><Feather name="shopping-bag" size={27} color={theme.colors.muted} /><Text style={styles.emptyTitle}>{tab === 'today' ? 'No activity today' : 'No sales yet'}</Text><Text style={styles.emptyBody}>{tab === 'today' ? 'New payment requests will appear here.' : 'Payment requests from this wallet will appear here.'}</Text></>}
      </View>}
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
    topBar: { height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backButton: { width: 40, height: 40 },
    glass: { overflow: 'visible' },
    heading: { paddingHorizontal: 24, paddingTop: 30, paddingBottom: 25 },
    title: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 42 },
    subheading: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 13, marginTop: 5 },
    tabs: { flexDirection: 'row', marginHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 28 },
    tab: { paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
    activeTab: { borderBottomColor: colors.bitcoin },
    tabText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    activeTabText: { color: colors.primary },
    summary: { marginHorizontal: 24, marginTop: 26, padding: 22, borderRadius: 18, backgroundColor: colors.surface },
    summaryLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.5 },
    paidCount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 48, marginTop: 3 },
    summaryRule: { height: 1, backgroundColor: colors.border, marginTop: 10, marginBottom: 12 },
    totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingVertical: 4, gap: 12 },
    totalLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
    totalAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 16, flexShrink: 1, textAlign: 'right' },
    noTotals: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    summaryNote: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10, marginTop: 12 },
    sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 24, marginTop: 35, marginBottom: 9 },
    sectionTitle: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.5 },
    sectionCount: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 11 },
    listContent: { flexGrow: 1 },
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
    detailContent: { paddingBottom: 28 },
    detailCard: { marginHorizontal: 24, padding: 24, backgroundColor: colors.surface, borderRadius: 18 },
    detailStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted },
    paidDot: { backgroundColor: colors.bitcoin },
    statusText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    detailAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 31, marginTop: 22 },
    detailSats: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 8 },
    detailsList: { marginHorizontal: 24, marginTop: 24 },
    detailField: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    fieldLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.2 },
    fieldValue: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 20, marginTop: 9 },
    checkArea: { marginHorizontal: 24, marginTop: 24, alignItems: 'center' },
    checkError: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19, textAlign: 'center', marginBottom: 12 },
    checkButton: { backgroundColor: colors.primary, borderRadius: 8, minHeight: 52, width: '100%', alignItems: 'center', justifyContent: 'center' },
    checkDisabled: { opacity: 0.6 },
    checkText: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
  });
}

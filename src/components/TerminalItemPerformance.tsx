import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { TerminalRange, TerminalSalesSummary } from '../services/terminalSales';
import { formatTerminalItemGross, getTerminalItemPerformance } from '../services/terminalItemPerformance';

type Props = {
  walletId: string;
  network: TerminalNetwork;
  scope: string;
  range: TerminalRange;
  visible: boolean;
  currentSummary?: TerminalSalesSummary;
  currentRefunds?: bigint;
  revision?: number;
  showRefundNote?: boolean;
};

type Result = Awaited<ReturnType<typeof getTerminalItemPerformance>>;
type State =
  | { identity: string; status: 'loading' | 'error'; result: null }
  | { identity: string; status: 'ready'; result: Result };

const quantity = (value: bigint) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export default function TerminalItemPerformance({ walletId, network, scope, range, visible, currentSummary, currentRefunds = 0n, revision = 0, showRefundNote }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const mounted = useRef(true);
  const generation = useRef(0);
  const currentInput = useRef({ summary: currentSummary, refunds: currentRefunds, revision: 0 });
  if (currentInput.current.summary !== currentSummary || currentInput.current.refunds !== currentRefunds) {
    currentInput.current = { summary: currentSummary, refunds: currentRefunds, revision: currentInput.current.revision + 1 };
  }
  const rangeKey = range ? `${range.start}:${range.end}` : 'all';
  const identity = `${scope}:${rangeKey}:${currentInput.current.revision}:${revision}`;
  const [state, setState] = useState<State>({ identity, status: 'loading', result: null });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current; };
  }, []);

  const load = useCallback(async () => {
    if (!visible || currentSummary?.receivedCount === 0) return;
    const request = ++generation.current;
    setState(previous => previous.identity === identity && previous.status === 'loading' ? previous : { identity, status: 'loading', result: null });
    try {
      const result = await getTerminalItemPerformance(walletId, network, range);
      if (mounted.current && request === generation.current) setState({ identity, status: 'ready', result });
    } catch {
      if (mounted.current && request === generation.current) setState({ identity, status: 'error', result: null });
    }
  }, [identity, walletId, network, range, visible, currentSummary]);

  useEffect(() => {
    if (visible && currentSummary?.receivedCount !== 0) void load();
    return () => { ++generation.current; };
  }, [load, visible, currentSummary?.receivedCount]);

  if (!visible || currentSummary?.receivedCount === 0) return null;
  const result = state.identity === identity && state.status === 'ready' ? state.result : null;
  const loading = state.identity !== identity || state.status === 'loading';
  const error = state.identity === identity && state.status === 'error';

  return <View style={styles.root} accessibilityLabel="Top items">
    <View style={styles.headingRow}>
      <Text style={styles.heading}>TOP ITEMS</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading top items" size="small" color={theme.colors.bitcoin} /> : null}
    </View>
    <Text style={styles.caption}>{result?.hasMore ? 'Top 5 by quantity · gross sales' : 'By quantity · gross sales'}</Text>
    {error ? <View style={styles.errorRow}>
      <Text style={styles.note}>Item performance unavailable</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry top items" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
    </View> : null}
    {result ? <>
      {result.items.length ? result.items.slice(0, 5).map(item => <View key={`${item.itemId}:${item.unit}`} style={styles.row} accessibilityLabel={`${item.name}, quantity ${quantity(item.quantity)}, gross ${formatTerminalItemGross(item.gross, item.unit)}`}>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.quantity}>× {quantity(item.quantity)}</Text>
        <Text style={styles.gross}>{formatTerminalItemGross(item.gross, item.unit)}</Text>
      </View>) : <Text style={styles.empty}>No item sales in this period</Text>}
      {showRefundNote === true || (showRefundNote === undefined && currentRefunds > 0n) ? <Text style={styles.note}>Refunds aren’t assigned to items.</Text> : null}
      {result.paidWithoutItems > 0 ? <Text style={styles.note}>{result.paidWithoutItems} paid {result.paidWithoutItems === 1 ? 'sale' : 'sales'} without item details excluded</Text> : null}
    </> : null}
  </View>;
}

function makeStyles(colors: { primary: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { marginHorizontal: 24, marginTop: 30 },
    headingRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    heading: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.5 },
    caption: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10, marginTop: 2, marginBottom: 8 },
    row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
    name: { flex: 1, color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 17 },
    quantity: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10 },
    gross: { minWidth: 72, maxWidth: 110, color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 11, textAlign: 'right' },
    empty: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 11, paddingVertical: 12 },
    note: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 9, lineHeight: 15, marginTop: 6 },
    errorRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 10 },
  });
}

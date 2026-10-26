import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { TerminalSalesSummary } from '../services/terminalSales';
import { getTerminalSalesComparison, terminalComparisonRows } from '../services/terminalSalesComparison';

type Range = { start: number; end: number; shorter: boolean };
type Props = {
  walletId: string;
  network: TerminalNetwork;
  scope: string;
  periodDay: Date;
  currentRange: { start: number; end: number };
  previousRange: Range;
  currentSummary: TerminalSalesSummary;
  currentRefunds: bigint;
};

type State =
  | { identity: string; status: 'loading' | 'error'; result: null }
  | { identity: string; status: 'ready'; result: Awaited<ReturnType<typeof getTerminalSalesComparison>> };

const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function TerminalPeriodComparison({ walletId, network, scope, periodDay, currentRange, previousRange, currentSummary, currentRefunds }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const generation = useRef(0);
  const mounted = useRef(true);
  const currentInput = useRef({ summary: currentSummary, refunds: currentRefunds, revision: 0 });
  if (currentInput.current.summary !== currentSummary || currentInput.current.refunds !== currentRefunds) {
    currentInput.current = { summary: currentSummary, refunds: currentRefunds, revision: currentInput.current.revision + 1 };
  }
  const identity = `${scope}:${currentRange.start}:${currentRange.end}:${previousRange.start}:${previousRange.end}:${currentInput.current.revision}`;
  const [state, setState] = useState<State>({ identity, status: 'loading', result: null });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; ++generation.current; };
  }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setState(previous => previous.identity === identity && previous.status === 'loading' ? previous : { identity, status: 'loading', result: null });
    try {
      const result = await getTerminalSalesComparison(walletId, network, previousRange);
      if (mounted.current && request === generation.current) setState({ identity, status: 'ready', result });
    } catch {
      if (mounted.current && request === generation.current) setState({ identity, status: 'error', result: null });
    }
  }, [identity, walletId, network, previousRange, currentSummary, currentRefunds]);

  useEffect(() => { void load(); return () => { ++generation.current; }; }, [load]);

  const result = state.identity === identity && state.status === 'ready' ? state.result : null;
  const loading = state.identity !== identity || state.status === 'loading';
  const rows = result ? terminalComparisonRows(currentSummary, currentRefunds, result.summary, result.refundedSats) : [];
  const nextDay = new Date(periodDay.getFullYear(), periodDay.getMonth(), periodDay.getDate() + 1).getTime();
  const inProgress = currentRange.end === nextDay;

  return <View style={styles.root} accessibilityLabel="Period comparison">
    <View style={styles.headingRow}>
      <Text style={styles.heading}>Compared with {formatDate(previousRange.start)}{formatDate(previousRange.start) !== formatDate(previousRange.end - 1) ? ` – ${formatDate(previousRange.end - 1)}` : ''}</Text>
      {loading ? <ActivityIndicator accessibilityLabel="Loading period comparison" size="small" color={theme.colors.bitcoin} /> : null}
    </View>
    {state.identity === identity && state.status === 'error' ? <View style={styles.errorRow}>
      <Text style={styles.errorText}>Comparison unavailable</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry period comparison" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
    </View> : null}
    {result ? <>
      <View style={styles.columns}><Text style={styles.columnLabel}>Previous</Text><Text style={styles.columnChange}>Change</Text></View>
      {rows.map(row => <View key={row.key} style={styles.row} accessibilityLabel={`${row.label}, previous ${row.previous}, change ${row.change}`}>
        <Text style={styles.label}>{row.label.toUpperCase()}</Text>
        <Text style={styles.previous}>{row.previous}</Text>
        <Text style={styles.change}>{row.change}</Text>
      </View>)}
      {inProgress ? <Text style={styles.note}>Current period in progress</Text> : null}
      {previousRange.shorter ? <Text style={styles.note}>Previous period has fewer days</Text> : null}
    </> : null}
  </View>;
}

function makeStyles(colors: { primary: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 14 },
    headingRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    heading: { flex: 1, color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10, lineHeight: 16 },
    columns: { flexDirection: 'row', marginTop: 9, paddingLeft: 82 },
    columnLabel: { flex: 1, color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 8, letterSpacing: 0.8, textAlign: 'right' },
    columnChange: { width: 94, color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 8, letterSpacing: 0.8, textAlign: 'right' },
    row: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 8 },
    label: { width: 74, color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 9 },
    previous: { flex: 1, color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 10, textAlign: 'right' },
    change: { width: 94, color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, textAlign: 'right' },
    note: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 9, lineHeight: 15, marginTop: 5 },
    errorRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 5 },
    errorText: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10 },
    retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 10 },
  });
}

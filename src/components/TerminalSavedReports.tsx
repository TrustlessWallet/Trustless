import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalNetwork } from '../services/terminal';
import { listTerminalReportPresets, removeTerminalReportPreset, reportPresetKey, saveTerminalReportPreset, TerminalReportPreset } from '../services/terminalReportPresets';
import { parseSalesDate } from '../services/terminalSalesPeriod';

type Props = { walletId: string; network: TerminalNetwork; current: TerminalReportPreset; visible: boolean; onApply: (preset: TerminalReportPreset) => void };
const periodNames = { today: 'Today', week: '7 days', month: 'Month', all: 'All dates', custom: 'Custom' };
function title(preset: TerminalReportPreset) {
  const date = (value: string) => parseSalesDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const period = preset.period === 'custom' && preset.customRange ? `${date(preset.customRange.startDate)} – ${date(preset.customRange.endDate)}` : periodNames[preset.period];
  return `${period} · ${preset.tab === 'items' ? 'Items' : 'Overview'}`;
}
const details = (preset: TerminalReportPreset) => preset.tab === 'items' ? `${preset.unit ?? 'All currencies'} · ${preset.sort === 'gross' ? 'Sales amount' : 'Quantity'}` : '';

export default function TerminalSavedReports({ walletId, network, current, visible, onApply }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const scope = `${network}:${walletId}`;
  const context = useRef({ scope, visible, epoch: 0 });
  if (context.current.scope !== scope || context.current.visible !== visible) context.current = { scope, visible, epoch: context.current.epoch + 1 };
  const mounted = useRef(true);
  const request = useRef(0);
  const mutation = useRef(false);
  const [state, setState] = useState<{ scope: string; ready: boolean; entries: TerminalReportPreset[]; error: string; busy: boolean }>({ scope, ready: false, entries: [], error: '', busy: false });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current; }; }, []);
  const load = useCallback(async () => {
    if (!visible) return;
    const epoch = context.current.epoch, id = ++request.current;
    try {
      const entries = await listTerminalReportPresets(walletId, network);
      if (mounted.current && context.current.epoch === epoch && id === request.current) setState({ scope, ready: true, entries, error: '', busy: false });
    } catch {
      if (mounted.current && context.current.epoch === epoch && id === request.current) setState({ scope, ready: false, entries: [], error: 'Saved reports unavailable.', busy: false });
    }
  }, [walletId, network, scope, visible]);
  useEffect(() => { void load(); return () => { ++request.current; }; }, [load]);
  const active = state.scope === scope ? state : { scope, ready: false, entries: [], error: '', busy: false };
  const key = reportPresetKey(current);
  const saved = active.entries.some(entry => reportPresetKey(entry) === key);
  const change = async (remove?: TerminalReportPreset) => {
    if (!visible || !active.ready || mutation.current) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.visible && context.current.epoch === epoch;
    mutation.current = true;
    ++request.current;
    setState(previous => ({ ...previous, busy: true, error: '' }));
    try {
      const entries = remove ? await removeTerminalReportPreset(walletId, network, remove, isCurrent) : await saveTerminalReportPreset(walletId, network, current, isCurrent);
      if (isCurrent()) setState({ scope, ready: true, entries, error: '', busy: false });
    } catch (error) {
      if (isCurrent()) setState(previous => ({ ...previous, busy: false, error: error instanceof Error && error.message === 'Report preset limit reached.' ? 'Save up to 10 reports. Remove one to save another.' : `Couldn’t ${remove ? 'remove' : 'save'} report. Try again.` }));
    } finally { mutation.current = false; }
  };
  return <View style={styles.root}>
    <View style={styles.bar}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Saved reports" accessibilityState={{ expanded, disabled: !visible || !active.entries.length }} disabled={!visible || !active.entries.length} onPress={() => setExpanded(value => !value)} style={styles.open}>
        <Text style={styles.label}>Saved reports{active.ready && active.entries.length ? ` · ${active.entries.length}` : ''}</Text>
        {active.entries.length ? <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={theme.colors.muted} /> : null}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={saved ? 'Report saved' : 'Save current report'} accessibilityState={{ disabled: !visible || !active.ready || active.busy || saved }} disabled={!visible || !active.ready || active.busy || saved} onPress={() => { void change(); }} style={styles.save}>
        {active.busy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Feather name={saved ? 'check' : 'bookmark'} size={16} color={saved ? theme.colors.muted : theme.colors.primary} />}
        <Text style={[styles.saveText, saved && { color: theme.colors.muted }]}>{saved ? 'Saved' : 'Save'}</Text>
      </TouchableOpacity>
    </View>
    {active.error ? <View style={styles.error}><Text accessibilityRole="alert" style={[styles.note, styles.errorText]}>{active.error}</Text>{!active.ready ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry saved reports" onPress={() => { void load(); }} disabled={!visible} style={styles.retry}><Text style={styles.saveText}>Retry</Text></TouchableOpacity> : null}</View> : null}
    {expanded && active.ready ? active.entries.map(entry => { const identity = reportPresetKey(entry), selected = key === identity; return <View key={identity} style={styles.row}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open saved report ${title(entry)}${details(entry) ? ` · ${details(entry)}` : ''}`} accessibilityState={{ selected, disabled: !visible }} disabled={!visible} onPress={() => { onApply(entry); setExpanded(false); }} style={styles.entry}>
        <Text style={[styles.entryTitle, selected && styles.selected]}>{title(entry)}</Text>{details(entry) ? <Text style={styles.note}>{details(entry)}</Text> : null}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove saved report ${title(entry)}${details(entry) ? ` · ${details(entry)}` : ''}`} disabled={!visible || active.busy} onPress={() => { void change(entry); }} style={styles.remove}><Feather name="x" size={17} color={theme.colors.muted} /></TouchableOpacity>
    </View>; }) : null}
  </View>;
}
function makeStyles(colors: { primary: string; muted: string; border: string }) {
  return StyleSheet.create({
    root: { marginHorizontal: 24, borderBottomWidth: 1, borderBottomColor: colors.border },
    bar: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 },
    open: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
    label: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    save: { minWidth: 76, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
    saveText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    entry: { flex: 1, minHeight: 52, justifyContent: 'center', paddingVertical: 10, gap: 4 },
    entryTitle: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19 },
    selected: { fontFamily: 'SpaceMono-Bold' },
    note: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 18 },
    remove: { minWidth: 44, minHeight: 48, alignItems: 'flex-end', justifyContent: 'center' },
    error: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, gap: 8 },
    errorText: { flex: 1 },
    retry: { minHeight: 44, justifyContent: 'center' },
  });
}

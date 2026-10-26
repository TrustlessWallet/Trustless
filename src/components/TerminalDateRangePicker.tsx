import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';

export type TerminalDateRangeDraft = { startDate: string; endDate: string };

type Props = {
  value: TerminalDateRangeDraft;
  today: Date;
  onChange: (value: TerminalDateRangeDraft) => void;
  onApply: () => void;
  onCancel: () => void;
};

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const parseKey = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const shortDate = (value: string) => parseKey(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function TerminalDateRangePicker({ value, today, onChange, onApply, onCancel }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const [selecting, setSelecting] = useState<'startDate' | 'endDate'>('startDate');
  const initial = parseKey(value.startDate);
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const todayKey = dateKey(today);
  const invalid = value.startDate > value.endDate;
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const firstOffset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((firstOffset + days) / 7) * 7 }, (_, index) => {
    const day = index - firstOffset + 1;
    return day > 0 && day <= days ? day : null;
  });
  const canPrevious = month.getFullYear() > 1970 || month.getMonth() > 0;
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const canNext = month.getTime() < currentMonth.getTime();
  const moveMonth = (amount: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + amount, 1));

  return <View style={styles.root} accessibilityLabel="Custom date range editor">
    <View style={styles.selectors}>
      {(['startDate', 'endDate'] as const).map(key => <TouchableOpacity
        key={key}
        accessibilityRole="button"
        accessibilityLabel={`${key === 'startDate' ? 'From' : 'To'} ${shortDate(value[key])}`}
        onPress={() => { setSelecting(key); setMonth(new Date(parseKey(value[key]).getFullYear(), parseKey(value[key]).getMonth(), 1)); }}
        style={[styles.selector, selecting === key && styles.activeSelector]}
      >
        <Text style={styles.selectorLabel}>{key === 'startDate' ? 'FROM' : 'TO'}</Text>
        <Text style={styles.selectorValue} numberOfLines={1}>{shortDate(value[key])}</Text>
      </TouchableOpacity>)}
    </View>
    <View style={styles.monthHeader}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" disabled={!canPrevious} onPress={() => moveMonth(-1)} style={[styles.arrow, !canPrevious && styles.disabled]}>
        <Feather name="chevron-left" size={18} color={theme.colors.primary} />
      </TouchableOpacity>
      <Text style={styles.monthLabel}>{monthLabel}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" disabled={!canNext} onPress={() => moveMonth(1)} style={[styles.arrow, !canNext && styles.disabled]}>
        <Feather name="chevron-right" size={18} color={theme.colors.primary} />
      </TouchableOpacity>
    </View>
    <View style={styles.weekRow}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={`${label}-${index}`} style={styles.weekday}>{label}</Text>)}</View>
    <View style={styles.grid}>{cells.map((day, index) => {
      if (day === null) return <View key={`blank-${index}`} style={styles.cell} />;
      const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
      const chosen = key === value.startDate || key === value.endDate;
      const inRange = key >= value.startDate && key <= value.endDate;
      const disabled = key > todayKey;
      return <TouchableOpacity key={key} accessibilityRole="button" accessibilityLabel={parseKey(key).toLocaleDateString()} accessibilityState={{ selected: chosen, disabled }} disabled={disabled} style={[styles.cell, inRange && styles.rangeCell, chosen && styles.chosenCell]} onPress={() => {
        onChange({ ...value, [selecting]: key });
        if (selecting === 'startDate') setSelecting('endDate');
      }}><Text style={[styles.day, chosen && styles.chosenDay, disabled && styles.disabledDay]}>{day}</Text></TouchableOpacity>;
    })}</View>
    {invalid ? <Text style={styles.error}>From date must be on or before To date.</Text> : null}
    <View style={styles.actions}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel custom date range" onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Apply custom date range" accessibilityState={{ disabled: invalid }} disabled={invalid} onPress={onApply} style={[styles.apply, invalid && styles.disabled]}><Text style={styles.applyText}>Apply</Text></TouchableOpacity>
    </View>
  </View>;
}

function makeStyles(colors: { primary: string; inversePrimary: string; surface: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { marginHorizontal: 24, marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: colors.surface },
    selectors: { flexDirection: 'row', gap: 8 },
    selector: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, justifyContent: 'center' },
    activeSelector: { borderColor: colors.bitcoin },
    selectorLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 9, letterSpacing: 1 },
    selectorValue: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 11, marginTop: 2 },
    monthHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
    arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    monthLabel: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    weekRow: { flexDirection: 'row' },
    weekday: { width: '14.2857%', textAlign: 'center', color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 9, paddingVertical: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    cell: { width: '14.2857%', height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    rangeCell: { backgroundColor: colors.border },
    chosenCell: { backgroundColor: colors.primary },
    day: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 11 },
    chosenDay: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold' },
    disabledDay: { color: colors.muted, opacity: 0.45 },
    error: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 10, lineHeight: 16, marginTop: 6 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
    cancel: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
    cancelText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    apply: { flex: 1, minHeight: 44, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    applyText: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    disabled: { opacity: 0.45 },
  });
}

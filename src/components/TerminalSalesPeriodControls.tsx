import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { CustomSalesDateRange, SalesPeriod, terminalSalesPeriodBounds } from '../services/terminalSalesPeriod';
import TerminalDateRangePicker from './TerminalDateRangePicker';

export type Props = {
  period: SalesPeriod;
  customRange: CustomSalesDateRange | null;
  draft: CustomSalesDateRange | null;
  day: Date;
  onSelect: (period: SalesPeriod) => void;
  onDraftChange: (draft: CustomSalesDateRange) => void;
  onApply: () => void;
  onCancel: () => void;
  disabled?: boolean;
  detailCaption?: string;
};

const periods: { value: SalesPeriod; title: string; label: string }[] = [
  { value: 'today', title: 'Today', label: 'Today sales' },
  { value: 'week', title: '7 days', label: 'Last 7 days sales' },
  { value: 'month', title: 'Month', label: 'This month sales' },
  { value: 'all', title: 'All', label: 'All sales' },
  { value: 'custom', title: 'Custom', label: 'Custom sales range' },
];
const formatDate = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function TerminalSalesPeriodControls({ period, customRange, draft, day, onSelect, onDraftChange, onApply, onCancel, disabled = false, detailCaption }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const bounds = terminalSalesPeriodBounds(period, day, customRange ?? undefined);
  const caption = detailCaption ?? (period === 'all' ? 'All sales for this wallet' : period === 'today' ? formatDate(day.getTime()) : `${formatDate(bounds!.start)} – ${formatDate(bounds!.end - 1)}`);

  return <>
    <View style={styles.tabs}>
      {periods.map(item => <TouchableOpacity key={item.value} accessibilityRole={item.value === 'custom' ? 'button' : 'tab'} accessibilityState={{ selected: period === item.value, disabled, ...(item.value === 'custom' ? { expanded: !!draft } : {}) }} accessibilityLabel={item.label} disabled={disabled} onPress={() => onSelect(item.value)} style={[styles.tab, item.value === 'custom' && styles.customTab, item.value !== 'custom' && period === item.value && styles.activeTab]}>
        {item.value === 'custom' ? <View style={[styles.customControl, (period === 'custom' || !!draft) && styles.customControlActive]}>
          <Feather name="calendar" size={13} color={period === 'custom' || draft ? theme.colors.primary : theme.colors.muted} />
          <Text style={[styles.customText, (period === 'custom' || !!draft) && styles.activeText]}>{item.title}</Text>
        </View> : <Text style={[styles.tabText, period === item.value && styles.activeText]}>{item.title}</Text>}
      </TouchableOpacity>)}
    </View>
    {detailCaption ? <View style={styles.caption}><Text style={styles.captionText}>{detailCaption}</Text></View> : draft ? <TerminalDateRangePicker value={{ ...draft }} today={day} onChange={onDraftChange} onApply={onApply} onCancel={onCancel} />
      : period === 'custom' && customRange ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit custom date range" disabled={disabled} onPress={() => onSelect('custom')} style={styles.customRangeRow}><Text style={styles.customRangeText}>{caption}</Text><Feather name="calendar" size={16} color={theme.colors.muted} /></TouchableOpacity>
        : <View style={styles.caption}><Text style={styles.captionText}>{caption}</Text></View>}
  </>;
}

function makeStyles(colors: { primary: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    tabs: { flexDirection: 'row', marginHorizontal: 24, marginTop: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    tab: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 2, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
    customTab: { flex: 1.35, paddingVertical: 5 },
    customControl: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
    customControlActive: { borderColor: colors.bitcoin },
    customText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
    tabText: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    activeTab: { borderBottomColor: colors.bitcoin },
    activeText: { color: colors.primary },
    caption: { paddingHorizontal: 24, paddingTop: 16 },
    captionText: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 13 },
    customRangeRow: { minHeight: 44, marginHorizontal: 24, marginTop: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    customRangeText: { flex: 1, color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 11 },
  });
}

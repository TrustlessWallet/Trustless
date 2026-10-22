import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { formatTerminalBasketAmount, TerminalBasketLine, TerminalUnit } from '../services/terminal';
import { TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = {
  catalog: TerminalItem[];
  lines: TerminalBasketLine[];
  unit: TerminalUnit;
  busy: boolean;
  onAdd: (item: TerminalItem) => void;
  onRemoveOne: (line: TerminalBasketLine) => void;
  onRemove: (line: TerminalBasketLine) => void;
  onClose: () => void;
};

export default function TerminalQuickItemsScreen({ catalog, lines, unit, busy, onAdd, onRemoveOne, onRemove, onClose }: Props) {
  const { theme } = useTheme();
  const basketUnit = lines.length ? unit : null;
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader title="Items" closeLabel="Close item picker" onClose={onClose} />
    <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={styles.list}>
      {catalog.map(item => {
        const selected = lines.find(line => line.itemId === item.id);
        const unavailable = !!basketUnit && item.unit !== basketUnit;
        return <View key={item.id} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
          <View style={styles.info}>
            <Text style={[styles.name, { color: unavailable ? theme.colors.muted : theme.colors.primary }]} numberOfLines={1}>{selected?.name ?? item.name}</Text>
            <Text style={[styles.price, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(selected?.unitPrice ?? item.unitPrice, selected ? unit : item.unit)}{selected ? ` · ${formatTerminalBasketAmount(selected.total, unit)}` : ''}</Text>
          </View>
          {selected ? <>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onRemove(selected)}><Feather name="x" size={16} color={theme.colors.primary} /></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onRemoveOne(selected)}><Text style={[styles.symbol, { color: theme.colors.primary }]}>−</Text></TouchableOpacity>
            <Text style={[styles.quantity, { color: theme.colors.primary }]}>{selected.quantity}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onAdd(item)}><Text style={[styles.symbol, { color: theme.colors.primary }]}>+</Text></TouchableOpacity>
          </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} accessibilityState={{ disabled: unavailable || busy }} disabled={unavailable || busy} style={styles.control} onPress={() => onAdd(item)}><Feather name="plus" size={20} color={unavailable ? theme.colors.muted : theme.colors.primary} /></TouchableOpacity>}
        </View>;
      })}
      {lines.filter(line => !catalog.some(item => item.id === line.itemId)).map(line => <View key={line.itemId} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
        <View style={styles.info}><Text style={[styles.name, { color: theme.colors.primary }]} numberOfLines={1}>{line.name}</Text><Text style={[styles.price, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(line.unitPrice, unit)} · {formatTerminalBasketAmount(line.total, unit)}</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${line.name}`} disabled={busy} style={styles.control} onPress={() => onRemove(line)}><Feather name="x" size={16} color={theme.colors.primary} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove one ${line.name}`} disabled={busy} style={styles.control} onPress={() => onRemoveOne(line)}><Text style={[styles.symbol, { color: theme.colors.primary }]}>−</Text></TouchableOpacity>
        <Text style={[styles.quantity, { color: theme.colors.primary }]}>{line.quantity}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add one ${line.name}`} disabled={busy} style={styles.control} onPress={() => onAdd({ id: line.itemId, name: line.name, unit, unitPrice: line.unitPrice })}><Text style={[styles.symbol, { color: theme.colors.primary }]}>+</Text></TouchableOpacity>
      </View>)}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }, row: { height: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  info: { flex: 1 }, name: { fontSize: 14 }, price: { fontSize: 11, marginTop: 5 }, control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  symbol: { fontSize: 19 }, quantity: { fontSize: 15, minWidth: 20, textAlign: 'center' },
});

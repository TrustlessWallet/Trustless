import React, { useMemo } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { formatTerminalBasketAmount, TerminalBasketLine, TerminalUnit } from '../services/terminal';
import { TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = {
  error?: string;
  catalog: TerminalItem[];
  lines: TerminalBasketLine[];
  unit: TerminalUnit;
  busy: boolean;
  onAdd: (item: TerminalItem) => void;
  onRemoveOne: (line: TerminalBasketLine) => void;
  onClose: () => void;
};

export default function TerminalQuickItemsScreen({ error = '', catalog, lines, unit, busy, onAdd, onRemoveOne, onClose }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  // Fixed iOS form-sheet detents otherwise inherit the list’s intrinsic height.
  const sheetHeight = Math.max(0, (height - insets.top) * 0.5);
  const basketUnit = lines.length ? unit : null;
  const selectedById = useMemo(() => new Map(lines.map(line => [line.itemId, line])), [lines]);
  const rows = useMemo(() => {
    const ids = new Set(catalog.map(item => item.id));
    return [...catalog, ...lines.filter(line => !ids.has(line.itemId)).map(line => ({ id: line.itemId, name: line.name, unit, unitPrice: line.unitPrice }))];
  }, [catalog, lines, unit]);
  return <View style={[styles.root, { height: sheetHeight, backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader title="Items" closeLabel="Close item picker" onClose={onClose} />
    {/* A native wrapper keeps react-native-screens from misplacing this list in an iOS formSheet. */}
    <View collapsable={false} style={styles.scrollContainer}>
      <FlatList data={rows} keyExtractor={item => item.id} extraData={{ lines, unit, busy }} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.list, { paddingBottom: Math.max(12, insets.bottom) }]}
        renderItem={({ item }) => {
          const selected = selectedById.get(item.id);
          const unavailable = !selected && !!basketUnit && item.unit !== basketUnit;
          return <View key={item.id} style={[styles.row, { borderBottomColor: theme.colors.border }]}>
            <View style={styles.info}>
              <Text style={[styles.name, { color: unavailable ? theme.colors.muted : theme.colors.primary }]} numberOfLines={1}>{selected?.name ?? item.name}</Text>
              <Text style={[styles.price, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(selected?.unitPrice ?? item.unitPrice, selected ? unit : item.unit)}{selected ? ` · ${formatTerminalBasketAmount(selected.total, unit)}` : ''}</Text>
            </View>
            {selected ? <>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onRemoveOne(selected)}><Feather name="minus" size={20} color={theme.colors.primary} /></TouchableOpacity>
              <Text style={[styles.quantity, { color: theme.colors.primary }]}>{selected.quantity}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onAdd({ id: selected.itemId, name: selected.name, unit, unitPrice: selected.unitPrice })}><Feather name="plus" size={20} color={theme.colors.primary} /></TouchableOpacity>
            </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} accessibilityState={{ disabled: unavailable || busy }} disabled={unavailable || busy} style={styles.control} onPress={() => onAdd(item)}><Feather name="plus" size={20} color={unavailable ? theme.colors.muted : theme.colors.primary} /></TouchableOpacity>}
          </View>;
        }}
      />
    </View>
    {error ? <View style={[styles.feedback, { paddingBottom: Math.max(12, insets.bottom) }]}><Text accessibilityRole="alert" style={[styles.feedbackText, { color: theme.colors.muted }]}>{error}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flexShrink: 0 },
  feedback: { paddingHorizontal: 24, paddingTop: 12, justifyContent: 'center' }, feedbackText: { fontSize: 12, lineHeight: 18 },
  scrollContainer: { flex: 1, minHeight: 0 }, scroll: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 24 }, row: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  info: { flex: 1, minWidth: 0, paddingRight: 8 }, name: { fontSize: 14, lineHeight: 20 }, price: { fontSize: 12, lineHeight: 18, marginTop: 4 }, control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  quantity: { fontSize: 15, minWidth: 20, textAlign: 'center' },
});

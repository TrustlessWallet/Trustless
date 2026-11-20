import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import SmallNativeSheetOutline from '../components/SmallNativeSheetOutline';
import { useTheme } from '../contexts/ThemeContext';
import { formatTerminalBasketAmount, TerminalBasketLine, TerminalUnit } from '../services/terminal';
import { TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = {
  error?: string;
  catalog: TerminalItem[];
  catalogPending?: boolean;
  onCreate?: () => void;
  onRetry?: () => void;
  lines: TerminalBasketLine[];
  unit: TerminalUnit;
  busy: boolean;
  onAdd: (item: TerminalItem) => void;
  onRemoveOne: (line: TerminalBasketLine) => void;
  onClose: () => void;
};

export default function TerminalQuickItemsScreen({ error = '', catalog, catalogPending, onCreate, onRetry, lines, unit, busy, onAdd, onRemoveOne, onClose }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stackControls = fontScale >= 1.4 || width < 350;
  const basketUnit = lines.length ? unit : null;
  const selectedById = useMemo(() => new Map(lines.map(line => [line.itemId, line])), [lines]);
  const rows = useMemo(() => {
    const ids = new Set(catalog.map(item => item.id));
    return [...catalog, ...lines.filter(line => !ids.has(line.itemId)).map(line => ({ id: line.itemId, name: line.name, unit, unitPrice: line.unitPrice }))];
  }, [catalog, lines, unit]);
  const showCreate = rows.length === 0 && !onRetry && !catalogPending && !!onCreate;
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader smallNativeSheet title="Items" closeLabel="Close item picker" onClose={onClose} />
    {/* A native wrapper keeps react-native-screens from misplacing this list in an iOS formSheet. */}
    <View collapsable={false} style={styles.scrollContainer}>
      {showCreate ? <ScrollView contentContainerStyle={styles.emptySetup} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} bounces={false}>
        <View style={styles.emptyMessage}>
          <Text style={[styles.emptyTitle, { color: theme.colors.muted }]}>No items yet</Text>
        </View>
        <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onCreate} style={[styles.create, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '700' }}>Add the first item</Text>
          </TouchableOpacity>
          <Text style={[styles.hint, { color: theme.colors.muted }]}>You can add more items in Terminal settings</Text>
        </View>
      </ScrollView> : <FlatList data={rows} keyExtractor={item => item.id} extraData={{ lines, unit, busy, stackControls }} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5} style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.list, !rows.length && styles.emptyList, { paddingBottom: rows.length ? Math.max(12, insets.bottom) : 0 }]}
        ListEmptyComponent={onRetry ? <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={styles.control}><Text>Items unavailable · Retry</Text></TouchableOpacity>
          : catalogPending ? <ActivityIndicator accessibilityLabel="Loading items" color={theme.colors.bitcoin} />
          : <Text style={[styles.emptyTitle, { color: theme.colors.muted }]}>No items yet</Text>}
        renderItem={({ item }) => {
          const selected = selectedById.get(item.id);
          const unavailable = !selected && !!basketUnit && item.unit !== basketUnit;
          return <View key={item.id} style={[styles.row, stackControls && styles.stackedRow, { borderBottomColor: theme.colors.border }]}>
            <View style={[styles.info, stackControls && styles.stackedInfo]}>
              <Text allowFontScaling maxFontSizeMultiplier={2} style={[styles.name, { color: unavailable ? theme.colors.muted : theme.colors.primary }]} numberOfLines={stackControls ? undefined : 2}>{selected?.name ?? item.name}</Text>
              <Text allowFontScaling maxFontSizeMultiplier={2} style={[styles.price, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(selected?.unitPrice ?? item.unitPrice, selected ? unit : item.unit)}{selected ? ` · ${formatTerminalBasketAmount(selected.total, unit)}` : ''}</Text>
            </View>
            <View style={styles.controls}>{selected ? <>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onRemoveOne(selected)}><Feather name="minus" size={20} color={theme.colors.primary} /></TouchableOpacity>
              <Text allowFontScaling maxFontSizeMultiplier={2} style={[styles.quantity, { color: theme.colors.primary }]}>{selected.quantity}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add one ${selected.name}`} disabled={busy} style={styles.control} onPress={() => onAdd({ id: selected.itemId, name: selected.name, unit, unitPrice: selected.unitPrice })}><Feather name="plus" size={20} color={theme.colors.primary} /></TouchableOpacity>
            </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Add ${item.name}`} accessibilityState={{ disabled: unavailable || busy }} disabled={unavailable || busy} style={styles.control} onPress={() => onAdd(item)}><Feather name="plus" size={20} color={unavailable ? theme.colors.muted : theme.colors.primary} /></TouchableOpacity>}</View>
          </View>;
        }}
      />}
    </View>
    {error ? <View style={[styles.feedback, { paddingBottom: Math.max(12, insets.bottom) }]}><Text accessibilityRole="alert" allowFontScaling maxFontSizeMultiplier={2} style={[styles.feedbackText, { color: theme.colors.muted }]}>{error}</Text></View> : null}
    <SmallNativeSheetOutline />
  </View>;
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptySetup: { flexGrow: 1, paddingHorizontal: 24 },
  emptyMessage: { flexGrow: 1, justifyContent: 'center' },
  footer: { paddingTop: 12 },
  emptyTitle: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  create: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  root: { flex: 1 },
  feedback: { paddingHorizontal: 24, paddingTop: 12, justifyContent: 'center' }, feedbackText: { fontSize: 12, lineHeight: 18 },
  scrollContainer: { flex: 1, minHeight: 0 }, scroll: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 24, paddingTop: 0, paddingBottom: 24 }, row: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  info: { flex: 1, minWidth: 0, paddingRight: 8 }, name: { fontSize: 14, lineHeight: 20 }, price: { fontSize: 12, lineHeight: 18, marginTop: 4 }, control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stackedRow: { flexDirection: 'column', alignItems: 'stretch' },
  stackedInfo: { flex: 0, paddingRight: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  quantity: { fontSize: 15, minWidth: 20, textAlign: 'center' },
});

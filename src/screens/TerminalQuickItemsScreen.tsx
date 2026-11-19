import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, PanResponder, Pressable, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { formatTerminalBasketAmount, TerminalBasketLine, TerminalUnit } from '../services/terminal';
import { TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';
import { SHEET_HEADER_HEIGHT } from '../constants/theme';

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
  const { height, width, fontScale } = useWindowDimensions();
  const stackControls = fontScale >= 1.4 || width < 350;
  const sheetHeight = height * 0.55;
  // Animate layout so native glass keeps the same frame as its press target.
  const dragY = useRef(new Animated.Value(sheetHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    Animated.parallel([
      Animated.timing(dragY, { toValue: 0, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    return () => { mounted.current = false; dragY.stopAnimation(); backdropOpacity.stopAnimation(); };
  }, [dragY, backdropOpacity]);
  const dismiss = () => {
    if (closing.current) return;
    closing.current = true;
    dragY.stopAnimation();
    backdropOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(dragY, { toValue: height, duration: 180, useNativeDriver: false }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => { if (mounted.current) onClose(); });
  };
  const closeRef = useRef(onClose);
  closeRef.current = dismiss;
  const headerDrag = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => !closing.current && gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx),
    onPanResponderMove: (_event, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy > 80 || gesture.vy > 0.8) closeRef.current();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start(),
  })).current;
  const basketUnit = lines.length ? unit : null;
  const selectedById = useMemo(() => new Map(lines.map(line => [line.itemId, line])), [lines]);
  const rows = useMemo(() => {
    const ids = new Set(catalog.map(item => item.id));
    return [...catalog, ...lines.filter(line => !ids.has(line.itemId)).map(line => ({ id: line.itemId, name: line.name, unit, unitPrice: line.unitPrice }))];
  }, [catalog, lines, unit]);
  const showCreate = rows.length === 0 && !onRetry && !catalogPending && !!onCreate;
  return <View style={styles.overlay}>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#00000033', opacity: backdropOpacity }]} />
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss item picker" onPress={dismiss} style={StyleSheet.absoluteFill} />
    <Animated.View style={[styles.root, { height: sheetHeight, backgroundColor: theme.colors.background, bottom: Animated.multiply(dragY, -1) }]}>
    <View {...headerDrag.panHandlers}><TerminalSheetHeader title="Items" closeLabel="Close item picker" onClose={dismiss} /></View>
    {/* A native wrapper keeps react-native-screens from misplacing this list in an iOS formSheet. */}
    <View collapsable={false} style={styles.scrollContainer}>
      {showCreate ? <ScrollView contentContainerStyle={styles.emptySetup} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} bounces={false}>
        <View style={{ height: (sheetHeight - SHEET_HEADER_HEIGHT - 24) / 2, flexShrink: 1 }} />
        <Text style={[styles.emptyTitle, { color: theme.colors.muted }]}>No items yet</Text>
        <View style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onCreate} style={[styles.create, { backgroundColor: theme.colors.primary }]}>
            <Text style={{ color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '700' }}>Add item</Text>
          </TouchableOpacity>
          <Text style={[styles.hint, { color: theme.colors.muted }]}>Add more items in Terminal settings.</Text>
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
  </Animated.View></View>;
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptySetup: { flexGrow: 1, paddingHorizontal: 24 },
  footer: { marginTop: 'auto', paddingTop: 12 },
  emptyTitle: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  create: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  root: { position: 'absolute', left: 0, right: 0, flexShrink: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  feedback: { paddingHorizontal: 24, paddingTop: 12, justifyContent: 'center' }, feedbackText: { fontSize: 12, lineHeight: 18 },
  scrollContainer: { flex: 1, minHeight: 0 }, scroll: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 24, paddingTop: 0, paddingBottom: 24 }, row: { minHeight: 64, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  info: { flex: 1, minWidth: 0, paddingRight: 8 }, name: { fontSize: 14, lineHeight: 20 }, price: { fontSize: 12, lineHeight: 18, marginTop: 4 }, control: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stackedRow: { flexDirection: 'column', alignItems: 'stretch' },
  stackedInfo: { flex: 0, paddingRight: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  quantity: { fontSize: 15, minWidth: 20, textAlign: 'center' },
});

import { TerminalSearchInput, normalizeItemSearch } from '../components/TerminalSearchInput';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTerminalPro } from '../contexts/TerminalProContext';
import { useTerminalProGate } from '../hooks/useTerminalProGate';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { formatTerminalBasketAmount, TerminalNetwork, TerminalUnit } from '../services/terminal';
import { FREE_TERMINAL_ITEM_LIMIT, deleteTerminalItem, getCachedTerminalItems, listTerminalItems, TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';
import { SHEET_HEADER_HEIGHT } from '../constants/theme';

type Props = { walletId: string; network: TerminalNetwork; preferredUnit: TerminalUnit; onClose: () => void; onEdit: (item?: TerminalItem) => void };

export default function TerminalItemsScreen({ walletId, network, onClose, onEdit }: Props) {
  const { theme } = useTheme();
  const activeWallet = useActiveWallet();
  const { cashierState } = useWalletMode();
  const focused = useIsFocused();
  const pro = useTerminalPro();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<TerminalItem[]>(() => getCachedTerminalItems(walletId, network) ?? []);
  const [loadedScope, setLoadedScope] = useState<string | null>(() => getCachedTerminalItems(walletId, network) != null ? `${network}:${walletId}` : null);
  const [readError, setReadError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const term = normalizeItemSearch(query);
  const matches = term ? items.filter(item => normalizeItemSearch(item.name).includes(term)) : items;
  useEffect(() => { setQuery(''); }, [walletId, network]);
  const busyRef = useRef(false);
  const loadRevision = useRef(0);
  const mounted = useRef(true);
  const ownerRef = useRef(false);
  const currentScope = useRef(`${network}:${walletId}`);
  currentScope.current = `${network}:${walletId}`;
  const ownerAllowed = cashierState === 'off' && activeWallet?.id === walletId && activeWallet.type !== 'watch-only';
  ownerRef.current = focused && ownerAllowed;
  const screenScope = `${network}:${walletId}`;
  const ownerCurrent = () => mounted.current && ownerRef.current && currentScope.current === screenScope;
  const proGate = useTerminalProGate({ allowed: focused && ownerAllowed, scope: `${network}:${walletId}:items` });
  const needsPro = pro.status !== 'pro' && items.length >= FREE_TERMINAL_ITEM_LIMIT;
  const add = () => { if (!ownerCurrent() || busyRef.current || readError) return; if (needsPro) proGate.requirePro(() => { if (ownerCurrent()) onEdit(); }); else onEdit(); };
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeOpacity = scrollY.interpolate({ inputRange: [0, 100], outputRange: [0, 1], extrapolate: 'clamp' });

  const load = async () => {
    const revision = ++loadRevision.current;
    setReadError(false);
    try { const saved = await listTerminalItems(walletId, network); if (ownerCurrent() && revision === loadRevision.current) { setItems(saved); setLoadedScope(screenScope); } }
    catch { if (ownerCurrent() && revision === loadRevision.current) setReadError(true); }
  };
  useEffect(() => {
    mounted.current = true;
    setItems(getCachedTerminalItems(walletId, network) ?? []);
    if (focused && ownerAllowed) void load();
    return () => { mounted.current = false; ++loadRevision.current; };
  }, [walletId, network, focused, ownerAllowed]);

  const remove = async (item: TerminalItem) => {
    if (busyRef.current || !ownerCurrent()) return;
    ++loadRevision.current;
    busyRef.current = true; setBusy(true); setError('');
    try { const next = await deleteTerminalItem(walletId, network, item.id, ownerCurrent); if (ownerCurrent()) setItems(next); }
    catch (failure) { if (ownerCurrent()) setError((failure as Error).message || 'Couldn’t delete item.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  if (!ownerAllowed) return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader title="Items" closeLabel="Close items" onClose={onClose} />
    <Text style={[styles.message, { color: theme.colors.muted, marginTop: insets.top + 110, marginHorizontal: 24 }]}>Owner access is required to edit items.</Text>
  </View>;
  return <><View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Animated.View pointerEvents="none" style={[styles.scrollFade, { opacity: fadeOpacity }]}><LinearGradient colors={[theme.colors.background, theme.colors.background + 'CC', theme.colors.background + '66', theme.colors.background + '00']} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} /></Animated.View>
    <TerminalSheetHeader title="Items" closeLabel="Close items" onClose={onClose} />
    {!readError && items.length > 0 ? <TerminalSearchInput label="Search items" value={query} onChangeText={setQuery} /> : null}
    <Animated.FlatList data={readError ? [] : matches} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" keyExtractor={item => item.id} extraData={busy} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} style={styles.scroll} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.content, !readError && items.length === 0 && styles.emptyContent, { paddingBottom: 24 }]}
      ListEmptyComponent={readError ? <View><Text style={[styles.message, { color: theme.colors.muted }]}>Saved items are unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry items" onPress={() => { void load(); }}><Text style={[styles.link, { color: theme.colors.bitcoin }]}>Retry</Text></TouchableOpacity></View>
        : loadedScope === screenScope ? <Text style={[styles.emptyText, { color: theme.colors.muted }]}>{term ? 'No matching items' : 'No items yet'}</Text> : null}
      renderItem={({ item }) => <View key={item.id} style={[styles.itemRow, { borderBottomColor: theme.colors.border }]}>
            <View style={styles.itemInfo}><Text style={[styles.itemName, { color: theme.colors.primary }]}>{item.name}</Text><Text style={[styles.itemPrice, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(item.unitPrice, item.unit)}</Text></View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} disabled={busy} onPress={() => { if (ownerCurrent()) onEdit(item); }} style={styles.iconButton}><Feather name="edit" size={18} color={theme.colors.primary} /></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} disabled={busy} onPress={() => { void remove(item); }} style={styles.iconButton}><Feather name="trash-2" size={17} color={theme.colors.primary} /></TouchableOpacity>
          </View>}

      ListFooterComponent={error ? <Text style={[styles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
    />
    <View style={[styles.footer, { paddingBottom: insets.bottom + 24, backgroundColor: theme.colors.background, borderTopColor: theme.colors.border }]}>
      {needsPro ? <Text style={[styles.limitHint, { color: theme.colors.muted }]}>5 items included. Go unlimited with Pro.</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={needsPro ? 'Upgrade to Terminal Pro' : 'Add item'} disabled={busy || readError} onPress={add} style={[styles.add, { backgroundColor: theme.colors.primary, opacity: busy || readError ? 0.55 : 1 }]}>
        <Text style={{ color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 16 }}>{needsPro ? 'Upgrade to Pro' : 'Add item'}</Text>
      </TouchableOpacity>
    </View>
  </View>
  {proGate.proSheet}</>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollFade: { position: 'absolute', top: SHEET_HEADER_HEIGHT, left: 0, right: 0, height: 48, zIndex: 1 },
  scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  emptyText: { fontSize: 16, textAlign: 'center' },
  message: { fontSize: 12, marginTop: 12 }, link: { fontSize: 13, marginTop: 12 },
  itemRow: { minHeight: 65, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  itemInfo: { flex: 1, minWidth: 0, paddingRight: 8 }, itemName: { fontSize: 16, lineHeight: 22 }, itemPrice: { fontSize: 12, lineHeight: 18, marginTop: 4 }, iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 24, borderTopWidth: StyleSheet.hairlineWidth },
  limitHint: { fontSize: 12, textAlign: 'center', marginBottom: 12 },
  add: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

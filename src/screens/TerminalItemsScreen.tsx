import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { formatTerminalBasketAmount, TerminalNetwork, TerminalUnit } from '../services/terminal';
import { deleteTerminalItem, listTerminalItems, TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = { walletId: string; network: TerminalNetwork; preferredUnit: TerminalUnit; onClose: () => void; onEdit: (item?: TerminalItem) => void };

export default function TerminalItemsScreen({ walletId, network, onClose, onEdit }: Props) {
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const { cashierState } = useWalletMode();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<TerminalItem[]>([]);
  const [readError, setReadError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const ownerRef = useRef(false);
  const currentScope = useRef(`${network}:${walletId}`);
  currentScope.current = `${network}:${walletId}`;
  const ownerAllowed = cashierState === 'off' && activeWallet?.id === walletId && activeWallet.type !== 'watch-only';
  ownerRef.current = focused && ownerAllowed;
  const screenScope = `${network}:${walletId}`;
  const ownerCurrent = () => mounted.current && ownerRef.current && currentScope.current === screenScope;
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeOpacity = scrollY.interpolate({ inputRange: [0, 100], outputRange: [0, 1], extrapolate: 'clamp' });

  const load = async () => {
    setReadError(false);
    try { const saved = await listTerminalItems(walletId, network); if (ownerCurrent()) setItems(saved); }
    catch { if (ownerCurrent()) setReadError(true); }
  };
  useEffect(() => {
    mounted.current = true;
    if (focused) void load();
    return () => { mounted.current = false; };
  }, [walletId, network, focused]);

  const remove = async (item: TerminalItem) => {
    if (busyRef.current || !ownerCurrent()) return;
    busyRef.current = true; setBusy(true); setError('');
    try { const next = await deleteTerminalItem(walletId, network, item.id, ownerCurrent); if (ownerCurrent()) setItems(next); }
    catch (failure) { if (ownerCurrent()) setError((failure as Error).message || 'Couldn’t delete item.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  if (!ownerAllowed) return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader title="Items" closeLabel="Close items" onClose={onClose} />
    <Text style={[styles.message, { color: theme.colors.muted, marginTop: insets.top + 110, marginHorizontal: 24 }]}>Owner access is required to edit items.</Text>
  </View>;
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Animated.View pointerEvents="none" style={[styles.scrollFade, { opacity: fadeOpacity }]}><LinearGradient colors={[theme.colors.background, theme.colors.background + 'CC', theme.colors.background + '66', theme.colors.background + '00']} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} /></Animated.View>
    <TerminalSheetHeader title="Items" closeLabel="Close items" onClose={onClose} />
    <Animated.ScrollView style={styles.scroll} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.content, { paddingBottom: 24 }]}>
      {readError ? <View><Text style={[styles.message, { color: theme.colors.muted }]}>Saved items are unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry items" onPress={() => { void load(); }}><Text style={[styles.link, { color: theme.colors.bitcoin }]}>Retry</Text></TouchableOpacity></View>
        : <>
          {items.map(item => <View key={item.id} style={[styles.itemRow, { borderBottomColor: theme.colors.border }]}>
            <View style={styles.itemInfo}><Text style={[styles.itemName, { color: theme.colors.primary }]}>{item.name}</Text><Text style={[styles.itemPrice, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(item.unitPrice, item.unit)}</Text></View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} disabled={busy} onPress={() => { if (ownerCurrent()) onEdit(item); }} style={styles.iconButton}><Feather name="edit" size={18} color={theme.colors.primary} /></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} disabled={busy} onPress={() => { void remove(item); }} style={styles.iconButton}><Feather name="trash-2" size={17} color={theme.colors.primary} /></TouchableOpacity>
          </View>)}

          {error ? <Text style={[styles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
        </>}
    </Animated.ScrollView>
    <View style={[styles.footer, { paddingBottom: insets.bottom + 24, backgroundColor: theme.colors.background, borderTopColor: theme.colors.border }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add item" accessibilityHint={items.length >= 30 ? 'Catalog limit of 30 items reached' : undefined} disabled={busy || readError || items.length >= 30} onPress={() => { if (ownerCurrent()) onEdit(); }} style={[styles.add, { backgroundColor: theme.colors.primary, opacity: busy || readError || items.length >= 30 ? 0.55 : 1 }]}>
        <Text style={{ color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 16 }}>Add item</Text>
      </TouchableOpacity>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollFade: { position: 'absolute', top: 56, left: 0, right: 0, height: 48, zIndex: 1 },
  scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
  message: { fontSize: 12, marginTop: 12 }, link: { fontSize: 13, marginTop: 12 },
  itemRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  itemInfo: { flex: 1 }, itemName: { fontSize: 16 }, itemPrice: { fontSize: 12, marginTop: 4 }, iconButton: { padding: 12 },
  footer: { padding: 24, borderTopWidth: StyleSheet.hairlineWidth },
  add: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import { formatTerminalBasketAmount, parseFiatMinor, parseTerminalAmount, TerminalNetwork, TerminalUnit } from '../services/terminal';
import { deleteTerminalItem, listTerminalItems, saveTerminalItem, TerminalItem } from '../services/terminalItems';

type Props = { walletId: string; network: TerminalNetwork; preferredUnit: TerminalUnit; onClose: () => void };
const units: TerminalUnit[] = ['USD', 'EUR', 'CHF', 'sats', 'BTC'];

export default function TerminalItemsScreen({ walletId, network, preferredUnit, onClose }: Props) {
  const { theme, isDark } = useTheme();
  const { activeWallet } = useWallet();
  const { cashierState } = useWalletMode();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { scrollViewRef, paddingBottom, handleInputFocus } = useKeyboardScroll({ basePaddingBottom: insets.bottom + 36 });
  const [items, setItems] = useState<TerminalItem[]>([]);
  const [readError, setReadError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const ownerRef = useRef(false);
  const currentScope = useRef(`${network}:${walletId}`);
  currentScope.current = `${network}:${walletId}`;
  ownerRef.current = focused && cashierState === 'off' && activeWallet?.id === walletId && activeWallet.type !== 'watch-only';
  const screenScope = `${network}:${walletId}`;
  const ownerCurrent = () => mounted.current && ownerRef.current && currentScope.current === screenScope;
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftUnit, setDraftUnit] = useState<TerminalUnit>(preferredUnit);
  const [editing, setEditing] = useState(false);
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

  const clearDraft = () => { setEditing(false); setDraftId(null); setDraftName(''); setDraftPrice(''); setDraftUnit(preferredUnit); setError(''); };
  const edit = (item?: TerminalItem) => {
    if (!ownerCurrent()) return;
    setEditing(true); setDraftId(item?.id ?? null); setDraftName(item?.name ?? ''); setDraftUnit(item?.unit ?? preferredUnit);
    setDraftPrice(item ? item.unit === 'BTC' ? formatTerminalBasketAmount(item.unitPrice, 'BTC').replace(' BTC', '') : item.unit === 'sats' ? String(item.unitPrice) : formatTerminalBasketAmount(item.unitPrice, item.unit).split(' ')[1] : '');
    setError('');
  };
  const save = async () => {
    if (busyRef.current || !ownerCurrent()) return;
    let item: TerminalItem;
    try {
      const entered = draftPrice.trim();
      const price = /,/.test(entered) && !/\./.test(entered) && (entered.match(/,/g) || []).length === 1 ? entered.replace(',', '.') : entered;
      const unitPrice = draftUnit === 'sats' || draftUnit === 'BTC' ? parseTerminalAmount(price, draftUnit) : parseFiatMinor(price);
      item = { id: draftId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: draftName.trim(), unit: draftUnit, unitPrice };
    } catch (failure) { setError((failure as Error).message); return; }
    busyRef.current = true; setBusy(true); setError('');
    try { const next = await saveTerminalItem(walletId, network, item, ownerCurrent); if (ownerCurrent()) { setItems(next); clearDraft(); } }
    catch (failure) { if (ownerCurrent()) setError((failure as Error).message || 'Couldn’t save item.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const remove = async (item: TerminalItem) => {
    if (busyRef.current || !ownerCurrent()) return;
    busyRef.current = true; setBusy(true); setError('');
    try { const next = await deleteTerminalItem(walletId, network, item.id, ownerCurrent); if (ownerCurrent()) { setItems(next); if (draftId === item.id) clearDraft(); } }
    catch (failure) { if (ownerCurrent()) setError((failure as Error).message || 'Couldn’t delete item.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  if (!ownerRef.current) return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <View style={[styles.topBar, { backgroundColor: isDark ? theme.colors.surface : theme.colors.background }]}><Pressable accessibilityRole="button" accessibilityLabel="Close items" onPress={onClose}><GlassView width={40} height={40} shape="circle" interactive style={styles.glass}><Feather name="x" size={20} color={theme.colors.primary} /></GlassView></Pressable></View>
    <Text style={[styles.message, { color: theme.colors.muted, marginTop: insets.top + 110, marginHorizontal: 24 }]}>Owner access is required to edit items.</Text>
  </View>;
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Animated.View pointerEvents="none" style={[styles.scrollFade, { opacity: fadeOpacity }]}><LinearGradient colors={[theme.colors.background, theme.colors.background + 'CC', theme.colors.background + '66', theme.colors.background + '00']} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} /></Animated.View>
    <View style={[styles.topBar, { backgroundColor: isDark ? theme.colors.surface : theme.colors.background }]}><Pressable accessibilityRole="button" accessibilityLabel="Close items" onPress={onClose}>
      <GlassView width={40} height={40} shape="circle" interactive style={styles.glass}><Feather name="x" size={20} color={theme.colors.primary} /></GlassView>
    </Pressable></View>
    <Animated.ScrollView style={styles.scroll} ref={scrollViewRef} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom }]}>
      <Text style={[styles.title, { color: theme.colors.primary }]}>Items</Text>
      {readError ? <View><Text style={[styles.message, { color: theme.colors.muted }]}>Saved items are unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry items" onPress={() => { void load(); }}><Text style={[styles.link, { color: theme.colors.bitcoin }]}>Retry</Text></TouchableOpacity></View>
        : <>
          {!editing ? items.map(item => <View key={item.id} style={[styles.itemRow, { borderBottomColor: theme.colors.border }]}>
            <View style={styles.itemInfo}><Text style={[styles.itemName, { color: theme.colors.primary }]}>{item.name}</Text><Text style={[styles.itemPrice, { color: theme.colors.muted }]}>{formatTerminalBasketAmount(item.unitPrice, item.unit)}</Text></View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={() => edit(item)} style={styles.iconButton}><Feather name="edit" size={18} color={theme.colors.primary} /></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`} onPress={() => { void remove(item); }} style={styles.iconButton}><Feather name="trash-2" size={17} color={theme.colors.primary} /></TouchableOpacity>
          </View>) : null}
          {!editing && items.length < 30 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add item" onPress={() => edit()} style={[styles.add, { backgroundColor: theme.colors.primary }]}><Text style={{ color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold' }}>Add item</Text></TouchableOpacity> : null}
          {editing ? <View style={styles.form}>
            <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>Name</Text>
            <StyledInput accessibilityLabel="Item name" value={draftName} onChangeText={setDraftName} maxLength={60} onFocus={handleInputFocus} autoCapitalize="sentences" />
            <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>Price</Text>
            <StyledInput accessibilityLabel="Item price" value={draftPrice} onChangeText={setDraftPrice} keyboardType="decimal-pad" onFocus={handleInputFocus} />
            <View style={styles.units}>{units.map(choice => <TouchableOpacity key={choice} accessibilityRole="button" accessibilityLabel={`Price in ${choice}`} accessibilityState={{ selected: draftUnit === choice }} onPress={() => { if (choice !== draftUnit) { setDraftUnit(choice); setDraftPrice(''); } }} style={[styles.unit, { borderColor: draftUnit === choice ? theme.colors.bitcoin : theme.colors.border }]}><Text style={{ color: theme.colors.primary }}>{choice}</Text></TouchableOpacity>)}</View>
            {error ? <Text style={[styles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save item" disabled={busy} onPress={() => { void save(); }} style={[styles.save, { backgroundColor: theme.colors.primary }]}>{busy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={{ color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold' }}>Save item</Text>}</TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel item edit" onPress={clearDraft} style={styles.cancel}><Text style={{ color: theme.colors.muted }}>Cancel</Text></TouchableOpacity>
          </View> : error ? <Text style={[styles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
        </>}
    </Animated.ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, topBar: { height: 56, zIndex: 2, elevation: 2, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }, glass: { overflow: 'visible' },
  scrollFade: { position: 'absolute', top: 56, left: 0, right: 0, height: 48, zIndex: 1 },
  scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 }, title: { fontSize: 16, fontWeight: '600', marginBottom: 16 },
  message: { fontSize: 12, marginTop: 12 }, link: { fontSize: 13, marginTop: 12 },
  itemRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  itemInfo: { flex: 1 }, itemName: { fontSize: 16 }, itemPrice: { fontSize: 12, marginTop: 4 }, iconButton: { padding: 12 },
  add: { minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  form: { marginTop: 18 }, fieldLabel: { fontSize: 12, marginTop: 14, marginBottom: 8 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 },
  unit: { minHeight: 36, minWidth: 55, paddingHorizontal: 8, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  save: { minHeight: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import { formatTerminalBasketAmount, parseFiatMinor, parseTerminalAmount, TerminalNetwork, TerminalUnit } from '../services/terminal';
import { saveTerminalItem, TerminalItem } from '../services/terminalItems';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = { walletId: string; network: TerminalNetwork; preferredUnit: TerminalUnit; initialItem?: TerminalItem; onClose: () => void };
const units: TerminalUnit[] = ['USD', 'EUR', 'CHF', 'sats', 'BTC'];

function priceText(item?: TerminalItem) {
  if (!item) return '';
  if (item.unit === 'sats') return String(item.unitPrice);
  if (item.unit === 'BTC') return formatTerminalBasketAmount(item.unitPrice, 'BTC').replace(' BTC', '');
  return formatTerminalBasketAmount(item.unitPrice, item.unit).split(' ')[1];
}

export default function TerminalItemEditorScreen({ walletId, network, preferredUnit, initialItem, onClose }: Props) {
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const { cashierState } = useWalletMode();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const insets = useSafeAreaInsets();
  const { scrollViewRef, paddingBottom, handleInputFocus } = useKeyboardScroll({ basePaddingBottom: insets.bottom + 36 });
  const [name, setName] = useState(initialItem?.name ?? '');
  const [price, setPrice] = useState(priceText(initialItem));
  const [unit, setUnit] = useState<TerminalUnit>(initialItem?.unit ?? preferredUnit);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useLayoutEffect(() => { navigation.setOptions({ gestureEnabled: !busy }); }, [navigation, busy]);
  const ownerRef = useRef(false);
  const scopeRef = useRef(`${network}:${walletId}`);
  scopeRef.current = `${network}:${walletId}`;
  const ownerAllowed = cashierState === 'off' && activeWallet?.id === walletId && activeWallet.type !== 'watch-only';
  ownerRef.current = focused && ownerAllowed;
  const screenScope = `${network}:${walletId}`;
  const ownerCurrent = () => mounted.current && ownerRef.current && scopeRef.current === screenScope;

  const save = async () => {
    if (busyRef.current || !ownerCurrent()) return;
    let item: TerminalItem;
    try {
      const entered = price.trim();
      const normalized = /,/.test(entered) && !/\./.test(entered) && (entered.match(/,/g) || []).length === 1 ? entered.replace(',', '.') : entered;
      const unitPrice = unit === 'sats' || unit === 'BTC' ? parseTerminalAmount(normalized, unit) : parseFiatMinor(normalized);
      item = { id: initialItem?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: name.trim(), unit, unitPrice };
    } catch (failure) { setError((failure as Error).message); return; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      await saveTerminalItem(walletId, network, item, ownerCurrent);
      if (ownerCurrent()) onClose();
    } catch (failure) {
      if (ownerCurrent()) setError((failure as Error).message || 'Couldn’t save item.');
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <TerminalSheetHeader title={initialItem ? 'Edit item' : 'Add item'} closeLabel="Close item editor" disabled={busy} onClose={() => { if (!busyRef.current) onClose(); }} />
    {ownerAllowed ? <ScrollView ref={scrollViewRef} style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom }]}>
      <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>Name</Text>
      <StyledInput accessibilityLabel="Item name" value={name} onChangeText={setName} maxLength={60} onFocus={handleInputFocus} autoCapitalize="sentences" />
      <Text style={[styles.fieldLabel, { color: theme.colors.muted }]}>Price</Text>
      <StyledInput accessibilityLabel="Item price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" onFocus={handleInputFocus} />
      <View style={styles.units}>{units.map(choice => <TouchableOpacity key={choice} accessibilityRole="button" accessibilityLabel={`Price in ${choice}`} accessibilityState={{ selected: unit === choice }} onPress={() => { if (choice !== unit) { setUnit(choice); setPrice(''); } }} style={[styles.unit, { borderColor: unit === choice ? theme.colors.bitcoin : theme.colors.border }]}><Text style={{ color: theme.colors.primary }}>{choice}</Text></TouchableOpacity>)}</View>
      {error ? <Text style={[styles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save item" disabled={busy} onPress={() => { void save(); }} style={[styles.save, { backgroundColor: theme.colors.primary }]}>{busy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={{ color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold' }}>Save item</Text>}</TouchableOpacity>
    </ScrollView> : <Text style={[styles.message, { color: theme.colors.muted, marginTop: insets.top + 110, marginHorizontal: 24 }]}>Owner access is required to edit items.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
  fieldLabel: { fontSize: 12, marginTop: 14, marginBottom: 8 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 },
  unit: { minHeight: 36, minWidth: 55, paddingHorizontal: 8, borderWidth: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  message: { fontSize: 12, marginTop: 12 },
  save: { minHeight: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
});

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { TerminalNetwork } from '../services/terminal';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, saveTerminalReceiptBranding, TerminalReceiptBranding } from '../services/terminalReceiptBranding';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = { walletId: string; network: TerminalNetwork; onClose: () => void };
const fields = [{ key: 'name', label: 'Business name', max: 80 }, { key: 'contact', label: 'Contact', max: 120 }, { key: 'footer', label: 'Footer', max: 160 }] as const;

export default function TerminalReceiptSettingsScreen({ walletId, network, onClose }: Props) {
  const { theme } = useTheme();
  const activeWallet = useActiveWallet();
  const { cashierState } = useWalletMode();
  const focused = useIsFocused();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const scope = `${network}:${walletId}`;
  const context = useRef({ scope, owner: false, epoch: 0 });
  const allowed = activeWallet?.id === walletId && activeWallet.type !== 'watch-only' && cashierState === 'off';
  const owner = allowed && focused;
  if (context.current.scope !== scope || context.current.owner !== owner) context.current = { scope, owner, epoch: context.current.epoch + 1 };
  const mounted = useRef(true);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ scope: string; ready: boolean; loading: boolean; error: boolean; saved: TerminalReceiptBranding }>({ scope, ready: false, loading: true, error: false, saved: DEFAULT_TERMINAL_RECEIPT_BRANDING });
  const [draft, setDraft] = useState<TerminalReceiptBranding>(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  const [error, setError] = useState('');
  const styles = makeStyles(theme.colors);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; }; }, []);
  useLayoutEffect(() => { navigation.setOptions({ gestureEnabled: !busy }); }, [navigation, busy]);
  const load = async () => {
    if (!owner) return;
    const request = ++generation.current, epoch = context.current.epoch;
    setState(previous => ({ ...previous, scope, ready: false, loading: true, error: false }));
    try {
      const branding = await loadTerminalReceiptBranding(walletId, network);
      if (mounted.current && request === generation.current && context.current.epoch === epoch) {
        setDraft(branding); setError('');
        setState({ scope, ready: true, loading: false, error: false, saved: branding });
      }
    } catch {
      if (mounted.current && request === generation.current && context.current.epoch === epoch) setState({ scope, ready: false, loading: false, error: true, saved: DEFAULT_TERMINAL_RECEIPT_BRANDING });
    }
  };
  useEffect(() => { void load(); return () => { ++generation.current; }; }, [scope, owner]);
  const ready = state.scope === scope && state.ready;
  const dirty = fields.some(field => draft[field.key].trim() !== state.saved[field.key]);
  const save = async () => {
    if (!owner || !ready || busyRef.current || !dirty) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.owner && context.current.epoch === epoch;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await saveTerminalReceiptBranding(walletId, network, draft, isCurrent);
      if (isCurrent()) { Keyboard.dismiss(); onClose(); }
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error && failure.message === 'Invalid receipt branding.' ? 'Use single-line text within the field limits.' : 'Couldn’t save receipt details. Try again.');
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <View style={styles.root}>
    <TerminalSheetHeader title="Receipts" closeLabel="Close receipt settings" disabled={busy} onClose={() => { if (!busyRef.current) onClose(); }} />
    {!allowed ? <Text style={styles.message}>Owner access is required to edit receipts.</Text> : state.loading || state.scope !== scope ? <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading receipt settings" size="small" color={theme.colors.bitcoin} /></View> : state.error ? <View style={styles.failure}><Text style={styles.message}>Receipt settings unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry receipt settings" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      {fields.map(field => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{field.label}</Text>
        <StyledInput accessibilityLabel={`Receipt ${field.label.toLowerCase()}`} value={draft[field.key]} maxLength={field.max} editable={!busy} autoCorrect={field.key !== 'contact'} autoCapitalize={field.key === 'contact' ? 'none' : 'sentences'} onChangeText={value => { setDraft(previous => ({ ...previous, [field.key]: value })); setError(''); }} />
      </View>)}
      <Text style={styles.previewLabel}>Preview</Text>
      <View accessibilityLabel="Receipt branding preview" style={styles.preview}>
        {draft.name.trim() ? <Text style={styles.business}>{draft.name.trim()}</Text> : null}
        {draft.contact.trim() ? <Text style={styles.contact}>{draft.contact.trim()}</Text> : null}
        <Text style={styles.receiptTitle}>Payment receipt</Text>
        <View style={styles.details}><Text style={styles.detailsText}>Payment details</Text></View>
        {draft.footer.trim() ? <Text style={styles.contact}>{draft.footer.trim()}</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save receipt settings" accessibilityState={{ disabled: busy || !dirty, busy }} disabled={busy || !dirty} onPress={() => { void save(); }} style={[styles.save, !dirty && styles.disabled]}>{busy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.saveText}>Save</Text>}</TouchableOpacity>
    </ScrollView>}
  </View>;
}
function makeStyles(colors: { background: string; primary: string; inversePrimary: string; surface: string; muted: string; border: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background }, scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
    field: { marginBottom: 18 }, label: { color: colors.muted, fontSize: 12, marginBottom: 8 },
    previewLabel: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 10 },
    preview: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 8 },
    business: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 16 }, contact: { color: colors.muted, fontSize: 12, lineHeight: 19 },
    receiptTitle: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    details: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 16 }, detailsText: { color: colors.muted, fontSize: 12 },
    message: { color: colors.muted, fontSize: 12, marginTop: 12 },
    save: { minHeight: 50, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24 }, saveText: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 14 }, disabled: { opacity: 0.4 },
    loading: { paddingTop: 30, alignItems: 'center' }, failure: { paddingHorizontal: 24, paddingTop: 20 }, retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, retryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
  });
}

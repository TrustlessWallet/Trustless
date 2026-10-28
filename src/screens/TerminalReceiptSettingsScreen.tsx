import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Keyboard, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { TerminalNetwork } from '../services/terminal';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, saveTerminalReceiptBranding, TerminalReceiptBranding } from '../services/terminalReceiptBranding';
import { importTerminalReceiptLogo } from '../services/terminalReceiptLogoImport';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = { walletId: string; network: TerminalNetwork; onClose: () => void };
const fields = [{ key: 'name', label: 'Business name', max: 80 }, { key: 'contact', label: 'Contact', max: 120 }, { key: 'footer', label: 'Footer', max: 160 }] as const;

export default function TerminalReceiptSettingsScreen({ walletId, network, onClose }: Props) {
  const { theme, isDark } = useTheme();
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
  const pickingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preparingLogo, setPreparingLogo] = useState(false);
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
  const dirty = fields.some(field => draft[field.key].trim() !== state.saved[field.key]) || draft.logo?.mimeType !== state.saved.logo?.mimeType || draft.logo?.base64 !== state.saved.logo?.base64;
  const chooseLogo = async () => {
    if (!owner || !ready || busyRef.current || pickingRef.current) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.owner && context.current.epoch === epoch;
    pickingRef.current = true; setError('');
    try {
      Keyboard.dismiss();
      const source = await new Promise<'photos' | 'files' | null>(resolve => {
        if (Platform.OS === 'ios') {
          ActionSheetIOS.showActionSheetWithOptions({ options: ['Choose from Photos', 'Choose from Files', 'Cancel'], cancelButtonIndex: 2, userInterfaceStyle: isDark ? 'dark' : 'light', tintColor: theme.colors.primary }, index => resolve(index === 0 ? 'photos' : index === 1 ? 'files' : null));
        } else {
          Alert.alert('Choose logo', undefined, [
            { text: 'Choose from Photos', onPress: () => resolve('photos') },
            { text: 'Choose from Files', onPress: () => resolve('files') },
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          ], { cancelable: true, onDismiss: () => resolve(null) });
        }
      });
      if (!source || !isCurrent()) return;
      // Resolve new native capabilities only when used, so an older development binary still opens safely.
      const imagePicker = source === 'photos' ? require('expo-image-picker') as typeof import('expo-image-picker') : null;
      const picked = imagePicker
        ? await imagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false, base64: false, preferredAssetRepresentationMode: imagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible })
        : await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/jpeg'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !isCurrent()) return;
      setPreparingLogo(true);
      const logo = await importTerminalReceiptLogo(picked.assets[0].uri, isCurrent);
      if (logo && isCurrent()) setDraft(previous => ({ ...previous, logo }));
    } catch {
      if (isCurrent()) setError('Couldn’t prepare this logo. Choose a PNG or JPEG up to 20 MB and 32 megapixels.');
    } finally { pickingRef.current = false; if (mounted.current) setPreparingLogo(false); }
  };
  const save = async () => {
    if (!owner || !ready || busyRef.current || pickingRef.current || !dirty) return;
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
      <View style={styles.field}>
        <Text style={styles.label}>Logo</Text>
        {draft.logo ? <Image accessibilityLabel="Receipt logo preview" source={{ uri: `data:${draft.logo.mimeType};base64,${draft.logo.base64}` }} resizeMode="contain" style={styles.logo} /> : null}
        <View style={styles.logoActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose receipt logo" accessibilityState={{ disabled: busy || preparingLogo, busy: preparingLogo }} disabled={busy || preparingLogo} onPress={() => { void chooseLogo(); }} style={styles.logoButton}><Text style={[styles.logoButtonText, preparingLogo && { opacity: 0 }]}>{draft.logo ? 'Change logo' : 'Choose logo'}</Text>{preparingLogo ? <View style={styles.logoProgress}><ActivityIndicator size="small" color={theme.colors.bitcoin} /></View> : null}</TouchableOpacity>
          {draft.logo ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove receipt logo" disabled={busy || preparingLogo} onPress={() => { setDraft(previous => { const { logo: _logo, ...rest } = previous; return rest; }); setError(''); }} style={styles.logoButton}><Text style={styles.logoButtonText}>Remove</Text></TouchableOpacity> : null}
        </View>
      </View>
      {fields.map(field => <View key={field.key} style={styles.field}>
        <Text style={styles.label}>{field.label}</Text>
        <StyledInput accessibilityLabel={`Receipt ${field.label.toLowerCase()}`} value={draft[field.key]} maxLength={field.max} editable={!busy} autoCorrect={field.key !== 'contact'} autoCapitalize={field.key === 'contact' ? 'none' : 'sentences'} onChangeText={value => { setDraft(previous => ({ ...previous, [field.key]: value })); setError(''); }} />
      </View>)}
      <Text style={styles.previewLabel}>Preview</Text>
      <View accessibilityLabel="Receipt branding preview" style={styles.preview}>
        {draft.logo ? <Image accessibilityLabel="Receipt logo in preview" source={{ uri: `data:${draft.logo.mimeType};base64,${draft.logo.base64}` }} resizeMode="contain" style={styles.logo} /> : null}
        {draft.name.trim() ? <Text style={styles.business}>{draft.name.trim()}</Text> : null}
        {draft.contact.trim() ? <Text style={styles.contact}>{draft.contact.trim()}</Text> : null}
        <Text style={styles.receiptTitle}>Payment receipt</Text>
        <View style={styles.details}><Text style={styles.detailsText}>Payment details</Text></View>
        {draft.footer.trim() ? <Text style={styles.contact}>{draft.footer.trim()}</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save receipt settings" accessibilityState={{ disabled: busy || preparingLogo || !dirty, busy }} disabled={busy || preparingLogo || !dirty} onPress={() => { void save(); }} style={[styles.save, !dirty && styles.disabled]}>{busy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.saveText}>Save</Text>}</TouchableOpacity>
    </ScrollView>}
  </View>;
}
function makeStyles(colors: { background: string; primary: string; inversePrimary: string; surface: string; muted: string; border: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background }, scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
    field: { marginBottom: 18 }, label: { color: colors.muted, fontSize: 12, marginBottom: 8 },
    logo: { width: 120, height: 80, alignSelf: 'flex-start', marginBottom: 8 },
    logoProgress: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    logoActions: { flexDirection: 'row', gap: 12 }, logoButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border }, logoButtonText: { color: colors.primary, fontSize: 12 },
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

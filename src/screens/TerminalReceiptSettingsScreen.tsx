import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Keyboard, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { TerminalNetwork } from '../services/terminal';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, normalizeTerminalReceiptBranding, saveTerminalReceiptBranding, TerminalReceiptBranding } from '../services/terminalReceiptBranding';
import { importTerminalReceiptLogo } from '../services/terminalReceiptLogoImport';
import { createTerminalReceiptTemplate, loadTerminalReceiptTemplates, removeTerminalReceiptTemplate, replaceTerminalReceiptTemplate, TerminalReceiptTemplate } from '../services/terminalReceiptTemplates';
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
  const [pendingAction, setPendingAction] = useState<'settings' | 'template' | 'delete' | null>(null);
  const busy = pendingAction !== null;
  const [preparingLogo, setPreparingLogo] = useState(false);
  const [state, setState] = useState<{ scope: string; ready: boolean; loading: boolean; error: boolean; saved: TerminalReceiptBranding }>({ scope, ready: false, loading: true, error: false, saved: DEFAULT_TERMINAL_RECEIPT_BRANDING });
  const [draft, setDraft] = useState<TerminalReceiptBranding>(DEFAULT_TERMINAL_RECEIPT_BRANDING);
  const [error, setError] = useState('');
  const [library, setLibrary] = useState<{ scope: string; items: TerminalReceiptTemplate[]; loading: boolean; error: boolean }>({ scope, items: [], loading: true, error: false });
  const libraryGeneration = useRef(0);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
  const libraryReady = library.scope === scope && !library.loading && !library.error;
  const templates = libraryReady ? library.items : [];
  const loadedTemplate = templates.find(item => item.id === loadedTemplateId);
  const equalBranding = (a: TerminalReceiptBranding, b: TerminalReceiptBranding) => fields.every(field => a[field.key].trim() === b[field.key].trim()) && a.logo?.mimeType === b.logo?.mimeType && a.logo?.base64 === b.logo?.base64;
  const canEdit = () => owner && context.current.owner && context.current.scope === scope && ready && !busyRef.current && !pickingRef.current;
  const loadTemplates = async () => {
    if (!owner || !context.current.owner) return;
    const request = ++libraryGeneration.current, epoch = context.current.epoch;
    setLibrary(previous => ({ scope, items: previous.scope === scope ? previous.items : [], loading: true, error: false }));
    try {
      const items = await loadTerminalReceiptTemplates(walletId, network);
      if (mounted.current && request === libraryGeneration.current && context.current.epoch === epoch) setLibrary({ scope, items, loading: false, error: false });
    } catch {
      if (mounted.current && request === libraryGeneration.current && context.current.epoch === epoch) setLibrary({ scope, items: [], loading: false, error: true });
    }
  };
  useEffect(() => {
    setTemplatesOpen(false); setNaming(false); setTemplateName(''); setLoadedTemplateId(null); setTemplateError('');
    void loadTemplates(); return () => { ++libraryGeneration.current; };
  }, [scope, owner]);
  const loadTemplate = (template?: TerminalReceiptTemplate) => {
    if (!canEdit() || !libraryReady) return;
    setDraft(normalizeTerminalReceiptBranding(template?.branding ?? DEFAULT_TERMINAL_RECEIPT_BRANDING));
    setLoadedTemplateId(template?.id ?? null); setTemplatesOpen(false); setNaming(false); setTemplateName(''); setError(''); setTemplateError(''); Keyboard.dismiss();
  };
  const changeTemplate = async (operation: 'create' | 'replace' | 'delete', template?: TerminalReceiptTemplate) => {
    if (!canEdit() || !libraryReady || (operation !== 'create' && !template)) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.owner && context.current.scope === scope && context.current.epoch === epoch;
    busyRef.current = true; setPendingAction(operation === 'delete' ? 'delete' : 'template'); setDeletingId(operation === 'delete' ? template!.id : null); setTemplateError(''); Keyboard.dismiss();
    try {
      const items = operation === 'create' ? await createTerminalReceiptTemplate(walletId, network, templateName, draft, isCurrent)
        : operation === 'replace' ? await replaceTerminalReceiptTemplate(walletId, network, template!.id, draft, isCurrent)
        : await removeTerminalReceiptTemplate(walletId, network, template!.id, isCurrent);
      if (!isCurrent()) return;
      setLibrary({ scope, items, loading: false, error: false });
      if (operation === 'create') {
        setLoadedTemplateId(items.find(item => item.name === templateName.trim())?.id ?? null); setNaming(false); setTemplateName('');
      } else if (operation === 'delete' && loadedTemplateId === template!.id) setLoadedTemplateId(null);
    } catch (failure) {
      if (isCurrent()) {
        const message = failure instanceof Error ? failure.message : '';
        setTemplateError(message === 'Invalid receipt template name.' ? 'Use a name of 1–40 characters without control characters.'
          : message === 'Standard is reserved for the default receipt.' ? message
          : message === 'Receipt template name already exists.' ? 'A template with this name already exists.'
          : message === 'Receipt template limit reached.' ? 'You can save up to 5 templates.'
          : message === 'Invalid receipt branding.' ? 'Use single-line receipt details within the field limits.' : 'Couldn’t save templates. Try again.');
      }
    } finally { busyRef.current = false; if (mounted.current) { setPendingAction(null); setDeletingId(null); } }
  };
  const deleteTemplate = (template: TerminalReceiptTemplate) => {
    if (!canEdit() || !libraryReady) return;
    const epoch = context.current.epoch;
    Alert.alert('Delete template?', template.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { if (context.current.epoch === epoch) void changeTemplate('delete', template); } }]);
  };
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
    if (!canEdit() || naming || !dirty) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.owner && context.current.epoch === epoch;
    busyRef.current = true; setPendingAction('settings'); setError('');
    try {
      await saveTerminalReceiptBranding(walletId, network, draft, isCurrent);
      if (isCurrent()) { Keyboard.dismiss(); onClose(); }
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error && failure.message === 'Invalid receipt branding.' ? 'Use single-line text within the field limits.' : 'Couldn’t save receipt details. Try again.');
    } finally { busyRef.current = false; if (mounted.current) setPendingAction(null); }
  };
  return <View style={styles.root}>
    <TerminalSheetHeader title="Receipts" closeLabel="Close receipt settings" disabled={busy} onClose={() => { if (!busyRef.current) onClose(); }} />
    {!allowed ? <Text style={styles.message}>Owner access is required to edit receipts.</Text> : state.loading || state.scope !== scope ? <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading receipt settings" size="small" color={theme.colors.bitcoin} /></View> : state.error ? <View style={styles.failure}><Text style={styles.message}>Receipt settings unavailable.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry receipt settings" onPress={() => { void load(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.templates}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Load receipt template" accessibilityState={{ expanded: templatesOpen, disabled: busy || preparingLogo }} disabled={busy || preparingLogo} onPress={() => { if (canEdit()) { Keyboard.dismiss(); setTemplatesOpen(value => !value); } }} style={styles.templatesRow}>
          <Text style={styles.templatesTitle}>Templates</Text>
          <View style={styles.templatesEnd}>{library.loading || library.scope !== scope ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : libraryReady ? <Text style={styles.templateCount}>{templates.length}</Text> : null}<Feather name={templatesOpen ? 'chevron-down' : 'chevron-right'} size={20} color={theme.colors.primary} /></View>
        </TouchableOpacity>
        {templatesOpen && library.error ? <View><Text style={styles.message}>Templates unavailable. Your receipt settings are unchanged.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry receipt templates" onPress={() => { void loadTemplates(); }} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : null}
        {templatesOpen && libraryReady ? <View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Load standard receipt" disabled={busy || preparingLogo} onPress={() => loadTemplate()} style={styles.templateRow}><Text style={styles.templateTitle}>Standard</Text><Feather name="chevron-right" size={18} color={theme.colors.primary} /></TouchableOpacity>
          {templates.map(template => <View key={template.id} style={styles.templateRow}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Load template ${template.name}`} disabled={busy || preparingLogo} onPress={() => loadTemplate(template)} style={styles.templateLoad}><Text style={styles.templateTitle}>{template.name}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Delete template ${template.name}`} disabled={busy || preparingLogo} onPress={() => deleteTemplate(template)} style={styles.templateDelete}>{deletingId === template.id ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Feather name="trash-2" size={17} color={theme.colors.primary} />}</TouchableOpacity>
          </View>)}
        </View> : null}
      </View>
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
      <View style={styles.templateActions}>
        {naming ? <>
          <Text style={styles.label}>Template name</Text>
          <StyledInput accessibilityLabel="Receipt template name" value={templateName} maxLength={40} autoFocus editable={!busy} autoCorrect={false} returnKeyType="done" onChangeText={value => { setTemplateName(value); setTemplateError(''); }} onSubmitEditing={() => { if (templateName.trim()) void changeTemplate('create'); }} />
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save receipt template" accessibilityState={{ disabled: busy || preparingLogo || !templateName.trim(), busy: pendingAction === 'template' }} disabled={busy || preparingLogo || !templateName.trim()} onPress={() => { void changeTemplate('create'); }} style={[styles.templateButton, !templateName.trim() && styles.disabled]}>{pendingAction === 'template' ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.templateButtonText}>Save template</Text>}</TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel saving template" disabled={busy} onPress={() => { if (canEdit()) { setNaming(false); setTemplateName(''); setTemplateError(''); Keyboard.dismiss(); } }} style={styles.templateCancel}><Text style={styles.templateButtonText}>Cancel</Text></TouchableOpacity>
        </> : <>
          {loadedTemplate && !equalBranding(loadedTemplate.branding, draft) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Replace receipt template ${loadedTemplate.name}`} disabled={busy || preparingLogo} onPress={() => { void changeTemplate('replace', loadedTemplate); }} style={styles.templateButton}>{pendingAction === 'template' ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.templateButtonText}>Replace “{loadedTemplate.name}”</Text>}</TouchableOpacity> : null}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save as receipt template" disabled={busy || preparingLogo || !libraryReady || templates.length >= 5} accessibilityState={{ disabled: busy || preparingLogo || !libraryReady || templates.length >= 5 }} onPress={() => { if (canEdit() && libraryReady && templates.length < 5) { setNaming(true); setTemplateName(''); setTemplateError(''); } }} style={[styles.templateButton, (!libraryReady || templates.length >= 5) && styles.disabled]}><Text style={styles.templateButtonText}>Save as template</Text></TouchableOpacity>
          {libraryReady && templates.length >= 5 ? <Text style={styles.message}>Maximum of 5 templates.</Text> : null}
        </>}
        {templateError ? <Text accessibilityRole="alert" style={styles.message}>{templateError}</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.message}>{error}</Text> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save receipt settings" accessibilityState={{ disabled: busy || preparingLogo || naming || !dirty, busy }} disabled={busy || preparingLogo || naming || !dirty} onPress={() => { void save(); }} style={[styles.save, !dirty && styles.disabled]}>{pendingAction === 'settings' ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.saveText}>Save</Text>}</TouchableOpacity>
    </ScrollView>}
  </View>;
}
function makeStyles(colors: { background: string; primary: string; inversePrimary: string; surface: string; muted: string; border: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background }, scroll: { flex: 1, minHeight: 0 }, content: { paddingHorizontal: 24, paddingTop: 20 },
    templates: { marginBottom: 20 }, templatesRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, templatesTitle: { color: colors.muted, fontSize: 16 }, templatesEnd: { flexDirection: 'row', alignItems: 'center', gap: 10 }, templateCount: { color: colors.primary, fontSize: 14 },
    templateRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border }, templateLoad: { flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: 10 }, templateTitle: { color: colors.primary, fontSize: 14, flexShrink: 1 }, templateDelete: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
    templateActions: { marginTop: 18 }, templateButton: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, marginTop: 12 }, templateButtonText: { color: colors.primary, fontSize: 13, fontFamily: 'SpaceMono-Bold', textAlign: 'center' }, templateCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { randomBytes } from 'crypto';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import { TerminalNetwork } from '../services/terminal';
import { createTerminalBackup, disposeTerminalBackup, inspectTerminalBackup, removeTerminalBackupFile, restoreTerminalBackup, TerminalBackupPreview } from '../services/terminalBackup';
import TerminalSheetHeader from './TerminalSheetHeader';

type Props = { walletId: string; network: TerminalNetwork; onClose: () => void };
export default function TerminalBackupScreen({ walletId, network, onClose }: Props) {
  const { theme } = useTheme(), activeWallet = useActiveWallet(), { cashierState } = useWalletMode();
  const focused = useIsFocused(), navigation = useNavigation(), insets = useSafeAreaInsets();
  const owner = focused && activeWallet?.id === walletId && activeWallet.type !== 'watch-only' && cashierState === 'off';
  const scope = `${walletId}:${network}:${activeWallet?.xpub ?? ''}`;
  const context = useRef({ scope, owner, epoch: 0 });
  if (context.current.scope !== scope || context.current.owner !== owner) context.current = { scope, owner, epoch: context.current.epoch + 1 };
  const mounted = useRef(true), busyRef = useRef(false), previewRef = useRef<TerminalBackupPreview | null>(null), fileRef = useRef('');
  const [mode, setMode] = useState<'create' | 'restore'>('create');
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [fileName, setFileName] = useState(''), [error, setError] = useState('');
  const [preview, setPreview] = useState<TerminalBackupPreview | null>(null);
  const styles = makeStyles(theme.colors);
  const count = (amount: number, noun: string) => `${amount.toLocaleString()} ${noun}${amount === 1 ? '' : 's'}`;
  const clearPreview = () => { const value = previewRef.current; previewRef.current = null; if (value) void disposeTerminalBackup(value).catch(() => undefined); setPreview(null); };
  const clearFile = () => { if (fileRef.current) removeTerminalBackupFile(fileRef.current); fileRef.current = ''; setFileName(''); };
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; const value = previewRef.current; previewRef.current = null;
    if (value) void disposeTerminalBackup(value).catch(() => undefined); if (fileRef.current) removeTerminalBackupFile(fileRef.current);
  }; }, []);
  useEffect(() => { if (!owner) { setPassword(''); setConfirmation(''); clearPreview(); clearFile(); } }, [owner, scope]);
  useLayoutEffect(() => { navigation.setOptions({ gestureEnabled: !busy }); }, [busy, navigation]);
  const selectMode = (next: 'create' | 'restore') => {
    if (busyRef.current || next === mode) return;
    clearPreview(); clearFile(); setMode(next); setPassword(''); setConfirmation(''); setError(''); Keyboard.dismiss();
  };
  const run = async (operation: (isCurrent: () => boolean) => Promise<void>) => {
    if (!owner || !activeWallet?.xpub || busyRef.current) return;
    const epoch = context.current.epoch;
    const isCurrent = () => mounted.current && context.current.owner && context.current.epoch === epoch;
    busyRef.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try { await operation(isCurrent); }
    catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : 'Couldn’t complete the backup. Try again.'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const identity = { walletId, network, xpub: activeWallet?.xpub ?? '' };
  const chooseFile = () => run(async isCurrent => {
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !isCurrent()) return;
    const source = new File(picked.assets[0].uri);
    if (!source.exists || source.size < 100 || source.size > 100 * 1024 * 1024) throw new Error('Choose a Terminal backup up to 100 MB.');
    const owned = new File(Paths.cache, `terminal-import-${randomBytes(16).toString('hex')}.trustless`);
    source.copy(owned);
    if (!isCurrent()) { removeTerminalBackupFile(owned.uri); return; }
    clearPreview(); clearFile(); fileRef.current = owned.uri; setFileName(picked.assets[0].name || 'Terminal backup'); setPassword('');
  });
  const create = () => run(async isCurrent => {
    if (password !== confirmation) throw new Error('Passwords don’t match.');
    if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
    if (!isCurrent()) return;
    const backup = await createTerminalBackup(identity, password, isCurrent);
    try {
      if (isCurrent()) await Sharing.shareAsync(backup.uri, { mimeType: 'application/octet-stream', dialogTitle: 'Save encrypted Terminal backup', UTI: 'public.data' });
      if (isCurrent()) { setPassword(''); setConfirmation(''); }
    } finally { removeTerminalBackupFile(backup.uri); }
  });
  const unlock = () => run(async isCurrent => {
    const unlocked = await inspectTerminalBackup(fileRef.current, identity, password, isCurrent);
    if (!isCurrent()) { await disposeTerminalBackup(unlocked); return; }
    clearPreview(); previewRef.current = unlocked; setPreview(unlocked); setPassword('');
  });
  const restore = () => run(async isCurrent => {
    const value = previewRef.current; if (!value) return;
    try { await restoreTerminalBackup(value, identity, isCurrent); }
    finally { previewRef.current = null; if (mounted.current) setPreview(null); }
    if (isCurrent()) { clearFile(); onClose(); }
  });
  const action = (label: string, disabled: boolean, onPress: () => void, secondary = false) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={[styles.button, secondary && styles.secondary, (disabled || (busy && secondary)) && styles.disabled]}>
    {busy && !secondary ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>}
  </TouchableOpacity>;
  return <View style={styles.root}>
    <TerminalSheetHeader title="Backup" closeLabel="Close terminal backup" disabled={busy} onClose={() => { if (!busyRef.current) onClose(); }} />
    {!owner ? <Text style={styles.note}>Owner access is required.</Text> : <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.tabs}>{(['create', 'restore'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={value === 'create' ? 'Create backup tab' : 'Restore backup tab'} accessibilityState={{ selected: mode === value, disabled: busy }} disabled={busy} onPress={() => selectMode(value)} style={[styles.tab, mode === value && styles.selected]}><Text style={[styles.tabText, mode === value && styles.selectedText]}>{value === 'create' ? 'Create' : 'Restore'}</Text></TouchableOpacity>)}</View>
      <Text style={styles.note}>Sales, refunds and saved items. No wallet recovery material is included.</Text>
      {mode === 'create' ? <>
        <View style={styles.field}><Text style={styles.label}>Password</Text><StyledInput accessibilityLabel="Backup password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={1024} editable={!busy} style={styles.input} /></View>
        <View style={styles.field}><Text style={styles.label}>Confirm password</Text><StyledInput accessibilityLabel="Confirm backup password" value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={1024} editable={!busy} style={styles.input} /></View>
        <Text style={styles.note}>Use at least 12 characters. Keep the password safe; it cannot be recovered.</Text>
        {action('Create backup', password.length < 12 || !confirmation || !activeWallet?.xpub, () => { void create(); })}
      </> : <>
        {action(fileName ? 'Choose another backup' : 'Choose backup', !activeWallet?.xpub, () => { void chooseFile(); }, true)}
        {fileName ? <Text style={styles.fileName} numberOfLines={2}>{fileName}</Text> : null}
        {preview ? <>
          <View style={styles.summary}><Text style={styles.date}>{new Date(preview.createdAt).toLocaleString()}</Text><Text style={styles.summaryText}>{count(preview.sales, 'sale')} · {count(preview.refunds, 'refund')} · {count(preview.items, 'item')}</Text></View>
          <Text style={styles.note}>Requires an empty history and item catalog. Refunds from restored sales stay disabled: a backup may omit later refunds.</Text>
          {action('Restore backup', preview.sales + preview.refunds + preview.items === 0, () => { void restore(); })}
        </> : fileName ? <>
          <View style={styles.field}><Text style={styles.label}>Password</Text><StyledInput accessibilityLabel="Restore backup password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} maxLength={1024} editable={!busy} style={styles.input} /></View>
          {action('Unlock backup', password.length < 12, () => { void unlock(); })}
        </> : <Text style={styles.note}>Choose an encrypted Terminal backup for this wallet and network.</Text>}
      </>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>}
  </View>;
}
function makeStyles(colors: { background: string; primary: string; muted: string; surface: string; border: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background }, scroll: { flex: 1 }, content: { padding: 24 },
    tabs: { flexDirection: 'row', marginBottom: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
    tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, selected: { borderBottomColor: colors.primary },
    tabText: { color: colors.muted, fontSize: 14, fontFamily: 'SpaceMono-Bold' }, selectedText: { color: colors.primary },
    note: { color: colors.muted, fontSize: 12, lineHeight: 19, marginBottom: 24 }, field: { marginBottom: 20 }, label: { color: colors.muted, fontSize: 13, marginBottom: 8 },
    input: { backgroundColor: colors.surface, color: colors.primary, borderRadius: 12, padding: 14, fontSize: 16 },
    button: { minHeight: 52, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', padding: 14, marginBottom: 16 },
    buttonText: { fontSize: 16, fontFamily: 'SpaceMono-Bold', color: colors.background }, secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }, secondaryText: { color: colors.primary }, disabled: { opacity: 0.45 },
    fileName: { fontSize: 12, lineHeight: 18, color: colors.muted, marginBottom: 20 }, summary: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, marginBottom: 20 }, date: { color: colors.muted, fontSize: 12, marginBottom: 8 }, summaryText: { color: colors.primary, fontSize: 15, fontFamily: 'SpaceMono-Bold' }, error: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  });
}

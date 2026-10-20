import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Keyboard, Platform, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useHeaderHeight } from '@react-navigation/elements';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { PrepareUnilateralExitResponse } from '@breeztech/breez-sdk-spark-react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { IS_TESTNET } from '../constants/network';
import { authenticate_transaction_action } from '../services/authState';
import { loadExit } from '../services/exitStorage';
import { encodeExit, exportExitBackup, importExitBackup } from '../services/exitCodec';
import { Broadcaster, loadBroadcaster, saveBroadcaster, testBroadcaster } from '../services/packageBroadcaster';
import { broadcastReady, buildExit, checkExit, ExitRecord, FundingCoin, quoteExit, recoveryCoins, restoreExit } from '../services/unilateralExit';

export function UnilateralExitScreen() {
    const { theme } = useTheme();
    const { activeWallet, isLightningInitialized, runLightningRecovery } = useWallet();
    const navigation = useNavigation<any>();
    const focused = useIsFocused();
    const scrollViewRef = useRef<ScrollView>(null);
    const viewportHeight = useRef(0);
    const windowHeight = useWindowDimensions().height;
    const headerHeight = useHeaderHeight();
    const headerOverlap = Platform.OS === 'ios' ? headerHeight : 0;
    // iOS form sheets give Yoga an unbounded content height. Pin the React layout
    // to the native viewport so adding a quote/message cannot expand the scroll
    // view to its full content height and clamp its offset back to zero.
    const [scrollHeight, setScrollHeight] = useState(windowHeight);
    useEffect(() => { setScrollHeight(windowHeight); }, [windowHeight]);
    const scrollOffset = useRef(0);
    const keyboardHeight = useRef(0);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const focusedField = useRef<{ section: string; field: string } | null>(null);
    const sections = useRef<Record<string, number>>({});
    const fields = useRef<Record<string, { y: number; height: number }>>({});
    const actions = useRef<Record<string, number>>({});
    const frame = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Coalesce focus and keyboard frame notifications (including password bars)
    // into one scroll, rather than starting competing animations.
    const revealFocusedField = () => {
        if (frame.current !== null) clearTimeout(frame.current);
        frame.current = setTimeout(() => {
            frame.current = null;
            const current = focusedField.current;
            if (!current || !keyboardHeight.current || !viewportHeight.current) return;
            const visibleHeight = viewportHeight.current - headerOverlap - (Platform.OS === 'ios' ? keyboardHeight.current : 0);
            const field = fields.current[current.field];
            const sectionY = sections.current[current.section];
            if (!field || sectionY === undefined || visibleHeight <= 0) return;
            const top = sectionY + field.y;
            const actionKey = current.field === 'confirmation' ? 'build' : current.section;
            const bottom = sectionY + (actions.current[actionKey] ?? field.y + field.height);
            // Prioritize the field if a small viewport cannot fit the whole group.
            const target = Math.max(0, Math.min(bottom - visibleHeight + 16, top - 16));
            if (Math.abs(target - scrollOffset.current) > 1) scrollViewRef.current?.scrollTo({ y: target, animated: true });
        }, 80);
    };
    const focusField = (section: string, field: string) => {
        focusedField.current = { section, field };
        keyboardHeight.current = Keyboard.metrics()?.height ?? keyboardHeight.current;
        revealFocusedField();
    };
    const blurField = (field: string) => {
        if (focusedField.current?.field === field) focusedField.current = null;
    };
    useEffect(() => {
        const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow', event => {
            keyboardHeight.current = event.endCoordinates.height;
            setKeyboardInset(Platform.OS === 'ios' ? event.endCoordinates.height : 0);
            revealFocusedField();
        });
        const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
            keyboardHeight.current = 0;
            setKeyboardInset(0);
        });
        return () => {
            show.remove(); hide.remove();
            if (frame.current !== null) clearTimeout(frame.current);
        };
    }, [headerOverlap]);
    const runRef = useRef(runLightningRecovery); runRef.current = runLightningRecovery;
    const walletRef = useRef(activeWallet?.id); walletRef.current = activeWallet?.id;
    const working = useRef(false);
    const [busy, setBusy] = useState(false);
    const [quoteLoading, setQuoteLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState('');
    const [quoteError, setQuoteError] = useState('');
    const [record, setRecord] = useState<ExitRecord | null>(null);
    const recordRef = useRef(record); recordRef.current = record;
    const [config, setConfig] = useState<Broadcaster>({ url: '', username: '', password: '' });
    const [connection, setConnection] = useState('');
    const [destination, setDestination] = useState('');
    const [fee, setFee] = useState('2');
    const [quote, setQuote] = useState<PrepareUnilateralExitResponse | null>(null);
    const [coins, setCoins] = useState<FundingCoin[]>([]);
    const [coin, setCoin] = useState<FundingCoin | null>(null);
    const [confirmation, setConfirmation] = useState('');
    const [password, setPassword] = useState('');
    const [backupSaved, setBackupSaved] = useState(false);
    const [exported, setExported] = useState(false);
    const styles = StyleSheet.create({
        page: { flex: 1, backgroundColor: theme.colors.background },
        content: { paddingTop: 20, paddingBottom: 32, paddingHorizontal: 20, gap: 20, },
        card: { padding: 20, backgroundColor: theme.colors.surface, borderRadius: 20, gap: 16 },
        title: { fontSize: 20, fontWeight: '600', color: theme.colors.primary },
        body: { color: theme.colors.muted, fontSize: 14, lineHeight: 22 },
        button: { backgroundColor: theme.colors.primary, padding: 16, minHeight: 52, borderRadius: theme.LAYOUT.radius, alignItems: 'center' },
        label: { color: theme.colors.inversePrimary, fontWeight: '600' },
        error: { color: theme.colors.error, lineHeight: 22 },
        hero: { alignItems: 'center', gap: 12, paddingVertical: 12 },
        heroTitle: { fontSize: 27, fontWeight: '700', color: theme.colors.primary, textAlign: 'center' },
        sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
        fieldLabel: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
        amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
        amountLabel: { flex: 1, color: theme.colors.muted, fontSize: 14 },
        amountValue: { color: theme.colors.primary, fontWeight: '600', fontSize: 14 },
        quote: { backgroundColor: theme.colors.background, borderRadius: 14, padding: 16, gap: 14 },
        coin: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.LAYOUT.radius, padding: 14, minHeight: 50, backgroundColor: theme.colors.background, justifyContent: 'center' },
        selectedCoin: { borderColor: theme.colors.primary, borderWidth: 2 },
        transaction: { backgroundColor: theme.colors.background, padding: 14, borderRadius: 12, gap: 8 },
        txid: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: theme.colors.muted },
        status: { color: theme.colors.primary, fontWeight: '600', fontSize: 13 },
        checkbox: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
    });
    const usable = loaded && isLightningInitialized && !IS_TESTNET && activeWallet?.type !== 'watch-only';
    const execute = async (task: () => Promise<void>, allowOffline = false, errorLocation: 'general' | 'quote' = 'general') => {
        if (working.current || (!usable && !allowOffline)) return;
        const id = walletRef.current;
        working.current = true; setBusy(true); setQuoteLoading(errorLocation === 'quote');
        // Keep the previous quote/message visible while retrying, so the sheet
        // does not collapse and expand the same content on every request.
        if (errorLocation !== 'quote') setError('');
        try { await task(); }
        catch (e) {
            if (walletRef.current === id) {
                const message = e instanceof Error ? e.message : 'Recovery operation failed.';
                if (errorLocation === 'quote') {
                    setQuoteError(message);
                }
                else setError(message);
                // A build or broadcast may have persisted newer state before an error.
                if (id && errorLocation !== 'quote') try { setRecord(await loadExit(id)); } catch { /* Keep original error visible. */ }
            }
        } finally { working.current = false; setBusy(false); setQuoteLoading(false); }
    };
    useEffect(() => {
        let cancelled = false;
        setLoaded(false); setRecord(null); setQuote(null); setCoin(null); setCoins([]);
        setConfirmation(''); setBackupSaved(false); setExported(false); setPassword(''); setError(''); setQuoteError('');
        if (!activeWallet) return;
        const id = activeWallet.id;
        Promise.all([loadExit(id), loadBroadcaster()]).then(([saved, rpc]) => {
            if (cancelled) return;
            setRecord(saved); if (rpc) setConfig(rpc);
            setDestination(saved?.destination || activeWallet.address);
            setFee(saved?.quote.feeRateSatPerVbyte.toString() || '2');
            setLoaded(true);
        }).catch(() => { if (!cancelled) setError('Cannot load recovery storage. Do not start another exit; restore access to the saved record first.'); });
        return () => { cancelled = true; };
    }, [activeWallet?.id]);
    useEffect(() => {
        if (!focused || !usable) return;
        const refresh = () => {
            const current = recordRef.current;
            if (!current?.response || current.phase === 'done' || working.current || AppState.currentState !== 'active') return;
            void execute(async () => { setRecord(await runRef.current(access => checkExit(access, current))); });
        };
        refresh();
        const interval = setInterval(refresh, 30000);
        const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
        return () => { clearInterval(interval); subscription.remove(); };
    }, [focused, usable, activeWallet?.id]);

    const button = (label: string, action: () => void, enabled = true, loading = false, section?: string) => <TouchableOpacity onLayout={section ? event => { actions.current[section] = event.nativeEvent.layout.y + event.nativeEvent.layout.height; } : undefined} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy || !enabled, busy: loading }} disabled={busy || !enabled} style={[styles.button, (busy || !enabled) && !loading && { opacity: 0.4 }]} onPress={action}><Text style={[styles.label, loading && { opacity: 0 }]}>{label}</Text>{loading && <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={theme.colors.bitcoin} /></View>}</TouchableOpacity>;
    const sectionHeading = (icon: React.ComponentProps<typeof Feather>['name'], title: string) => <View style={styles.sectionHeading}><Feather name={icon} size={20} color={theme.colors.primary} /><Text style={[styles.title, { flex: 1 }]}>{title}</Text></View>;
    const amountRow = (label: string, value: bigint) => <View style={styles.amountRow}><Text style={styles.amountLabel}>{label}</Text><Text style={styles.amountValue}>{value.toLocaleString()} sats</Text></View>;
    const changeConfig = (next: Broadcaster) => { setConfig(next); setConnection(''); };
    const review = () => execute(async () => {
        focusedField.current = null;
        Keyboard.dismiss();
        const next = await runRef.current(async access => {
            const prepared = await quoteExit(access, record?.destination || destination.trim(), fee, record || undefined);
            return { prepared, available: record ? [record.funding] : await recoveryCoins(access) };
        });
        setQuoteError('');
        setQuote(next.prepared); setCoins(next.available); setCoin(null); setConfirmation('');
    }, false, 'quote');
    const build = () => execute(async () => {
        if (!quote || !coin || confirmation !== 'EXIT') return;
        if (!await authenticate_transaction_action('Authorize unilateral exit')) return;
        const next = await runRef.current(access => buildExit(access, quote, coin, record || undefined), true);
        setRecord(next); setQuote(null); setBackupSaved(false); setExported(false);
    });
    const exportBackup = () => execute(async () => {
        if (!record || !await authenticate_transaction_action('Export recovery backup')) return;
        const encrypted = await exportExitBackup(record, password);
        const file = new File(Paths.cache, 'trustless-recovery-backup.json');
        try {
            file.write(encrypted);
            if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
            await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save encrypted recovery backup', UTI: 'public.json' });
            setExported(true);
        } finally { if (file.exists) file.delete(); }
    }, true);
    const exportPackages = () => execute(async () => {
        if (!record || !backupSaved || !await authenticate_transaction_action('Export signed recovery transactions')) return;
        const current = await runRef.current(access => checkExit(access, record));
        setRecord(current);
        if (current.phase !== 'active' || !current.response) throw new Error('No ready recovery packages.');
        const confirmed = new Set(current.response.transactions.filter(tx => tx.status.tag === 'Confirmed').map(tx => tx.txid));
        const packages = current.response.transactions
            .filter(tx => tx.status.tag === 'Ready' && tx.dependsOn.every(id => confirmed.has(id)))
            .map(tx => ({ txid: tx.txid, method: tx.cpfpTxHex ? 'submitpackage' : 'sendrawtransaction',
                params: tx.cpfpTxHex ? [[tx.txHex, tx.cpfpTxHex]] : [tx.txHex] }));
        if (!packages.length) throw new Error('No transactions are ready yet.');
        const file = new File(Paths.cache, 'trustless-ready-packages.json');
        try {
            file.write(encodeExit({ network: 'mainnet', destination: current.destination, packages }));
            if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
            await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export signed transaction packages', UTI: 'public.json' });
        } finally { if (file.exists) file.delete(); }
    });
    const importBackup = () => execute(async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain'], copyToCacheDirectory: true });
        if (picked.canceled) return;
        const file = new File(picked.assets[0].uri);
        try {
            if (file.size > 30 * 1024 * 1024) throw new Error('Recovery backup is too large.');
            const imported = await importExitBackup<ExitRecord>(await file.text(), password);
            if (!await authenticate_transaction_action('Restore recovery backup')) return;
            setRecord(await runRef.current(access => restoreExit(access, imported), true));
        } finally { if (file.exists) file.delete(); }
    });

    return <ScrollView ref={scrollViewRef} style={[styles.page, Platform.OS === 'ios' && { flex: 0, height: scrollHeight }]}
        contentContainerStyle={styles.content}
        contentInset={{ bottom: keyboardInset + headerOverlap }}
        automaticallyAdjustKeyboardInsets={false}
        onScroll={event => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
            const height = event.nativeEvent.layoutMeasurement.height;
            if (height !== viewportHeight.current) { viewportHeight.current = height; setScrollHeight(height); revealFocusedField(); }
        }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" bounces={false}>
        <View style={styles.hero}>
            <Text style={styles.heroTitle}>Lightning Recovery</Text>
            <Text style={[styles.body, { textAlign: 'center' }]}>An independent path back to Bitcoin.</Text>
        </View>
        <Text style={styles.body}>Recover this wallet’s Spark funds to Bitcoin without operator approval. This can take days and requires separate on-chain funds for mining fees. Normal withdrawal is usually cheaper and faster. During recovery, do not use this wallet in another app or spend its fee-funding output.</Text>
        {!record && button('Normal withdrawal', () => navigation.navigate('WithdrawToOnchain'), usable)}
        {IS_TESTNET && <Text style={styles.body}>This recovery flow supports mainnet only. The app’s Bitcoin testnet setting is not Spark regtest.</Text>}
        {!isLightningInitialized && <Text style={styles.body}>Waiting for the Lightning wallet to connect. A successful network sync is not required to resume saved recovery data.</Text>}
        {busy && !quoteLoading && <ActivityIndicator color={theme.colors.bitcoin} />}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <View style={styles.card} testID="broadcaster-section" onLayout={event => { sections.current.broadcaster = event.nativeEvent.layout.y; }}>
            {sectionHeading('server', 'Package broadcaster')}
            <Text style={styles.body}>Enter your HTTPS Bitcoin Core RPC or Alchemy Bitcoin mainnet URL. Alchemy format: https://bitcoin-mainnet.g.alchemy.com/v2/YOUR_API_KEY</Text>
            <Text style={styles.fieldLabel}>HTTPS RPC URL</Text>
            <View testID="rpcUrl-bounds" onLayout={event => { fields.current.rpcUrl = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="Broadcaster URL" containerStyle={{ backgroundColor: theme.colors.background }} value={config.url} onChangeText={url => changeConfig({ ...config, url })} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="HTTPS RPC URL" editable={!busy} onFocus={() => focusField('broadcaster', 'rpcUrl')} onBlur={() => blurField('rpcUrl')} />
            </View>
            <Text style={styles.fieldLabel}>Username (optional)</Text>
            <View testID="rpcUser-bounds" onLayout={event => { fields.current.rpcUser = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="RPC username" containerStyle={{ backgroundColor: theme.colors.background }} value={config.username} onChangeText={username => changeConfig({ ...config, username })} autoCapitalize="none" placeholder="RPC username (optional)" editable={!busy} onFocus={() => focusField('broadcaster', 'rpcUser')} onBlur={() => blurField('rpcUser')} />
            </View>
            <Text style={styles.fieldLabel}>Password (optional)</Text>
            <View testID="rpcPassword-bounds" onLayout={event => { fields.current.rpcPassword = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="RPC password" containerStyle={{ backgroundColor: theme.colors.background }} value={config.password} onChangeText={password => changeConfig({ ...config, password })} secureTextEntry placeholder="RPC password (optional)" editable={!busy} onFocus={() => focusField('broadcaster', 'rpcPassword')} onBlur={() => blurField('rpcPassword')} />
            </View>
            {button('Test and save broadcaster', () => execute(async () => { await testBroadcaster(config); await saveBroadcaster(config); setConnection('Mainnet connection and package submission method verified.'); }, true), !!config.url, false, 'broadcaster')}
            {!!connection && <Text style={styles.body}>{connection}</Text>}
        </View>
        {!record || record.phase === 'redo' || record.phase === 'building' ? <View style={styles.card} testID="review-section" onLayout={event => { sections.current.review = event.nativeEvent.layout.y; }}>
            {sectionHeading('sliders', record ? 'Rebuild remaining exit' : 'Review recovery')}
            {!record && <Text style={styles.body}>A quote only estimates the recovery and fees. After you review it, “Build and save exit” creates the recovery data and saves it encrypted on this device. You can then export your own backup.</Text>}
            <Text style={styles.fieldLabel}>Bitcoin destination</Text>
            <View testID="destination-bounds" onLayout={event => { fields.current.destination = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="Bitcoin destination" containerStyle={{ backgroundColor: theme.colors.background }} value={record?.destination || destination} onChangeText={text => { setDestination(text); setQuote(null); setQuoteError(''); }} autoCapitalize="none" autoCorrect={false} editable={!busy && !record} placeholder="Bitcoin destination address" onFocus={() => focusField('review', 'destination')} onBlur={() => blurField('destination')} />
            </View>
            <Text style={styles.fieldLabel}>Fee rate (sat/vB)</Text>
            <View testID="fee-bounds" onLayout={event => { fields.current.fee = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="Exit fee rate" containerStyle={{ backgroundColor: theme.colors.background }} value={fee} onChangeText={text => { setFee(text); setQuote(null); setQuoteError(''); }} keyboardType="number-pad" editable={!busy} onFocus={() => focusField('review', 'fee')} onBlur={() => blurField('fee')} />
            </View>
            {button('Get recovery quote', () => { void review(); }, usable, quoteLoading, 'review')}
            <Text accessibilityRole={quoteError ? "alert" : undefined} style={[styles.error, { minHeight: 22 }]}>{quoteError}</Text>
            {quote && <>
                <View style={styles.quote}>
                    {amountRow('Recoverable balance', quote.recoverableValueSat)}
                    {amountRow('Total mining fees', quote.totalFeeSat)}
                    {amountRow('Package fees', quote.cpfpFeeSat)}
                    {amountRow('Funding split fee', quote.fanoutFeeSat)}
                    {amountRow('Final sweep fee', quote.sweepFeeSat)}
                    {amountRow('Separate funding needed', quote.singleUtxoFundingSat)}
                    <Text style={styles.body}>{quote.leaves.length} selected portions</Text>
                </View>
                <Text style={styles.body}>Choose one confirmed native SegWit output from this wallet to fund the fees. Unspent funding returns to the destination.</Text>
                {coins.map(c => <TouchableOpacity key={`${c.txid}:${c.vout}`} disabled={busy || (!record && BigInt(c.value) < quote.singleUtxoFundingSat)} accessibilityRole="radio" accessibilityState={{ checked: coin?.txid === c.txid && coin.vout === c.vout }} onPress={() => setCoin(c)} style={[styles.coin, coin?.txid === c.txid && coin.vout === c.vout && styles.selectedCoin]}>
                    <Text>{coin?.txid === c.txid && coin.vout === c.vout ? '✓ ' : ''}{c.value} sats · {c.txid.slice(0, 10)}…:{c.vout}</Text>
                </TouchableOpacity>)}
                {!coins.length && <Text style={styles.body}>No eligible confirmed output found. Receive on-chain funds into this wallet, then request a new quote.</Text>}
                {coin && !record && <Text style={styles.body}>Expected total at the destination: {(quote.recoverableValueSat + BigInt(coin.value) - quote.totalFeeSat).toString()} sats, including unused funding.</Text>}
                <Text style={styles.body}>Once built, this wallet’s normal spending is paused to protect recovery funds. After broadcasting, an exit cannot be cancelled. Type EXIT to build and save the transactions.</Text>
                <View testID="confirmation-bounds" onLayout={event => { fields.current.confirmation = event.nativeEvent.layout; }}>
                    <StyledInput accessibilityLabel="Type EXIT" containerStyle={{ backgroundColor: theme.colors.background }} value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" editable={!busy} onFocus={() => focusField('review', 'confirmation')} onBlur={() => blurField('confirmation')} />
                </View>
                {button('Build and save exit', () => { void build(); }, usable && !!coin && confirmation === 'EXIT', false, 'build')}
            </>}
        </View> : null}
        {record && <View style={styles.card}>
            {sectionHeading(record.phase === 'done' ? 'check-circle' : 'clock', record.phase === 'done' ? 'Recovery completed' : 'Recovery progress')}
            <Text selectable style={styles.body}>Destination: {record.destination}</Text>
            {!!record.reason && <Text style={styles.body}>{record.reason}</Text>}
            {record.phase === 'building' && <Text style={styles.body}>Build was interrupted. Re-quote and build using the saved funding and original leaves.</Text>}
            {record.response?.transactions.map(tx => <View key={tx.txid} style={styles.transaction}>
                <Text selectable style={styles.txid}>{tx.txid}</Text>
                <Text style={styles.status}>{tx.status.tag === 'Confirmed' ? 'Confirmed' : tx.status.tag === 'Ready' ? 'Ready to broadcast' : tx.status.tag === 'WaitingForDependencies' ? 'Waiting for earlier confirmations' : tx.status.tag === 'WaitingForTimelock' ? `Waiting for timelock${tx.status.inner.spendableAtHeight ? ` · block ${tx.status.inner.spendableAtHeight}` : ''}` : 'Chain status could not be verified'}</Text>
            </View>)}
            {button('Check progress', () => execute(async () => { setRecord(await runRef.current(access => checkExit(access, record))); }), usable && !!record.response)}
            <Text style={styles.body}>Reopen this screen regularly to broadcast newly ready steps. iOS cannot guarantee continuous background execution. Keep your backup until the destination funds confirm.</Text>
            {record.phase !== 'done' && <>
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: backupSaved, disabled: !exported || busy }} style={[styles.checkbox, !exported && { opacity: 0.5 }]} disabled={!exported || busy} onPress={() => setBackupSaved(!backupSaved)}><Feather name={backupSaved ? 'check-square' : 'square'} size={22} color={theme.colors.primary} /><Text style={[styles.body, { flex: 1 }]}>I saved the encrypted backup outside this app.</Text></TouchableOpacity>
                <Text style={styles.body}>You can also export ready packages for another broadcaster. That file is unencrypted and allows anyone holding it to broadcast these signed transactions.</Text>
                {button('Export ready packages', () => { void exportPackages(); }, usable && backupSaved && record.phase === 'active')}
                {button('Broadcast ready steps', () => Alert.alert('Start or continue exit?', 'Ready transactions will be sent to your configured broadcaster. Confirmed steps cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' }, { text: 'Broadcast', style: 'destructive', onPress: () => execute(async () => {
                        if (!await authenticate_transaction_action('Broadcast unilateral exit')) return;
                        setRecord(await runRef.current(access => broadcastReady(access, record, config)));
                    }) },
                ]), usable && backupSaved && record.phase === 'active' && !!config.url && !!record.response?.transactions.some(t => t.status.tag === 'Ready'))}
            </>}
        </View>}
        <View style={styles.card} testID="backup-section" onLayout={event => { sections.current.backup = event.nativeEvent.layout.y; }}>
            {sectionHeading('lock', record ? 'Export recovery backup' : 'Import existing backup')}
            <Text style={styles.body}>{record
                ? 'Your recovery data is saved encrypted on this device. Export a separate file and keep it outside the app so you can restore it if this device is lost. Your seed alone may not replace this data.'
                : 'Import a backup file you previously exported for this wallet. After you build an exit on this device, this section changes to Export recovery backup. An existing local exit cannot be replaced by an imported file.'}</Text>
            {record && !record.response && <Text style={styles.body}>The build has not produced signed transactions yet. Finish the build and export a new backup before broadcasting.</Text>}
            <Text style={styles.body}>{record
                ? 'Choose a password of at least 12 characters to encrypt the exported file. Keep it separately; you will need it to import the file later. This is not your wallet password or seed.'
                : 'Enter the password you chose when exporting that backup. It is not your wallet password or seed.'}</Text>
            <Text style={styles.fieldLabel}>{record ? 'Choose backup file password' : 'Existing backup file password'}</Text>
            <View testID="backupPassword-bounds" onLayout={event => { fields.current.backupPassword = event.nativeEvent.layout; }}>
                <StyledInput accessibilityLabel="Backup file password" containerStyle={{ backgroundColor: theme.colors.background }} secureTextEntry value={password} onChangeText={setPassword} placeholder="At least 12 characters" editable={!busy} onFocus={() => focusField('backup', 'backupPassword')} onBlur={() => blurField('backupPassword')} />
            </View>
            {record ? button('Export encrypted backup', () => { void exportBackup(); }, password.length >= 12, false, 'backup') : button('Import encrypted backup', () => { void importBackup(); }, usable && password.length >= 12, false, 'backup')}
        </View>
    </ScrollView>;
}

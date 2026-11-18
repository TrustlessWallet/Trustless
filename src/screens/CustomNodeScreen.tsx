import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePreventRemove } from '@react-navigation/native';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import type { Theme } from '../constants/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import {
    CUSTOM_ELECTRUM_NODE_KEY, CUSTOM_NODE_ALLOW_SELF_SIGNED_KEY, CUSTOM_NODE_URL_KEY,
    getConnectedPeer, getElectrumClient, parseCustomNode, resetActiveConnection, test_custom_node_connection,
} from '../services/electrum';

const nodeKeys = [CUSTOM_NODE_URL_KEY, CUSTOM_ELECTRUM_NODE_KEY, CUSTOM_NODE_ALLOW_SELF_SIGNED_KEY];

export default function CustomNodeScreen() {
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const { triggerRefresh } = useWallet();
    const [draft, setDraft] = useState('');
    const [saved, setSaved] = useState('');
    const [allowSelfSigned, setAllowSelfSigned] = useState(false);
    const [phase, setPhase] = useState<'loading' | 'idle' | 'testing' | 'applying'>('loading');
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const busy = phase !== 'idle';
    usePreventRemove(phase === 'testing' || phase === 'applying', () => {});

    useEffect(() => {
        let current = true;
        setPhase('loading');
        setLoadFailed(false);
        void Promise.all(nodeKeys.map(key => AsyncStorage.getItem(key))).then(([url, legacy, selfSigned]) => {
            if (!current) return;
            const value = url || legacy || '';
            const parsed = parseCustomNode(value);
            setSaved(value);
            setDraft(parsed ? `${parsed.host}:${parsed.port}:${parsed.protocol}` : value);
            setAllowSelfSigned(selfSigned === 'true');
        }).catch(() => { if (current) setLoadFailed(true); })
            .finally(() => { if (current) setPhase('idle'); });
        return () => { current = false; };
    }, [loadAttempt]);

    const savedNode = parseCustomNode(saved);
    const connected = getConnectedPeer();
    const usingCustom = !!savedNode && !!connected && savedNode.host === connected.host
        && savedNode.port === connected.port && savedNode.protocol === connected.protocol;
    const status = !connected ? 'Disconnected' : usingCustom ? 'Custom node connected'
        : saved ? 'Using a public node' : 'Default nodes';
    const edit = (value: string) => { setDraft(value); setError(''); };
    const toggleCertificate = () => {
        if (allowSelfSigned) {
            setAllowSelfSigned(false);
            setError('');
            return;
        }
        Alert.alert('Unverified node certificate',
            'Only enable this for a custom node you trust on a secure network. An intercepted connection can expose address queries and falsify balances or history.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Allow for my node', onPress: () => { if (!lock.current) setAllowSelfSigned(true); } },
            ]);
    };

    const apply = async (useDefault: boolean) => {
        if (busy || lock.current || loadFailed) return;
        const text = draft.trim().replace(/^https?:\/\//i, '');
        const parsed = !useDefault && !text.startsWith('{') ? parseCustomNode(text) : null;
        if (!useDefault && !parsed) {
            setError('Use host:port:protocol, for example node.example.com:50002:tls.');
            return;
        }
        const url = parsed ? `${parsed.host}:${parsed.port}:${parsed.protocol}` : '';
        lock.current = true;
        Keyboard.dismiss();
        setError('');
        setPhase(useDefault ? 'applying' : 'testing');
        try {
            if (!useDefault && !await test_custom_node_connection(url, allowSelfSigned)) {
                setError('Could not reach this node. Check the address and certificate settings.');
                return;
            }
            setPhase('applying');
            if (useDefault) {
                await AsyncStorage.multiRemove(nodeKeys);
                setDraft('');
                setAllowSelfSigned(false);
            } else {
                await AsyncStorage.multiSet([
                    [CUSTOM_NODE_URL_KEY, url],
                    [CUSTOM_NODE_ALLOW_SELF_SIGNED_KEY, String(allowSelfSigned)],
                ]);
                setDraft(url);
            }
            setSaved(url);
            resetActiveConnection();
            try {
                await getElectrumClient();
            } catch {
                setError('Settings saved. The node connection is currently unavailable.');
                return;
            }
            void triggerRefresh('onchain').catch(() => {});
        } catch {
            setError('Could not save node settings. Please try again.');
        } finally {
            lock.current = false;
            setPhase('idle');
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {phase === 'loading' ? <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading node settings" color={theme.colors.bitcoin} /></View>
                : loadFailed ? <View style={styles.content}>
                    <Text accessibilityRole="alert" style={styles.error}>Could not load node settings.</Text>
                    <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => setLoadAttempt(attempt => attempt + 1)}>
                        <Text style={styles.secondaryText}>Retry</Text>
                    </TouchableOpacity>
                </View> : <>
                    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                        <View style={styles.connection}>
                            <Text style={styles.status}>{status}</Text>
                            {connected && <Text style={styles.hint} selectable>{connected.host}</Text>}
                        </View>
                        <Text style={styles.label}>Electrum node</Text>
                        <StyledInput accessibilityLabel="Electrum node" value={draft} onChangeText={edit}
                            placeholder="host:port:protocol" autoCapitalize="none" autoCorrect={false} autoComplete="off"
                            spellCheck={false} editable={!busy} returnKeyType="go" onSubmitEditing={() => { void apply(false); }} />
                        {!!savedNode && !usingCustom && <Text style={styles.hint}>Saved node: {savedNode.host}</Text>}
                        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: allowSelfSigned, disabled: busy }}
                            style={styles.checkbox} disabled={busy} onPress={toggleCertificate}>
                            <Feather name={allowSelfSigned ? 'check-square' : 'square'} size={20} color={theme.colors.primary} />
                            <Text style={styles.secondaryText}>Allow self-signed certificates</Text>
                        </TouchableOpacity>
                        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
                        {!!saved && <TouchableOpacity accessibilityRole="button" style={styles.secondary}
                            disabled={busy} onPress={() => { void apply(true); }}>
                            <Text style={styles.secondaryText}>Use default nodes</Text>
                        </TouchableOpacity>}
                    </ScrollView>
                    <View style={styles.footer}>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Test & save"
                            accessibilityState={{ disabled: busy || !draft.trim(), busy }}
                            style={[styles.button, !draft.trim() && !busy && styles.disabled]} disabled={busy || !draft.trim()}
                            onPress={() => { void apply(false); }}>
                            {busy ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.buttonText}>Test &amp; save</Text>}
                        </TouchableOpacity>
                    </View>
                </>}
        </KeyboardAvoidingView>
    );
}

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { padding: 24 },
    connection: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, marginBottom: 16, paddingBottom: 12 },
    status: { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
    label: { color: theme.colors.muted, fontSize: 14, marginBottom: 8 },
    hint: { color: theme.colors.muted, fontSize: 13, marginTop: 6 },
    error: { color: theme.colors.error, fontSize: 13, marginTop: 8 },
    checkbox: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 8 },
    secondary: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 8 },
    secondaryText: { color: theme.colors.primary, fontSize: 14, flexShrink: 1 },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    button: { minHeight: 56, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primary },
    buttonText: { fontSize: 16, fontWeight: '600', color: theme.colors.inversePrimary },
    disabled: { opacity: 0.5 },
});

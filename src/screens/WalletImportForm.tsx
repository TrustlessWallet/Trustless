import React, { useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView,
    StyleSheet, TouchableOpacity, View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import type { Theme } from '../constants/theme';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import type { RootStackParamList } from '../types';

type Props = {
    label: string;
    placeholder: string;
    hint: string;
    prepareImport: (value: string) => Parameters<ReturnType<typeof useWallet>['addWallet']>[0];
    suggestionsFor?: (value: string) => string[];
};

export default function WalletImportForm({ label, placeholder, hint, prepareImport, suggestionsFor }: Props) {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
    const { addWallet } = useWallet();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const [value, setValue] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [focused, setFocused] = useState(false);
    const busy = useRef(false);
    const inputRevision = useRef(0);
    const suggestions = focused && !loading ? suggestionsFor?.(value) ?? [] : [];

    const updateValue = (text: string) => {
        if (busy.current) return;
        inputRevision.current++;
        setValue(text);
        setError('');
    };

    const paste = async () => {
        if (busy.current) return;
        const revision = ++inputRevision.current;
        const isCurrent = () => revision === inputRevision.current && !busy.current && navigation.isFocused();
        try {
            const text = await Clipboard.getStringAsync();
            if (!isCurrent()) return;
            if (text.trim()) updateValue(text);
            else setError('The clipboard is empty.');
        } catch {
            if (isCurrent()) setError('Could not paste. Try pasting directly into the field.');
        }
    };

    const scan = () => {
        if (busy.current) return;
        const revision = ++inputRevision.current;
        Keyboard.dismiss();
        navigation.navigate('QRScanner', {
            onScanSuccess: text => {
                if (revision === inputRevision.current) updateValue(text);
            },
        });
    };

    const importWallet = async () => {
        if (busy.current || !value.trim()) return;
        inputRevision.current++;
        let params;
        try {
            params = prepareImport(value);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Check the import details and try again.');
            return;
        }

        busy.current = true;
        setLoading(true);
        setError('');
        Keyboard.dismiss();
        try {
            const wallet = await addWallet(params);
            if (wallet && navigation.isFocused()) navigation.navigate('WalletSetupSuccess', { kind: 'imported' });
        } catch {
            // Keep credentials and internal error details out of the UI and logs.
            if (navigation.isFocused()) setError('Could not import this wallet. Please try again.');
        } finally {
            busy.current = false;
            setLoading(false);
        }
    };

    const disabled = loading || !value.trim();
    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.label}>{label}</Text>
                <StyledInput
                    accessibilityLabel={label}
                    placeholder={placeholder}
                    value={value}
                    onChangeText={updateValue}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    containerStyle={styles.field}
                    multiline
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!loading}
                    rightElement={
                        <View style={styles.actions}>
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Paste ${label.toLowerCase()}`}
                                disabled={loading} style={styles.iconButton} onPress={paste}>
                                <Feather name="clipboard" size={19} color={theme.colors.primary} />
                            </TouchableOpacity>
                            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Scan ${label.toLowerCase()}`}
                                disabled={loading} style={styles.iconButton} onPress={scan}>
                                <Feather name="camera" size={19} color={theme.colors.primary} />
                            </TouchableOpacity>
                        </View>
                    }
                />
                {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
                {suggestions.length > 0 && (
                    <View style={styles.suggestions}>
                        {suggestions.map(word => (
                            <TouchableOpacity key={word} accessibilityRole="button" style={styles.suggestion}
                                onPress={() => updateValue(value.replace(/\S+$/u, word + ' '))}>
                                <Text style={styles.suggestionText}>{word}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
                <Text style={styles.hint}>{hint}</Text>
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Import wallet"
                    accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={importWallet}
                    style={[styles.button, disabled && !loading && styles.disabled]}>
                    {loading ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.buttonText}>Import wallet</Text>}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },
    label: { fontSize: 14, color: theme.colors.muted, marginBottom: 8 },
    field: { height: 120 },
    actions: { flexDirection: 'row', alignItems: 'flex-start', flex: 1, paddingTop: 4 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    hint: { color: theme.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
    error: { color: theme.colors.error, fontSize: 13, lineHeight: 20, marginTop: 8 },
    suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    suggestion: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.surface },
    suggestionText: { fontSize: 14, color: theme.colors.primary },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    button: { backgroundColor: theme.colors.primary, borderRadius: 8, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: theme.colors.inversePrimary, fontSize: 16, fontWeight: '600' },
    disabled: { opacity: 0.5 },
});

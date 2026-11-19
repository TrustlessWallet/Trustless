import React, { useState, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Keyboard, ScrollView, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';

const BackupIntroScreen = () => {
    const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'BackupIntro'>>();
    const { generateMnemonic, wallets } = useWallet();
    const [name, setName] = useState(() => `Wallet ${wallets.length + 1}`);
    const [strength, setStrength] = useState(128);
    const [loading, setLoading] = useState(false);
    const busy = useRef(false);
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const showPhrase = async () => {
        if (busy.current) return;
        busy.current = true;
        setLoading(true);
        Keyboard.dismiss();
        try {
            const mnemonic = await generateMnemonic(strength);
            if (!mnemonic) throw new Error('Generation failed');
            if (navigation.isFocused()) navigation.navigate('ShowMnemonic', { mnemonic, mode: 'create', name: name.trim() || undefined });
        } catch {
            Alert.alert('Could not create recovery phrase', 'Please try again.');
        } finally {
            busy.current = false;
            setLoading(false);
        }
    };
    return <ScrollView style={styles.container} contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Wallet name</Text>
        <StyledInput accessibilityLabel="Wallet name" value={name} onChangeText={setName}
            maxLength={80} editable={!loading} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
        <Text style={[styles.label, styles.section]}>Recovery phrase</Text>
        <View style={styles.choices}>
            {([128, 192, 256] as const).map(value => <TouchableOpacity key={value}
                accessibilityRole="radio" accessibilityState={{ checked: strength === value }}
                disabled={loading} onPress={() => setStrength(value)}
                style={[styles.choice, strength === value && styles.selected]}>
                <Text style={[styles.choiceText, strength === value && styles.selectedText]}>{value * 3 / 32} words</Text>
            </TouchableOpacity>)}
        </View>
        <TouchableOpacity accessibilityRole="button" style={styles.button} disabled={loading} onPress={showPhrase}>
            {loading ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.buttonText}>Show recovery phrase</Text>}
        </TouchableOpacity>
    </ScrollView>;
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    content: { padding: 24 },
    label: { fontSize: 14, fontWeight: 'bold', color: theme.colors.primary, marginBottom: 8 },
    section: { marginTop: 24 },
    choices: { flexDirection: 'row', gap: 8 },
    choice: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: theme.LAYOUT.radius, borderWidth: 1,
        borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
    selected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    choiceText: { fontSize: 14, color: theme.colors.primary },
    selectedText: { color: theme.colors.inversePrimary },
    button: { backgroundColor: theme.colors.primary, borderRadius: 8, minHeight: 56, justifyContent: 'center', alignItems: 'center', marginTop: 32 },
    buttonText: { fontSize: 16, fontWeight: '600', color: theme.colors.inversePrimary },
});
export default BackupIntroScreen;

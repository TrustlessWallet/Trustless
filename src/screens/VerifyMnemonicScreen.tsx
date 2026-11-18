import React, { useState, useMemo, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, TextInput, Keyboard } from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';


import { NETWORK_NAME } from '../constants/network';
import { confirmWalletBackup } from '../services/firstLaunchWallet';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'VerifyMnemonic'>;
type RoutePropType = RouteProp<RootStackParamList, 'VerifyMnemonic'>;
const VerifyMnemonicScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { mnemonic, name } = route.params;
    const originalWords = mnemonic.split(' ');
    const { addWallet } = useWallet();
    const [loading, setLoading] = useState(false);
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const inputs = useRef<(TextInput | null)[]>([]);
    const busy = useRef(false);
    const [invalid, setInvalid] = useState<number[]>([]);
    const wordsToVerify = useMemo(() => {
        const indexes = new Set<number>();
        const maxAttempts = 100;
        let attempts = 0;
        while (indexes.size < 3 && attempts < maxAttempts) {
            indexes.add(Math.floor(Math.random() * originalWords.length));
            attempts++;
        }
        return Array.from(indexes).sort((a, b) => a - b);
    }, [originalWords.length]);
    const [userInputs, setUserInputs] = useState<string[]>(Array(3).fill(''));

    const handleVerify = async () => {
        if (busy.current) return;
        const isCorrect = wordsToVerify.every((wordIndex, i) => userInputs[i].trim().toLowerCase() === originalWords[wordIndex]);
        if (isCorrect) {
            busy.current = true;
            setLoading(true);
            Keyboard.dismiss();
            try {
                const created = await addWallet({ mnemonic, name }, { freshlyGenerated: true });
                if (!created) return;
                // Wallet creation has already committed. If this optional marker
                // fails, keep the reminder rather than reporting creation failed.
                try { await confirmWalletBackup(NETWORK_NAME, created.id); }
                catch { /* The wallet remains usable; its backup reminder stays visible. */ }
                navigation.navigate('WalletSetupSuccess', { kind: 'created' });
            } catch (error) {
                Alert.alert("Error", "Could not save the wallet.");
            } finally {
                busy.current = false;
                setLoading(false);
            }
        } else {
            const errors = wordsToVerify.flatMap((wordIndex, i) => userInputs[i].trim().toLowerCase() === originalWords[wordIndex] ? [] : [i]);
            setInvalid(errors);
            inputs.current[errors[0]]?.focus();
        }
    };
    const handleInputChange = (text: string, index: number) => {
        const newInputs = [...userInputs];
        newInputs[index] = text;
        setUserInputs(newInputs);
        setInvalid(previous => previous.filter(value => value !== index));
    };
    return (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                bounces={false}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.subtitle}>
                    Enter these three words from your recovery phrase.
                </Text>
                {wordsToVerify.map((wordIndex, i) => (
                    <View key={wordIndex} style={styles.inputGroup}>
                        <Text style={styles.label}>Word #{wordIndex + 1}</Text>
                        <StyledInput
                            ref={input => { inputs.current[i] = input; }}
                            accessibilityLabel={`Word ${wordIndex + 1}`}
                            containerStyle={invalid.includes(i) ? styles.invalidInput : undefined}
                            autoFocus={i === 0}
                            returnKeyType={i < 2 ? "next" : "done"}
                            blurOnSubmit={i === 2}
                            onSubmitEditing={() => { if (i < 2) inputs.current[i + 1]?.focus(); else void handleVerify(); }}
                            value={userInputs[i]}
                            onChangeText={(text) => handleInputChange(text, i)}
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={`Enter word #${wordIndex + 1}`}
                            editable={!loading}
                        />
                        {invalid.includes(i) && <Text style={styles.error}>Check this word</Text>}
                    </View>
                ))}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleVerify} disabled={loading}>
                    {loading ? (
                         <ActivityIndicator color={theme.colors.bitcoin} />
                    ) : (
                        <View style={styles.buttonContentRowCentered}>
                            <Feather name="check-circle" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.buttonText}>Create wallet</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    invalidInput: { borderColor: theme.colors.bitcoin },
    error: { color: theme.colors.muted, marginTop: 4, fontSize: 12 },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: 24,
      paddingBottom: 16,
      flexGrow: 1,
    },
    subtitle: {
      fontSize: 16,
      lineHeight: 24,
      color: theme.colors.primary,
      textAlign: 'left',
      marginBottom: 24,
    },
    inputGroup: {
      marginBottom: 16
    },
    label: {
      fontSize: 16,
      color: theme.colors.primary,
      marginBottom: 8,
      fontWeight: '500'
    },
    button: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 16,
      borderRadius: 8,
      marginTop: 8,
      minHeight: 56
    },
    buttonDisabled: {
        opacity: 0.5
    },
    buttonText: {
      color: theme.colors.inversePrimary,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center'
    },
    buttonContentRowCentered: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8
    },
});
export default VerifyMnemonicScreen;

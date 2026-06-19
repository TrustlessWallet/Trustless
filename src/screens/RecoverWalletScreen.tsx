import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import * as bip39 from 'bip39';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'RecoverWallet'>;

const RecoverWalletScreen = () => {
    const [phrase, set_phrase] = useState('');
    const [loading, set_loading] = useState(false);
    const [suggestions, set_suggestions] = useState<string[]>([]);
    const { addWallet: add_wallet } = useWallet();
    const navigation = useNavigation<NavigationProp>();
    const { theme, isDark: is_dark } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);

    const [is_input_focused, set_is_input_focused] = useState(false);

    const is_input_empty = phrase.trim().length === 0;

    const handle_text_change = (text: string) => {
        set_phrase(text);

        if (text.length === 0 || text.endsWith(' ')) {
            set_suggestions([]);
            return;
        }

        const words_array = text.split(' ');
        const last_word = words_array[words_array.length - 1].toLowerCase();

        if (last_word.length > 0) {
            const english_words = bip39.wordlists?.english || bip39.wordlists?.EN;
            if (english_words && Array.isArray(english_words)) {
                const matches = english_words.filter((word: string) => word.startsWith(last_word));
                set_suggestions(matches.slice(0, 5));
            }
        } else {
            set_suggestions([]);
        }
    };

    const handle_suggestion_press = (word: string) => {
        const words_array = phrase.split(' ');
        words_array.pop();
        words_array.push(word);
        
        const new_phrase = words_array.join(' ') + ' ';
        set_phrase(new_phrase);
        set_suggestions([]);
    };

    const handle_qr_scan = (scanned_data: string) => {
        set_phrase(scanned_data);
    };

    const open_qr_scanner = () => {
        navigation.navigate('QRScanner', { onScanSuccess: handle_qr_scan });
    };

    const handle_recover = async () => {
        const trimmed_phrase = phrase.trim().toLowerCase();
        
        if (!bip39.validateMnemonic(trimmed_phrase)) {
            Alert.alert("Error", "Invalid recovery phrase. Please check the words and try again.");
            return;
        }

        set_loading(true);
        try {
            const new_wallet = await add_wallet({ mnemonic: trimmed_phrase });
            
            if (new_wallet) {
                Alert.alert("Success", "Your wallet has been recovered and set as active.", [
                    { text: "OK", onPress: () => navigation.popToTop() }
                ]);
            }
        } catch (error) {
            Alert.alert("Error", error instanceof Error ? error.message : "An unexpected error occurred.");
        } finally {
            set_loading(false);
        }
    };

    return (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
            <ScrollView 
                contentContainerStyle={styles.scroll_container}
                keyboardShouldPersistTaps="handled"
                bounces={false}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.top_content}>
                    <Text style={styles.subtitle}>
                        Enter your 12, 18, or 24-word recovery phrase to restore your wallet.
                    </Text>
                    
                    <View style={[styles.input_wrapper, is_input_focused && styles.input_wrapper_focused]}>
                        <TextInput
                            style={styles.phrase_input}
                            placeholder="Enter words separated by spaces"
                            placeholderTextColor={theme.colors.muted}
                            value={phrase}
                            onChangeText={handle_text_change}
                            multiline={true}
                            onFocus={() => set_is_input_focused(true)}
                            onBlur={() => set_is_input_focused(false)}
                            autoComplete="off"
                            spellCheck={false}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardAppearance={is_dark ? 'dark' : 'light'}
                        />
                        <View style={styles.right_elements}>
                            <TouchableOpacity onPress={open_qr_scanner} style={styles.icon_button}>
                                <Feather name="camera" size={20} color={theme.colors.primary} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                <View style={styles.bottom_content}>
                    <TouchableOpacity 
                        style={[
                            styles.button, 
                            is_input_empty && { opacity: 0.5 }
                        ]} 
                        onPress={handle_recover} 
                        disabled={loading || is_input_empty}
                    >
                        {loading ? (
                            <ActivityIndicator color={theme.colors.inversePrimary} />
                        ) : (
                            <View style={styles.button_content_row_centered}>
                                <Feather name="key" size={18} color={theme.colors.inversePrimary} />
                                <Text style={styles.button_text}>Recover wallet</Text>
                            </View>
                        )}
                    </TouchableOpacity>

                    <View style={styles.suggestions_wrapper}>
                        {suggestions.length > 0 && (
                            <ScrollView 
                                horizontal 
                                showsHorizontalScrollIndicator={false} 
                                keyboardShouldPersistTaps="always"
                                contentContainerStyle={styles.suggestions_scroll_content}
                                bounces={false}
                            >
                                {suggestions.map((word) => (
                                    <TouchableOpacity 
                                        key={word} 
                                        style={styles.suggestion_button} 
                                        onPress={() => handle_suggestion_press(word)}
                                    >
                                        <Text style={styles.suggestion_text}>{word}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background 
  },
  scroll_container: {
    flexGrow: 1,
    padding: 24,
  },
  top_content: {
    flex: 1,
  },
  bottom_content: {
    justifyContent: 'flex-end',
  },
  subtitle: { 
    fontSize: 16, 
    color: theme.colors.primary,
    textAlign: 'center', 
    marginBottom: 24, 
  },
  input_wrapper: { 
    flexDirection: 'row', 
    borderWidth: 1, 
    borderColor: theme.colors.border, 
    borderRadius: 8, 
    backgroundColor: theme.colors.surface,
    height: 120,
    marginBottom: 16
  },
  input_wrapper_focused: {
    borderColor: theme.colors.bitcoin,
  },
  phrase_input: { 
    flex: 1, 
    paddingHorizontal: 16, 
    paddingVertical: 16, 
    fontSize: 16,
    fontFamily: 'SpaceMono-Regular', 
    color: theme.colors.primary, 
    textAlignVertical: 'top' 
  },
  right_elements: { 
    flexDirection: 'row', 
    alignItems: 'flex-start', 
    paddingRight: 8, 
    paddingTop: 8 
  },
  icon_button: {
    padding: 8,
  },
  suggestions_wrapper: {
    marginVertical: 16,
  },
  suggestions_scroll_content: {
    alignItems: 'center',
    gap: 8,
  },
  suggestion_button: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: 8,
  },
  suggestion_text: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  button: { 
    backgroundColor: theme.colors.primary,
    paddingVertical: 16, 
    borderRadius: 8,
    minHeight: 56,
  },
  button_text: { 
    color: theme.colors.inversePrimary,
    fontSize: 16, 
    fontWeight: '600', 
    textAlign: 'center' 
  },
  button_content_row_centered: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8 
  },
});

export default RecoverWalletScreen;
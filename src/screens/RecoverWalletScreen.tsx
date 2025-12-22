import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import * as bip39 from 'bip39';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { StyledInput } from '../components/StyledInput';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'RecoverWallet'>;
const RecoverWalletScreen = () => {
    const [phrase, setPhrase] = useState('');
    const [loading, setLoading] = useState(false);
    const { addWallet } = useWallet();
    const navigation = useNavigation<NavigationProp>();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const handleRecover = async () => {
        const trimmedPhrase = phrase.trim().toLowerCase();
        if (!bip39.validateMnemonic(trimmedPhrase)) {
            Alert.alert("Error", "Invalid recovery phrase. Please check the words and try again.");
            return;
        }
        setLoading(true);
        try {
            const newWallet = await addWallet({ mnemonic: trimmedPhrase });
            if (newWallet) {
                Alert.alert("Success", "Your wallet has been recovered and set as active.", [
                    { text: "OK", onPress: () => navigation.popToTop() }
                ]);
            } else {
                throw new Error("Could not add the wallet.");
            }
        } catch (error) {
            Alert.alert("Error", error instanceof Error ? error.message : "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };
    return (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
            <Text style={styles.subtitle}>
                Enter your 12, 18, or 24-word recovery phrase to restore your wallet.
            </Text>
            <StyledInput
                containerStyle={styles.inputContainer}
                placeholder="Enter words separated by spaces"
                value={phrase}
                onChangeText={setPhrase}
                multiline
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance={isDark ? 'dark' : 'light'}
                placeholderTextColor={theme.colors.muted}
            />
            <TouchableOpacity style={styles.button} onPress={handleRecover} disabled={loading}>
                {loading ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.buttonContentRowCentered}>
                        <Feather name="key" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.buttonText}>Recover wallet</Text>
                    </View>
                )}
            </TouchableOpacity>
        </KeyboardAvoidingView>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 24, 
    backgroundColor: theme.colors.background 
  },
  subtitle: { 
    fontSize: 16, 
    color: theme.colors.primary,
    textAlign: 'center', 
    marginBottom: 24, 
  },
  inputContainer: { 
    height: 120, 
    marginBottom: 24 
  },
  button: { 
    backgroundColor: theme.colors.primary,
    paddingVertical: 16, 
    borderRadius: 8 
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
export default RecoverWalletScreen;
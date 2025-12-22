import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { StyledInput } from '../components/StyledInput'; 
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'VerifyMnemonic'>;
type RoutePropType = RouteProp<RootStackParamList, 'VerifyMnemonic'>;
const VerifyMnemonicScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { mnemonic } = route.params;
    const originalWords = mnemonic.split(' ');
    const { addWallet } = useWallet();
    const [loading, setLoading] = useState(false);
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
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
        const isCorrect = wordsToVerify.every((wordIndex, i) => userInputs[i].trim().toLowerCase() === originalWords[wordIndex]);
        if (isCorrect) {
            setLoading(true);
            try {
                await addWallet({ mnemonic });
                Alert.alert("Success!", "Your wallet is now set up and secured.", [
                    { text: "OK", onPress: () => navigation.popToTop() }
                ]);
            } catch (error) {
                Alert.alert("Error", "Could not save the wallet.");
            } finally {
                setLoading(false);
            }
        } else {
            Alert.alert("Error", "The words you entered do not match. Please check your recovery phrase and try again.");
        }
    };
    const handleInputChange = (text: string, index: number) => {
        const newInputs = [...userInputs];
        newInputs[index] = text;
        setUserInputs(newInputs);
    };
    return (

            <View style={styles.scrollContent}>
                <Text style={styles.subtitle}>
                    To ensure you have saved your phrase correctly, please enter the missing words.
                </Text>
                {wordsToVerify.map((wordIndex, i) => (
                    <View key={wordIndex} style={styles.inputGroup}>
                        <Text style={styles.label}>Word #{wordIndex + 1}</Text>
                        <StyledInput
                            value={userInputs[i]}
                            onChangeText={(text) => handleInputChange(text, i)}
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="off"
                            spellCheck={false}
                            keyboardAppearance={isDark ? 'dark' : 'light'}
                            placeholderTextColor={theme.colors.muted}
                            placeholder={`Enter word #${wordIndex + 1}`}
                            editable={!loading}
                        />
                    </View>
                ))}
                <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleVerify} disabled={loading}>
                    {loading ? (
                         <ActivityIndicator color={theme.colors.inversePrimary} />
                    ) : (
                        <View style={styles.buttonContentRowCentered}>
                            <Feather name="check-circle" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.buttonText}>Verify</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: { 
      flex: 1, 
      backgroundColor: theme.colors.background 
    },
    scrollContent: {
      padding: 24,
      flexGrow: 1,
    },
    subtitle: { 
      fontSize: 16, 
      lineHeight: 24, 
      color: theme.colors.primary, 
      textAlign: 'center', 
      marginBottom: 32, 
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
      marginTop: 16 
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
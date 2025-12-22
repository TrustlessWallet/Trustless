import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from '../components/StyledText';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'BackupIntro'>;
const BackupIntroScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { generateMnemonic } = useWallet();
    const [loading, setLoading] = useState(false);
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const handleShowPhrase = async (strength: number) => {
        setLoading(true);
        const newMnemonic = await generateMnemonic(strength);
        setLoading(false);
        if (newMnemonic) {
            navigation.navigate('ShowMnemonic', {
                mnemonic: newMnemonic,
                mode: 'create'
            });
        } else {
        }
    };
    return (
        <View style={styles.container}>
            <Text style={styles.introText}>
                Choose your recovery phrase length. Longer phrases provide more security.
            </Text>
            <View style={styles.optionsContainer}>
                <TouchableOpacity style={styles.optionButton} onPress={() => handleShowPhrase(128)} disabled={loading}>
                    <Text style={styles.optionButtonText}>12 Words</Text>
                    <Text style={styles.optionButtonSubText}>Standard security</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionButton} onPress={() => handleShowPhrase(192)} disabled={loading}>
                    <Text style={styles.optionButtonText}>18 Words</Text>
                    <Text style={styles.optionButtonSubText}>More security</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionButton} onPress={() => handleShowPhrase(256)} disabled={loading}>
                    <Text style={styles.optionButtonText}>24 Words</Text>
                    <Text style={styles.optionButtonSubText}>Maximum security</Text>
                </TouchableOpacity>
            </View>
            {loading && <ActivityIndicator style={styles.loadingIndicator} color={theme.colors.primary} />}
        </View>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        backgroundColor: theme.colors.background
    },
    introText: {
        fontSize: 18,
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 26,
        color: theme.colors.primary,
    },
    optionsContainer: {
        width: '100%',
    },
    optionButton: {
        backgroundColor: theme.colors.background,
        paddingVertical: 16,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginBottom: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.colors.primary,
    },
    optionButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.primary,
    },
    optionButtonSubText: {
        fontSize: 14,
        color: theme.colors.muted,
        marginTop: 4,
    },
    loadingIndicator: { 
        marginTop: 24 
    }
});
export default BackupIntroScreen;
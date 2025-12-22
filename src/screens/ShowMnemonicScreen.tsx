import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ShowMnemonic'>;
type RoutePropType = RouteProp<RootStackParamList, 'ShowMnemonic'>;
const ShowMnemonicScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { mnemonic, mode } = route.params;
    const words = mnemonic.split(' ');
    const wordCount = words.length;
    const isBackupMode = mode === 'backup';
    const { theme } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const handleContinue = () => {
        if (isBackupMode) {
            navigation.popToTop();
        } else {
            navigation.navigate('VerifyMnemonic', { mnemonic });
        }
    };
    const firstColumnWords = words.slice(0, Math.ceil(wordCount / 2));
    const secondColumnWords = words.slice(Math.ceil(wordCount / 2));
    return (
        <View style={styles.container}>
            <Text style={styles.warning}>
                Save these {wordCount} words in order and store them securely. This is the only way to recover your wallet.
            </Text>
            <View style={styles.mnemonicContainer}>
                {}
                <View style={styles.column}>
                    {firstColumnWords.map((word, index) => (
                        <Text key={index} style={styles.word}>{index + 1}. {word}</Text>
                    ))}
                </View>
                {}
                <View style={styles.column}>
                    {secondColumnWords.map((word, index) => {
                        const wordNumber = index + firstColumnWords.length + 1;
                        return (
                            <Text key={wordNumber} style={styles.word}>{wordNumber}. {word}</Text>
                        );
                    })}
                </View>
            </View>
            <TouchableOpacity style={styles.button} onPress={handleContinue}>
                <View style={styles.buttonContentRowCentered}>
                    <Feather
                        name={isBackupMode ? "check-circle" : "arrow-right-circle"}
                        size={18}
                        color={theme.colors.inversePrimary}
                    />
                    <Text style={styles.buttonText}>
                        {isBackupMode ? "Done" : "Continue to verification"}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: theme.colors.background 
    },
    warning: {
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.primary, 
        textAlign: 'center',
        marginBottom: 24,
    },
    mnemonicContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: theme.colors.primary, 
        width: '100%',
    },
    column: {
        paddingHorizontal: 16,
    },
    word: {
        fontSize: 18,
        fontWeight: '600',
        paddingVertical: 8,
        color: theme.colors.primary, 
    },
    button: {
        backgroundColor: theme.colors.primary, 
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center'
    },
    buttonText: {
        color: theme.colors.inversePrimary, 
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    buttonContentRowCentered: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});
export default ShowMnemonicScreen;
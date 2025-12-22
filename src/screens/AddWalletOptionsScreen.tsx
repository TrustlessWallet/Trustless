import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AddWalletOptions'>;
const AddWalletOptionsScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    return (
        <View style={styles.container}>
            <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('BackupIntro')}>
                <Feather name="plus-circle" size={18} color={theme.colors.inversePrimary} />
                <Text style={styles.buttonText}>Create a new wallet</Text>
            </TouchableOpacity>
            <Text style={styles.orText}>Or</Text>
            <TouchableOpacity style={styles.recoverButton} onPress={() => navigation.navigate('RecoverWallet')}>
                <Feather name="refresh-ccw" size={18} color={theme.colors.primary} />
                <Text style={styles.recoverButtonText}>Import existing wallet</Text>
            </TouchableOpacity>
        </View>
    );
};
const getStyles = (theme: Theme) => StyleSheet.create({
    container: { 
      flex: 1, 
      backgroundColor: theme.colors.background,
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: 24 
    },
    button: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      justifyContent: 'center', 
      gap: 8, 
      backgroundColor: theme.colors.primary,
      paddingVertical: 16, 
      borderRadius: 8, 
      width: '100%' 
    },
    buttonText: { 
      color: theme.colors.inversePrimary,
      fontSize: 16, 
      fontWeight: '600' 
    },
    orText: { 
      fontSize: 16, 
      color: theme.colors.muted,
      marginVertical: 16 
    },
    recoverButton: { 
      flexDirection: 'row', 
      alignItems: 'center', 
      justifyContent: 'center', 
      gap: 8, 
      backgroundColor: theme.colors.background,
      paddingVertical: 16, 
      borderRadius: 8, 
      borderWidth: 1, 
      borderColor: theme.colors.primary,
      width: '100%' 
    },
    recoverButtonText: { 
      color: theme.colors.primary,
      fontSize: 16, 
      fontWeight: '600' 
    },
});
export default AddWalletOptionsScreen;
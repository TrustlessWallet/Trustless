import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme';
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'BackupDisclaimer'>;
type RoutePropType = RouteProp<RootStackParamList, 'BackupDisclaimer'>;
const BulletPoint = ({ text, theme }: { text: string, theme: Theme }) => (
    <View style={getStyles(theme).bulletContainer}>
        <Text style={getStyles(theme).bullet}>•</Text>
        <Text style={getStyles(theme).bulletText}>{text}</Text>
    </View>
);
const BackupDisclaimerScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { walletId } = route.params;
    const { getMnemonicForWallet } = useWallet();
    const [loading, setLoading] = useState(false);
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const handleShowPhrase = async () => {
        setLoading(true);
        const mnemonic = await getMnemonicForWallet(walletId);
        setLoading(false);
        if (mnemonic) {
            navigation.navigate('ShowMnemonic', { mnemonic, mode: 'backup' });
        } else {
            Alert.alert("Error", "Could not retrieve the recovery phrase for this wallet.");
        }
    };
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Backup Recovery Phrase</Text>
            <View style={styles.bulletsWrapper}>
                <BulletPoint text="You are about to view your secret recovery phrase." theme={theme} />
                <BulletPoint text="Ensure no one else is looking at your screen." theme={theme} />
                <BulletPoint text="This phrase is the only way to recover your funds." theme={theme} />
            </View>
            <TouchableOpacity style={styles.button} onPress={handleShowPhrase} disabled={loading}>
                {loading ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.buttonContentRowCentered}>
                        <Feather name="eye" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.buttonText}>Show Phrase</Text>
                    </View>
                )}
            </TouchableOpacity>
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
    title: { 
      fontSize: 24, 
      fontWeight: 'bold', 
      textAlign: 'center', 
      marginBottom: 24,
      color: theme.colors.primary
    },
    bulletsWrapper: { 
      alignSelf: 'center', 
      marginBottom: 32, 
      width: '90%' 
    },
    bulletContainer: { 
      flexDirection: 'row', 
      alignItems: 'flex-start', 
      marginBottom: 16 
    },
    bullet: { 
      fontSize: 22, 
      marginRight: 12, 
      lineHeight: 28,
      color: theme.colors.primary
    },
    bulletText: { 
      flex: 1, 
      fontSize: 18, 
      color: theme.colors.primary,
      lineHeight: 28 
    },
    button: { 
      backgroundColor: theme.colors.primary,
      paddingVertical: 16, 
      borderRadius: 8, 
      width: '100%' 
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
export default BackupDisclaimerScreen;
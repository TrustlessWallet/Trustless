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
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'BackupDisclaimer'>;
type route_prop_type = RouteProp<RootStackParamList, 'BackupDisclaimer'>;

const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';

const BulletPoint = ({ text, theme }: { text: string, theme: Theme }) => (
    <View style={get_styles(theme).bullet_container}>
        <Text style={get_styles(theme).bullet}>•</Text>
        <Text style={get_styles(theme).bullet_text}>{text}</Text>
    </View>
);

const BackupDisclaimerScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { walletId } = route.params;
    const { getMnemonicForWallet } = useWallet();
    const [is_loading, set_is_loading] = useState(false);
    const { theme } = useTheme();
    const styles = useMemo(() => get_styles(theme), [theme]);

    const handle_show_phrase = async () => {
        try {
            const saved_setting = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
            
            if (saved_setting === 'true') {
                const auth_result = await LocalAuthentication.authenticateAsync({
                    promptMessage: 'Authenticate to view your recovery phrase',
                    fallbackLabel: 'Use Passcode',
                });
                
                if (!auth_result.success) {
                    return; 
                }
            }

            set_is_loading(true);
            const mnemonic = await getMnemonicForWallet(walletId);
            set_is_loading(false);

            if (mnemonic) {
                navigation.navigate('ShowMnemonic', { mnemonic, mode: 'backup' });
            } else {
                Alert.alert("Error", "Could not retrieve the recovery phrase for this wallet.");
            }
        } catch (error) {
            set_is_loading(false);
            Alert.alert("Error", "An error occurred during authentication.");
        }
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Backup Recovery Phrase</Text>
            <View style={styles.bullets_wrapper}>
                <BulletPoint text="You are about to view your secret recovery phrase." theme={theme} />
                <BulletPoint text="Ensure no one else is looking at your screen." theme={theme} />
                <BulletPoint text="This phrase is the only way to recover your funds." theme={theme} />
            </View>
            <TouchableOpacity style={styles.button} onPress={handle_show_phrase} disabled={is_loading}>
                {is_loading ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.button_content_row_centered}>
                        <Feather name="eye" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.button_text}>Show Phrase</Text>
                    </View>
                )}
            </TouchableOpacity>
        </View>
    );
};

const get_styles = (theme: Theme) => StyleSheet.create({
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
    bullets_wrapper: { 
      alignSelf: 'center', 
      marginBottom: 32, 
      width: '90%' 
    },
    bullet_container: { 
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
    bullet_text: { 
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

export default BackupDisclaimerScreen;
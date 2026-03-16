import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../types';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import { get_biometric_prompt_shown, set_biometric_prompt_shown, authenticate_session } from '../services/authState';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AuthCheck'>;
const DEFAULT_SCREEN_KEY = '@defaultScreen'; 

const AuthCheckScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme } = useTheme(); 
    const styles = useMemo(() => get_styles(theme), [theme]); 
    const [is_authenticating, set_is_authenticating] = useState(false);

    const run_authentication = async () => {
        if (is_authenticating) return;
        set_is_authenticating(true);
        set_biometric_prompt_shown(true);
        
        try {
            const success = await authenticate_session();
            if (success) {
                await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
                const default_screen = await AsyncStorage.getItem(DEFAULT_SCREEN_KEY);
                const screen_to_load: keyof TabParamList = default_screen === 'Tracker' ? 'Tracker' : 'Wallet';
                navigation.replace('MainTabs', { screen: screen_to_load });
            } else {
                Alert.alert('Authentication failed', 'Please try again.');
                set_is_authenticating(false);
            }
        } catch (error) {
            console.error(error);
            Alert.alert('Authentication error', 'Could not verify your identity.');
            set_is_authenticating(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            run_authentication();
        }, 300);
        return () => clearTimeout(timer);
    }, []);

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Authentication Required</Text>
            <Text style={styles.subtitle}>Please authenticate to access your wallet</Text>
            <TouchableOpacity 
                style={styles.button} 
                onPress={run_authentication}
                disabled={is_authenticating}
            >
                {is_authenticating ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.button_content_row}>
                        <Feather name="unlock" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.button_text}>
                            Authenticate
                        </Text>
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
        alignItems: 'center',
        backgroundColor: theme.colors.background, 
        padding: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
        textAlign: 'center',
        color: theme.colors.primary, 
    },
    subtitle: {
        fontSize: 16,
        color: theme.colors.muted, 
        marginBottom: 16,
        textAlign: 'center',
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: theme.colors.primary, 
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 8,
        width: '60%',
        minHeight: 55
    },
    button_text: {
        color: theme.colors.inversePrimary, 
        fontSize: 16,
        fontWeight: '600',
    },
    button_content_row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    }
});

export default AuthCheckScreen;
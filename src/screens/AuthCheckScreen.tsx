import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../types';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
import { setAppIsAuthenticated, setBiometricPromptShown } from '../services/authState';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AuthCheck'>;
const DEFAULT_SCREEN_KEY = '@defaultScreen'; 

const AuthCheckScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme } = useTheme(); 
    const styles = useMemo(() => getStyles(theme), [theme]); 
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    const authenticate = async () => {
        if (isAuthenticating) return;
        setIsAuthenticating(true);
        setBiometricPromptShown(true);
        
        try {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Authenticate to access your wallet',
                cancelLabel: 'Cancel',
                fallbackLabel: 'Use Passcode',
            });
            if (result.success) {
                setAppIsAuthenticated(true);
                await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
                const defaultScreen = await AsyncStorage.getItem(DEFAULT_SCREEN_KEY);
                const screenToLoad: keyof TabParamList = defaultScreen === 'Wallet' ? 'Wallet' : 'Tracker';
                navigation.replace('MainTabs', { screen: screenToLoad });
            } else {
                Alert.alert('Authentication failed', 'Please try again.');
                setIsAuthenticating(false);
            }
        } catch (error) {
            console.error(error);
            Alert.alert('Authentication error', 'Could not verify your identity.');
            setIsAuthenticating(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            authenticate();
        }, 300);
        return () => clearTimeout(timer);
    }, []);

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Authentication Required</Text>
            <Text style={styles.subtitle}>Please authenticate to access your wallet</Text>
            <TouchableOpacity 
                style={styles.button} 
                onPress={authenticate}
                disabled={isAuthenticating}
            >
                {isAuthenticating ? (
                    <ActivityIndicator color={theme.colors.inversePrimary} />
                ) : (
                    <View style={styles.buttonContentRowCentered}>
                        <Feather name="unlock" size={18} color={theme.colors.inversePrimary} />
                        <Text style={styles.buttonText}>
                            Authenticate
                        </Text>
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
    buttonText: {
        color: theme.colors.inversePrimary, 
        fontSize: 16,
        fontWeight: '600',
    },
    buttonContentRowCentered: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    }
});

export default AuthCheckScreen;
import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { RootStackParamList } from '../types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RoutePropType = RouteProp<RootStackParamList, 'TransactionSuccess'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionSuccess'>;

const TransactionSuccessScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { type } = route.params; // 'onchain' or 'lightning'
    
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);
    const { triggerRefresh } = useWallet();

    const scaleAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Trigger a background refresh immediately so balances update
        triggerRefresh();

        // Play the success spring animation
        Animated.parallel([
            Animated.spring(scaleAnim, {
                toValue: 1,
                tension: 50,
                friction: 5,
                useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            })
        ]).start();
    }, []);

    const handleDone = () => {
        navigation.popToTop();
    };

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
                    <View style={styles.iconCircle}>
                        <Feather name="check" size={48} color={theme.colors.background} />
                    </View>
                </Animated.View>
                
                <Animated.View style={{ opacity: opacityAnim, alignItems: 'center' }}>
                    <Text style={styles.title}>
                        {type === 'lightning' ? 'Payment Sent!' : 'Transaction Sent!'}
                    </Text>
                    <Text style={styles.subtitle}>
                        {type === 'lightning' 
                            ? 'Your lightning invoice was paid instantly.' 
                            : 'Your transaction has been broadcasted to the network.'}
                    </Text>
                </Animated.View>
            </View>

            <Animated.View style={[styles.footer, { opacity: opacityAnim }]}>
                <TouchableOpacity style={styles.doneButton} onPress={handleDone}>
                    <Text style={styles.doneButtonText}>Done</Text>
                </TouchableOpacity>
            </Animated.View>
        </View>
    );
};

const getStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
        justifyContent: 'space-between',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    iconContainer: {
        marginBottom: 32,
    },
    iconCircle: {
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: theme.colors.primary, // Or use theme.colors.bitcoin for the orange accent
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontFamily: 'SpaceMono-Bold',
        color: theme.colors.primary,
        marginBottom: 12,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 16,
        color: theme.colors.muted,
        textAlign: 'center',
        lineHeight: 24,
    },
    footer: {
        padding: 24,
        paddingBottom: 48, // Extra padding for safe area
    },
    doneButton: {
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
    },
    doneButtonText: {
        color: theme.colors.primary,
        fontSize: 16,
        fontFamily: 'SpaceMono-Bold',
    },
});

export default TransactionSuccessScreen;
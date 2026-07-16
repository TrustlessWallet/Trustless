import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, InteractionManager } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from '../types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RoutePropType = RouteProp<RootStackParamList, 'TransactionSuccess'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionSuccess'>;

const TransactionSuccessScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { type, txId, transaction } = route.params as any;

    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const scaleAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
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

        InteractionManager.runAfterInteractions(() => {
            navigation.dispatch((state) => {
                const filteredRoutes = state.routes.filter(
                    (r) => r.name !== 'Send' && r.name !== 'TransactionConfirm'
                );
                return CommonActions.reset({
                    ...state,
                    routes: filteredRoutes,
                    index: filteredRoutes.length - 1,
                });
            });
        });
    }, []);

    const handleDone = () => {
        navigation.popToTop();
    };

    const handleDetails = () => {
        if (txId || transaction) {
            navigation.navigate('TransactionDetails', { txId, transaction });
        }
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
                        {type === 'lightning' ? 'Payment sent!' : 'Transaction sent!'}
                    </Text>
                    <Text style={styles.subtitle}>
                        {type === 'lightning'
                            ? 'Your lightning invoice has been paid.'
                            : 'Your transaction has been broadcasted.'}
                    </Text>
                </Animated.View>
            </View>

            <Animated.View style={[styles.footer, { opacity: opacityAnim }]}>
                {type === 'onchain' && txId && (
                    <TouchableOpacity style={styles.detailsButton} onPress={handleDetails}>
                        <Text style={styles.buttonText}>Transaction details</Text>
                    </TouchableOpacity>
                )}
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
    },
    content: {
        flex: 1,
        paddingTop: 64,
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
        backgroundColor: theme.colors.primary,
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
        width: '100%',
        padding: 24,
        paddingBottom: 48,
        gap: 12,
        backgroundColor: theme.colors.background,
    },

    detailsButton: {
        backgroundColor: theme.colors.surface,
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    doneButton: {
        backgroundColor: '#000000',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
    },
    buttonText: {
        color: theme.colors.primary,
        fontSize: 16,
        fontFamily: 'SpaceMono-Bold',
    },
    doneButtonText: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontFamily: 'SpaceMono-Bold',
    },
});

export default TransactionSuccessScreen;
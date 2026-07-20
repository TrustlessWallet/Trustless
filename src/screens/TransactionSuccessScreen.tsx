import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Animated, InteractionManager, Dimensions, Easing } from 'react-native';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { RootStackParamList } from '../types';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RoutePropType = RouteProp<RootStackParamList, 'TransactionSuccess'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'TransactionSuccess'>;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const TransactionSuccessScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RoutePropType>();
    const { type, txId, transaction } = route.params as any;

    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const scaleAnim = useRef(new Animated.Value(0)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;
    const ringAnim = useRef(new Animated.Value(0)).current;
    const footerAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        let has_started = false;

        const startAnimation = () => {
            if (has_started) return;
            has_started = true;

            Animated.sequence([
                Animated.parallel([
                    // Pop: overshoots past 1 then eases back, driven by
                    // Easing.back so the circle feels like it "pops" into
                    // place rather than just fading/scaling in linearly.
                    Animated.timing(scaleAnim, {
                        toValue: 1,
                        duration: 450,
                        easing: Easing.out(Easing.back(1.9)),
                        useNativeDriver: true,
                    }),
                    Animated.timing(opacityAnim, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: true,
                    }),
                    Animated.timing(ringAnim, {
                        toValue: 1,
                        duration: 700,
                        useNativeDriver: true,
                    }),
                ]),
                Animated.timing(footerAnim, {
                    toValue: 1,
                    duration: 280,
                    useNativeDriver: true,
                }),
            ]).start();
        };

        // The screen is presented as a sheet, which plays its own slide/grow
        // transition on mount. Starting the pop animation immediately in
        // this effect means it runs while the sheet is still transitioning
        // in (or off-screen), so it's invisible or gets clipped by the time
        // the sheet settles. `transitionEnd` fires once that presentation
        // animation completes, so we wait for it before popping the circle.
        const unsubscribe = navigation.addListener('transitionEnd', startAnimation);

        // Fallback in case this screen's navigator never fires transitionEnd
        // (e.g. it's the initial route, or the event doesn't propagate for
        // this presentation type) so the animation still plays.
        const fallback = setTimeout(startAnimation, 400);

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

        return () => {
            unsubscribe();
            clearTimeout(fallback);
        };
    }, []);

    const handleDone = () => {
        navigation.popToTop();
    };

    const handleDetails = () => {
        if (txId || transaction) {
            navigation.navigate('TransactionDetails', { txId, transaction });
        }
    };

    const ringScale = ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
    const ringOpacity = ringAnim.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.35, 0.15, 0] });

    return (
        <View style={styles.container}>
            <View style={styles.content}>
                <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
                    <Animated.View
                        style={[
                            styles.iconRing,
                            { opacity: ringOpacity, transform: [{ scale: ringScale }] },
                        ]}
                    />
                    <View style={styles.iconCircle}>
                        <Feather name="check" size={44} color={theme.colors.background} strokeWidth={3} />
                    </View>
                </Animated.View>

                <Animated.View style={{ opacity: opacityAnim, alignItems: 'center' }}>
                    <Text style={styles.title}>
                        {type === 'lightning'
                            ? 'Your lightning invoice has been paid!'
                            : 'Your transaction has been broadcasted!'}
                    </Text>
                </Animated.View>
            </View>

            <Animated.View
                style={[
                    styles.footer,
                    {
                        opacity: footerAnim,
                        transform: [
                            {
                                translateY: footerAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [16, 0],
                                }),
                            },
                        ],
                    },
                ]}
            >

                {type === 'onchain' && txId && (
                    <TouchableOpacity
                        style={styles.detailsButton}
                        onPress={handleDetails}
                    >
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
        minHeight: SCREEN_HEIGHT - 100,
        backgroundColor: theme.colors.background,
    },
    content: {
        flex: 1,
        paddingTop: 72,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    iconContainer: {
        marginBottom: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconRing: {
        position: 'absolute',
        width: 96,
        height: 96,
        borderRadius: 48,
        borderWidth: 2,
        borderColor: theme.colors.primary,
    },
    iconCircle: {
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',

    },
    title: {
        fontSize: 20,
        fontFamily: 'SpaceMono-Bold',
        color: theme.colors.primary,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: theme.colors.muted,
        textAlign: 'center',
        lineHeight: 22,
        paddingHorizontal: 12,
    },
    footer: {
        width: '100%',
        paddingHorizontal: 24,
        paddingBottom: 16,
        paddingTop: 8,
        gap: 12,
        backgroundColor: theme.colors.background,
    },
    detailsButton: {
        flexDirection: 'row',
        backgroundColor: theme.colors.background,
        paddingVertical: 16,
        borderRadius: theme.LAYOUT.radius,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 56,
        borderWidth: 1,
        borderColor: theme.colors.primary,
    },
    doneButton: {
        backgroundColor: theme.colors.primary,
        paddingVertical: 16,
        borderRadius: theme.LAYOUT.radius,
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
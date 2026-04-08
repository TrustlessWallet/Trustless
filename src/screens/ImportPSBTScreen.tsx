import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Alert, TouchableOpacity, Animated } from 'react-native';
import { Text } from '../components/StyledText';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { Feather } from '@expo/vector-icons';
import { URDecoder } from '@ngraveio/bc-ur';
import { Buffer } from 'buffer';
import { finalizeAndBroadcastPSBT } from '../services/bitcoin';

type RouteParams = RouteProp<RootStackParamList, 'ImportPSBT'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportPSBT'>;

const ImportPSBTScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RouteParams>();
    const isFocused = useIsFocused();
    const { theme } = useTheme();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const [permission, requestPermission] = useCameraPermissions();
    const [scanned, setScanned] = useState(false);

    const [decoder] = useState(() => new URDecoder());
    const [progress, setProgress] = useState(0);

    const progressAnim = useRef(new Animated.Value(0)).current;
    const revealAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!permission?.granted && permission?.canAskAgain) {
            requestPermission();
        }
    }, [permission, requestPermission]);

    useEffect(() => {
        if (progress > 0 && progress < 1) {
            Animated.timing(revealAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: false,
            }).start();
        } else {
            Animated.timing(revealAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [progress, revealAnim]);

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: progress,
            duration: 150,
            useNativeDriver: false,
        }).start();
    }, [progress, progressAnim]);

    const handleBarCodeScanned = ({ data }: { data: string }) => {
        if (scanned) return;

        try {
            let psbtBase64 = '';

            if (data.toLowerCase().startsWith('ur:')) {
                decoder.receivePart(data);
                setProgress(decoder.getProgress());

                if (decoder.isComplete()) {
                    if (decoder.isSuccess()) {
                        setScanned(true);
                        const ur = decoder.resultUR();
                        const decodedBuffer = ur.decodeCBOR();
                        psbtBase64 = Buffer.from(decodedBuffer).toString('base64');
                    } else {
                        Alert.alert('Scan Error', 'Failed to decode animated QR.');
                        setScanned(false);
                        return;
                    }
                } else {
                    return;
                }
            } else {
                setScanned(true);
                psbtBase64 = data;
            }

            if (psbtBase64) {
                const { recipientAddress, amount, unit, fee, utxos, unsignedPsbtBase64 } = route.params;

                navigation.navigate('TransactionConfirm', {
                    recipientAddress,
                    amount,
                    unit,
                    fee,
                    utxos,
                    isImported: true,
                    loading: false,
                    onConfirm: async () => {
                        try {
                            await finalizeAndBroadcastPSBT(unsignedPsbtBase64, psbtBase64);

                            Alert.alert(
                                'Transaction sent!',
                                'Your signed transaction has been broadcasted.',
                                [{ text: 'OK', onPress: () => navigation.popToTop() }]
                            );
                        } catch (error) {
                            console.error(error);
                            Alert.alert('Broadcast Error', error instanceof Error ? error.message : 'Failed to finalize and broadcast the transaction.');
                            setScanned(false);
                        }
                    }
                });
            }
        } catch (e) {
            if (!data.toLowerCase().startsWith('ur:')) {
                Alert.alert("Invalid format", "The scanned QR code is not a valid PSBT.");
                setScanned(false);
            }
        }
    };

    if (!permission?.granted) {
        return (
            <View style={styles.centered}>
                <Text style={{ color: theme.colors.primary }}>Camera permission is required.</Text>
                <TouchableOpacity onPress={requestPermission} style={styles.permissionButton}>
                    <Text style={{ color: theme.colors.inversePrimary }}>Grant Permission</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const progressSectionHeight = revealAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 50],
    });

    const progressSectionOpacity = revealAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
    });

    const progressWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    return (
        <View style={styles.container}>
            {isFocused && (
                <CameraView
                    style={StyleSheet.absoluteFillObject}
                    facing="back"
                    onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                />
            )}
            <View style={styles.overlay}>
                <View style={styles.scanArea} />

                <View style={styles.instructionContainer}>
                    <View style={styles.instructionHeader}>
                        <Feather name="maximize" size={24} color={theme.colors.primary} />
                        <Text style={styles.instructionText}>Scan signed transaction</Text>
                    </View>
                    
                    <Animated.View style={[styles.progressSection, { height: progressSectionHeight, opacity: progressSectionOpacity }]}>
                        <View style={styles.progressBarTrack}>
                            <Animated.View style={[styles.progressBarFill, { width: progressWidth }]} />
                        </View>
                        <Text style={styles.progressText}>{Math.round(progress * 100)}% captured</Text>
                    </Animated.View>
                </View>
            </View>
        </View>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
    permissionButton: { marginTop: 16, padding: 12, backgroundColor: theme.colors.primary, borderRadius: 8 },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scanArea: {
        width: 250,
        height: 250,
        borderWidth: 2,
        borderColor: 'white',
        backgroundColor: 'transparent',
        borderRadius: 16,
    },
    instructionContainer: {
        position: 'absolute',
        bottom: 80,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 24,
        paddingVertical: 16,
        borderRadius: 24,
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: 260,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    instructionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    instructionText: {
        color: theme.colors.primary,
        fontSize: 16,
        fontWeight: '600',
    },
    progressSection: {
        width: '100%',
        alignItems: 'center',
        overflow: 'hidden',
        marginTop: 4,
    },
    progressBarTrack: {
        width: '100%',
        height: 6,
        backgroundColor: theme.colors.border,
        borderRadius: 3,
        marginTop: 12,
        marginBottom: 8,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        backgroundColor: theme.colors.bitcoin || '#F7931A', 
        borderRadius: 3,
    },
    progressText: {
        color: theme.colors.bitcoin || '#F7931A',
        fontSize: 13,
        fontWeight: '600',
    },
});

export default ImportPSBTScreen;
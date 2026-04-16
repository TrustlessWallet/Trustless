import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Dimensions } from 'react-native';
import { Text } from '../components/StyledText';
import QRCode from 'react-native-qrcode-svg';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { Feather } from '@expo/vector-icons';
import { buildPSBT, encodePSBTtoUR } from '../services/bitcoin';

type RouteParams = RouteProp<RootStackParamList, 'ExportPSBT'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ExportPSBT'>;

const ExportPSBTScreen = () => {
    const [unsignedPsbtString, setUnsignedPsbtString] = useState<string>('');
    const navigation = useNavigation<NavigationProp>();
    const route = useRoute<RouteParams>();
    const { activeWallet } = useWallet();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);

    const { recipientAddress, amount, unit, fee, utxos } = route.params;

    const [qrFrames, setQrFrames] = useState<string[]>([]);
    const [frameIndex, setFrameIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const qrSize = useMemo(() => {
        const screenWidth = Dimensions.get('window').width;
        const padding = 48;
        const qrPadding = 16;
        return screenWidth - padding - qrPadding;
    }, []);

    useEffect(() => {
        try {
            const base64Psbt = buildPSBT(activeWallet, recipientAddress, amount, unit, fee, utxos);
            setUnsignedPsbtString(base64Psbt);

            const parts = encodePSBTtoUR(base64Psbt);
            setQrFrames(parts.length > 0 ? parts : [base64Psbt]);
        } catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : "Failed to build transaction");
        }
    }, [activeWallet, amount, fee, recipientAddress, unit, utxos]);

    useEffect(() => {
        if (qrFrames.length <= 1) return;
        const interval = setInterval(() => {
            setFrameIndex(prev => (prev + 1) % qrFrames.length);
        }, 400);
        return () => clearInterval(interval);
    }, [qrFrames]);

    const handleImportScan = () => {
        navigation.navigate('ImportPSBT', {
            recipientAddress,
            amount,
            unit,
            fee,
            utxos,
            unsignedPsbtBase64: unsignedPsbtString
        });
    };

    if (error) {
        return (
            <View style={styles.centered}>
                <Feather name="alert-circle" size={48} color={theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} bounces={false}>
            <View style={styles.instructionContainer}>
                <Text style={styles.instructionText}>1. Scan this QR code with your signing device.</Text>
                <Text style={styles.instructionText}>2. Review and sign the transaction.</Text>
                <Text style={styles.instructionText}>3. Import the signed transaction back into Trustless.</Text>
            </View>

            <View style={styles.qrWrapper}>
                {qrFrames.length > 0 ? (
                    <View style={styles.qrContainer}>
                        <QRCode
                            value={qrFrames[frameIndex]}
                            size={qrSize}
                            backgroundColor={theme.colors.background}
                            color={theme.colors.primary}
                            ecl="M"
                            quietZone={10}
                        />
                    </View>
                ) : (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={styles.loadingText}>Building transaction...</Text>
                    </View>
                )}
            </View>

            <TouchableOpacity
                style={[styles.button, qrFrames.length === 0 && styles.buttonDisabled]}
                onPress={handleImportScan}
                disabled={qrFrames.length === 0}
            >
                <Feather name="camera" size={20} color={theme.colors.inversePrimary} />
                <Text style={styles.buttonText}>Import signed transaction</Text>
            </TouchableOpacity>
        </ScrollView>
    );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    scrollContent: {
        paddingHorizontal: 24,
        paddingBottom: 256,
        paddingTop: 16,
        flexGrow: 1,
        justifyContent: 'space-between',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.background,
        padding: 24,
    },
    qrWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
        paddingHorizontal: 24,
    },
    qrContainer: {
        padding: 8,
        backgroundColor: theme.colors.background,
        borderRadius: 8,
        shadowColor: theme.colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? 0.3 : 0.1,
        shadowRadius: 3,
        elevation: 3,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    loadingContainer: {
        height: 332,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
    },
    loadingText: {
        color: theme.colors.muted,
        fontSize: 14,
    },
    errorText: {
        color: theme.colors.error,
        marginTop: 16,
        textAlign: 'center',
        fontSize: 16,
    },
    button: {
        backgroundColor: theme.colors.primary,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 56,
        borderRadius: 8,
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    buttonText: {
        color: theme.colors.inversePrimary,
        fontSize: 16,
        fontWeight: '600',
    },
    instructionContainer: {
        backgroundColor: theme.colors.surface,
        borderRadius: 8,
        padding: 16,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: 16,
        gap: 16,
    },
    instructionText: {
        color: theme.colors.primary,
        fontSize: 16,
        textAlign: 'left',
        lineHeight: 24,
    },
});

export default ExportPSBTScreen;
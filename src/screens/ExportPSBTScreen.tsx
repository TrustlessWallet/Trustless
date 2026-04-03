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
import * as bitcoin from 'bitcoinjs-lib';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { cborEncode } from '@ngraveio/bc-ur/dist/cbor';
import { getBip32Node } from '../services/bitcoin';
import { NETWORK, DERIVATION_PARENT_PATH } from '../constants/network';
import { Buffer } from 'buffer';

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
        if (!activeWallet || activeWallet.type !== 'watch-only') return;
        if (!activeWallet.fingerprint || !activeWallet.xpub) {
            setError("Wallet is missing master fingerprint or xpub.");
            return;
        }

        try {
            const cleanAmount = amount.replace(',', '.');
            const amountSatoshis = unit === 'BTC' ? Math.round(parseFloat(cleanAmount) * 100000000) : parseInt(cleanAmount, 10);
            const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
            const change = totalInput - amountSatoshis - fee;

            const psbt = new bitcoin.Psbt({ network: NETWORK });
            const rootNode = getBip32Node(activeWallet.xpub, NETWORK);
            const masterFingerprint = Buffer.from(activeWallet.fingerprint, 'hex');

            let basePath = activeWallet.derivation_path || DERIVATION_PARENT_PATH;
            if (basePath.startsWith('m/')) basePath = basePath.slice(2);
            basePath = basePath.replace(/'/g, 'h');

            utxos.forEach(utxo => {
                const recvInfo = activeWallet.derivedReceiveAddresses.find(a => a.address === utxo.address);
                const changeInfo = recvInfo ? null : activeWallet.derivedChangeAddresses.find(a => a.address === utxo.address);

                if (!recvInfo && !changeInfo) throw new Error("Derivation info missing for UTXO");

                const chain = changeInfo ? 1 : 0;
                const index = changeInfo ? changeInfo.index : recvInfo!.index;
                const pathSuffix = `${chain}/${index}`;
                const fullPath = `m/${basePath}/${pathSuffix}`.replace(/h/g, "'");

                const childNode = rootNode.derivePath(pathSuffix);
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: childNode.publicKey, network: NETWORK });

                psbt.addInput({
                    hash: utxo.txid,
                    index: utxo.vout,
                    witnessUtxo: { script: p2wpkh.output!, value: utxo.value },
                    bip32Derivation: [{
                        masterFingerprint,
                        path: fullPath,
                        pubkey: childNode.publicKey
                    }]
                });
            });

            psbt.addOutput({ address: recipientAddress, value: amountSatoshis });

            if (change > 0) {
                let verifiedChangeIndex = activeWallet.changeAddressIndex ?? 0;
                const changeSet = new Set(activeWallet.derivedChangeAddresses.map(a => a.address));
                for (let i = verifiedChangeIndex; i < activeWallet.derivedChangeAddresses.length + 20; i++) {
                    const info = activeWallet.derivedAddressInfoCache.find(c => c.index === i && changeSet.has(c.address));
                    if (!info || info.tx_count === 0) {
                        verifiedChangeIndex = i;
                        break;
                    }
                }

                const changeNode = rootNode.derivePath(`1/${verifiedChangeIndex}`);
                const p2wpkhChange = bitcoin.payments.p2wpkh({ pubkey: changeNode.publicKey, network: NETWORK });
                const fullChangePath = `m/${basePath}/1/${verifiedChangeIndex}`.replace(/h/g, "'");

                psbt.addOutput({
                    address: p2wpkhChange.address!,
                    value: change,
                    bip32Derivation: [{
                        masterFingerprint,
                        path: fullChangePath,
                        pubkey: changeNode.publicKey
                    }]
                });
            }

            const base64Psbt = psbt.toBase64();
            setUnsignedPsbtString(base64Psbt);

            const psbtBytes = Buffer.from(base64Psbt, 'base64');
            const ur = new UR(cborEncode(psbtBytes), 'crypto-psbt');
            const encoder = new UREncoder(ur, 120);
            const parts = encoder.encodeWhole();

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
            unsignedPsbtBase64: unsignedPsbtString // <-- Add this line
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
        <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
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
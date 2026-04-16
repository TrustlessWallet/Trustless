import React, { useState, useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Clipboard, Share, Alert, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import QRCode from 'react-native-qrcode-svg';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { useWallet } from '../contexts/WalletContext';
import { NETWORK, NETWORK_NAME, DERIVATION_PARENT_PATH } from '../constants/network';
import { format_public_key } from '../services/bitcoin';
import { AddressText } from '../components/AddressText';
import * as bip39 from 'bip39';
import * as secp from '@bitcoinerlab/secp256k1';
import { BIP32Factory } from 'bip32';

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'ShowPublicKey'>;
type route_prop_type = RouteProp<RootStackParamList, 'ShowPublicKey'>;

const qr_size = 260;

const bip32 = BIP32Factory(secp);

const ShowPublicKeyScreen = () => {
    const route = useRoute<route_prop_type>();
    const { wallet_id } = route.params;

    const { wallets, getMnemonicForWallet } = useWallet();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => get_styles(theme, isDark), [theme, isDark]);

    const [copied, set_copied] = useState(false);
    const [derived_fingerprint, set_derived_fingerprint] = useState<string | null>(null);
    const [derived_path, set_derived_path] = useState<string | null>(null);

    const wallet = useMemo(() => wallets.find(w => w.id === wallet_id), [wallets, wallet_id]);

    useEffect(() => {
        let cancelled = false;

        const derive_metadata = async () => {
            if (!wallet) return;
            if (wallet.type !== 'standard') return;
            if (wallet.fingerprint && wallet.derivation_path) return;

            try {
                const mnemonic = await getMnemonicForWallet(wallet.id);
                if (!mnemonic) return;

                const seed = bip39.mnemonicToSeedSync(mnemonic);
                const root = bip32.fromSeed(seed, NETWORK);

                if (cancelled) return;
                set_derived_fingerprint(root.fingerprint.toString('hex'));
                set_derived_path(DERIVATION_PARENT_PATH);
            } catch (e) {
            }
        };

        derive_metadata();
        return () => { cancelled = true; };
    }, [wallet?.id, wallet?.type, wallet?.fingerprint, wallet?.derivation_path, getMnemonicForWallet]);

    const effective_fingerprint = wallet?.fingerprint || derived_fingerprint || '';
    const effective_path = wallet?.derivation_path || derived_path || '';

    const formatted_pub_key = useMemo(() => {
        if (!wallet || !wallet.xpub) return '';
        return format_public_key(wallet.xpub, wallet.scriptType || 'p2wpkh', NETWORK_NAME);
    }, [wallet]);

    const export_string = useMemo(() => {
        if (!formatted_pub_key) return '';
        if (effective_fingerprint && effective_path) {
            let path = effective_path;
            if (path.startsWith('m/')) {
                path = path.slice(2);
            }
            path = path.replace(/h/g, "'");
            return `[${effective_fingerprint}/${path}]${formatted_pub_key}`;
        }
        return formatted_pub_key;
    }, [formatted_pub_key, effective_fingerprint, effective_path]);

    const copy_to_clipboard = () => {
        if (export_string) {
            Clipboard.setString(export_string);
            set_copied(true);
            setTimeout(() => set_copied(false), 1500);
        }
    };

    const on_share = async () => {
        if (export_string) {
            try {
                await Share.share({ message: export_string });
            } catch (error) {
                Alert.alert("Error", "Could not share the public key.");
            }
        }
    };

    if (!wallet || !wallet.xpub) {
        return (
            <View style={styles.centered_container}>
                <Text style={styles.error_text}>Public key not available.</Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.scroll_content} showsVerticalScrollIndicator={true} bounces={false}>
            <View style={styles.qr_container}>
                <Text style={styles.description_text}>
                    This extended public key can be used to generate all your wallet's addresses.
                </Text>

                {!!effective_path && (
                    <View style={styles.meta_container}>
                        <Text style={styles.meta_text}>{effective_path.replace(/h/g, "'")}</Text>
                    </View>
                )}

                <TouchableOpacity style={styles.qr_code_wrapper} onPress={copy_to_clipboard} activeOpacity={0.8}>
                    {copied && (
                        <View style={styles.copied_overlay}>
                            <Feather name="copy" size={32} color={theme.colors.primary} />
                            <Text style={styles.copied_text}>Copied!</Text>
                        </View>
                    )}
                    <QRCode
                        value={export_string}
                        size={qr_size}
                        backgroundColor={theme.colors.background}
                        color={theme.colors.primary}
                    />
                </TouchableOpacity>

                {!!effective_fingerprint && (
                    <View style={[styles.meta_container, styles.meta_container_bottom]}>
                        <MaterialIcons name="fingerprint" size={16} color={theme.colors.muted} style={styles.meta_icon} />
                        <Text style={styles.meta_text}>{effective_fingerprint}</Text>
                    </View>
                )}

                <AddressText
                    style={styles.address_text}
                    selectable
                    address={formatted_pub_key}
                    groupSize={6}
                    padLastLine
                />
            </View>

            <View style={styles.actions_container}>
                <TouchableOpacity style={styles.action_button} onPress={copy_to_clipboard}>
                    <Feather name="copy" size={24} color={theme.colors.primary} />
                    <Text style={styles.action_button_text}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.action_button} onPress={on_share}>
                    <Feather name="share-2" size={24} color={theme.colors.primary} />
                    <Text style={styles.action_button_text}>Share</Text>
                </TouchableOpacity>
            </View>
        </ScrollView>
    );
};

const get_styles = (theme: Theme, isDark: boolean) => StyleSheet.create({
    centered_container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.background,
    },
    scroll_content: {
        flexGrow: 1,
        paddingBottom: 16,
        backgroundColor: theme.colors.background,
        paddingTop: 8,
    },
    error_text: {
        color: theme.colors.error,
        fontSize: 16,
    },
    qr_container: {
        alignItems: 'center',
        paddingBottom: 16,
        width: '100%',
    },
    description_text: {
        fontSize: 14,
        color: theme.colors.muted,
        marginBottom: 16,
        textAlign: 'center',
        paddingHorizontal: 24,
        lineHeight: 20,
    },
    meta_container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    meta_container_bottom: {
        marginBottom: 16,
    },
    meta_text: {
        fontSize: 14,
        color: theme.colors.muted,
        fontWeight: 'normal',
        letterSpacing: 0.5,
    },
    meta_icon: {
        marginRight: 6,
    },
    qr_code_wrapper: {
        padding: 16,
        backgroundColor: theme.colors.background,
        borderRadius: 8,
        shadowColor: theme.colors.primary,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: isDark ? 0.3 : 0.1,
        shadowRadius: 3,
        elevation: 3,
        borderWidth: 1,
        borderColor: theme.colors.border,
        marginBottom: 8,
    },
    copied_overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.colors.background + 'CC',
        borderRadius: 8,
        gap: 8,
        zIndex: 10,
    },
    copied_text: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.colors.primary
    },
    address_text: {
        fontSize: 14,
        textAlign: 'center',
        color: theme.colors.primary,
        lineHeight: 24,
        paddingHorizontal: 50,
    },
    actions_container: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 32,
        width: '100%',
        paddingVertical: 1,
    },
    action_button: {
        alignItems: 'center',
        padding: 12,
        minWidth: 80
    },
    action_button_text: {
        color: theme.colors.primary,
        fontSize: 14,
        marginTop: 8
    },
});

export default ShowPublicKeyScreen;
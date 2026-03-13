import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Clipboard, Share, Alert, ScrollView } from 'react-native';
import { Text } from '../components/StyledText';
import QRCode from 'react-native-qrcode-svg';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { useWallet } from '../contexts/WalletContext';
import { NETWORK_NAME } from '../constants/network';
import { format_public_key } from '../services/bitcoin';
import { AddressText } from '../components/AddressText';

type navigation_prop = NativeStackNavigationProp<RootStackParamList, 'ShowPublicKey'>;
type route_prop_type = RouteProp<RootStackParamList, 'ShowPublicKey'>;

const qr_size = 260;

const ShowPublicKeyScreen = () => {
    const navigation = useNavigation<navigation_prop>();
    const route = useRoute<route_prop_type>();
    const { wallet_id } = route.params;
    
    const { wallets } = useWallet();
    const { theme, isDark } = useTheme();
    const styles = useMemo(() => get_styles(theme, isDark), [theme, isDark]);
    
    const [copied, set_copied] = useState(false);

    const wallet = useMemo(() => wallets.find(w => w.id === wallet_id), [wallets, wallet_id]);
    
    const formatted_pub_key = useMemo(() => {
        if (!wallet || !wallet.xpub) return '';
        return format_public_key(wallet.xpub, wallet.scriptType || 'p2wpkh', NETWORK_NAME);
    }, [wallet]);

    const copy_to_clipboard = () => {
        if (formatted_pub_key) {
            Clipboard.setString(formatted_pub_key);
            set_copied(true);
            setTimeout(() => set_copied(false), 1500);
        }
    };

    const on_share = async () => {
        if (formatted_pub_key) {
            try {
                await Share.share({ message: formatted_pub_key });
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
        <ScrollView contentContainerStyle={styles.scroll_content} showsVerticalScrollIndicator={true}>
            <View style={styles.qr_container}>
                <Text style={styles.description_text}>
                    This extended public key can be used to generate all your wallet's addresses.
                </Text>
                
                <TouchableOpacity style={styles.qr_code_wrapper} onPress={copy_to_clipboard} activeOpacity={0.8}>
                    {copied && (
                        <View style={styles.copied_overlay}>
                            <Feather name="copy" size={32} color={theme.colors.primary} />
                            <Text style={styles.copied_text}>Copied!</Text>
                        </View>
                    )}
                    <QRCode 
                        value={formatted_pub_key} 
                        size={qr_size} 
                        backgroundColor={theme.colors.background} 
                        color={theme.colors.primary} 
                    />
                </TouchableOpacity>
                
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
        paddingBottom: 32,
        backgroundColor: theme.colors.background, 
        paddingTop: 16,
    },
    error_text: {
        color: theme.colors.error,
        fontSize: 16,
    },
    qr_container: { 
        alignItems: 'center', 
        paddingTop: 8, 
        paddingBottom: 24,
        width: '100%', 
    },
    description_text: {
        fontSize: 14,
        color: theme.colors.muted, 
        marginBottom: 24,
        textAlign: 'center',
        paddingHorizontal: 24,
        lineHeight: 20,
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
        marginBottom: 24,
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
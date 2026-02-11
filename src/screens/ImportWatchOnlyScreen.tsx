import React, { useState, useMemo } from 'react';
import { 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator, 
  TouchableWithoutFeedback, 
  Keyboard 
} from 'react-native';
import { Text } from '../components/StyledText';
import { StyledInput } from '../components/StyledInput';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../contexts/WalletContext';
import { Feather } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import { NETWORK, NETWORK_NAME } from '../constants/network';

import { BIP32Factory } from 'bip32';
import * as secp from '@bitcoinerlab/secp256k1';
const bip32 = BIP32Factory(secp);

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportWatchOnly'>;

const ImportWatchOnlyScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme, isDark } = useTheme();
    const { addWallet } = useWallet();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const [name, setName] = useState('');
    const [xpub, setXpub] = useState('');
    const [loading, setLoading] = useState(false);

    const handleScan = () => {
        navigation.navigate('QRScanner', {
            onScanSuccess: (data) => {
                setXpub(data);
                navigation.goBack();
            }
        });
    };

    const handleImport = async () => {
        const trimmedXpub = xpub.trim();
        if (!trimmedXpub) return;
        
        const validPrefixes = ['xpub', 'zpub', 'ypub', 'vpub', 'tpub', 'upub'];
        if (!validPrefixes.some(p => trimmedXpub.startsWith(p))) {
            Alert.alert("Invalid Key", "Please enter a valid extended public key.");
            return;
        }

        try {
            bip32.fromBase58(trimmedXpub, NETWORK); 
        } catch (e) {
            console.warn(e);
            Alert.alert(
                "Network Mismatch", 
                `This key is not valid for ${NETWORK_NAME}. Please switch networks or use a compatible key.`
            );
            return;
        }

        setLoading(true);
        try {
            const wallet = await addWallet({
                type: 'watch-only',
                xpub: trimmedXpub,
                name: name.trim() || undefined
            });

            if (wallet) {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }]
                });
            } else {
                Alert.alert("Error", "Failed to import wallet.");
            }
        } catch (e) {
            console.error(e);
            Alert.alert("Error", "Could not import this key. Please check format.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.container}>
                <Text style={styles.label}>Wallet Label (Optional)</Text>
                <StyledInput 
                    placeholder="e.g. Cold Storage"
                    value={name}
                    onChangeText={setName}
                    containerStyle={styles.inputSpacing}
                    editable={!loading}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                />

                <Text style={styles.label}>Extended Public Key</Text>
                <StyledInput 
                    placeholder="xpub..."
                    value={xpub}
                    onChangeText={setXpub}
                    autoCapitalize="none"
                    autoCorrect={false}
                    containerStyle={styles.inputSpacing}
                    editable={!loading}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    rightElement={
                        <TouchableOpacity style={styles.scanButton} onPress={handleScan}>
                            <Feather name="camera" size={20} color={theme.colors.primary} />
                        </TouchableOpacity>
                    }
                />

                <Text style={styles.helperText}>
                    Supports xpub, zpub, ypub formats. Import from hardware wallets or other software to watch your balance.
                </Text>

                <TouchableOpacity 
                    style={[styles.button, (!xpub || loading) && styles.buttonDisabled]} 
                    onPress={handleImport}
                    disabled={!xpub || loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.colors.inversePrimary} />
                    ) : (
                        <View style={styles.buttonContent}>
                            <Feather name="download-cloud" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.buttonText}>Import Wallet</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>
        </TouchableWithoutFeedback>
    );
};

const getStyles = (theme: Theme) => StyleSheet.create({
    container: { 
        flex: 1, 
        backgroundColor: theme.colors.background,
        padding: 24
    },
    label: {
        fontSize: 16, 
        marginBottom: 8, 
        color: theme.colors.primary, 
        fontWeight: '500',
    },
    inputSpacing: {
        marginBottom: 24,
    },
    scanButton: {
        padding: 10,
    },
    helperText: {
        color: theme.colors.muted,
        fontSize: 13,
        marginBottom: 32,
        lineHeight: 20
    },
    button: { 
        backgroundColor: theme.colors.primary, 
        borderRadius: 8, 
        alignItems: 'center', 
        height: 56, 
        justifyContent: 'center',
    },
    buttonDisabled: {
        opacity: 0.5
    },
    buttonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8
    },
    buttonText: { 
        color: theme.colors.inversePrimary, 
        fontSize: 16, 
        fontWeight: '600', 
    }
});

export default ImportWatchOnlyScreen;
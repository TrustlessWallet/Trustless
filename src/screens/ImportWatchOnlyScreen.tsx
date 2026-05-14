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
import { getBip32Node } from '../services/bitcoin';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ImportWatchOnly'>;

const ImportWatchOnlyScreen = () => {
    const navigation = useNavigation<NavigationProp>();
    const { theme, isDark } = useTheme();
    const { addWallet } = useWallet();
    const styles = useMemo(() => getStyles(theme), [theme]);

    const [xpub, set_xpub] = useState('');
    const [loading, set_loading] = useState(false);

    const handle_scan = () => {
        navigation.navigate('QRScanner', {
            onScanSuccess: (data) => {
                set_xpub(data);
            }
        });
    };

    const handle_import = async () => {
        const raw_input = xpub.trim();
        if (!raw_input) return;

        let final_xpub = raw_input;
        let parsed_fingerprint = undefined;
        let parsed_path = undefined;

        const match = raw_input.match(/^\[([a-f0-9]{8})\/([^\]]+)\](.*)$/i);

        if (match) {
            parsed_fingerprint = match[1];
            parsed_path = "m/" + match[2].replace(/'/g, "h");
            final_xpub = match[3];
        } else {
            Alert.alert(
                "Missing metadata",
                "Hardware wallets require the master fingerprint and derivation path. Please scan the full format containing [fingerprint/path]."
            );
            return;
        }

        const valid_prefixes = ['xpub', 'zpub', 'ypub', 'vpub', 'tpub', 'upub'];
        if (!valid_prefixes.some(p => final_xpub.startsWith(p))) {
            Alert.alert("Invalid key", "Please enter a valid extended public key.");
            return;
        }

        try {
            getBip32Node(final_xpub, NETWORK);
        } catch (e) {
            console.warn(e);
            Alert.alert(
                "Network Mismatch",
                `This key is not valid for ${NETWORK_NAME}. Please switch networks or use a compatible key.`
            );
            return;
        }

        set_loading(true);
        try {
            const wallet = await addWallet({
                type: 'watch-only',
                xpub: final_xpub,
                fingerprint: parsed_fingerprint,
                derivation_path: parsed_path,
                name: undefined
            });

            if (wallet) {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }]
                });
            }
        } catch (e) {
            console.error(e);
            Alert.alert("Error", "Could not import this key. Please check format.");
        } finally {
            set_loading(false);
        }
    };

    return (
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.container}>
                <View>
                    <Text style={styles.label}>Extended public key</Text>
                    <StyledInput
                        placeholder="[95e61bfa/84'/1'/0']vpub5Z8P...vUsREK"
                        value={xpub}
                        onChangeText={set_xpub}
                        autoCapitalize="none"
                        autoCorrect={false}
                        spellCheck={false}
                        editable={!loading}
                        keyboardAppearance={isDark ? 'dark' : 'light'}
                        multiline
                        containerStyle={styles.multilineInput}
                        rightElement={
                            <TouchableOpacity style={styles.scanButton} onPress={handle_scan}>
                                <Feather name="camera" size={20} color={theme.colors.primary} />
                            </TouchableOpacity>
                        }
                    />
                    <Text style={styles.helperText}>
                        Import from hardware wallet or other software to watch your balance.
                    </Text>
                </View>

                <TouchableOpacity
                    style={[styles.button, (!xpub || loading) && styles.buttonDisabled]}
                    onPress={handle_import}
                    disabled={!xpub || loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.colors.inversePrimary} />
                    ) : (
                        <View style={styles.buttonContent}>
                            <Feather name="eye" size={18} color={theme.colors.inversePrimary} />
                            <Text style={styles.buttonText}>Import wallet</Text>
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
    multilineInput: {
        height: 120,
        marginBottom: 8,
    },
    scanButton: {
        padding: 10,
    },
    helperText: {
        color: theme.colors.muted,
        fontSize: 13,
        lineHeight: 20,
    },
    button: {
        backgroundColor: theme.colors.primary,
        borderRadius: 8,
        alignItems: 'center',
        height: 56,
        justifyContent: 'center',
        marginTop: 24,
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
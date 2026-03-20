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

    const [name, set_name] = useState('');
    const [xpub, set_xpub] = useState('');
    const [loading, set_loading] = useState(false);

    const handle_scan = () => {
        navigation.navigate('QRScanner', {
            onScanSuccess: (data) => {
                set_xpub(data);
                navigation.goBack();
            }
        });
    };

    const handle_import = async () => {
        const trimmed_xpub = xpub.trim();
        if (!trimmed_xpub) return;
        
        const valid_prefixes = ['xpub', 'zpub', 'ypub', 'vpub', 'tpub', 'upub'];
        if (!valid_prefixes.some(p => trimmed_xpub.startsWith(p))) {
            Alert.alert("Invalid Key", "Please enter a valid extended public key.");
            return;
        }

        try {
            getBip32Node(trimmed_xpub, NETWORK);
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
                xpub: trimmed_xpub,
                name: name.trim() || undefined
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
                <View style={styles.inputSpacing}>
                <Text style={styles.label}>Extended public key</Text>
                <StyledInput 
                    placeholder="xpub / zpub / ypub"
                    value={xpub}
                    onChangeText={set_xpub}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                    rightElement={
                        <TouchableOpacity style={styles.scanButton} onPress={handle_scan}>
                            <Feather name="camera" size={20} color={theme.colors.primary} />
                        </TouchableOpacity>
                    }
                />                
                <Text style={styles.helperText}>
                    Import from hardware wallets or other software to watch your balance.
                </Text>
                </View>

                <Text style={styles.label}>Wallet label (optional)</Text>
                <StyledInput 
                    placeholder="e.g. Cold storage"
                    value={name}
                    onChangeText={set_name}
                    containerStyle={styles.inputSpacing}
                    editable={!loading}
                    keyboardAppearance={isDark ? 'dark' : 'light'}
                />

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
        marginBottom: 16,
    },
    scanButton: {
        padding: 10,
    },
    helperText: {
        color: theme.colors.muted,
        fontSize: 13,
        lineHeight: 20,
        marginTop: 8,
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
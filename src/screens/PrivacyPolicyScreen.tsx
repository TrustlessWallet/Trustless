import React, { useMemo } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
const PrivacyPolicyScreen = () => {
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>1. No Data Collection</Text>
      <Text style={styles.paragraph}>
        We do not collect, store, or transmit any personal information. We do not have servers, a backend, or a database. Your wallet's private keys, transaction history, and settings are stored entirely on your local device.
      </Text>
      <Text style={styles.heading}>2. Private Keys & Security</Text>
      <Text style={styles.paragraph}>
        Your recovery phrase (mnemonic) and private keys are encrypted and stored in your device's secure storage (Keychain/Keystore). They never leave your device. We cannot access your funds, and we cannot help you recover them if you lose your backup.
      </Text>
      <Text style={styles.heading}>3. Network & Third Parties</Text>
      <Text style={styles.paragraph}>
        This app connects directly to public Bitcoin block explorers (Mempool.space and Blockstream.info) to retrieve balances and broadcast transactions.
      </Text>
      <Text style={styles.paragraph}>
        <Text style={styles.bold}>Important:</Text> When you open the app, your device queries these services. While we do not track you, these third-party providers may see your IP address and the bitcoin addresses you are querying.
      </Text>
      <Text style={styles.heading}>4. Camera & Biometrics</Text>
      <Text style={styles.paragraph}>
        <Text style={styles.bullet}>• Camera:</Text> Used solely for scanning QR codes. No images are saved or sent anywhere.
      </Text>
      <Text style={styles.paragraph}>
        <Text style={styles.bullet}>• Biometrics:</Text> We use your device's local authentication (FaceID/TouchID) to unlock the app. Biometric data remains in your device's Secure Enclave and is never accessible to the app.
      </Text>
    </ScrollView>
  );
};
const getStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  heading: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginTop: 24,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 16,
    color: theme.colors.muted,
    lineHeight: 24,
    marginBottom: 12,
  },
  bold: {
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  bullet: {
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
});
export default PrivacyPolicyScreen;
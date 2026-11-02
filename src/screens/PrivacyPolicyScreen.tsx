import React, { useMemo } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
const PrivacyPolicyScreen = () => {
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} bounces={false}>
      <Text style={styles.heading}>1. Local Wallet Data</Text>
      <Text style={styles.paragraph}>
        Your wallet secrets and Terminal records are stored on your device. Sales, items, receipt settings, and backups are not uploaded for subscription billing. Files you choose to export or share go only to the destination you select.
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
      <Text style={styles.heading}>5. Optional Terminal Pro</Text>
      <Text style={styles.paragraph}>Terminal Pro uses RevenueCat and your app store to check purchases and subscriptions. RevenueCat receives an anonymous purchase identifier, purchase and subscription records, and technical connection information. We do not send your seed, private keys, wallet addresses, balances, sales records, receipt content, or customer details to RevenueCat. No separate account is required.</Text>
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
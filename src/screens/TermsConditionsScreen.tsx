import React, { useMemo } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
const TermsConditionsScreen = () => {
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} bounces={false}>
      <Text style={styles.heading}>1. Non-Custodial Service</Text>
      <Text style={styles.paragraph}>
        This software is a self-custodial Bitcoin wallet. You have sole control over your private keys at all times, for both your on-chain funds and your Lightning balance. The developers of this app never have access to your keys or funds and cannot retrieve them for you.
      </Text>
      <Text style={styles.heading}>2. Lightning Balance and Cooperative Withdrawal</Text>
      <Text style={styles.paragraph}>
        Your Lightning balance uses Spark through Breez SDK. Normal payments and withdrawals require cooperation from the service. Unilateral exit is available as a last-resort recovery option in Settings. It requires saved recovery data, separate on-chain fee funding, a compatible transaction broadcaster, and waiting for confirmations and timelocks. Your seed alone may not be enough to recover during a service outage; keep an encrypted recovery backup. The developers cannot retrieve your keys or funds.
      </Text>
      <Text style={styles.heading}>3. Your Responsibilities</Text>
      <Text style={styles.paragraph}>
        You are responsible for securing your device and backing up your 12-24 word recovery phrase. If you lose this phrase or your device is compromised, your funds may be lost permanently.
      </Text>
      <Text style={styles.heading}>4. No Warranty ("As Is")</Text>
      <Text style={styles.paragraph}>
        This software is provided "as is", without warranty of any kind, express or implied. The developers utilize best practices for security but do not guarantee that the software is error-free. You use this software at your own risk.
      </Text>
      <Text style={styles.heading}>5. Bitcoin Network Risks</Text>
      <Text style={styles.paragraph}>
        Bitcoin transactions are irreversible. Once sent, funds cannot be recovered. You acknowledge the risks associated with cryptocurrency, including value volatility and network congestion.
      </Text>
      <Text style={styles.heading}>6. Third-Party Availability</Text>
      <Text style={styles.paragraph}>
        This app relies on public APIs (such as Mempool.space and Blockstream) to function. We do not control these services and cannot guarantee their uptime. If these services are unavailable, the app may fail to update balances or send transactions temporarily.
      </Text>
      <Text style={styles.heading}>7. Optional Terminal Pro</Text>
      <Text style={styles.paragraph}>Terminal Pro is an optional auto-renewing subscription. The store shows your local price, billing period, and any eligible free trial before purchase. Payment is charged by your app store. Unless canceled in your store’s subscription settings before renewal, the subscription renews at the displayed store price. An eligible trial converts to a paid subscription unless canceled before it ends. You can restore purchases using the same store account.</Text>
      <Text style={styles.paragraph}>Checkout, sales history, refunds, basic receipts, raw sales CSV export, and encrypted backup remain free. Expiry does not delete your data or remove existing branding from receipts. Store terms apply to purchases; iOS purchases also use Apple’s standard licensed application agreement.</Text>
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
});
export default TermsConditionsScreen;
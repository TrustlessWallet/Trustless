import React, { useMemo } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
const TermsConditionsScreen = () => {
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>1. Non-Custodial Service</Text>
      <Text style={styles.paragraph}>
        This software is a self-custodial Bitcoin wallet. You have sole control over your private keys and funds. The developers of this app never have access to your funds and cannot retrieve them for you.
      </Text>
      <Text style={styles.heading}>2. Your Responsibilities</Text>
      <Text style={styles.paragraph}>
        You are responsible for securing your device and backing up your 12-24 word recovery phrase. If you lose this phrase or your device is compromised, your funds may be lost permanently.
      </Text>
      <Text style={styles.heading}>3. No Warranty ("As Is")</Text>
      <Text style={styles.paragraph}>
        This software is provided "as is", without warranty of any kind, express or implied. The developers utilize best practices for security but do not guarantee that the software is error-free. You use this software at your own risk.
      </Text>
      <Text style={styles.heading}>4. Bitcoin Network Risks</Text>
      <Text style={styles.paragraph}>
        Bitcoin transactions are irreversible. Once sent, funds cannot be recovered. You acknowledge the risks associated with cryptocurrency, including value volatility and network congestion.
      </Text>
      <Text style={styles.heading}>5. Third-Party Availability</Text>
      <Text style={styles.paragraph}>
        This app relies on public APIs (such as Mempool.space and Blockstream) to function. We do not control these services and cannot guarantee their uptime. If these services are unavailable, the app may fail to update balances or send transactions temporarily.
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
});
export default TermsConditionsScreen;
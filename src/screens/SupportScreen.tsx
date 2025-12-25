import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Clipboard } from 'react-native';
import { Text } from '../components/StyledText';
import QRCode from 'react-native-qrcode-svg';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';

const DONATION_ADDRESS = 'bc1q835gw6aqf6jmgs5pja5xf5xzcp76w75cqfvek6';
const QR_SIZE = 220;

const SupportScreen = () => {
  const { theme, isDark } = useTheme();
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]);
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    Clipboard.setString(DONATION_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const formatAddressInChunks = (address: string) => {
    return address.match(/.{1,4}/g)?.join(' ') || address;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Ways to support us</Text>
      <Text style={styles.introText}>
        Trustless is a free, open-source project. Here is how you can help:
      </Text>
      
      <View style={styles.listContainer}>
        <View style={styles.bulletItem}>
          <Text style={styles.bulletPoint}>1.</Text>
          <Text style={styles.bulletText}>Actually use the app. This is the best way to show that our software is useful.</Text>
        </View>
        <View style={styles.bulletItem}>
          <Text style={styles.bulletPoint}>2.</Text>
          <Text style={styles.bulletText}>Tell your friends about us. Word of mouth is the strongest marketing.</Text>
        </View>
        <View style={styles.bulletItem}>
          <Text style={styles.bulletPoint}>3.</Text>
          <Text style={styles.bulletText}>Suggest improvements or report bugs. Reach us via the contact form in the app settings or raise an issue on GitHub.</Text>
        </View>
        <View style={styles.bulletItem}>
          <Text style={styles.bulletPoint}>4.</Text>
          <Text style={styles.bulletText}>If you are a developer, you can contribute to the code. Visit our GitHub repo to learn how.</Text>
        </View>
      </View>

      <View style={styles.separator} />

      <Text style={styles.heading}>Donate</Text>
      <Text style={styles.paragraph}>
        If you are able, you can donate to the bitcoin address below to support the open source development. Thank you!
      </Text>

      <View style={styles.qrContainer}>
        {copied && (
          <View style={styles.copiedOverlay}>
            <Feather name="copy" size={32} color={theme.colors.primary} />
            <Text style={styles.copiedText}>Copied!</Text>
          </View>
        )}
        <TouchableOpacity style={styles.qrCodeWrapper} onPress={copyToClipboard} activeOpacity={0.8}>
          <QRCode 
            value={DONATION_ADDRESS} 
            size={QR_SIZE} 
            backgroundColor={theme.colors.background} 
            color={theme.colors.primary} 
          />
        </TouchableOpacity>
        
        <TouchableOpacity onPress={copyToClipboard}>
            <Text style={styles.addressText}>{formatAddressInChunks(DONATION_ADDRESS)}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={copyToClipboard}>
          <Feather name="copy" size={20} color={theme.colors.inversePrimary} />
          <Text style={styles.actionButtonText}>Copy Address</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 64,
  },
  heading: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginTop: 8,
    marginBottom: 16,
  },
  introText: {
    fontSize: 16,
    color: theme.colors.muted,
    marginBottom: 24,
  },
  listContainer: {
    marginBottom: 16,
  },
  bulletItem: {
    flexDirection: 'row',
    marginBottom: 12,
    alignItems: 'flex-start',
    paddingRight: 16,
  },
  bulletPoint: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginRight: 12,
    width: 20,
  },
  bulletText: {
    fontSize: 16,
    color: theme.colors.primary,
    flex: 1,
    lineHeight: 22,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 24,
  },
  paragraph: {
    fontSize: 16,
    color: theme.colors.primary,
    lineHeight: 24,
    marginBottom: 24,
  },
  qrContainer: { 
    alignItems: 'center', 
    paddingTop: 8, 
    paddingBottom: 8,
    width: '100%', 
  },
  qrCodeWrapper: { 
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
    marginBottom: 16,
  },
  copiedOverlay: { 
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: 8,
    zIndex: 10,
    borderRadius: 8,
  },
  copiedText: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: theme.colors.primary 
  },
  addressText: { 
    fontFamily: 'monospace', 
    fontSize: 14,
    textAlign: 'center', 
    color: theme.colors.primary, 
    lineHeight: 24,
    paddingHorizontal: 16,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionButtonText: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  }
});

export default SupportScreen;
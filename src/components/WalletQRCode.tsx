import React from 'react';
import type { ViewStyle } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { Theme } from '../constants/theme';
import { useTheme } from '../contexts/ThemeContext';

export const WALLET_QR_SIZE = 240;

export function WalletQRCode({ value }: { value: string }) {
  const { theme } = useTheme();
  return <QRCode value={value} size={WALLET_QR_SIZE} backgroundColor={theme.colors.background} color={theme.colors.primary} />;
}

export const walletQRCardStyle = (theme: Theme, isDark: boolean): ViewStyle => ({
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
  marginBottom: 0,
});

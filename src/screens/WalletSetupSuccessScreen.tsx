import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AnimatedSuccess from '../components/AnimatedSuccess';
import { useTheme } from '../contexts/ThemeContext';
import type { RootStackParamList } from '../types';

export default function WalletSetupSuccessScreen({
  navigation, route,
}: NativeStackScreenProps<RootStackParamList, 'WalletSetupSuccess'>) {
  const { theme } = useTheme();
  const [showCheck, setShowCheck] = useState(false);

  useFocusEffect(useCallback(() => {
    const animate = setTimeout(() => setShowCheck(true), 300);
    const dismiss = setTimeout(() => navigation.popToTop(), 1800);
    return () => {
      clearTimeout(animate);
      clearTimeout(dismiss);
    };
  }, [navigation]));

  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.colors.background }}>
    {showCheck ? <AnimatedSuccess title={route.params.kind === 'created' ? 'Wallet created' : 'Wallet imported'} /> : null}
  </View>;
}

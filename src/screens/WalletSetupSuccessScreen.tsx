import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useIsFocused, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import AnimatedSuccess from '../components/AnimatedSuccess';
import { useTheme } from '../contexts/ThemeContext';
import type { RootStackParamList } from '../types';

export default function WalletSetupSuccessScreen({
  navigation, route,
}: NativeStackScreenProps<RootStackParamList, 'WalletSetupSuccess'>) {
  const { theme } = useTheme();
  const [showCheck, setShowCheck] = useState(false);

  const [elapsed, setElapsed] = useState(false);
  const focused = useIsFocused();
  usePreventRemove(!elapsed, () => {});
  useEffect(() => {
    if (elapsed && focused) navigation.popToTop();
  }, [elapsed, focused, navigation]);

  useFocusEffect(useCallback(() => {
    const animate = setTimeout(() => setShowCheck(true), 300);
    const dismiss = setTimeout(() => setElapsed(true), 1800);
    return () => {
      clearTimeout(animate);
      clearTimeout(dismiss);
    };
  }, []));

  return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.colors.background }}>
    {showCheck ? <AnimatedSuccess title={route.params.kind === 'created' ? 'Wallet created' : 'Wallet imported'} /> : null}
  </View>;
}

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';

export default function TerminalPaymentSuccess({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(pop, { toValue: 1, duration: 450, easing: Easing.out(Easing.back(1.9)), useNativeDriver: true }),
      Animated.timing(ring, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]);
    animation.start(); return () => animation.stop();
  }, [pop, ring]);
  return <View style={styles.content}>
    <Animated.View style={[styles.icon, { opacity: pop, transform: [{ scale: pop }] }]}>
      <Animated.View style={[styles.ring, { borderColor: theme.colors.primary, opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }] }]} />
      <View style={[styles.circle, { backgroundColor: theme.colors.primary }]}><Feather name="check" size={44} color={theme.colors.inversePrimary} /></View>
    </Animated.View>
    <Text accessibilityRole="header" style={[styles.title, { color: theme.colors.primary }]}>Payment received</Text>
    {children}
  </View>;
}
const styles = StyleSheet.create({
  content: { alignItems: 'center', paddingHorizontal: 24, gap: 16 }, icon: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  circle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2 },
  title: { fontFamily: 'SpaceMono-Bold', fontSize: 20, textAlign: 'center' },
});

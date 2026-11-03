import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';

/** A quiet paid-feature marker; the label keeps contrast in both themes. */
export default function TerminalProBadge() {
  const { theme } = useTheme();
  return <View style={[styles.badge, { borderColor: theme.colors.bitcoin }]}>
    <Text style={[styles.label, { color: theme.colors.primary }]}>Pro</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, alignSelf: 'center' },
  label: { fontSize: 10, fontWeight: '700', lineHeight: 14 },
});

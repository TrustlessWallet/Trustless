import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { SHEET_HEADER_HEIGHT, SHEET_HEADER_HORIZONTAL_PADDING, SHEET_HEADER_SIDE_WIDTH } from '../constants/theme';
import { Text } from './StyledText';

type Props = {
  title: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  enabled?: boolean;
};

export default function SheetHeader({ title, leading, trailing, enabled = true }: Props) {
  const { theme, isDark } = useTheme();
  return <View pointerEvents={enabled ? 'auto' : 'none'} style={[styles.header, { backgroundColor: isDark ? theme.colors.surface : theme.colors.background, borderBottomColor: theme.colors.border }]}>
    <View style={styles.side}>{leading}</View>
    <Text pointerEvents="none" style={[styles.title, { color: theme.colors.primary }]} numberOfLines={1}>{title}</Text>
    <View style={[styles.side, styles.trailing]}>{trailing}</View>
  </View>;
}

const styles = StyleSheet.create({
  header: { height: SHEET_HEADER_HEIGHT, zIndex: 2, elevation: 2, paddingHorizontal: SHEET_HEADER_HORIZONTAL_PADDING, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: SHEET_HEADER_SIDE_WIDTH, height: SHEET_HEADER_SIDE_WIDTH, justifyContent: 'center' },
  trailing: { alignItems: 'flex-end' },
  title: { position: 'absolute', left: SHEET_HEADER_HORIZONTAL_PADDING + SHEET_HEADER_SIDE_WIDTH, right: SHEET_HEADER_HORIZONTAL_PADDING + SHEET_HEADER_SIDE_WIDTH, textAlign: 'center', fontSize: 17, fontFamily: 'SpaceMono-Bold', fontWeight: '700' },
});

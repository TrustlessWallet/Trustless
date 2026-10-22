import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { GlassView } from '../components/GlassView';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';

type Props = {
  title: string;
  onClose: () => void;
  closeLabel: string;
  leading?: React.ReactNode;
  disabled?: boolean;
};

export const TerminalSheetInteractionContext = createContext(true);

export default function TerminalSheetHeader({ title, onClose, closeLabel, leading, disabled = false }: Props) {
  const { theme, isDark } = useTheme();
  const focused = useIsFocused();
  const enabled = useContext(TerminalSheetInteractionContext) && focused && !disabled;
  return <View pointerEvents={enabled ? 'auto' : 'none'} style={[styles.header, { backgroundColor: isDark ? theme.colors.surface : theme.colors.background, borderBottomColor: theme.colors.border }]}>
    <View style={styles.side}>{leading}</View>
    <Text pointerEvents="none" style={[styles.title, { color: theme.colors.primary }]} numberOfLines={1}>{title}</Text>
    <View style={styles.side}>
      <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} disabled={!enabled} onPress={onClose} style={styles.close}>
        <GlassView width={40} height={40} shape="circle" interactive={enabled} style={styles.glass}>
          <Feather name="x" size={20} color={theme.colors.primary} />
        </GlassView>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  header: { height: 56, zIndex: 2, elevation: 2, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  side: { width: 40, height: 40 },
  title: { position: 'absolute', left: 70, right: 70, textAlign: 'center', fontSize: 16, fontFamily: 'SpaceMono-Bold', fontWeight: '700' },
  close: { width: 40, height: 40 },
  glass: { overflow: 'visible' },
});

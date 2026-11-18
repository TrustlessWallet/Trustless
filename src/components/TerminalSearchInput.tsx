import { StyledInput } from './StyledInput';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export function TerminalSearchInput({ label, value, onChangeText, onFocus, compact = false }: {
  onFocus?: () => void;
  compact?: boolean;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const { theme } = useTheme();
  return <View style={{ paddingHorizontal: 24, paddingVertical: compact ? 4 : 8 }}>
    <StyledInput accessibilityLabel={label} placeholder={label} value={value} onChangeText={onChangeText}
      containerStyle={compact ? { height: 44 } : undefined}
      onFocus={onFocus} autoCorrect={false} autoCapitalize="none" returnKeyType="search" maxLength={128}
      rightElement={value ? <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`}
        onPress={() => onChangeText('')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="x" size={18} color={theme.colors.muted} />
      </Pressable> : <Feather name="search" size={18} color={theme.colors.muted} />}
    />
  </View>;
}

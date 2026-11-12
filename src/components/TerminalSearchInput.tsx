import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export function TerminalSearchInput({ label, value, onChangeText }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const { theme } = useTheme();
  return <View style={{ marginHorizontal: 24, marginVertical: 8, paddingHorizontal: 12, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 8, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
    <Feather name="search" size={16} color={theme.colors.muted} />
    <TextInput
      style={{ flex: 1, minHeight: 44, color: theme.colors.primary, fontFamily: 'SpaceMono-Regular' }}
      placeholderTextColor={theme.colors.muted}
      accessibilityLabel={label}
      placeholder={label}
      value={value}
      onChangeText={onChangeText}
      autoCorrect={false}
      autoCapitalize="none"
      returnKeyType="search"
      maxLength={128}
    />
    {value ? <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label.toLowerCase()}`}
      onPress={() => onChangeText('')} hitSlop={10}>
      <Feather name="x" size={18} color={theme.colors.muted} />
    </Pressable> : null}
  </View>;
}

export function normalizeItemSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

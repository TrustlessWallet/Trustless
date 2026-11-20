import React, { createContext, useContext } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import SheetHeader from '../components/SheetHeader';
import GlassIconButton from '../components/GlassIconButton';
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
  const { theme } = useTheme();
  const focused = useIsFocused();
  const enabled = useContext(TerminalSheetInteractionContext) && focused && !disabled;
  return <SheetHeader title={title} leading={leading} enabled={enabled} trailing={
    <GlassIconButton accessibilityLabel={closeLabel} onPress={onClose} disabled={!enabled} visualSize={40} align="flex-end">
      <Feather name="x" size={20} color={theme.colors.primary} />
    </GlassIconButton>
  } />;
}

import React from 'react';
import { Pressable, StyleSheet, TouchableOpacity } from 'react-native';
import { GlassView } from './GlassView';
import { SHEET_HEADER_BUTTON_TOUCH_SIZE } from '../constants/theme';

type Props = {
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  visualSize?: number;
  disabled?: boolean;
  busy?: boolean;
  align?: 'flex-start' | 'center' | 'flex-end';
  touchable?: boolean;
};

export default function GlassIconButton({ onPress, accessibilityLabel, children, visualSize = 40, disabled = false, busy = false, align = 'center', touchable = false }: Props) {
  const props = { accessibilityRole: 'button' as const, accessibilityLabel, accessibilityState: { disabled, busy }, disabled, onPress };
  const style = [styles.touch, { alignItems: align }];
  const glass = <GlassView width={visualSize} height={visualSize} shape="circle" interactive={!disabled} style={styles.glass}>{children}</GlassView>;
  return touchable
    ? <TouchableOpacity {...props} activeOpacity={0.8} style={style}>{glass}</TouchableOpacity>
    : <Pressable {...props} style={style}>{glass}</Pressable>;
}

const styles = StyleSheet.create({
  touch: { width: SHEET_HEADER_BUTTON_TOUCH_SIZE, height: SHEET_HEADER_BUTTON_TOUCH_SIZE, justifyContent: 'center' },
  glass: { overflow: 'visible' },
});

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SMALL_NATIVE_SHEET_CORNER_RADIUS } from '../constants/theme';
import { useSheetHeaderColor } from './SheetHeader';

export default function SmallNativeSheetOutline() {
  const borderColor = useSheetHeaderColor();
  if (Platform.OS !== 'ios') return null;

  return <View pointerEvents="none" accessibilityElementsHidden style={[styles.outline, { borderColor }]} />;
}

const styles = StyleSheet.create({
  outline: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: SMALL_NATIVE_SHEET_CORNER_RADIUS,
    borderCurve: 'continuous',
  },
});

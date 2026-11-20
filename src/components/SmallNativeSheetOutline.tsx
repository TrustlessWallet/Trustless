import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SMALL_NATIVE_SHEET_CORNER_RADIUS } from '../constants/theme';
import { useSheetHeaderColor } from './SheetHeader';

export default function SmallNativeSheetOutline() {
  const borderColor = useSheetHeaderColor();
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  if (Platform.OS !== 'ios') return null;

  // Stroke the perimeter only. A stretched native border image with mixed
  // corner radii can paint over the glass controls inside the sheet.
  const right = width - 0.5;
  const bottom = height - 0.5;
  const radius = Math.min(SMALL_NATIVE_SHEET_CORNER_RADIUS - 0.5, right / 2, bottom);
  const outline = `M 0.5 0.5 H ${right} V ${bottom - radius}
    a ${radius} ${radius} 0 0 1 ${-radius} ${radius} H ${0.5 + radius}
    a ${radius} ${radius} 0 0 1 ${-radius} ${-radius} Z`;

  return <View pointerEvents="none" accessibilityElementsHidden style={styles.outline}
    onLayout={({ nativeEvent: { layout } }) => setSize(old =>
      old.width === layout.width && old.height === layout.height ? old : { width: layout.width, height: layout.height })}>
    {width > 1 && height > 1 && <Svg width="100%" height="100%">
      <Path d={outline} fill="none" stroke={borderColor} strokeWidth={1} />
    </Svg>}
  </View>;
}

const styles = StyleSheet.create({
  outline: { ...StyleSheet.absoluteFill, zIndex: 3 },
});

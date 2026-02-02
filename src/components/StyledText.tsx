import React from 'react';
import { Text as DefaultText, TextStyle, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface TextProps extends React.ComponentProps<typeof DefaultText> {
  style?: TextStyle | TextStyle[];
}

export function Text(props: TextProps) {
  const { theme } = useTheme();
  const { style, ...otherProps } = props;

  // Flatten styles to check for fontWeight
  const flatStyle = StyleSheet.flatten(style || {});
  
  // Check for bold weights (including numeric values like "700")
  const fontWeight = flatStyle?.fontWeight;
  let isBold = false;
  if (fontWeight === 'bold') {
    isBold = true;
  } else if (typeof fontWeight === 'string' && parseInt(fontWeight, 10) >= 700) {
    isBold = true;
  } else if (typeof fontWeight === 'number' && fontWeight >= 700) {
    isBold = true;
  }

  const isItalic = flatStyle?.fontStyle === 'italic';

  // LOGIC: Explicitly select the font file based on stylze
  let fontFamily = 'SpaceMono-Regular';

  if (isBold && isItalic) {
    fontFamily = 'SpaceMono-BoldItalic';
  } else if (isBold) {
    fontFamily = 'SpaceMono-Bold';
  } else if (isItalic) {
    fontFamily = 'SpaceMono-Italic';
  }

  const androidStyleFix = Platform.OS === 'android' ? { fontWeight: undefined } : {};

  return (
    <DefaultText
      style={[
        { 
          color: theme.colors.primary, 
          fontFamily 
        }, 
        style,
        androidStyleFix
      ]}
      {...otherProps}
    />
  );
}
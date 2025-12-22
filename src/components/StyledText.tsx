import React from 'react';
import { Text as DefaultText, StyleSheet } from 'react-native';
type TextProps = DefaultText['props'];
export function Text(props: TextProps) {
  const style = StyleSheet.flatten(props.style);
  let fontFamily = 'SpaceMono-Regular';
  if (style && style.fontWeight) {
    const weight = style.fontWeight;
    let isBold = false;
    if (typeof weight === 'string') {
      isBold = weight === 'bold' || parseInt(weight, 10) >= 700;
    } else if (typeof weight === 'number') {
      isBold = weight >= 700;
    }
    if (isBold) {
      fontFamily = style.fontStyle === 'italic' ? 'SpaceMono-BoldItalic' : 'SpaceMono-Bold';
    } else if (style.fontStyle === 'italic') {
      fontFamily = 'SpaceMono-Italic';
    }
  }
  return (
    <DefaultText
      {...props}
      style={[styles.defaultStyle, props.style, { fontFamily }]}
    />
  );
}
const styles = StyleSheet.create({
  defaultStyle: {
    fontFamily: 'SpaceMono-Regular',
  },
});
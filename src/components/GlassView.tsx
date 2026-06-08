import React from 'react';
import { View, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Host, ZStack } from '@expo/ui/swift-ui';
import { glassEffect, cornerRadius as cornerRadiusModifier, frame } from '@expo/ui/swift-ui/modifiers';

interface GlassViewProps {
  width: number;
  height: number;
  borderRadius: number;
  tintColor?: string;
  variant?: string;
  interactive?: boolean;
  fallbackColor: string;
  fallbackOpacity?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const GlassView: React.FC<GlassViewProps> = ({
  width,
  height,
  borderRadius,
  tintColor,
  variant = 'clear',
  interactive = false,
  fallbackColor,
  fallbackOpacity = 0.85,
  style,
  children,
}) => {
  const glassOptions: any = { variant, interactive };
  if (tintColor) {
    glassOptions.tint = tintColor;
  }

  return (
    <View style={[{ width, height, borderRadius }, style]}>
      {Platform.OS === 'ios' ? (
        <Host style={StyleSheet.absoluteFill}>
          <ZStack
            modifiers={[
              frame({ width, height }),
              glassEffect({ glass: glassOptions }),
              cornerRadiusModifier(borderRadius),
            ]}
          >
            <View />
          </ZStack>
        </Host>
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: fallbackColor,
              opacity: fallbackOpacity,
              borderRadius,
            },
          ]}
        />
      )}
      <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}>
        {children}
      </View>
    </View>
  );
};
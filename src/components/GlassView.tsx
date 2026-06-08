import React from 'react';
import { View, Platform, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Host, ZStack } from '@expo/ui/swift-ui';
import { 
  glassEffect, 
  cornerRadius as cornerRadiusModifier, 
  frame,
  ignoreSafeArea
} from '@expo/ui/swift-ui/modifiers';
import { useTheme } from '../contexts/ThemeContext';

interface GlassViewProps {
  width: number;
  height: number;
  borderRadius?: number;
  borderTopLeftRadius?: number;
  borderTopRightRadius?: number;
  borderBottomLeftRadius?: number;
  borderBottomRightRadius?: number;
  tintColor?: string;
  variant?: string;
  interactive?: boolean;
  fallbackColor?: string;
  fallbackOpacity?: number;
  shape?: 'circle' | 'capsule' | 'rectangle' | 'ellipse';
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const GlassView: React.FC<GlassViewProps> = ({
  width,
  height,
  borderRadius = 0,
  borderTopLeftRadius,
  borderTopRightRadius,
  borderBottomLeftRadius,
  borderBottomRightRadius,
  tintColor,
  variant = 'clear',
  interactive = false,
  fallbackColor,
  fallbackOpacity = 0.85,
  shape = 'rectangle',
  style,
  children,
}) => {
  const { theme } = useTheme();

  const activeTintColor = tintColor ?? theme.colors.surface + '99';
  const activeFallbackColor = fallbackColor ?? theme.colors.surface;

  const glassOptions: any = { 
    variant, 
    interactive, 
    tint: activeTintColor 
  };

  const swiftModifiers: any[] = [
    frame({ width, height }),
    glassEffect({ glass: glassOptions, shape }),
    ignoreSafeArea()
  ];

  const hasIndividualCorners = 
    borderTopLeftRadius !== undefined || 
    borderTopRightRadius !== undefined || 
    borderBottomLeftRadius !== undefined || 
    borderBottomRightRadius !== undefined;

  // Only apply native Swift corner radius if using a uniform radius.
  if (borderRadius > 0 && !hasIndividualCorners) {
    swiftModifiers.push(cornerRadiusModifier(borderRadius));
  }

  return (
    <View 
      style={[
        { 
          width, 
          height, 
          overflow: 'hidden',
          borderRadius: borderRadius,
          borderTopLeftRadius: borderTopLeftRadius ?? borderRadius,
          borderTopRightRadius: borderTopRightRadius ?? borderRadius,
          borderBottomLeftRadius: borderBottomLeftRadius ?? borderRadius,
          borderBottomRightRadius: borderBottomRightRadius ?? borderRadius,
        }, 
        style
      ]}
    >
      {Platform.OS === 'ios' ? (
        <Host style={StyleSheet.absoluteFill}>
          <ZStack modifiers={swiftModifiers}>
            <View />
          </ZStack>
        </Host>
      ) : (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: activeFallbackColor,
              opacity: fallbackOpacity,
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
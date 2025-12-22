import React, { useState, useRef, useEffect } from 'react';
import { 
  TextInput, 
  TextInputProps, 
  StyleSheet, 
  Animated, 
  ViewStyle, 
  View 
} from 'react-native';
import { useTheme } from '../contexts/ThemeContext';

interface StyledInputProps extends TextInputProps {
  containerStyle?: ViewStyle;
  rightElement?: React.ReactNode;
}

export const StyledInput: React.FC<StyledInputProps> = ({
  onFocus,
  onBlur,
  style,
  containerStyle,
  rightElement,
  placeholderTextColor,
  multiline,
  ...props
}) => {
  const { theme } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isFocused]);

  const handleFocus = (event: any) => {
    setIsFocused(true);
    if (onFocus) onFocus(event);
  };

  const handleBlur = (event: any) => {
    setIsFocused(false);
    if (onBlur) onBlur(event);
  };

  const baseContainerStyle = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.LAYOUT.radius,
    borderWidth: 1,
    ...(multiline ? { minHeight: theme.LAYOUT.inputHeight } : { height: theme.LAYOUT.inputHeight }),
  };

  return (
    <View style={[styles.container, baseContainerStyle, containerStyle]}>
      <Animated.View 
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderColor: theme.colors.bitcoin,
            borderWidth: 1,
            borderRadius: theme.LAYOUT.radius,
            opacity: focusAnim, 
          }
        ]}
      />
      
      <TextInput
        onFocus={handleFocus}
        onBlur={handleBlur}
        multiline={multiline}
        style={[
          styles.input, 
          { color: theme.colors.primary },
          multiline && styles.multilineInput, 
          style
        ]}
        placeholderTextColor={placeholderTextColor || theme.colors.muted}
        {...props}
      />
      {rightElement && (
        <View style={styles.rightElement}>
          {rightElement}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 16,
    height: '100%',
    fontFamily: 'SpaceMono-Regular',
  },
  multilineInput: {
    paddingTop: 16,
    paddingBottom: 16,
    textAlignVertical: 'top',
  },
  rightElement: {
    paddingRight: 8,
    justifyContent: 'center',
    height: '100%',
  },
});
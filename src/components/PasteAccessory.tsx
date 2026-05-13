import React, { useState, useEffect } from 'react';
import { 
  View, 
  TouchableOpacity, 
  StyleSheet, 
  Platform, 
  InputAccessoryView, 
  Keyboard 
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';

interface PasteAccessoryProps {
  nativeID: string;
  onPaste: (text: string) => void;
  isFocused: boolean;
  bottomOffset?: number; 
}

export const PasteAccessory: React.FC<PasteAccessoryProps> = ({ 
  nativeID, 
  onPaste, 
  isFocused,
  bottomOffset = 0
}) => {
  const { theme } = useTheme();
  const [clipboardText, setClipboardText] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (isFocused) {
      Clipboard.getStringAsync().then(text => setClipboardText(text || ''));
    }
  }, [isFocused]);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => {
        showSub.remove();
        hideSub.remove();
      };
    }
  }, []);

  if (!isFocused || !clipboardText) return null;

  const handlePaste = () => {
    onPaste(clipboardText);
  };

  const Toolbar = () => (
    <View style={[styles.toolbar, { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border }]}>
      <TouchableOpacity onPress={handlePaste} style={styles.button}>
        <Text style={[styles.text, { color: theme.colors.primary }]}>
          Paste: {clipboardText.length > 20 ? `${clipboardText.substring(0, 20)}...` : clipboardText}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <InputAccessoryView nativeID={nativeID}>
        <Toolbar />
      </InputAccessoryView>
    );
  }

  // Android implementation
  if (keyboardHeight === 0) return null;

  return (
    <View style={[styles.androidWrapper, { bottom: keyboardHeight + bottomOffset }]}>
      <Toolbar />
    </View>
  );
};

const styles = StyleSheet.create({
  toolbar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    borderTopWidth: 1,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
  androidWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 999,
  }
});
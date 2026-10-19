import React, { useEffect } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert } from 'react-native';
import { RootStackParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import TabNavigator from './TabNavigator';
import TerminalScreen from '../screens/TerminalScreen';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

// Terminal covers the tabs through the stack instead of destroying them.
// Returning preserves the native tab controller, scroll position and queries.
export function MainRoot() {
  const { mode } = useWalletMode();
  const { activeWallet } = useWallet();
  const navigation = useNavigation<Navigation>();
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && mode === 'terminal' && activeWallet && activeWallet.type !== 'watch-only') {
      navigation.navigate('Terminal');
    }
  }, [focused, mode, activeWallet?.id, activeWallet?.type, navigation]);
  return <TabNavigator />;
}

export function TerminalRoute() {
  const { mode, setMode } = useWalletMode();
  const { activeWallet } = useWallet();
  const navigation = useNavigation<Navigation>();
  const unsupported = activeWallet?.type === 'watch-only';
  const focused = useIsFocused();
  useEffect(() => {
    if (mode === 'wallet' || unsupported) {
      if (navigation.canGoBack()) navigation.goBack();
      else navigation.replace('MainTabs');
    }
  }, [mode, unsupported, navigation]);
  useEffect(() => navigation.addListener('beforeRemove', () => {
    // Keep Android Back and restored navigation state consistent with mode.
    void setMode('wallet').catch(() => Alert.alert('Could not save wallet mode', 'Please retry.'));
  }), [navigation, setMode]);
  return mode === 'terminal' && !unsupported ? <TerminalScreen visible={focused} /> : null;
}

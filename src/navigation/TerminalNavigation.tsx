import React, { useEffect } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { RootStackParamList } from '../types';
import { useActiveWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';
import TabNavigator from './TabNavigator';
import TerminalScreen from '../screens/TerminalScreen';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

// Terminal covers the tabs through the stack instead of destroying them.
// Returning preserves the native tab controller, scroll position and queries.
export function MainRoot() {
  const { mode } = useWalletMode();
  const activeWallet = useActiveWallet();
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
  const { mode, setMode, cashierState } = useWalletMode();
  const activeWallet = useActiveWallet();
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
    if (cashierState && cashierState !== 'off') return;
    void setMode('wallet').catch(error => {
      if (error instanceof Error && error.message === 'Cashier mode requires owner unlock.') return;
      Alert.alert('Could not save wallet mode', 'Please retry.');
    });
  }), [navigation, setMode, cashierState]);
  return <TerminalScreen visible={focused && mode === 'terminal' && !unsupported} />;
}

// This route is mounted only in the restricted navigator. It has no parent
// wallet tabs or privileged stack route to return to.
export function CashierTerminalRoot() {
  const { cashierState, cashierBusy, unlockCashier, retryCashierLoad } = useWalletMode();
  const { theme } = useTheme();
  const focused = useIsFocused();
  const [error, setError] = React.useState('');
  const unlock = async () => {
    setError('');
    try { await unlockCashier(); }
    catch {
      if (cashierState === 'locked') Alert.alert('Couldn’t unlock cashier mode', 'Please retry.');
      else setError('Couldn’t unlock cashier mode. Please retry.');
    }
  };
  const retry = async () => {
    setError('');
    try { await retryCashierLoad(); }
    catch { setError('Cashier lock is unavailable. Please retry or authenticate to unlock.'); }
  };
  if (cashierState === 'locked') return <TerminalScreen visible={focused} onExit={() => { void unlock(); }} />;
  return <View style={[cashierStyles.root, { backgroundColor: theme.colors.background }]}>
    <Text style={[cashierStyles.title, { color: theme.colors.primary }]}>Cashier mode locked</Text>
    <Text style={[cashierStyles.message, { color: theme.colors.muted }]}>This wallet can’t open the cashier terminal right now.</Text>
    {error ? <Text style={[cashierStyles.message, { color: theme.colors.muted }]}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Owner unlock" accessibilityState={{ disabled: cashierBusy }} disabled={cashierBusy} onPress={() => { void unlock(); }} style={[cashierStyles.button, { backgroundColor: theme.colors.primary }]}>
      {cashierBusy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={{ color: theme.colors.inversePrimary }}>Owner unlock</Text>}
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Retry cashier lock" disabled={cashierBusy} onPress={() => { void retry(); }} style={cashierStyles.retry}><Text style={{ color: theme.colors.primary }}>Retry</Text></Pressable>
  </View>;
}

const cashierStyles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  title: { fontSize: 22, fontWeight: '600', textAlign: 'center' },
  message: { fontSize: 13, textAlign: 'center', marginTop: 12 },
  button: { minWidth: 180, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 8, marginTop: 26 },
  retry: { minWidth: 120, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});

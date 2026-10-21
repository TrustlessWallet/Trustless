import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalUnit } from '../services/terminal';
import { useWallet } from '../contexts/WalletContext';
import { useWalletMode } from '../contexts/WalletModeContext';

type Props = { unit: TerminalUnit; onSelectUnit: (unit: TerminalUnit) => void; onClose: () => void };
const units: TerminalUnit[] = ['USD', 'EUR', 'CHF', 'sats', 'BTC'];

export default function TerminalSettingsScreen({ unit, onSelectUnit, onClose }: Props) {
  const { theme } = useTheme();
  const { activeWallet } = useWallet();
  const { cashierState, cashierBusy, enableCashier, unlockCashier } = useWalletMode();
  const [cashierError, setCashierError] = useState('');
  const cashierPress = async () => {
    setCashierError('');
    try {
      if (cashierState === 'off') await enableCashier();
      else await unlockCashier();
    } catch { setCashierError('Couldn’t save cashier mode. Please retry.'); }
  };
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const rowRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: insets.top + 8, left: 24 });
  const openCurrency = () => {
    rowRef.current?.measureInWindow((x, y, width, height) => {
      const below = y + height + 8;
      const top = below + 140 <= screenHeight - insets.bottom - 8 ? below : y - 148;
      setPopoverPosition({
        top: Math.max(insets.top + 8, Math.min(top, screenHeight - insets.bottom - 148)),
        left: Math.max(16, Math.min(x + width - 204, screenWidth - 220)),
      });
      setCurrencyOpen(true);
    });
  };
  const scrollY = useRef(new Animated.Value(0)).current;
  const fadeOpacity = scrollY.interpolate({ inputRange: [0, 100], outputRange: [0, 1], extrapolate: 'clamp' });
  const styles = makeStyles(theme.colors);
  return <View style={styles.root}>
    <Animated.View pointerEvents="none" style={[styles.scrollFade, { height: insets.top + 48, opacity: fadeOpacity }]}>
      <LinearGradient colors={[theme.colors.background, theme.colors.background + 'CC', theme.colors.background + '66', theme.colors.background + '00']} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to terminal" onPress={onClose} style={styles.backButton}>
        <GlassView width={40} height={40} shape="circle" interactive style={styles.glass}>
          <Feather name="arrow-left" size={20} color={theme.colors.primary} />
        </GlassView>
      </Pressable>
    </View>
    <Animated.ScrollView bounces={false} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.content, { paddingBottom: Math.max(128, insets.bottom + 30) }]}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Terminal Settings</Text>
        <View style={styles.rowWrapper}>
          <TouchableOpacity ref={rowRef} accessibilityRole="button" accessibilityLabel="Currency" accessibilityState={{ expanded: currencyOpen }} onPress={openCurrency} style={styles.row}>
            <Text style={styles.rowLabel}>Currency</Text>
            <View style={styles.rowEnd}><Text style={styles.currentUnit}>{unit}</Text><Feather name="chevron-right" size={24} color={theme.colors.primary} /></View>
          </TouchableOpacity>
        </View>
        {activeWallet && activeWallet.type !== 'watch-only' ? <View style={styles.rowWrapper}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cashier mode" accessibilityState={{ disabled: cashierBusy }} disabled={cashierBusy} onPress={() => { void cashierPress(); }} style={styles.row}>
            <Text style={styles.rowLabel}>Cashier mode</Text>
            <View style={styles.rowEnd}>{cashierBusy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.currentUnit}>{cashierState === 'off' ? 'Off' : 'On'}</Text>}<Feather name="chevron-right" size={24} color={theme.colors.primary} /></View>
          </TouchableOpacity>
        </View> : null}
        {cashierError ? <Text style={styles.settingError}>{cashierError}</Text> : null}
      </View>
    </Animated.ScrollView>
    <Modal visible={currencyOpen} transparent animationType="none" onRequestClose={() => setCurrencyOpen(false)}>
      <View style={styles.popoverBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss currencies" style={styles.popoverOverlay} onPress={() => setCurrencyOpen(false)} />
        <View style={[styles.popoverPosition, popoverPosition]}>
          <GlassView width={204} height={140} borderRadius={24} shape="roundedRectangle" interactive style={styles.glass}>
            <View style={styles.currencyGrid}>{units.map(choice =>
              <TouchableOpacity key={choice} accessibilityRole="button" accessibilityState={{ selected: choice === unit }} accessibilityLabel={choice} style={styles.currencyOption} onPress={() => { onSelectUnit(choice); setCurrencyOpen(false); }}>
                <Text style={[styles.currencyText, choice === unit && styles.currencyTextSelected]}>{choice}</Text>
              </TouchableOpacity>)}</View>
          </GlassView>
        </View>
      </View>
    </Modal>
  </View>;
}

function makeStyles(colors: { background: string; primary: string; surface: string; muted: string; border: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    scrollFade: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
    topBar: { position: 'absolute', left: 0, right: 0, zIndex: 2, height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
    backButton: { width: 40, height: 40 },
    glass: { overflow: 'visible' },
    content: { padding: 24, paddingVertical: 128, flexGrow: 1 },
    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: 16 },
    rowWrapper: { borderBottomWidth: 1, borderBottomColor: colors.border },
    row: { paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabel: { color: colors.muted, fontSize: 16 },
    rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    settingError: { color: colors.muted, fontSize: 12, marginTop: 12 },
    currentUnit: { color: colors.primary, fontSize: 16 },
    popoverBackdrop: { flex: 1, backgroundColor: 'transparent' },
    popoverOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    popoverPosition: { position: 'absolute' },
    currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 4 },
    currencyOption: { width: 58, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
    currencyText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    currencyTextSelected: { color: colors.bitcoin },
  });
}

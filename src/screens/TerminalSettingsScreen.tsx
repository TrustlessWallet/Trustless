import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalUnit } from '../services/terminal';
import { useActiveWallet } from '../contexts/WalletContext';
import { CashierTerminalDraft, useWalletMode } from '../contexts/WalletModeContext';
import TerminalSheetHeader from './TerminalSheetHeader';
import { SHEET_HEADER_HEIGHT } from '../constants/theme';

type Props = { unit: TerminalUnit; onSelectUnit: (unit: TerminalUnit) => void; onClose: () => void; onOpenItems?: () => void; onOpenReceipts?: () => void; onOpenBackup?: () => void; getTerminalDraft?: () => CashierTerminalDraft | null };
const units: TerminalUnit[] = ['USD', 'EUR', 'CHF', 'sats', 'BTC'];

export default function TerminalSettingsScreen({ unit, onSelectUnit, onClose, onOpenItems, onOpenReceipts, onOpenBackup, getTerminalDraft }: Props) {
  const { theme } = useTheme();
  const activeWallet = useActiveWallet();
  const focused = useIsFocused();
  const mounted = useRef(true);
  const currencyContext = useRef({ walletId: activeWallet?.id, focused, revision: 0 });
  if (currencyContext.current.walletId !== activeWallet?.id || currencyContext.current.focused !== focused) {
    currencyContext.current = { walletId: activeWallet?.id, focused, revision: currencyContext.current.revision + 1 };
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { cashierState, cashierBusy, enableCashier, unlockCashier } = useWalletMode();
  const [cashierError, setCashierError] = useState('');
  const cashierPress = async () => {
    setCashierError('');
    try {
      if (cashierState === 'off') await enableCashier(getTerminalDraft);
      else await unlockCashier('terminal', getTerminalDraft);
    } catch { setCashierError('Couldn’t save cashier mode. Please retry.'); }
  };
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const rowRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: insets.top + 8, left: 24 });
  const dismissCurrency = () => { ++currencyContext.current.revision; setCurrencyOpen(false); };
  useEffect(() => { ++currencyContext.current.revision; setCurrencyOpen(false); }, [focused, activeWallet?.id]);
  const openCurrency = () => {
    if (!focused) return;
    const revision = ++currencyContext.current.revision;
    rowRef.current?.measureInWindow((x, y, width, height) => {
      // Native measurements can finish after another sheet has taken focus.
      if (!mounted.current || !currencyContext.current.focused || currencyContext.current.revision !== revision) return;
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
  return <View pointerEvents={focused ? 'auto' : 'none'} style={styles.root}>
    <Animated.View pointerEvents="none" style={[styles.scrollFade, { opacity: fadeOpacity }]}>
      <LinearGradient colors={[theme.colors.background, theme.colors.background + 'CC', theme.colors.background + '66', theme.colors.background + '00']} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <TerminalSheetHeader title="Settings" closeLabel="Close terminal settings" onClose={onClose} />
    <Animated.ScrollView style={styles.scroll} bounces={false} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 24) }]}>
      <View style={styles.section}>
        <View style={styles.rowWrapper}>
          <TouchableOpacity ref={rowRef} accessibilityRole="button" accessibilityLabel="Currency" accessibilityState={{ expanded: currencyOpen }} onPress={openCurrency} style={styles.row}>
            <Text style={styles.rowLabel}>Currency</Text>
            <View style={styles.rowEnd}><Text style={styles.currentUnit}>{unit}</Text><Feather name="chevron-right" size={24} color={theme.colors.primary} /></View>
          </TouchableOpacity>
        </View>
        {activeWallet && activeWallet.type !== 'watch-only' && cashierState === 'off' && onOpenItems ? <View style={styles.rowWrapper}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage items" onPress={onOpenItems} style={styles.row}>
            <Text style={styles.rowLabel}>Items</Text><Feather name="chevron-right" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
        </View> : null}
        {activeWallet && activeWallet.type !== 'watch-only' && cashierState === 'off' && onOpenReceipts ? <View style={styles.rowWrapper}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Receipt settings" onPress={onOpenReceipts} style={styles.row}>
            <Text style={styles.rowLabel}>Receipts</Text><Feather name="chevron-right" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
        </View> : null}
        {activeWallet && activeWallet.type !== 'watch-only' && cashierState === 'off' && onOpenBackup ? <View style={styles.rowWrapper}><TouchableOpacity accessibilityRole="button" accessibilityLabel="Terminal backup" onPress={onOpenBackup} style={styles.row}><Text style={styles.rowLabel}>Backup</Text><Feather name="chevron-right" size={24} color={theme.colors.primary} /></TouchableOpacity></View> : null}
        {activeWallet && activeWallet.type !== 'watch-only' ? <View style={styles.rowWrapper}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cashier mode" accessibilityState={{ disabled: cashierBusy }} disabled={cashierBusy} onPress={() => { void cashierPress(); }} style={styles.row}>
            <Text style={styles.rowLabel}>Cashier mode</Text>
            <View style={styles.rowEnd}>{cashierBusy ? <ActivityIndicator size="small" color={theme.colors.bitcoin} /> : <Text style={styles.currentUnit}>{cashierState === 'off' ? 'Off' : 'On'}</Text>}<Feather name="chevron-right" size={24} color={theme.colors.primary} /></View>
          </TouchableOpacity>
        </View> : null}
        {cashierError ? <Text style={styles.settingError}>{cashierError}</Text> : null}
      </View>
    </Animated.ScrollView>
    <Modal visible={focused && currencyOpen} transparent animationType="none" onRequestClose={dismissCurrency}>
      <View style={styles.popoverBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss currencies" style={styles.popoverOverlay} onPress={dismissCurrency} />
        <View style={[styles.popoverPosition, popoverPosition]}>
          <GlassView width={204} height={140} borderRadius={24} shape="roundedRectangle" interactive style={styles.glass}>
            <View style={styles.currencyGrid}>{units.map(choice =>
              <TouchableOpacity key={choice} accessibilityRole="button" accessibilityState={{ selected: choice === unit }} accessibilityLabel={choice} style={styles.currencyOption} onPress={() => { if (!currencyContext.current.focused) return; onSelectUnit(choice); dismissCurrency(); }}>
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
    scrollFade: { position: 'absolute', top: SHEET_HEADER_HEIGHT, left: 0, right: 0, height: 48, zIndex: 1 },
    glass: { overflow: 'visible' },
    scroll: { flex: 1, minHeight: 0 },
    content: { paddingHorizontal: 24, paddingTop: 20 },
    section: { marginBottom: 32 },
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

import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView } from '../components/GlassView';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { TerminalUnit } from '../services/terminal';

type Props = { unit: TerminalUnit; onSelectUnit: (unit: TerminalUnit) => void; onClose: () => void };
const units: TerminalUnit[] = ['USD', 'EUR', 'CHF', 'sats', 'BTC'];

export default function TerminalSettingsScreen({ unit, onSelectUnit, onClose }: Props) {
  const { theme } = useTheme();
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
  const styles = makeStyles(theme.colors);
  return <View style={styles.root}>
    <View pointerEvents="box-none" style={[styles.topBar, { top: insets.top }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to terminal" onPress={onClose} style={styles.backButton}>
        <GlassView width={40} height={40} shape="circle" interactive style={styles.glass}>
          <Feather name="arrow-left" size={20} color={theme.colors.primary} />
        </GlassView>
      </TouchableOpacity>
    </View>
    <ScrollView contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentContainerStyle={{ paddingTop: insets.top + 86, paddingBottom: insets.bottom + 30 }}>
      <View style={styles.heading}><Text style={styles.title}>Settings</Text></View>
      <TouchableOpacity ref={rowRef} accessibilityRole="button" accessibilityLabel="Currency" accessibilityState={{ expanded: currencyOpen }} onPress={openCurrency} style={styles.row}>
        <Text style={styles.rowLabel}>Currency</Text>
        <View style={styles.rowEnd}><Text style={styles.currentUnit}>{unit}</Text><Feather name="chevron-right" size={18} color={theme.colors.muted} /></View>
      </TouchableOpacity>
    </ScrollView>
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
    topBar: { position: 'absolute', left: 0, right: 0, zIndex: 2, height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
    backButton: { width: 40, height: 40 },
    glass: { overflow: 'visible' },
    heading: { paddingHorizontal: 24, paddingBottom: 30 },
    title: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 36 },
    row: { marginHorizontal: 24, minHeight: 68, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowLabel: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 15 },
    rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    currentUnit: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 14 },
    popoverBackdrop: { flex: 1, backgroundColor: 'transparent' },
    popoverOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    popoverPosition: { position: 'absolute' },
    currencyGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 4 },
    currencyOption: { width: 58, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
    currencyText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    currencyTextSelected: { color: colors.bitcoin },
  });
}

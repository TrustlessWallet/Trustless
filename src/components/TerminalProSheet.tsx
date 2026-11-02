import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { ProPlan, useTerminalPro } from '../contexts/TerminalProContext';
import TerminalSheetHeader from '../screens/TerminalSheetHeader';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import TermsConditionsScreen from '../screens/TermsConditionsScreen';

type LegalPage = 'privacy' | 'terms' | null;
type Props = {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onVerified: () => void;
};

const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

export default function TerminalProSheet({ visible, onClose, onDismiss, onVerified }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { status, plans, loadingPlans, busy, pending, error, refresh, loadPlans, purchase, restore, manage } = useTerminalPro();
  const [selected, setSelected] = useState<'monthly' | 'annual'>('annual');
  const [legalPage, setLegalPage] = useState<LegalPage>(null);

  useEffect(() => { if (visible) void refresh(); }, [visible, refresh]);

  useEffect(() => {
    if (visible && status === 'free') void loadPlans();
    if (!visible) setLegalPage(null);
  }, [visible, status, loadPlans]);

  useEffect(() => {
    if (plans.length && !plans.some(plan => plan.id === selected)) {
      setSelected(plans.some(plan => plan.id === 'annual') ? 'annual' : 'monthly');
    }
  }, [plans, selected]);

  const selectedPlan = plans.find(plan => plan.id === selected);
  const subscribe = async () => {
    if (!selectedPlan || busy) return;
    if (await purchase(selectedPlan.id)) onVerified();
  };
  const restorePurchases = async () => {
    if (busy) return;
    if (await restore()) onVerified();
  };

  const legalTitle = legalPage === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions';
  return <Modal
    visible={visible}
    presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
    animationType="none"
    onRequestClose={onClose}
    onDismiss={onDismiss}
  >
    <View style={styles.root}>
      <TerminalSheetHeader title={legalPage ? legalTitle : 'Terminal Pro'} closeLabel="Close Terminal Pro" onClose={onClose} disabled={busy}
        leading={legalPage ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to Terminal Pro" onPress={() => setLegalPage(null)} style={styles.back}><Feather name="chevron-left" size={24} color={theme.colors.primary} /></TouchableOpacity> : undefined} />
      {legalPage ? <View style={styles.legalContent}>{legalPage === 'privacy' ? <PrivacyPolicyScreen /> : <TermsConditionsScreen />}</View> :
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          <Text style={styles.freeCopy}>Checkout, payment history, refunds, raw CSV export, and backup stay free.</Text>

          <View style={styles.comparison} accessibilityLabel="Free and Pro feature comparison">
            <View style={styles.comparisonHeading}><Text style={styles.featureHeading}>FEATURE</Text><Text style={styles.columnHeading}>FREE</Text><Text style={[styles.columnHeading, styles.proHeading]}>PRO</Text></View>
            {['Sales reports', 'Receipt logos', 'Receipt templates'].map(feature => <View key={feature} style={styles.comparisonRow}>
              <Text style={styles.feature}>{feature}</Text><Text style={styles.column}>—</Text><Feather style={styles.check} name="check" size={18} color={theme.colors.bitcoin} />
            </View>)}
          </View>

          {status === 'loading' ? <View style={styles.state}><ActivityIndicator color={theme.colors.bitcoin} /></View> : null}
          {status === 'pro' ? <View style={styles.state}>
            <Text style={styles.proActive}>Terminal Pro is active</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage subscription" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={() => { void manage(); }} style={styles.primaryButton}>
              {busy ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.primaryText}>Manage subscription</Text>}
            </TouchableOpacity>
          </View> : null}
          {status === 'unavailable' ? <View style={styles.state}><Text style={styles.stateText}>Subscriptions are unavailable right now.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry subscription" disabled={busy} onPress={() => { void refresh(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry</Text></TouchableOpacity></View> : null}
          {status === 'free' ? <>
            {loadingPlans ? <View style={styles.state}><ActivityIndicator color={theme.colors.bitcoin} /></View> : plans.length ? <>
              <Text style={styles.sectionTitle}>CHOOSE A PLAN</Text>
              {plans.map(plan => <PlanChoice key={plan.id} plan={plan} selected={selected === plan.id} disabled={busy} onPress={() => setSelected(plan.id)} theme={theme} styles={styles} />)}
              {selectedPlan?.trialLabel ? <Text style={styles.trial}>{selectedPlan.trialLabel}</Text> : null}
              {selectedPlan?.renewalLabel ? <Text style={styles.renewal}>{selectedPlan.renewalLabel}</Text> : null}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Continue with ${selected === 'annual' ? 'annual' : 'monthly'} Terminal Pro`} accessibilityState={{ disabled: busy || pending, busy }} disabled={busy || pending} onPress={() => { void subscribe(); }} style={[styles.primaryButton, (busy || pending) && styles.disabled]}>
                {busy ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.primaryText}>Continue with {selected === 'annual' ? 'Annual' : 'Monthly'}</Text>}
              </TouchableOpacity>
              <Text style={styles.renewal}>Auto-renews at the store price unless canceled in your store’s subscription settings.</Text>
            </> : <View style={styles.state}>
              <Text style={styles.stateText}>Store plans are unavailable right now.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading plans" disabled={busy} onPress={() => { void loadPlans(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry</Text></TouchableOpacity>
            </View>}
          </> : null}
          {pending ? <Text style={styles.stateText}>Awaiting store approval. Pro unlocks when payment is confirmed.</Text> : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {status !== 'pro' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Restore purchases" disabled={busy} onPress={() => { void restorePurchases(); }} style={styles.restore}><Text style={styles.restoreText}>Restore purchases</Text></TouchableOpacity> : null}
          <View style={styles.legalLinks}>
            <TouchableOpacity accessibilityRole="link" accessibilityLabel="Privacy Policy" onPress={() => setLegalPage('privacy')}><Text style={styles.legalLink}>Privacy</Text></TouchableOpacity>
            <Text style={styles.separator}>·</Text>
            <TouchableOpacity accessibilityRole="link" accessibilityLabel="Terms and Conditions" onPress={() => setLegalPage('terms')}><Text style={styles.legalLink}>Terms</Text></TouchableOpacity>
            {Platform.OS === 'ios' ? <><Text style={styles.separator}>·</Text><TouchableOpacity accessibilityRole="link" accessibilityLabel="Apple standard EULA" onPress={() => { void Linking.openURL(APPLE_EULA_URL); }}><Text style={styles.legalLink}>Apple EULA</Text></TouchableOpacity></> : null}
          </View>
        </ScrollView>}
    </View>
  </Modal>;
}

function PlanChoice({ plan, selected, disabled, onPress, theme, styles }: {
  plan: ProPlan; selected: boolean; disabled: boolean; onPress: () => void; theme: Theme; styles: ReturnType<typeof makeStyles>;
}) {
  const annual = plan.id === 'annual';
  return <TouchableOpacity accessibilityRole="radio" accessibilityLabel={`${annual ? 'Annual' : 'Monthly'} plan, ${plan.price} ${plan.periodLabel}`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.plan, selected && styles.selectedPlan]}>
    <View style={[styles.radio, selected && styles.selectedRadio]}>{selected ? <View style={styles.radioDot} /> : null}</View>
    <View style={styles.planText}><Text style={styles.planTitle}>{annual ? 'Annual' : 'Monthly'}</Text><Text style={styles.planPeriod}>{plan.periodLabel}</Text></View>
    <Text style={[styles.planPrice, annual && styles.annualPrice]}>{plan.price}</Text>
  </TouchableOpacity>;
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 32 },
  back: { width: 44, height: 44, justifyContent: 'center' },
  legalContent: { flex: 1 },
  freeCopy: { color: theme.colors.muted, fontSize: 12, lineHeight: 19, marginTop: 0, marginBottom: 20 },
  comparison: { borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden', marginBottom: 25 },
  comparisonHeading: { backgroundColor: theme.colors.surface, paddingVertical: 10, flexDirection: 'row' },
  featureHeading: { flex: 1, paddingLeft: 13, color: theme.colors.muted, fontSize: 10, fontWeight: '700' },
  columnHeading: { width: 55, color: theme.colors.muted, textAlign: 'center', fontSize: 10, fontWeight: '700' },
  proHeading: { color: theme.colors.bitcoin },
  comparisonRow: { minHeight: 45, borderTopColor: theme.colors.border, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center' },
  feature: { flex: 1, paddingLeft: 13, color: theme.colors.primary, fontSize: 12 },
  column: { width: 55, color: theme.colors.muted, textAlign: 'center', fontSize: 16 },
  check: { width: 55, textAlign: 'center' },
  state: { paddingVertical: 18, alignItems: 'center', gap: 12 },
  stateText: { color: theme.colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 19 },
  proActive: { color: theme.colors.primary, fontSize: 16, fontWeight: '700' },
  sectionTitle: { color: theme.colors.muted, fontSize: 11, fontWeight: '700', marginBottom: 10 },
  plan: { minHeight: 65, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginBottom: 9 },
  selectedPlan: { borderColor: theme.colors.bitcoin, backgroundColor: theme.colors.surface },
  radio: { width: 18, height: 18, borderWidth: 1, borderColor: theme.colors.muted, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  selectedRadio: { borderColor: theme.colors.bitcoin },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.bitcoin },
  planText: { flex: 1 },
  planTitle: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  planPeriod: { color: theme.colors.muted, fontSize: 10, marginTop: 3 },
  planPrice: { color: theme.colors.primary, fontSize: 17, fontWeight: '700' },
  annualPrice: { fontSize: 17 },
  trial: { color: theme.colors.primary, fontSize: 12, marginTop: 7 },
  renewal: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, marginTop: 9 },
  primaryButton: { minHeight: 50, borderRadius: 8, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingHorizontal: 12 },
  primaryText: { color: theme.colors.inversePrimary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: theme.colors.primary, fontSize: 12 },
  error: { color: theme.colors.error, textAlign: 'center', fontSize: 11, marginTop: 12 },
  restore: { alignItems: 'center', paddingVertical: 16, marginTop: 7 },
  restoreText: { color: theme.colors.primary, fontSize: 12, textDecorationLine: 'underline' },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, marginTop: 8 },
  legalLink: { color: theme.colors.muted, fontSize: 10, textDecorationLine: 'underline' },
  separator: { color: theme.colors.muted, fontSize: 10 },
});

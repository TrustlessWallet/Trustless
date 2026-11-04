import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Text } from './StyledText';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
import { ProPlan, ProActivation, ProActivationKind, useTerminalPro } from '../contexts/TerminalProContext';
import TerminalSheetHeader from '../screens/TerminalSheetHeader';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import TermsConditionsScreen from '../screens/TermsConditionsScreen';

type LegalPage = 'privacy' | 'terms' | null;
type Props = {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onVerified: () => void;
  activation?: ProActivation | null;
  onActivationStart?: (kind: ProActivationKind) => number | undefined;
};

const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const presentationStyle = Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen';

export default function TerminalProSheet({ visible, activation, onClose, onDismiss, onVerified, onActivationStart }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { status, plans, loadingPlans, busy, pending, error, refresh, loadPlans, purchase, restore, manage } = useTerminalPro();
  const [selected, setSelected] = useState<'monthly' | 'annual'>('annual');
  const [legalPage, setLegalPage] = useState<LegalPage>(null);
  const [legalOpen, setLegalOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<'purchase' | 'restore' | null>(null);
  const [activationKind, setActivationKind] = useState<'purchase' | 'restore' | null>(null);
  const activating = activationKind !== null;
  const [activationError, setActivationError] = useState('');
  const activationBusy = useRef(false);
  const attemptStarted = useRef(false);
  const pendingApproval = useRef(false);
  const sharedAttempt = useRef(false);
  const acknowledged = useRef(false);
  const session = useRef(0);
  const previousVisible = useRef(visible);
  if (previousVisible.current !== visible) {
    previousVisible.current = visible;
    ++session.current;
  }
  if (pending && attemptStarted.current) pendingApproval.current = true;
  useEffect(() => () => { ++session.current; }, []);


  useEffect(() => { if (visible) void refresh(); }, [visible, refresh]);

  useEffect(() => {
    if (visible && status === 'free') void loadPlans();
    if (!visible) {
      setLegalOpen(false);
      setLegalPage(null);
      setConfirmation(null);
      setActivationKind(null);
      setActivationError('');
      activationBusy.current = false;
      attemptStarted.current = false;
      pendingApproval.current = false;
      sharedAttempt.current = false;
      acknowledged.current = false;
    }
  }, [visible, status, loadPlans]);

  useEffect(() => {
    if (plans.length && !plans.some(plan => plan.id === selected)) {
      setSelected(plans.some(plan => plan.id === 'annual') ? 'annual' : 'monthly');
    }
  }, [plans, selected]);

  const selectedPlan = plans.find(plan => plan.id === selected);
  const activate = async (kind: 'purchase' | 'restore') => {
    if (busy || activationBusy.current || (kind === 'purchase' && (pending || !selectedPlan))) return;
    const ticket = session.current;
    activationBusy.current = true;
    attemptStarted.current = true;
    pendingApproval.current = false;
    const attemptId = onActivationStart?.(kind);
    sharedAttempt.current = attemptId !== undefined && attemptId !== 0;
    setActivationKind(kind);
    setActivationError('');
    try {
      const success = kind === 'purchase' ? await purchase(selectedPlan!.id, ...(attemptId === undefined ? [] : [attemptId])) : await restore(...(attemptId === undefined ? [] : [attemptId]));
      if (ticket === session.current && success && !sharedAttempt.current) setConfirmation(kind);
    } catch {
      if (ticket === session.current) setActivationError('Could not complete your request. Please try again.');
    } finally {
      if (ticket === session.current) { activationBusy.current = false; setActivationKind(null); }
    }
  };
  useEffect(() => {
    if (visible && pendingApproval.current && !sharedAttempt.current && status === 'pro' && !busy && !activating) {
      pendingApproval.current = false;
      setConfirmation('purchase');
    }
  }, [visible, status, busy, activating]);

  const close = () => { ++session.current; onClose(); };
  const closeLegal = () => {
    setLegalOpen(false);
    // Modal.onDismiss is iOS-only. Keep Android usable after its back/close action.
    if (Platform.OS !== 'ios') setLegalPage(null);
  };
  const openLegal = (page: Exclude<LegalPage, null>) => {
    if (!busy && !activating && !legalPage) { setLegalPage(page); setLegalOpen(true); }
  };
  const confirmedKind = activation?.kind ?? (sharedAttempt.current ? null : confirmation);
  const confirmed = confirmedKind !== null && status === 'pro';
  const continueAfterActivation = () => {
    if (!confirmed || busy || activating || acknowledged.current) return;
    acknowledged.current = true;
    onVerified();
  };
  const working = busy || activating;
  return <Modal
    visible={visible}
    presentationStyle={presentationStyle}
    animationType="slide"
    allowSwipeDismissal={!working && !legalPage}
    onRequestClose={close}
    onDismiss={onDismiss}
  >
    <>
    <View style={styles.root} pointerEvents={legalPage ? 'none' : 'auto'} accessibilityElementsHidden={!!legalPage} importantForAccessibility={legalPage ? 'no-hide-descendants' : 'auto'}>
      <TerminalSheetHeader title="Terminal Pro" closeLabel="Close Terminal Pro" onClose={close} disabled={working || !!legalPage} />
        <ScrollView key={confirmed ? 'confirmation' : 'subscription'} testID="terminal-pro-content" style={styles.scroll} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
          {confirmed ? <View style={styles.confirmation} accessibilityLiveRegion="polite">
            <Feather name="check-circle" size={28} color={theme.colors.bitcoin} />
            <Text accessibilityRole="header" style={styles.confirmationTitle}>Terminal Pro is ready</Text>
            {confirmedKind === 'restore' ? <Text style={styles.stateText}>Your subscription has been restored.</Text> : null}
          </View> : status === 'pro' && !activating ? <View style={styles.activeState}>
            <View style={styles.activeLabel}><Feather name="check-circle" size={18} color={theme.colors.bitcoin} /><Text style={styles.activeText}>Active</Text></View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage subscription" accessibilityState={{ disabled: working, busy: working }} disabled={working} onPress={() => { void manage(); }} style={styles.primaryButton}>
              {working ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.primaryText}>Manage subscription</Text>}
            </TouchableOpacity>
          </View> : null}
          <Text style={styles.sectionTitle}>{confirmed ? 'WHERE TO FIND YOUR FEATURES' : status === 'pro' ? 'INCLUDED WITH PRO' : 'PRO FEATURES'}</Text>
          <View style={styles.features}>
            <FeatureRow title="Unlimited items" detail={confirmed ? 'Settings → Items' : 'Expand your catalog beyond 5 free items'} theme={theme} styles={styles} />
            <FeatureRow title="Reports" detail={confirmed ? 'Sales → Reports' : 'Item reports and CSV export'} theme={theme} styles={styles} />
            <FeatureRow title="Receipt logos" detail={confirmed ? 'Settings → Receipts → Logo' : 'Add your logo to receipts'} theme={theme} styles={styles} />
            <FeatureRow title="Receipt templates" detail={confirmed ? 'Settings → Receipts → Save as template' : 'Save layouts for repeat use'} theme={theme} styles={styles} />
          </View>

          {status === 'loading' || (activating && status !== 'free') ? <View style={styles.state}><ActivityIndicator color={theme.colors.bitcoin} /></View> : null}
          {status === 'unavailable' ? <View style={styles.state}><Text style={styles.stateText}>Subscriptions are unavailable right now.</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry subscription" disabled={working} onPress={() => { void refresh(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry</Text></TouchableOpacity></View> : null}
          {status === 'free' ? <>
            {loadingPlans && plans.length === 0 ? <View style={styles.state}><ActivityIndicator color={theme.colors.bitcoin} /></View> : plans.length ? <>
              <Text style={styles.sectionTitle}>CHOOSE A PLAN</Text>
              {plans.map(plan => <PlanChoice key={plan.id} plan={plan} selected={selected === plan.id} disabled={working || pending} onPress={() => setSelected(plan.id)} theme={theme} styles={styles} />)}
              {selectedPlan?.trialLabel ? <Text style={styles.trial}>{selectedPlan.trialLabel}</Text> : null}
              {selectedPlan?.renewalLabel ? <Text style={styles.renewal}>{selectedPlan.renewalLabel}</Text> : null}
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Continue with ${selected === 'annual' ? 'annual' : 'monthly'} Terminal Pro`} accessibilityState={{ disabled: working || pending, busy: working && activationKind !== 'restore' }} disabled={working || pending} onPress={() => { void activate('purchase'); }} style={[styles.primaryButton, (working || pending) && styles.disabled]}>
                {working && activationKind !== 'restore' ? <ActivityIndicator color={theme.colors.bitcoin} /> : <Text style={styles.primaryText}>Continue with {selected === 'annual' ? 'Annual' : 'Monthly'}</Text>}
              </TouchableOpacity>
            </> : <View style={styles.state}>
              <Text style={styles.stateText}>Store plans are unavailable right now.</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry loading plans" disabled={working} onPress={() => { void loadPlans(); }} style={styles.secondaryButton}><Text style={styles.secondaryText}>Retry</Text></TouchableOpacity>
            </View>}
          </> : null}
          {confirmed ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Continue to Terminal" accessibilityState={{ disabled: working, busy: working }} disabled={working} onPress={continueAfterActivation} style={styles.primaryButton}><Text style={styles.primaryText}>Continue</Text></TouchableOpacity> : null}
          {pending ? <Text style={styles.stateText}>Awaiting store approval. Pro unlocks when payment is confirmed.</Text> : null}
          {error || activationError ? <Text accessibilityRole="alert" style={styles.error}>{error || activationError}</Text> : null}
          {status !== 'pro' ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Restore purchases" accessibilityState={{ disabled: working, busy: activationKind === 'restore' }} disabled={working} onPress={() => { void activate('restore'); }} style={styles.restore}><Text style={[styles.restoreText, activationKind === 'restore' && styles.hiddenActionLabel]}>Restore purchases</Text>{activationKind === 'restore' ? <ActivityIndicator accessibilityLabel="Restoring purchases" color={theme.colors.bitcoin} style={styles.restoreSpinner} /> : null}</TouchableOpacity> : null}
          {!confirmed ? <View style={styles.legalLinks}>
            <TouchableOpacity accessibilityRole="link" accessibilityLabel="Privacy Policy" disabled={working} onPress={() => openLegal('privacy')} style={styles.legalTouch}><Text style={styles.legalLink}>Privacy</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="link" accessibilityLabel="Terms and Conditions" disabled={working} onPress={() => openLegal('terms')} style={styles.legalTouch}><Text style={styles.legalLink}>Terms</Text></TouchableOpacity>
            {Platform.OS === 'ios' ? <TouchableOpacity accessibilityRole="link" accessibilityLabel="Apple standard EULA" disabled={working} onPress={() => { void Linking.openURL(APPLE_EULA_URL); }} style={styles.legalTouch}><Text style={styles.legalLink}>Apple EULA</Text></TouchableOpacity> : null}
          </View> : null}
        </ScrollView>
    </View>
    <Modal visible={visible && legalOpen} presentationStyle={presentationStyle} animationType="slide" allowSwipeDismissal onRequestClose={closeLegal} onDismiss={() => setLegalPage(null)}>
    <View style={styles.root}>
      <TerminalSheetHeader title={legalPage === 'privacy' ? 'Privacy Policy' : 'Terms & Conditions'} closeLabel={`Close ${legalPage === 'privacy' ? 'Privacy Policy' : 'Terms and Conditions'}`} onClose={closeLegal} />
      <View style={styles.legalContent}>{legalPage === 'privacy' ? <PrivacyPolicyScreen /> : legalPage === 'terms' ? <TermsConditionsScreen /> : null}</View>
    </View>
    </Modal>
    </>
  </Modal>;
}

function FeatureRow({ title, detail, theme, styles }: { title: string; detail: string; theme: Theme; styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.featureRow}><Feather name="check" size={17} color={theme.colors.bitcoin} /><View style={styles.featureText}><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureDetail}>{detail}</Text></View></View>;
}

function PlanChoice({ plan, selected, disabled, onPress, theme, styles }: {
  plan: ProPlan; selected: boolean; disabled: boolean; onPress: () => void; theme: Theme; styles: ReturnType<typeof makeStyles>;
}) {
  const annual = plan.id === 'annual';
  return <TouchableOpacity accessibilityRole="radio" accessibilityLabel={`${annual ? 'Annual' : 'Monthly'} plan, ${plan.price} ${plan.periodLabel}`} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress} style={[styles.plan, selected && styles.selectedPlan]}>
    <View style={[styles.radio, selected && styles.selectedRadio]}>{selected ? <View style={styles.radioDot} /> : null}</View>
    <View style={styles.planText}><Text style={styles.planTitle}>{annual ? 'Annual' : 'Monthly'}</Text><Text style={styles.planPeriod}>{plan.periodLabel}</Text></View>
    <Text style={styles.planPrice}>{plan.price}</Text>
  </TouchableOpacity>;
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 32 },
  legalContent: { flex: 1 },
  confirmation: { alignItems: 'center', gap: 12, paddingVertical: 20, marginBottom: 24 },
  confirmationTitle: { color: theme.colors.primary, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  activeState: { marginBottom: 28 },
  activeLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  activeText: { color: theme.colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
  features: { marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'center', minHeight: 58, gap: 13, borderBottomColor: theme.colors.border, borderBottomWidth: 1 },
  featureText: { flex: 1, paddingVertical: 10 },
  featureTitle: { color: theme.colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
  featureDetail: { color: theme.colors.muted, fontSize: 11, lineHeight: 17, marginTop: 3 },
  state: { paddingVertical: 18, alignItems: 'center', gap: 12 },
  stateText: { color: theme.colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 19 },
  sectionTitle: { color: theme.colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.4, marginBottom: 12 },
  plan: { minHeight: 65, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, marginBottom: 9 },
  selectedPlan: { borderColor: theme.colors.bitcoin, backgroundColor: theme.colors.surface },
  radio: { width: 18, height: 18, borderWidth: 1, borderColor: theme.colors.muted, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  selectedRadio: { borderColor: theme.colors.bitcoin },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.bitcoin },
  planText: { flex: 1 },
  planTitle: { color: theme.colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
  planPeriod: { color: theme.colors.muted, fontSize: 10, marginTop: 3 },
  planPrice: { color: theme.colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 16 },
  renewal: { color: theme.colors.muted, fontSize: 10, lineHeight: 16, marginTop: 9 },
  trial: { color: theme.colors.primary, fontSize: 12, marginTop: 7 },
  primaryButton: { minHeight: 50, borderRadius: 8, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20, paddingHorizontal: 12 },
  primaryText: { color: theme.colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
  disabled: { opacity: 0.55 },
  secondaryButton: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: theme.colors.primary, fontSize: 12 },
  error: { color: theme.colors.error, textAlign: 'center', fontSize: 11, marginTop: 12 },
  restore: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 7 },
  hiddenActionLabel: { opacity: 0 },
  restoreSpinner: { position: 'absolute', alignSelf: 'center' },
  restoreText: { color: theme.colors.primary, fontSize: 12, textDecorationLine: 'underline' },
  legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 },
  legalTouch: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  legalLink: { color: theme.colors.muted, fontSize: 11, textDecorationLine: 'underline' },
});

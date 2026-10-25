import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Keyboard, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { v4 as uuidv4 } from 'uuid';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TerminalSheetHeader from './TerminalSheetHeader';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import { authenticate_terminal_refund } from '../services/authState';
import { formatTerminalSats, parseTerminalAmount } from '../services/terminal';
import { TerminalSale } from '../services/terminalSales';
import { remainingTerminalRefundSats, reserveTerminalRefund, TerminalRefundAttempt, updateTerminalRefund } from '../services/terminalRefunds';
import { getTerminalReportingRate } from '../services/terminalRates';

type Quote = { quoteId: string; invoice: string; amountSats: number; feeSats: number; expiresAt: number };
type Props = { sale: TerminalSale; attempts: TerminalRefundAttempt[]; onClose: () => void; visible?: boolean };
type Phase = 'form' | 'preparing' | 'review' | 'authorizing' | 'sending';

const sats = (value: number | bigint) => `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} sats`;
const statusLabel = (status: TerminalRefundAttempt['status']) => status === 'complete' ? 'Refund sent' : status === 'failed' ? 'Failed' : status === 'pending' ? 'Pending' : 'Needs checking';
const safeRemaining = (sale: TerminalSale, attempts: TerminalRefundAttempt[]): number | null => {
  try { return remainingTerminalRefundSats(sale, attempts); } catch { return null; }
};

export default function TerminalRefundScreen({ sale, attempts, onClose, visible = true }: Props) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { activeWallet, isLightningInitialized, prepareTerminalRefund, sendTerminalRefund, verifyTerminalRefund } = useWallet();
  const { scrollViewRef, paddingBottom, handleInputFocus } = useKeyboardScroll({ basePaddingBottom: insets.bottom + 28, animateLayoutChanges: true });
  const styles = useMemo(() => makeStyles(theme.colors), [theme]);
  const [invoice, setInvoice] = useState('');
  const [amount, setAmount] = useState(() => String(safeRemaining(sale, attempts) ?? 0));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [localAttempt, setLocalAttempt] = useState<TerminalRefundAttempt | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const scope = `${sale.request.network}:${sale.request.walletId}:${sale.request.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const effectiveAttempts = localAttempt && !attempts.some(attempt => attempt.id === localAttempt.id && (attempt.updatedAt > localAttempt.updatedAt || (attempt.updatedAt === localAttempt.updatedAt && attempt.status === localAttempt.status)))
    ? [...attempts.filter(attempt => attempt.id !== localAttempt.id), localAttempt] : attempts;
  const remainingValue = safeRemaining(sale, effectiveAttempts);
  const remaining = remainingValue ?? 0;
  const saleAttempts = effectiveAttempts.filter(attempt => attempt.saleId === sale.request.id).sort((a, b) => b.createdAt - a.createdAt);
  const unresolved = saleAttempts.filter(attempt => attempt.status === 'unknown' || attempt.status === 'pending');
  const current = (captured: string) => mounted.current && visibleRef.current && captured === scopeRef.current;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (phase === 'form' && !invoice.trim()) setAmount(String(remaining));
  }, [remaining, phase]);

  const review = async () => {
    if (busy.current || remainingValue === null) return;
    const captured = scope;
    setError('');
    if (!isLightningInitialized || activeWallet?.id !== sale.request.walletId) { setError('Open this wallet and connect to Lightning before refunding.'); return; }
    const destination = invoice.trim();
    if (!/^ln(bc|tb)[a-z0-9]+$/i.test(destination)) { setError('Paste a BOLT11 Lightning invoice from the customer.'); return; }
    let amountSats: number;
    try { amountSats = parseTerminalAmount(amount.trim(), 'sats'); } catch { setError('Enter a valid whole-sat refund amount.'); return; }
    if (amountSats > remaining || unresolved.length) { setError(unresolved.length ? 'Check the unresolved refund before starting another.' : `Maximum refundable: ${sats(remaining)}.`); return; }
    Keyboard.dismiss();
    busy.current = true;
    setPhase('preparing');
    try {
      const prepared = await prepareTerminalRefund(destination, amountSats);
      if (!current(captured)) return;
      if (prepared.amountSats !== amountSats || prepared.invoice.toLowerCase() !== destination.toLowerCase() || prepared.expiresAt <= Date.now()) throw new Error('Invalid refund quote.');
      setQuote(prepared);
      setPhase('review');
    } catch {
      if (current(captured)) { setError('Couldn’t prepare this refund. Check the invoice and try again.'); setPhase('form'); }
    } finally { busy.current = false; }
  };

  const authorize = async () => {
    if (!quote || busy.current) return;
    const captured = scope;
    if (quote.expiresAt <= Date.now()) { setQuote(null); setPhase('form'); setError('The quote expired. Review the refund again.'); return; }
    busy.current = true;
    setError('');
    setPhase('authorizing');
    let reserved: TerminalRefundAttempt | undefined;
    let definitelyNotSent = false;
    try {
      if (!await authenticate_terminal_refund()) { if (current(captured)) setPhase('review'); return; }
      if (!current(captured)) return;
      if (activeWallet?.id !== sale.request.walletId || quote.expiresAt <= Date.now()) throw new Error('Refund quote expired.');
      const reportingCurrency = sale.request.fiat?.currency ?? sale.request.reportingRate?.currency ?? 'USD';
      const reportingRate = await getTerminalReportingRate(reportingCurrency);
      if (!current(captured)) return;
      if (quote.expiresAt <= Date.now()) throw new Error('Refund quote expired.');
      reserved = await reserveTerminalRefund(sale, { id: uuidv4(), invoice: quote.invoice, amountSats: quote.amountSats, feeSats: quote.feeSats, quoteExpiresAt: quote.expiresAt, reportingRate });
      if (current(captured)) setLocalAttempt(reserved);
      if (current(captured)) setPhase('sending');
      // Once reserved, finish recording the payment outcome even if this view closes.
      const result = await sendTerminalRefund(quote.quoteId, reserved.id);
      const updated = await updateTerminalRefund(reserved, result);
      if (current(captured)) { setLocalAttempt(updated); setOutcome(result.status === 'complete' ? 'Refund sent' : result.status === 'failed' ? 'Refund failed' : result.status === 'pending' ? 'Refund submitted. Check its status before trying again.' : 'Refund outcome is uncertain. Check its status before trying again.'); setPhase('form'); setQuote(null); setInvoice(''); }
    } catch (failure) {
      if (reserved && (failure as { mayHaveSent?: boolean })?.mayHaveSent === false) {
        try { const updated = await updateTerminalRefund(reserved, { status: 'failed' }); definitelyNotSent = true; if (current(captured)) setLocalAttempt(updated); } catch { /* Preserve the reserved attempt for reconciliation. */ }
      }
      if (current(captured)) {
        setQuote(null);
        setPhase('form');
        setError(definitelyNotSent ? (failure instanceof Error ? failure.message : 'Refund was not sent. Review the invoice and try again.')
          : reserved ? 'Refund outcome is uncertain. Check this attempt before trying again.' : 'Refund was not sent. Review the invoice and try again.');
      }
    } finally { busy.current = false; }
  };

  const checkAttempt = async (attempt: TerminalRefundAttempt) => {
    if (busy.current) return;
    if (!isLightningInitialized || activeWallet?.id !== sale.request.walletId) { setError('Open this wallet and connect to Lightning to check the refund.'); return; }
    const captured = scope;
    busy.current = true;
    setCheckingId(attempt.id);
    setError('');
    try {
      const result = await verifyTerminalRefund(attempt.invoice, attempt.createdAt, attempt.paymentId);
      const updated = await updateTerminalRefund(attempt, result);
      if (current(captured)) {
        setLocalAttempt(updated);
        setOutcome(updated.status === 'complete' ? 'Refund sent' : updated.status === 'failed' ? 'Refund failed' : '');
      }
      if (current(captured) && result.status === 'unknown') setError('No matching refund found yet. Check again later.');
    } catch {
      if (current(captured)) setError('Couldn’t check this refund. Try again later.');
    } finally { busy.current = false; if (current(captured)) setCheckingId(null); }
  };

  return <View style={styles.root}>
    <TerminalSheetHeader title="Refund" closeLabel="Close refund" onClose={onClose} />
    <ScrollView style={{ flex: 1 }} ref={scrollViewRef} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 20, paddingBottom }} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}><Text style={styles.subtitle}>Original sale · {sats(sale.request.amountSats)}</Text></View>
      <View style={styles.balance}><Text style={styles.balanceLabel}>AVAILABLE TO REFUND</Text><Text style={styles.balanceAmount}>{sats(remaining)}</Text></View>
      {outcome ? <Text style={styles.outcome}>{outcome}</Text> : null}
      {saleAttempts.length ? <View style={styles.attempts}>
        <Text style={styles.sectionLabel}>REFUNDS</Text>
        {saleAttempts.map(attempt => <View key={attempt.id} style={styles.attemptRow}>
          <View style={styles.attemptInfo}><Text style={styles.attemptAmount}>{sats(attempt.amountSats)}</Text><Text style={styles.attemptStatus}>{statusLabel(attempt.status)}</Text></View>
          {(attempt.status === 'unknown' || attempt.status === 'pending') ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Check refund ${attempt.id}`} disabled={checkingId !== null} onPress={() => { void checkAttempt(attempt); }} style={styles.smallButton}><Text style={styles.smallButtonText}>{checkingId === attempt.id ? 'Checking…' : 'Check'}</Text></TouchableOpacity> : null}
        </View>)}
      </View> : null}
      {remaining > 0 && !unresolved.length ? quote && phase !== 'form' && phase !== 'preparing' ? <View style={styles.form}>
        <Text style={styles.sectionLabel}>REVIEW REFUND</Text>
        <View style={styles.reviewCard}>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Customer receives</Text><Text style={styles.reviewValue}>{sats(quote.amountSats)}</Text></View>
          <View style={styles.reviewRow}><Text style={styles.reviewLabel}>Network fee</Text><Text style={styles.reviewValue}>{sats(quote.feeSats)}</Text></View>
          <View style={styles.reviewRule} />
          <View style={styles.reviewRow}><Text style={styles.reviewTotal}>Total debited</Text><Text style={styles.reviewTotal}>{sats(BigInt(quote.amountSats) + BigInt(quote.feeSats))}</Text></View>
        </View>
        <Text style={styles.destinationLabel}>CUSTOMER INVOICE</Text><Text style={styles.destination} selectable>{quote.invoice}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Authorize refund" disabled={phase !== 'review'} style={[styles.primaryButton, phase !== 'review' && styles.disabled]} onPress={() => { void authorize(); }}><Text style={styles.primaryText}>{phase === 'authorizing' ? 'Authorizing…' : phase === 'sending' ? 'Sending…' : 'Authorize refund'}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit refund" disabled={phase !== 'review'} style={styles.secondaryButton} onPress={() => { setQuote(null); setPhase('form'); }}><Text style={styles.secondaryText}>Edit details</Text></TouchableOpacity>
      </View> : <View style={styles.form}>
        <Text style={styles.fieldLabel}>CUSTOMER LIGHTNING INVOICE</Text>
        <StyledInput accessibilityLabel="Customer Lightning invoice" value={invoice} onChangeText={value => { setInvoice(value); setOutcome(''); }} onFocus={handleInputFocus} placeholder="BOLT11 invoice" autoCapitalize="none" autoCorrect={false} spellCheck={false} editable={phase === 'form'} rightElement={<TouchableOpacity accessibilityRole="button" accessibilityLabel="Paste invoice" onPress={() => { const captured = scope; void Clipboard.getStringAsync().then(value => { if (value && current(captured)) setInvoice(value.trim()); }).catch(() => { if (current(captured)) setError('Couldn’t paste the invoice.'); }); }}><Feather name="clipboard" size={19} color={theme.colors.primary} /></TouchableOpacity>} />
        <Text style={styles.fieldLabel}>AMOUNT</Text>
        <StyledInput accessibilityLabel="Refund amount in sats" value={amount} onChangeText={setAmount} onFocus={handleInputFocus} keyboardType="number-pad" editable={phase === 'form'} rightElement={<Text style={styles.unit}>sats</Text>} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Review refund" disabled={phase !== 'form'} style={[styles.primaryButton, phase !== 'form' && styles.disabled]} onPress={() => { void review(); }}><Text style={styles.primaryText}>{phase === 'preparing' ? 'Preparing…' : phase === 'authorizing' ? 'Authorizing…' : phase === 'sending' ? 'Sending…' : 'Review refund'}</Text></TouchableOpacity>
      </View> : null}
      {unresolved.length ? <Text style={styles.notice}>A refund has an unresolved outcome. Check it before starting another refund.</Text> : null}
      {remainingValue === null ? <Text style={styles.notice}>Refund records need attention. New refunds are unavailable.</Text> : null}
      {remainingValue === 0 && !unresolved.length ? <Text style={styles.notice}>This sale has been fully refunded.</Text> : null}
    </ScrollView>
  </View>;
}

function makeStyles(colors: { background: string; primary: string; inversePrimary: string; surface: string; border: string; muted: string; bitcoin: string }) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    topBar: { position: 'absolute', left: 0, right: 0, zIndex: 2, height: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
    backButton: { width: 40, height: 40 },
    heading: { paddingHorizontal: 24, paddingBottom: 22 },
    title: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 42 },
    subtitle: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, marginTop: 7 },
    balance: { marginHorizontal: 24, padding: 22, borderRadius: 18, backgroundColor: colors.surface },
    balanceLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.3 },
    balanceAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 28, marginTop: 12 },
    outcome: { marginHorizontal: 24, marginTop: 20, color: colors.bitcoin, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    attempts: { marginHorizontal: 24, marginTop: 30 },
    sectionLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.3, marginBottom: 10 },
    attemptRow: { minHeight: 66, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    attemptInfo: { flex: 1 },
    attemptAmount: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    attemptStatus: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 11, marginTop: 3 },
    smallButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, minWidth: 74, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
    smallButtonText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 11 },
    form: { marginHorizontal: 24, marginTop: 30 },
    fieldLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.2, marginBottom: 9, marginTop: 20 },
    unit: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 12, paddingRight: 7 },
    error: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19, marginTop: 18 },
    notice: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12, lineHeight: 19, marginHorizontal: 24, marginTop: 25 },
    primaryButton: { backgroundColor: colors.primary, borderRadius: 8, minHeight: 54, alignItems: 'center', justifyContent: 'center', marginTop: 26 },
    disabled: { opacity: 0.6 },
    primaryText: { color: colors.inversePrimary, fontFamily: 'SpaceMono-Bold', fontSize: 14 },
    secondaryButton: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
    secondaryText: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12 },
    reviewCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 20 },
    reviewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, gap: 10 },
    reviewLabel: { color: colors.muted, fontFamily: 'SpaceMono-Regular', fontSize: 12 },
    reviewValue: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 12, textAlign: 'right' },
    reviewRule: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
    reviewTotal: { color: colors.primary, fontFamily: 'SpaceMono-Bold', fontSize: 13 },
    destinationLabel: { color: colors.muted, fontFamily: 'SpaceMono-Bold', fontSize: 10, letterSpacing: 1.2, marginTop: 25 },
    destination: { color: colors.primary, fontFamily: 'SpaceMono-Regular', fontSize: 11, lineHeight: 18, marginTop: 10 },
  });
}

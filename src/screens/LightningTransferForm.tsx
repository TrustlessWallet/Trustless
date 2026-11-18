import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AddressText } from '../components/AddressText';
import { StyledInput } from '../components/StyledInput';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext';

export type FeeTier = 'slow' | 'normal' | 'fast';
export const feeTiers: FeeTier[] = ['slow', 'normal', 'fast'];
export const feeLabels = { slow: 'Slow', normal: 'Normal', fast: 'Fast', custom: 'Custom' };
const sats = new Intl.NumberFormat('en-US');
export const formatSats = (value: number) => `${sats.format(value)} sats`;
export const cleanSats = (text: string) => {
    const trimmed = text.trim();
    return /^\d{1,3}(?:[, \u00a0\u202f]\d{3})+$/u.test(trimmed)
        ? trimmed.replace(/[, \u00a0\u202f]/gu, '')
        : trimmed;
};

type Quote = {
    amount: number;
    amountLabel?: string;
    address?: string;
    fees: { label: string; amount: number }[];
};
type Props = {
    from: string;
    to: string;
    balance: number;
    amount: string;
    onAmountChange: (text: string) => void;
    amountHint: string;
    error: string | null;
    busy: boolean;
    disabled: boolean;
    action: string;
    onAction: () => void;
    quote: Quote | null;
    onEdit: () => void;
    children: React.ReactNode;
};

export function LightningTransferForm({
    from, to, balance, amount, onAmountChange, amountHint, error, busy,
    disabled, action, onAction, quote, onEdit, children,
}: Props) {
    const { theme } = useTheme();
    const { colors } = theme;
    const total = quote && quote.fees.reduce((sum, fee) => sum + fee.amount, quote.amount);
    return (
        <KeyboardAvoidingView style={[styles.container, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
                <View style={[styles.route, { borderColor: colors.border }]}>
                    <Text style={{ color: colors.primary }}><Text style={{ color: colors.muted }}>From  </Text>{from}</Text>
                    <Text style={{ color: colors.primary }}><Text style={{ color: colors.muted }}>To    </Text>{to}</Text>
                </View>
                {!quote && <>
                    <View style={styles.amountHeader}>
                        <Text style={[styles.label, { color: colors.muted }]}>Amount</Text>
                        <Text style={[styles.label, styles.alignEnd, { color: colors.muted }]}>{formatSats(balance)} available</Text>
                    </View>
                    <StyledInput accessibilityLabel="Amount in sats" keyboardType="number-pad" placeholder="0"
                        value={amount} onChangeText={onAmountChange} editable={!busy}
                        rightElement={<Text style={[styles.unit, { color: colors.muted }]}>sats</Text>} />
                    <Text style={[styles.hint, { color: colors.muted }]}>{amountHint}</Text>
                    {children}
                </>}
                {quote && total !== null && (
                    <View>
                        {quote.address && <AddressText address={quote.address} selectable style={[styles.address, { color: colors.primary }]} />}
                        <View style={[styles.quote, { backgroundColor: colors.surface, borderRadius: theme.LAYOUT.radius }]}>
                            <QuoteRow label={quote.amountLabel ?? "Recipient receives"} amount={quote.amount} />
                            {quote.fees.map(fee => <QuoteRow key={fee.label} label={fee.label} amount={fee.amount} />)}
                            <View style={[styles.total, { borderColor: colors.border }]}>
                                <QuoteRow label="Total debited" amount={total} bold />
                            </View>
                        </View>
                        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onEdit} style={styles.edit}>
                            <Text style={[styles.label, { color: colors.primary }]}>Edit transfer</Text>
                        </TouchableOpacity>
                    </View>
                )}
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
            </ScrollView>
            <View style={styles.footer}>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={action}
                    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onAction}
                    style={[styles.button, { backgroundColor: colors.primary, borderRadius: theme.LAYOUT.radius }, disabled && !busy && styles.disabled]}>
                    {busy ? <ActivityIndicator color={colors.bitcoin} /> :
                        <Text style={[styles.buttonText, { color: colors.inversePrimary }]}>{action}</Text>}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

function QuoteRow({ label, amount, bold }: { label: string; amount: number; bold?: boolean }) {
    const { theme } = useTheme();
    const style = [styles.label, { color: theme.colors.primary }, bold && styles.bold];
    return <View style={styles.row}><Text style={style}>{label}</Text><Text style={[style, styles.alignEnd]}>{formatSats(amount)}</Text></View>;
}

export function TransferChoices<Key extends string>({ options, selected, onSelect, disabled }: {
    options: { key: Key; label: string; detail?: string }[];
    selected: Key;
    onSelect: (key: Key) => void;
    disabled: boolean;
}) {
    const { theme: { colors, LAYOUT } } = useTheme();
    return <View style={styles.choices}>
        {options.map(({ key, label, detail }) => {
            const active = key === selected;
            const color = active ? colors.inversePrimary : colors.primary;
            return <TouchableOpacity key={key} accessibilityRole="radio" accessibilityState={{ checked: active, disabled }}
                disabled={disabled} onPress={() => onSelect(key)}
                style={[styles.choice, { borderRadius: LAYOUT.radius, backgroundColor: active ? colors.primary : colors.surface }]}>
                <Text style={[styles.choiceLabel, { color }]}>{label}</Text>
                {detail ? <Text style={[styles.choiceDetail, { color: active ? color : colors.muted }]}>{detail}</Text> : null}
            </TouchableOpacity>;
        })}
    </View>;
}

export function TransferDisclosure({ label, detail, open, onPress, disabled }: {
    label: string; detail?: string; open: boolean; onPress: () => void; disabled?: boolean;
}) {
    const { theme: { colors } } = useTheme();
    return <TouchableOpacity style={[styles.disclosure, { borderColor: colors.border }]}
        accessibilityRole="button" accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={onPress}>
        <Text style={[styles.label, { color: colors.primary }]}>{label}</Text>
        {detail ? <Text style={[styles.disclosureValue, { color: colors.muted }]}>{detail}</Text> : null}
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
    </TouchableOpacity>;
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
    route: { gap: 6, paddingBottom: 14, marginBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
    amountHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
    unit: { marginRight: 8 },
    hint: { fontSize: 12, marginTop: 6, marginBottom: 8 },
    edit: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    address: { fontSize: 14, lineHeight: 22 },
    error: { fontSize: 13, marginTop: 12 },
    quote: { padding: 14, gap: 10, marginTop: 16 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
    label: { flexShrink: 1, fontSize: 14 },
    alignEnd: { textAlign: 'right' },
    bold: { fontWeight: 'bold' },
    total: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
    footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24 },
    button: { minHeight: 56, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    buttonText: { fontSize: 16, fontWeight: 'bold' },
    disabled: { opacity: 0.5 },
    disclosure: { minHeight: 48, alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
    disclosureValue: { flex: 1, textAlign: 'right', fontSize: 13 },
    choices: { flexDirection: 'row', gap: 8, marginVertical: 8 },
    choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 2 },
    choiceLabel: { fontSize: 13, fontWeight: '600' },
    choiceDetail: { fontSize: 11 },
});

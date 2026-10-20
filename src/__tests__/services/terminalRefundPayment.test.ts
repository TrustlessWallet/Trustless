import * as breezSdk from '@breeztech/breez-sdk-spark-react-native';
import { checkedRefundInvoice, checkedRefundQuote, matchRefundPayment, TerminalRefundPreflightError } from '../../services/terminalRefundPayment';

jest.mock('@breeztech/breez-sdk-spark-react-native', () => ({
  InputType_Tags: { Bolt11Invoice: 'Bolt11Invoice', LnurlPay: 'LnurlPay' },
  SendPaymentMethod_Tags: { Bolt11Invoice: 'Bolt11Invoice' },
  BitcoinNetwork: { Bitcoin: 0, Testnet3: 1 }, FeePolicy: { FeesExcluded: 0, FeesIncluded: 1 },
  PaymentType: { Send: 1, Receive: 0 }, PaymentStatus: { Completed: 0, Pending: 1, Failed: 2 },
  PaymentDetails_Tags: { Lightning: 'Lightning' },
}));

const invoice = 'lnbc123test';
const parsed = (overrides: Record<string, unknown> = {}) => ({
  tag: breezSdk.InputType_Tags.Bolt11Invoice,
  inner: [{ network: breezSdk.BitcoinNetwork.Bitcoin, amountMsat: 123000n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)), expiry: 3600n,
    invoice: { bolt11: invoice }, ...overrides }],
} as any);
const quote = (overrides: Record<string, unknown> = {}) => ({
  paymentMethod: { tag: breezSdk.SendPaymentMethod_Tags.Bolt11Invoice,
    inner: { invoiceDetails: { invoice: { bolt11: invoice } }, lightningFeeSats: 7n } },
  amount: 123n, tokenIdentifier: undefined, conversionEstimate: undefined,
  feePolicy: breezSdk.FeePolicy.FeesExcluded, ...overrides,
} as any);
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1', paymentType: breezSdk.PaymentType.Send, status: breezSdk.PaymentStatus.Completed,
  amount: 123n, conversionDetails: undefined,
  details: { tag: breezSdk.PaymentDetails_Tags.Lightning, inner: { invoice } }, ...overrides,
} as any);

it('accepts only a live fixed-amount invoice on the active network', () => {
  expect(checkedRefundInvoice(parsed(), invoice, 123, breezSdk.BitcoinNetwork.Bitcoin)).toBeGreaterThan(Date.now());
  expect(() => checkedRefundInvoice(parsed({ amountMsat: undefined }), invoice, 123, breezSdk.BitcoinNetwork.Bitcoin)).toThrow(TerminalRefundPreflightError);
  expect(() => checkedRefundInvoice(parsed({ network: breezSdk.BitcoinNetwork.Testnet3 }), invoice, 123, breezSdk.BitcoinNetwork.Bitcoin)).toThrow();
  expect(() => checkedRefundInvoice(parsed({ expiry: 0n, timestamp: 1n }), invoice, 123, breezSdk.BitcoinNetwork.Bitcoin)).toThrow();
  expect(() => checkedRefundInvoice({ tag: breezSdk.InputType_Tags.LnurlPay } as any, invoice, 123, breezSdk.BitcoinNetwork.Bitcoin)).toThrow();
});

it('binds the reviewed Lightning fee to the exact Bitcoin quote', () => {
  expect(checkedRefundQuote(quote(), invoice, 123)).toBe(7);
  for (const changed of [
    { amount: 124n }, { tokenIdentifier: 'token' }, { conversionEstimate: {} },
    { feePolicy: breezSdk.FeePolicy.FeesIncluded },
    { paymentMethod: { tag: 'SparkAddress', inner: {} } },
    { paymentMethod: { tag: 'Bolt11Invoice', inner: { invoiceDetails: { invoice: { bolt11: 'lnbcother' } }, lightningFeeSats: 7n } } },
  ]) expect(() => checkedRefundQuote(quote(changed), invoice, 123)).toThrow(TerminalRefundPreflightError);
});

it('reconciles only exact outgoing Lightning payments with the right amount', () => {
  expect(matchRefundPayment(payment(), invoice, 123)).toEqual({ status: 'complete', paymentId: 'payment-1' });
  expect(matchRefundPayment(payment({ status: breezSdk.PaymentStatus.Failed }), invoice, 123)?.status).toBe('failed');
  expect(matchRefundPayment(payment({ paymentType: breezSdk.PaymentType.Receive }), invoice, 123)).toBeNull();
  expect(matchRefundPayment(payment({ amount: 124n }), invoice, 123)).toBeNull();
  expect(matchRefundPayment(payment({ details: { tag: 'Lightning', inner: {} } }), invoice, 123)).toBeNull();
});

import * as breezSdk from '@breeztech/breez-sdk-spark-react-native';
import { normalizeInvoice } from './terminal';

export type TerminalRefundResult = { status: 'complete' | 'pending' | 'failed' | 'unknown'; paymentId?: string };
export type TerminalRefundQuote = { quoteId: string; invoice: string; amountSats: number; feeSats: number; expiresAt: number };

// A preflight error guarantees that sendPayment was never invoked. Once it is
// invoked, even a native timeout must be treated as an uncertain payment.
export class TerminalRefundPreflightError extends Error {
  readonly mayHaveSent = false;
}

export function preflightRefund(message: string): never {
  throw new TerminalRefundPreflightError(message);
}

export function checkedRefundInvoice(
  parsed: breezSdk.InputType, invoice: string, amountSats: number, network: breezSdk.BitcoinNetwork,
): number {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) preflightRefund('Enter a valid refund amount.');
  if (parsed.tag !== breezSdk.InputType_Tags.Bolt11Invoice) preflightRefund('Refunds require a fixed-amount Lightning invoice.');
  const details = parsed.inner[0];
  if (details.network !== network || details.amountMsat !== BigInt(amountSats) * 1000n ||
      normalizeInvoice(details.invoice.bolt11) !== normalizeInvoice(invoice)) {
    preflightRefund('Invoice amount or network does not match the refund.');
  }
  const expiryMs = (details.timestamp + details.expiry) * 1000n;
  if (expiryMs <= BigInt(Date.now()) || expiryMs > BigInt(Number.MAX_SAFE_INTEGER)) preflightRefund('Refund invoice has expired.');
  return Number(expiryMs);
}

export function checkedRefundQuote(
  quote: breezSdk.PrepareSendPaymentResponse, invoice: string, amountSats: number,
): number {
  if (quote.paymentMethod.tag !== breezSdk.SendPaymentMethod_Tags.Bolt11Invoice ||
      quote.tokenIdentifier !== undefined || quote.conversionEstimate !== undefined ||
      quote.feePolicy !== breezSdk.FeePolicy.FeesExcluded || quote.amount !== BigInt(amountSats) ||
      normalizeInvoice(quote.paymentMethod.inner.invoiceDetails.invoice.bolt11) !== normalizeInvoice(invoice)) {
    preflightRefund('Refund quote changed. Prepare it again.');
  }
  const fee = quote.paymentMethod.inner.lightningFeeSats;
  if (fee < 0n || fee > BigInt(Number.MAX_SAFE_INTEGER) ||
      BigInt(amountSats) + fee > BigInt(Number.MAX_SAFE_INTEGER)) preflightRefund('Invalid refund fee.');
  return Number(fee);
}

export function matchRefundPayment(
  payment: breezSdk.Payment | undefined, invoice: string, amountSats: number,
): TerminalRefundResult | null {
  if (!payment || payment.paymentType !== breezSdk.PaymentType.Send ||
      payment.details?.tag !== breezSdk.PaymentDetails_Tags.Lightning ||
      typeof payment.details.inner.invoice !== 'string' ||
      normalizeInvoice(payment.details.inner.invoice) !== normalizeInvoice(invoice) ||
      payment.amount !== BigInt(amountSats) || payment.conversionDetails !== undefined) return null;
  const status = payment.status === breezSdk.PaymentStatus.Completed ? 'complete'
    : payment.status === breezSdk.PaymentStatus.Failed ? 'failed'
    : payment.status === breezSdk.PaymentStatus.Pending ? 'pending' : 'unknown';
  return { status, paymentId: payment.id };
}

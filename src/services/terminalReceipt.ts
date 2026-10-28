import { Share } from 'react-native';
import { formatFiatMinor, formatTerminalBasketAmount, formatTerminalSats } from './terminal';
import { TerminalSale } from './terminalSales';
import { TerminalRefundAttempt } from './terminalRefunds';
import { DEFAULT_TERMINAL_RECEIPT_BRANDING, loadTerminalReceiptBranding, normalizeTerminalReceiptBranding, TerminalReceiptBranding } from './terminalReceiptBranding';

export function formatTerminalReceipt(sale: TerminalSale, refunds: readonly TerminalRefundAttempt[] = [], branding: TerminalReceiptBranding = DEFAULT_TERMINAL_RECEIPT_BRANDING): string {
  if (sale.status !== 'received' || sale.receivedAt === undefined) throw new Error('Only verified paid sales have receipts.');
  const safeBranding = normalizeTerminalReceiptBranding(branding);
  const { request } = sale;
  const details = [
    'Payment receipt',
    `Sale: ${request.id}`,
    `Network: ${request.network}`,
    `Amount: ${formatTerminalSats(request.amountSats)} sats`,
  ];
  if (request.fiat) {
    details.push(`Original price: ${request.fiat.currency} ${formatFiatMinor(request.fiat.amountMinor)}`);
  }
  if (request.basket) {
    details.push('Items:');
    for (const line of request.basket.lines) details.push(`${line.name} × ${line.quantity} @ ${formatTerminalBasketAmount(line.unitPrice, request.basket.unit)} = ${formatTerminalBasketAmount(line.total, request.basket.unit)}`);
    details.push(`Items total: ${formatTerminalBasketAmount(request.basket.total, request.basket.unit)}`);
  }
  details.push(`Payment first verified locally: ${new Date(sale.receivedAt).toLocaleString()}`);
  if (sale.paymentId) details.push(`Payment reference: ${sale.paymentId}`);
  const relevant = refunds.filter(refund => refund.walletId === request.walletId &&
    refund.network === request.network && refund.saleId === request.id && refund.status !== 'failed');
  for (const refund of relevant) {
    const status = refund.status === 'complete' ? 'complete' : refund.status === 'pending' ? 'pending' : 'needs checking';
    details.push(`Refund ${refund.id}: ${formatTerminalSats(refund.amountSats)} sats (${status})`);
    if (refund.paymentId) details.push(`Refund payment reference: ${refund.paymentId}`);
  }
  if (!safeBranding.name && !safeBranding.contact && !safeBranding.footer) return details.join('\n');
  const heading = [safeBranding.name, safeBranding.contact].filter(Boolean);
  return [...heading, ...(heading.length ? [''] : []), ...details, ...(safeBranding.footer ? ['', safeBranding.footer] : [])].join('\n');
}

export async function shareTerminalReceipt(sale: TerminalSale, refunds: readonly TerminalRefundAttempt[] = [], isCurrent: () => boolean = () => true): Promise<void> {
  if (sale.status !== 'received' || sale.receivedAt === undefined) throw new Error('Only verified paid sales have receipts.');
  if (!isCurrent()) return;
  const branding = await loadTerminalReceiptBranding(sale.request.walletId, sale.request.network);
  if (!isCurrent()) return;
  await Share.share({ message: formatTerminalReceipt(sale, refunds, branding) });
}

import { Share } from 'react-native';
import { formatFiatMinor, formatTerminalBasketAmount, formatTerminalSats } from './terminal';
import { TerminalSale } from './terminalSales';
import { TerminalRefundAttempt } from './terminalRefunds';

export function formatTerminalReceipt(sale: TerminalSale, refunds: readonly TerminalRefundAttempt[] = []): string {
  if (sale.status !== 'received' || sale.receivedAt === undefined) throw new Error('Only verified paid sales have receipts.');
  const { request } = sale;
  const lines = [
    'Payment receipt',
    `Sale: ${request.id}`,
    `Network: ${request.network}`,
    `Amount: ${formatTerminalSats(request.amountSats)} sats`,
  ];
  if (request.fiat) {
    lines.push(`Original price: ${request.fiat.currency} ${formatFiatMinor(request.fiat.amountMinor)}`);
  }
  if (request.basket) {
    lines.push('Items:');
    for (const line of request.basket.lines) lines.push(`${line.name} × ${line.quantity} @ ${formatTerminalBasketAmount(line.unitPrice, request.basket.unit)} = ${formatTerminalBasketAmount(line.total, request.basket.unit)}`);
    lines.push(`Items total: ${formatTerminalBasketAmount(request.basket.total, request.basket.unit)}`);
  }
  lines.push(`Payment first verified locally: ${new Date(sale.receivedAt).toLocaleString()}`);
  if (sale.paymentId) lines.push(`Payment reference: ${sale.paymentId}`);
  const relevant = refunds.filter(refund => refund.walletId === request.walletId &&
    refund.network === request.network && refund.saleId === request.id && refund.status !== 'failed');
  for (const refund of relevant) {
    const status = refund.status === 'complete' ? 'complete' : refund.status === 'pending' ? 'pending' : 'needs checking';
    lines.push(`Refund ${refund.id}: ${formatTerminalSats(refund.amountSats)} sats (${status})`);
    if (refund.paymentId) lines.push(`Refund payment reference: ${refund.paymentId}`);
  }
  return lines.join('\n');
}

export async function shareTerminalReceipt(sale: TerminalSale, refunds: readonly TerminalRefundAttempt[] = []): Promise<void> {
  await Share.share({ message: formatTerminalReceipt(sale, refunds) });
}

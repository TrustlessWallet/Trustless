import { Share } from 'react-native';
import { TerminalSale } from '../../services/terminalSales';
import { TerminalRefundAttempt } from '../../services/terminalRefunds';
import { formatTerminalReceipt, shareTerminalReceipt } from '../../services/terminalReceipt';

beforeEach(() => {
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const sale: TerminalSale = {
  request: {
    id: 'sale-1', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc123abc',
    amountSats: 334, createdAt: 1000, expiresAt: 2000,
    fiat: { currency: 'CHF', amountMinor: 100, rate: '300000', fetchedAt: 1200 },
  },
  status: 'received', paymentId: 'receive-sdk', receivedAt: 3000, updatedAt: 3000,
};
const refund: TerminalRefundAttempt = {
  id: 'refund-1', walletId: 'wallet-a', network: 'mainnet', saleId: 'sale-1',
  saleInvoice: 'lnbc123abc', invoice: 'lnbc999abc', amountSats: 100,
  feeSats: 3, quoteExpiresAt: 9000, createdAt: 4000, status: 'complete',
  paymentId: 'send-sdk', updatedAt: 5000,
};

it('uses original fiat and local first verified time, with refunds separately in sats', () => {
  const text = formatTerminalReceipt(sale, [refund]);
  expect(text).toContain('Amount: 334 sats');
  expect(text).toContain('Original price: CHF 1.00');
  expect(text).toContain('Payment first verified locally:');
  expect(text).toContain('Payment reference: receive-sdk');
  expect(text).toContain('Refund refund-1: 100 sats (complete)');
  expect(text).toContain('Refund payment reference: send-sdk');
  expect(text).not.toContain('CHF 0.');
  expect(text).not.toContain(sale.request.invoice);
  expect(formatTerminalReceipt(sale, [{ ...refund, walletId: 'wallet-b' }])).not.toContain('Refund refund-1');
  expect(formatTerminalReceipt(sale, [{ ...refund, status: 'failed' }])).not.toContain('Refund refund-1');
  expect(formatTerminalReceipt(sale, [{ ...refund, status: 'unknown' }])).toContain('100 sats (needs checking)');
});

it('only shares receipts for verified paid sales', async () => {
  await expect(shareTerminalReceipt({ ...sale, status: 'pending', receivedAt: undefined })).rejects.toThrow('verified paid');
  expect(Share.share).not.toHaveBeenCalled();
  await shareTerminalReceipt(sale);
  expect(Share.share).toHaveBeenCalledWith({ message: formatTerminalReceipt(sale) });
});

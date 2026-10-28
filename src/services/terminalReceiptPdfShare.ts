import { Asset } from 'expo-asset';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { loadTerminalReceiptBranding } from './terminalReceiptBranding';
import type { TerminalSale } from './terminalSales';
import type { TerminalRefundAttempt } from './terminalRefunds';

async function readFont(module: number): Promise<Uint8Array> {
  const asset = await Asset.fromModule(module).downloadAsync();
  if (!asset.localUri) throw new Error('Receipt font unavailable.');
  return new File(asset.localUri).bytes();
}

/** Generate on demand: PDF code and fonts are never loaded by checkout. */
export async function shareTerminalPdfReceipt(sale: TerminalSale, refunds: readonly TerminalRefundAttempt[] = [], isCurrent: () => boolean = () => true): Promise<void> {
  if (sale.status !== 'received' || sale.receivedAt === undefined) throw new Error('Only verified paid sales have receipts.');
  if (!isCurrent()) return;
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable on this device.');
  if (!isCurrent()) return;
  const branding = await loadTerminalReceiptBranding(sale.request.walletId, sale.request.network);
  if (!isCurrent()) return;
  const [{ createTerminalReceiptPdf }, regular, bold] = await Promise.all([
    Promise.resolve().then(() => require('./terminalReceiptPdf') as typeof import('./terminalReceiptPdf')),
    readFont(require('../../assets/fonts/SpaceMono-Regular.ttf')),
    readFont(require('../../assets/fonts/SpaceMono-Bold.ttf')),
  ]);
  if (!isCurrent()) return;
  const bytes = await createTerminalReceiptPdf(sale, refunds, branding, { regular, bold });
  if (!isCurrent()) return;
  let file: File | undefined;
  try {
    file = new File(Paths.cache, `trustless-receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    file.create();
    file.write(Uint8Array.from(bytes));
    if (!isCurrent()) return;
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share PDF receipt' });
  } finally {
    try { if (file?.exists) file.delete(); } catch { /* The OS also reclaims cache files. */ }
  }
}

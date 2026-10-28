import * as Sharing from 'expo-sharing';
import { shareTerminalPdfReceipt } from '../../services/terminalReceiptPdfShare';
import { createTerminalReceiptPdf } from '../../services/terminalReceiptPdf';
import { loadTerminalReceiptBranding } from '../../services/terminalReceiptBranding';
import type { TerminalSale } from '../../services/terminalSales';

const files: { uri: string; exists: boolean; deleted: boolean; write: jest.Mock }[] = [];
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'private-cache' },
  File: class {
    uri: string; exists = false; deleted = false; write = jest.fn();
    constructor(first: string, name?: string) { this.uri = name ? `${first}/${name}` : first; if (name) files.push(this); }
    bytes() { return Promise.resolve(new Uint8Array([1, 2])); }
    create() { this.exists = true; }
    delete() { this.deleted = true; this.exists = false; }
  },
}));
jest.mock('expo-asset', () => ({ Asset: { fromModule: jest.fn(() => ({ downloadAsync: async () => ({ localUri: 'private-font' }) })) } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/terminalReceiptPdf', () => ({ createTerminalReceiptPdf: jest.fn() }));
jest.mock('../../services/terminalReceiptBranding', () => ({ loadTerminalReceiptBranding: jest.fn() }));
const sale = { request: { id: 'sale', walletId: 'wallet', network: 'mainnet' }, status: 'received', receivedAt: 12 } as TerminalSale;
const branding = { name: 'Shop', contact: '', footer: '' };
beforeEach(() => {
  jest.clearAllMocks(); files.length = 0;
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  (loadTerminalReceiptBranding as jest.Mock).mockResolvedValue(branding);
  (createTerminalReceiptPdf as jest.Mock).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});
it('uses scoped branding and private PDF file, cleaning up after share completes', async () => {
  await shareTerminalPdfReceipt(sale);
  expect(loadTerminalReceiptBranding).toHaveBeenCalledWith('wallet', 'mainnet');
  expect(createTerminalReceiptPdf).toHaveBeenCalledWith(sale, [], branding, { regular: new Uint8Array([1, 2]), bold: new Uint8Array([1, 2]) });
  expect(files[0].uri).not.toContain('wallet');
  expect(files[0].write).toHaveBeenCalledWith(new Uint8Array([37, 80, 68, 70]));
  expect(Sharing.shareAsync).toHaveBeenCalledWith(files[0].uri, expect.objectContaining({ mimeType: 'application/pdf' }));
  expect(files[0].deleted).toBe(true);
});
it('cleans up when native sharing fails and propagates PDF failures for the text fallback', async () => {
  (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('share failed'));
  await expect(shareTerminalPdfReceipt(sale)).rejects.toThrow('share failed');
  expect(files[0].deleted).toBe(true);
  (createTerminalReceiptPdf as jest.Mock).mockRejectedValueOnce(new Error('unsupported font'));
  await expect(shareTerminalPdfReceipt(sale)).rejects.toThrow('unsupported font');
  expect(files).toHaveLength(1);
});
it('cancels a stale scope before generation or sharing and refuses unpaid sales', async () => {
  let current = true;
  (loadTerminalReceiptBranding as jest.Mock).mockImplementationOnce(async () => { current = false; return branding; });
  await shareTerminalPdfReceipt(sale, [], () => current);
  expect(createTerminalReceiptPdf).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await expect(shareTerminalPdfReceipt({ ...sale, status: 'pending' })).rejects.toThrow('verified paid');
});
it('fails before reading receipt data when sharing is unavailable', async () => {
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
  await expect(shareTerminalPdfReceipt(sale)).rejects.toThrow('Sharing unavailable');
  expect(loadTerminalReceiptBranding).not.toHaveBeenCalled();
});

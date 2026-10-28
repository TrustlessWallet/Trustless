import { readFileSync } from 'fs';
import { PDFDocument, PDFName, PDFPage, PDFRawStream } from 'pdf-lib';
import { createTerminalReceiptPdf } from '../../services/terminalReceiptPdf';
import { TerminalSale } from '../../services/terminalSales';
import { TerminalRefundAttempt } from '../../services/terminalRefunds';

const fonts = {
  regular: Uint8Array.from(readFileSync('assets/fonts/SpaceMono-Regular.ttf')),
  bold: Uint8Array.from(readFileSync('assets/fonts/SpaceMono-Bold.ttf')),
};
const branding = { name: 'Trustless Coffee', contact: 'hello@example.com', footer: 'Thank you.' };
const sale: TerminalSale = {
  request: {
    id: 'sale-all-fields', walletId: 'wallet-a', network: 'mainnet', invoice: 'lnbc', amountSats: 1234, createdAt: 100, expiresAt: 200,
    fiat: { currency: 'USD', amountMinor: 500, rate: '100000', fetchedAt: 90 },
    basket: { unit: 'USD', total: 500, lines: [{ itemId: 'coffee', name: 'Original coffee', quantity: 2, unitPrice: 250, total: 500 }] },
  },
  status: 'received', receivedAt: 150, updatedAt: 150, paymentId: 'payment-reference',
};
const refund = (index: number): TerminalRefundAttempt => ({
  id: `refund-${index}`, walletId: 'wallet-a', network: 'mainnet', saleId: sale.request.id, saleInvoice: 'lnbc', invoice: 'refund',
  amountSats: 10 + index, feeSats: 1, quoteExpiresAt: 300, createdAt: 200, updatedAt: 250, status: index % 2 ? 'pending' : 'complete', paymentId: `refund-reference-${index}`,
});

it('creates a paid A5 PDF containing canonical sale, basket, payment, and refund details', async () => {
  const drawn: string[] = [];
  const original = PDFPage.prototype.drawText;
  const collector = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function(this: any, text: string, options: any) {
    drawn.push(text); return original.call(this, text, options);
  });
  const failed = { ...refund(2), id: 'failed-refund', status: 'failed' as const };
  const bytes = await createTerminalReceiptPdf(sale, [refund(1), failed], branding, fonts);
  collector.mockRestore();
  expect(bytes).toBeInstanceOf(Uint8Array);
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBe(1);
  const size = document.getPage(0).getSize();
  expect(size.width).toBeCloseTo(419.53, 1);
  expect(size.height).toBeCloseTo(595.28, 1);
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(drawn).toEqual(expect.arrayContaining([
    'Sale: sale-all-fields', 'Amount: 1 234 sats', 'Original price: USD 5.00',
    'Original coffee × 2 @ USD 2.50 = USD 5.00', 'Payment reference: payment-reference',
    'Refund refund-1: 11 sats (pending)', 'Refund payment reference: refund-reference-1',
  ]));
  expect(drawn.join('\n')).not.toContain('failed-refund');
});

it('rejects unpaid sales before producing a PDF', async () => {
  await expect(createTerminalReceiptPdf({ ...sale, status: 'pending', receivedAt: undefined }, [], branding, fonts)).rejects.toThrow('verified paid');
});

it('wraps long references and paginates all canonical refund lines without truncation', async () => {
  const longSale = { ...sale, paymentId: 'payment-'.repeat(80), request: { ...sale.request, id: 'sale-'.repeat(80), basket: { ...sale.request.basket!, lines: Array.from({ length: 20 }, (_, index) => ({ itemId: `item-${index}`, name: `Very long original product name ${index} ${'x'.repeat(40)}`, quantity: 2, unitPrice: 250, total: 500 })) } } };
  const drawn: string[] = [];
  const original = PDFPage.prototype.drawText;
  const collector = jest.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function(this: any, text: string, options: any) { drawn.push(text); return original.call(this, text, options); });
  const bytes = await createTerminalReceiptPdf(longSale, Array.from({ length: 40 }, (_, index) => ({ ...refund(index), saleId: longSale.request.id, paymentId: `refund-${index}-${'r'.repeat(100)}` })), branding, fonts);
  collector.mockRestore();
  const pageCount = (await PDFDocument.load(bytes)).getPageCount();
  expect(pageCount).toBeGreaterThan(2);
  expect(drawn).toContain(`Page 1 of ${pageCount}`);
  const content = drawn.filter(text => !text.startsWith('Page ')).join('');
  expect(content).toContain(longSale.paymentId!);
  expect(content).toContain(`Very long original product name 0 ${'x'.repeat(40)}`);
});

it('fails explicitly when the embedded receipt font lacks a Unicode glyph', async () => {
  const unsupported = { ...sale, request: { ...sale.request, basket: { ...sale.request.basket!, lines: [{ ...sale.request.basket!.lines[0], name: 'Coffee 😀' }] } } };
  await expect(createTerminalReceiptPdf(unsupported, [], branding, fonts)).rejects.toThrow('Share the text receipt instead');
});

it('embeds a validated PNG merchant logo', async () => {
  const logo = { mimeType: 'image/png' as const, base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==' };
  const bytes = await createTerminalReceiptPdf(sale, [], { ...branding, logo }, fonts);
  const document = await PDFDocument.load(bytes);
  const imageStreams = Array.from(document.context.enumerateIndirectObjects()).filter(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  expect(imageStreams.length).toBeGreaterThan(0);
});

it('renders iOS non-breaking locale date spaces without rejecting the receipt', async () => {
  const locale = jest.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('10/28/2026, 10:02:00\u202fAM');
  try {
    const bytes = await createTerminalReceiptPdf(sale, [], { ...branding, name: 'Corner\u00a0café' }, fonts);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  } finally { locale.mockRestore(); }
});

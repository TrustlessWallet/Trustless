import { Buffer } from 'buffer';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';
import { formatTerminalReceipt } from './terminalReceipt';
import { normalizeTerminalReceiptBranding, TerminalReceiptBranding } from './terminalReceiptBranding';
import { TerminalRefundAttempt } from './terminalRefunds';
import { TerminalSale } from './terminalSales';

export type TerminalReceiptPdfBranding = TerminalReceiptBranding & Readonly<{
  logo?: Readonly<{ mimeType: 'image/png' | 'image/jpeg'; base64: string }>;
}>;
export type TerminalReceiptPdfFonts = Readonly<{ regular: Uint8Array; bold: Uint8Array }>;

const A5: [number, number] = [419.53, 595.28];
const MARGIN = 36;
const CONTENT_WIDTH = A5[0] - MARGIN * 2;
const BOTTOM = 34;
const BLACK = rgb(0, 0, 0);
// iOS locale dates use non-breaking spaces absent from Space Mono. Preserve their visible spacing.
const pdfText = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

function assertSupportedText(fontBytes: Uint8Array, text: string) {
  let face: { characterSet?: number[] };
  try { face = (fontkit as any).create(fontBytes); } catch { throw new Error('Receipt font data is invalid.'); }
  const supported = new Set(face.characterSet ?? []);
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (character === '\n' || character === '\r') continue;
    if (!supported.has(codePoint)) throw new Error(`Receipt PDF font does not support “${character}”. Share the text receipt instead.`);
  }
}

function wrapByWidth(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [''];
  const result: string[] = [];
  let line = '';
  const pushLongToken = (token: string) => {
    for (const character of token) {
      const candidate = line + character;
      if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        result.push(line); line = character;
      } else line = candidate;
    }
  };
  for (const token of text.match(/\s+|\S+/gu) ?? []) {
    if (/^\s+$/u.test(token)) {
      if (line && font.widthOfTextAtSize(line + token, size) <= maxWidth) line += token;
      else if (line) { result.push(line); line = token; }
      continue;
    }
    if (font.widthOfTextAtSize(line + token, size) <= maxWidth) line += token;
    else {
      if (line.trim()) { result.push(line); line = ''; }
      if (font.widthOfTextAtSize(token, size) <= maxWidth) line = token;
      else pushLongToken(token);
    }
  }
  if (line || !result.length) result.push(line);
  return result;
}

export async function createTerminalReceiptPdf(
  sale: TerminalSale,
  refunds: readonly TerminalRefundAttempt[],
  branding: TerminalReceiptPdfBranding,
  fonts: TerminalReceiptPdfFonts,
): Promise<Uint8Array> {
  // The canonical formatter performs paid-sale and branding validation and remains the source of every receipt detail.
  const safeBranding = normalizeTerminalReceiptBranding(branding);
  const canonical = pdfText(formatTerminalReceipt(sale, refunds));
  const displayedText = pdfText([safeBranding.name, safeBranding.contact, canonical, safeBranding.footer].filter(Boolean).join('\n'));
  assertSupportedText(fonts.regular, displayedText);
  assertSupportedText(fonts.bold, displayedText);

  const document = await PDFDocument.create();
  document.registerFontkit(fontkit as any);
  const regular = await document.embedFont(fonts.regular, { subset: true });
  const bold = await document.embedFont(fonts.bold, { subset: true });
  let logo: PDFImage | undefined;
  if (safeBranding.logo) {
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(Buffer.from(safeBranding.logo.base64, 'base64')); } catch { throw new Error('Receipt logo is invalid.'); }
    try { logo = safeBranding.logo.mimeType === 'image/png' ? await document.embedPng(bytes) : await document.embedJpg(bytes); }
    catch { throw new Error('Receipt logo is invalid.'); }
  }

  let page!: PDFPage;
  let y!: number;
  const newPage = () => {
    page = document.addPage(A5);
    y = A5[1] - MARGIN;
  };
  newPage();
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(); };
  const drawWrapped = (text: string, font: PDFFont, size: number, lineHeight: number, gapAfter = 0) => {
    const lines = wrapByWidth(pdfText(text), font, size, CONTENT_WIDTH);
    const paragraphHeight = lines.length * lineHeight + gapAfter;
    const fullPageHeight = A5[1] - MARGIN - BOTTOM;
    if (paragraphHeight <= fullPageHeight && y - paragraphHeight < BOTTOM) newPage();
    for (const line of lines) {
      ensure(lineHeight);
      if (line) page.drawText(line, { x: MARGIN, y: y - size, size, font, color: BLACK });
      y -= lineHeight;
    }
    y -= gapAfter;
  };

  if (logo) {
    const scale = Math.min(1, 88 / logo.width, 54 / logo.height);
    const width = logo.width * scale, height = logo.height * scale;
    ensure(height + 10);
    page.drawImage(logo, { x: MARGIN, y: y - height, width, height });
    y -= height + 10;
  }
  if (safeBranding.name) drawWrapped(safeBranding.name, bold, 16, 21, 2);
  if (safeBranding.contact) drawWrapped(safeBranding.contact, regular, 9, 13, 9);

  for (const paragraph of canonical.split('\n')) {
    const prominent = paragraph.startsWith('Amount:') || paragraph.startsWith('Original price:');
    const heading = paragraph === 'Payment receipt' || paragraph === 'Items:';
    drawWrapped(paragraph, prominent || heading ? bold : regular, prominent ? 15 : heading ? 12 : 9, prominent ? 20 : heading ? 17 : 13, heading ? 3 : 1);
  }
  if (safeBranding.footer) {
    ensure(24); y -= 8;
    drawWrapped(safeBranding.footer, regular, 9, 13);
  }

  const pages = document.getPages();
  if (pages.length > 1) pages.forEach((receiptPage, index) => {
    const label = `Page ${index + 1} of ${pages.length}`;
    receiptPage.drawText(label, { x: (A5[0] - regular.widthOfTextAtSize(label, 7)) / 2, y: 15, size: 7, font: regular, color: BLACK });
  });

  document.setTitle('Payment receipt');
  document.setSubject('Terminal payment receipt');
  document.setCreator('Trustless');
  return document.save({ useObjectStreams: false });
}

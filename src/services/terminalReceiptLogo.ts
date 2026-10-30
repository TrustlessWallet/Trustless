import { Buffer } from 'buffer';
import pako from 'pako';

export type TerminalReceiptLogo = Readonly<{ mimeType: 'image/png' | 'image/jpeg'; base64: string }>;
export const MAX_TERMINAL_RECEIPT_LOGO_BYTES = 200 * 1024;
const MAX_SIDE = 1024;
type LogoDimensions = Readonly<{ width: number; height: number }>;
const dimensions = new WeakMap<TerminalReceiptLogo, LogoDimensions>();
const invalid = () => new Error('Invalid receipt logo. Choose a PNG or JPEG up to 200 KB and 1024 pixels per side.');
const u32 = (bytes: Uint8Array, offset: number) => (((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0);
const validSize = (width: number, height: number) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (bytes: Uint8Array) => pngSignature.every((value, index) => bytes[index] === value);
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8;
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function sanitizePng(bytes: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  if (!isPng(bytes)) throw invalid();
  let offset = 8, seenIHDR = false, seenIDAT = false, seenEnd = false;
  let width = 0, height = 0, channels = 0, bitDepth = 0, color = -1, paletteEntries = 0, seenPalette = false, seenTransparency = false, afterIDAT = false;
  const idat: Uint8Array[] = [];
  const safeChunks: Uint8Array[] = [bytes.subarray(0, 8)];
  while (offset + 12 <= bytes.length && !seenEnd) {
    const length = u32(bytes, offset), start = offset + 8, end = start + length;
    if (length > bytes.length || end + 4 > bytes.length || end < start) throw invalid();
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes, offset + 4, end) !== u32(bytes, end)) throw invalid();
    if (!seenIHDR && (type !== 'IHDR' || length !== 13)) throw invalid();
    if (type === 'IHDR') {
      if (seenIHDR || length !== 13) throw invalid();
      width = u32(bytes, start); height = u32(bytes, start + 4);
      color = bytes[start + 9]; bitDepth = bytes[start + 8];
      const validDepth = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
      if (!validSize(width, height) || ![0, 2, 3, 4, 6].includes(color) || !validDepth.includes(bitDepth) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0) throw invalid();
      channels = color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 1; seenIHDR = true;
    } else if (type === 'IDAT') { if (afterIDAT || (color === 3 && !seenPalette)) throw invalid(); idat.push(bytes.subarray(start, end)); seenIDAT = true; }
    else if (type === 'IEND') { if (length !== 0 || !seenIDAT) throw invalid(); seenEnd = true; }
    else if (type === 'PLTE') {
      if (seenPalette || seenIDAT || seenTransparency || color === 0 || color === 4 || length === 0 || length > 768 || length % 3 || (color === 3 && length / 3 > 2 ** bitDepth)) throw invalid();
      paletteEntries = length / 3; seenPalette = true;
    }
    else if (type === 'tRNS') {
      if (seenTransparency || seenIDAT || ![0, 2, 3].includes(color) ||
        (color === 0 && length !== 2) || (color === 2 && length !== 6) || (color === 3 && (!seenPalette || length === 0 || length > paletteEntries))) throw invalid();
      if (color === 0 && (((bytes[start] << 8) | bytes[start + 1]) >= 2 ** bitDepth)) throw invalid();
      if (color === 2 && [0, 2, 4].some(index => (((bytes[start + index] << 8) | bytes[start + index + 1]) >= 2 ** bitDepth))) throw invalid();
      seenTransparency = true;
    }
    else if (type === 'acTL' || type === 'fcTL' || type === 'fdAT' || (type.charCodeAt(0) & 32) === 0) throw invalid();
    if (seenIDAT && type !== 'IDAT') afterIDAT = true;
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) safeChunks.push(bytes.subarray(offset, end + 4));
    offset = end + 4;
  }
  if (!seenEnd || offset !== bytes.length) throw invalid();
  const compressed = new Uint8Array(idat.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of idat) { compressed.set(part, cursor); cursor += part.length; }
  const expected = height * (1 + Math.ceil(width * channels * bitDepth / 8));
  let inflated = 0;
  const decoder = new pako.Inflate();
  decoder.onData = chunk => { inflated += chunk.byteLength; if (inflated > expected) throw invalid(); };
  try { decoder.push(compressed, true); } catch { throw invalid(); }
  if (decoder.err || !(decoder as pako.Inflate & { ended: boolean }).ended || inflated !== expected) throw invalid();
  return { bytes: Buffer.concat(safeChunks.map(part => Buffer.from(part))), width, height };
}
function sanitizeJpeg(bytes: Uint8Array): { bytes: Uint8Array; width: number; height: number } {
  if (!isJpeg(bytes) || bytes.length < 6) throw invalid();
  let offset = 2, width = 0, height = 0, sawScan = false;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw invalid();
    const markerStart = offset;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length || !validSize(width, height)) throw invalid();
      sawScan = true; parts.push(bytes.subarray(markerStart)); break;
    }
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) throw invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw invalid();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 7 || width || height || bytes[offset + 2] !== 8) throw invalid();
      height = (bytes[offset + 3] << 8) | bytes[offset + 4]; width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (!validSize(width, height)) throw invalid();
    }
    // Remove metadata, including EXIF, GPS, comments and XMP; retain coding tables.
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) parts.push(bytes.subarray(markerStart, offset + length));
    offset += length;
  }
  if (!sawScan || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw invalid();
  return { bytes: Buffer.concat(parts.map(part => Buffer.from(part))), width, height };
}
export function receiptLogoFromBytes(input: Uint8Array): TerminalReceiptLogo {
  if (!(input instanceof Uint8Array) || input.length === 0 || input.length > MAX_TERMINAL_RECEIPT_LOGO_BYTES) throw invalid();
  const mimeType = isPng(input) ? 'image/png' : isJpeg(input) ? 'image/jpeg' : null;
  if (!mimeType) throw invalid();
  const image = mimeType === 'image/png' ? sanitizePng(input) : sanitizeJpeg(input);
  const logo: TerminalReceiptLogo = { mimeType, base64: Buffer.from(image.bytes).toString('base64') };
  dimensions.set(logo, { width: image.width, height: image.height });
  return logo;
}
export function normalizeTerminalReceiptLogo(value: unknown): TerminalReceiptLogo {
  if (!value || typeof value !== 'object') throw invalid();
  const input = value as Record<string, unknown>;
  if ((input.mimeType !== 'image/png' && input.mimeType !== 'image/jpeg') || typeof input.base64 !== 'string' || input.base64.length > 273_068 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) throw invalid();
  const bytes = Buffer.from(input.base64, 'base64');
  if (bytes.toString('base64') !== input.base64) throw invalid();
  const logo = receiptLogoFromBytes(bytes);
  if (logo.mimeType !== input.mimeType || logo.base64 !== input.base64) throw invalid();
  return logo;
}

/** Match the PDF's proportional fit without adding an invisible image frame or cropping. */
export function terminalReceiptLogoLayout(logo: TerminalReceiptLogo, maxWidth = 120, maxHeight = 80): LogoDimensions {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || !Number.isFinite(maxHeight) || maxHeight <= 0) throw invalid();
  let size = dimensions.get(logo);
  if (!size) {
    size = dimensions.get(normalizeTerminalReceiptLogo(logo))!;
    dimensions.set(logo, size);
  }
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  return { width: size.width * scale, height: size.height * scale };
}

import { File } from 'expo-file-system';
import { MAX_TERMINAL_RECEIPT_LOGO_BYTES, receiptLogoFromBytes, TerminalReceiptLogo } from './terminalReceiptLogo';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_PIXELS = 32_000_000;
const MAX_IMPORT_SIDE = 16_384;
const MAX_OUTPUT_SIDE = 1_024;
const OUTPUT_SIDES = [1_024, 768, 512, 384, 256] as const;
const friendly = () => new Error('Couldn’t prepare this logo. Choose a PNG or JPEG up to 20 MB and 32 megapixels.');
const u16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u32 = (bytes: Uint8Array, at: number) => (((bytes[at] * 0x1000000) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]) >>> 0);
function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
type Source = { mimeType: 'image/png' | 'image/jpeg'; width: number; height: number };
function inspectSource(bytes: Uint8Array): Source {
  let source: Source | null = null;
  if (pngSignature.every((value, index) => bytes[index] === value)) {
    if (bytes.length < 45 || u32(bytes, 8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR' ||
      crc32(bytes, 12, 29) !== u32(bytes, 29) ||
      ![0, 2, 3, 4, 6].includes(bytes[25]) ||
      bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0 || bytes[bytes.length - 8] !== 73 ||
      bytes[bytes.length - 7] !== 69 || bytes[bytes.length - 6] !== 78 || bytes[bytes.length - 5] !== 68 ||
      u32(bytes, bytes.length - 12) !== 0 || crc32(bytes, bytes.length - 8, bytes.length - 4) !== u32(bytes, bytes.length - 4)) throw friendly();
    // IHDR carries width and height before the native decoder receives the file.
    source = { mimeType: 'image/png', width: u32(bytes, 16), height: u32(bytes, 20) };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) throw friendly();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) throw friendly();
      const length = u16(bytes, offset);
      if (length < 2 || offset + length > bytes.length) throw friendly();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 7 || bytes[offset + 2] !== 8) throw friendly();
        source = { mimeType: 'image/jpeg', width: u16(bytes, offset + 5), height: u16(bytes, offset + 3) };
        break;
      }
      offset += length;
    }
  }
  if (!source || source.width < 1 || source.height < 1 || source.width > MAX_IMPORT_SIDE ||
    source.height > MAX_IMPORT_SIDE || source.width * source.height > MAX_IMPORT_PIXELS) throw friendly();
  return source;
}

/** Imports a local PNG/JPEG file, resizing proportionally until it fits receipt storage limits. */
export async function importTerminalReceiptLogo(uri: string, isCurrent: () => boolean): Promise<TerminalReceiptLogo | null> {
  if (!isCurrent()) return null;
  const generated = new Set<string>();
  try {
    if (typeof uri !== 'string' || !uri.startsWith('file://')) throw friendly();
    const original = new File(uri);
    if (!original.exists || original.size < 1 || original.size > MAX_IMPORT_BYTES) throw friendly();
    const bytes = new Uint8Array(await original.arrayBuffer());
    if (!isCurrent()) return null;
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMPORT_BYTES) throw friendly();
    const source = inspectSource(bytes);
    if (source.mimeType === 'image/png' && bytes.byteLength <= MAX_TERMINAL_RECEIPT_LOGO_BYTES && Math.max(source.width, source.height) <= MAX_OUTPUT_SIDE) {
      // A malformed small image is an error; never promote it by native transcoding.
      return receiptLogoFromBytes(bytes);
    }
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const format = source.mimeType === 'image/png' ? SaveFormat.PNG : SaveFormat.JPEG;
    const sourceContext = ImageManipulator.manipulate(uri);
    try {
      let currentImage = await sourceContext.renderAsync();
      try {
        if (!isCurrent()) return null;
        if (currentImage.width < 1 || currentImage.height < 1 || currentImage.width > MAX_IMPORT_SIDE ||
          currentImage.height > MAX_IMPORT_SIDE || currentImage.width * currentImage.height > MAX_IMPORT_PIXELS) throw friendly();
        // Native decoding applies JPEG EXIF orientation; use these displayed dimensions.
        const originalSide = Math.max(currentImage.width, currentImage.height);
        const targets = [...new Set(OUTPUT_SIDES.map(side => Math.min(side, originalSide)))];
        for (const target of targets) {
          if (!isCurrent()) return null;
          if (Math.max(currentImage.width, currentImage.height) > target) {
            sourceContext.resize(currentImage.width >= currentImage.height ? { width: target } : { height: target });
            const resized = await sourceContext.renderAsync();
            if (resized !== currentImage) currentImage.release();
            currentImage = resized;
            if (!isCurrent()) return null;
          }
          const result = await currentImage.saveAsync({ format, compress: format === SaveFormat.JPEG ? 0.85 : 1 });
          if (result.uri !== uri) generated.add(result.uri);
          if (!isCurrent()) return null;
          if (!result.uri.startsWith('file://') || result.uri === uri || result.width < 1 || result.height < 1 ||
            result.width > MAX_OUTPUT_SIDE || result.height > MAX_OUTPUT_SIDE) throw friendly();
          const output = new File(result.uri);
          if (!output.exists || output.size < 1) throw friendly();
          if (output.size > MAX_TERMINAL_RECEIPT_LOGO_BYTES) continue;
          const outputBytes = new Uint8Array(await output.arrayBuffer());
          if (!isCurrent()) return null;
          if (outputBytes.byteLength > MAX_TERMINAL_RECEIPT_LOGO_BYTES) continue;
          const logo = receiptLogoFromBytes(outputBytes);
          if (logo.mimeType !== source.mimeType) throw friendly();
          return logo;
        }
        throw friendly();
      } finally { currentImage.release(); }
    } finally { sourceContext.release(); }
  } catch {
    if (!isCurrent()) return null;
    throw friendly();
  } finally {
    for (const generatedUri of generated) {
      try { const file = new File(generatedUri); if (file.exists) file.delete(); } catch { /* best effort cache cleanup */ }
    }
  }
}

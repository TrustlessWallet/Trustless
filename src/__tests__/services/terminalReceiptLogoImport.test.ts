import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { importTerminalReceiptLogo } from '../../services/terminalReceiptLogoImport';
import { receiptLogoFromBytes } from '../../services/terminalReceiptLogo';

jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { PNG: 'png', JPEG: 'jpeg' } }));
jest.mock('../../services/terminalReceiptLogo', () => ({ MAX_TERMINAL_RECEIPT_LOGO_BYTES: 204800, receiptLogoFromBytes: jest.fn() }));
const files = new Map<string, { bytes: Uint8Array; size?: number; exists?: boolean; deleted?: boolean }>();
const fileMock = File as unknown as jest.Mock;
const manipulateMock = ImageManipulator.manipulate as jest.Mock;
const logoMock = receiptLogoFromBytes as jest.Mock;
const releases: jest.Mock[] = [];
const saveCalls: Array<{ width: number; height: number; options: unknown }> = [];
let outputs: string[];
let nativeWidth: number;
let nativeHeight: number;
let onSave: (() => void) | undefined;
function writeCrc(bytes: Uint8Array, start: number, end: number, destination: number) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) { crc ^= bytes[i]; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  bytes.set([(crc >>> 24) & 255, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], destination);
}
function png(width: number, height: number, size = 128): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  bytes.set([(width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255], 16);
  bytes.set([(height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255], 20);
  bytes[24] = 8; bytes[25] = 6;
  writeCrc(bytes, 12, 29, 29);
  bytes.set([73, 69, 78, 68], size - 8);
  writeCrc(bytes, size - 8, size - 4, size - 4);
  return bytes;
}
function jpeg(width: number, height: number, size = 128): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([255, 216, 255, 192, 0, 7, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255], 0);
  bytes.set([255, 217], size - 2);
  return bytes;
}
function add(uri: string, bytes: Uint8Array, size = bytes.byteLength) { files.set(uri, { bytes, size, exists: true }); }
function image(width: number, height: number) {
  const release = jest.fn(); releases.push(release);
  return { width, height, release, saveAsync: async (options: unknown) => {
    saveCalls.push({ width, height, options });
    onSave?.();
    return { uri: outputs.shift(), width, height };
  } };
}
beforeEach(() => {
  files.clear(); releases.length = 0; saveCalls.length = 0; outputs = []; onSave = undefined;
  nativeWidth = 0; nativeHeight = 0; jest.clearAllMocks();
  fileMock.mockImplementation((uri: string) => ({
    get exists() { return files.get(uri)?.exists ?? false; },
    get size() { return files.get(uri)?.size ?? 0; },
    arrayBuffer: async () => files.get(uri)!.bytes.buffer,
    delete: () => { files.get(uri)!.deleted = true; files.get(uri)!.exists = false; },
  }));
  manipulateMock.mockImplementation((source: string | { width: number; height: number }) => {
    if (typeof source !== 'string') throw new Error('A SharedRef must never cross the native bridge.');
    const release = jest.fn(); releases.push(release);
    let resize: { width?: number; height?: number } | null = null;
    let width = nativeWidth, height = nativeHeight;
    return { release, resize: (value: typeof resize) => { resize = value; }, renderAsync: async () => {
      if (resize) {
        const nextWidth = resize.width ?? Math.round(width * (resize.height! / height));
        const nextHeight = resize.height ?? Math.round(height * (resize.width! / width));
        width = nextWidth; height = nextHeight; resize = null;
      }
      return image(width, height);
    } };
  });
  logoMock.mockImplementation((bytes: Uint8Array) => ({ mimeType: bytes[0] === 137 ? 'image/png' : 'image/jpeg', base64: 'safe' }));
});

it('keeps an already valid small PNG untouched', async () => {
  const original = png(600, 300); add('file:///original', original);
  expect(await importTerminalReceiptLogo('file:///original', () => true)).toEqual({ mimeType: 'image/png', base64: 'safe' });
  expect(logoMock).toHaveBeenCalledWith(original);
  expect(manipulateMock).not.toHaveBeenCalled();
});

it('uses one URI context for a large PNG and preserves PNG output', async () => {
  add('file:///original', png(4000, 2000)); add('file:///result', png(1024, 512));
  nativeWidth = 4000; nativeHeight = 2000; outputs = ['file:///result'];
  expect(await importTerminalReceiptLogo('file:///original', () => true)).toEqual({ mimeType: 'image/png', base64: 'safe' });
  expect(manipulateMock).toHaveBeenCalledTimes(1);
  expect(manipulateMock.mock.calls[0][0]).toBe('file:///original');
  expect(saveCalls).toEqual([{ width: 1024, height: 512, options: { format: SaveFormat.PNG, compress: 1 } }]);
  expect(files.get('file:///result')?.deleted).toBe(true);
  expect(files.get('file:///original')?.deleted).toBeUndefined();
  expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
});

it('uses displayed dimensions after JPEG EXIF orientation and steps down until storage fits', async () => {
  add('file:///original', jpeg(3000, 1000));
  add('file:///result-1024', jpeg(341, 1024), 300000);
  add('file:///result-768', jpeg(256, 768), 190000);
  nativeWidth = 1000; nativeHeight = 3000; outputs = ['file:///result-1024', 'file:///result-768'];
  expect(await importTerminalReceiptLogo('file:///original', () => true)).toEqual({ mimeType: 'image/jpeg', base64: 'safe' });
  expect(manipulateMock).toHaveBeenCalledTimes(1);
  expect(manipulateMock).toHaveBeenCalledWith('file:///original');
  expect(saveCalls.map(call => [call.width, call.height])).toEqual([[341, 1024], [256, 768]]);
  expect(saveCalls[0].options).toEqual({ format: SaveFormat.JPEG, compress: 0.85 });
  expect(files.get('file:///result-1024')?.deleted).toBe(true);
  expect(files.get('file:///result-768')?.deleted).toBe(true);
  expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
});

it('normalizes even a small JPEG through native decoding', async () => {
  const original = jpeg(600, 300); add('file:///original', original);
  const transcoded = jpeg(600, 300); transcoded[20] = 1;
  add('file:///result', transcoded); nativeWidth = 600; nativeHeight = 300; outputs = ['file:///result'];
  await importTerminalReceiptLogo('file:///original', () => true);
  expect(manipulateMock).toHaveBeenCalledTimes(1);
  expect(saveCalls).toEqual([{ width: 600, height: 300, options: { format: SaveFormat.JPEG, compress: 0.85 } }]);
  expect(logoMock).toHaveBeenCalledWith(files.get('file:///result')?.bytes);
  expect(logoMock).not.toHaveBeenCalledWith(original);
  expect(files.get('file:///result')?.deleted).toBe(true);
});

it('rejects oversized or unsupported originals before native decode', async () => {
  add('file:///huge', png(400, 400), 20 * 1024 * 1024 + 1);
  add('file:///pixels', png(8000, 8000));
  add('file:///svg', new TextEncoder().encode('<svg></svg>'));
  for (const uri of ['file:///huge', 'file:///pixels', 'file:///svg']) {
    await expect(importTerminalReceiptLogo(uri, () => true)).rejects.toThrow('Choose a PNG or JPEG up to 20 MB');
  }
  expect(manipulateMock).not.toHaveBeenCalled();
});

it('returns null on stale scope after save and cleans up generated files and shared refs', async () => {
  add('file:///original', png(4000, 2000)); add('file:///result', png(1024, 512));
  nativeWidth = 4000; nativeHeight = 2000; outputs = ['file:///result'];
  let current = true; onSave = () => { current = false; };
  expect(await importTerminalReceiptLogo('file:///original', () => current)).toBeNull();
  expect(files.get('file:///result')?.deleted).toBe(true);
  expect(files.get('file:///original')?.deleted).toBeUndefined();
  expect(logoMock).not.toHaveBeenCalled();
  expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
});

it('does not transcode a malformed small PNG', async () => {
  add('file:///bad', png(200, 200));
  logoMock.mockImplementationOnce(() => { throw new Error('Invalid receipt logo.'); });
  await expect(importTerminalReceiptLogo('file:///bad', () => true)).rejects.toThrow('Couldn’t prepare this logo');
  expect(manipulateMock).not.toHaveBeenCalled();
});

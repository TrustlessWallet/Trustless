import { deflateSync } from 'zlib';
import { receiptLogoFromBytes, terminalReceiptLogoLayout } from '../../services/terminalReceiptLogo';

function logo(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  const pixels = Buffer.alloc(height * (1 + width * 4), 127);
  for (let row = 0; row < height; row++) pixels[row * (1 + width * 4)] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  return receiptLogoFromBytes(png);
}

it.each([
  [200, 800, 20, 80],
  [800, 200, 120, 30],
  [200, 200, 80, 80],
  [24, 12, 24, 12],
])('fits %s by %s logos without an artificial side frame or distortion', (width, height, expectedWidth, expectedHeight) => {
  const image = logo(width, height);
  expect(terminalReceiptLogoLayout(image)).toEqual({ width: expectedWidth, height: expectedHeight });
  expect(terminalReceiptLogoLayout(JSON.parse(JSON.stringify(image)))).toEqual({ width: expectedWidth, height: expectedHeight });
});
it('rejects malformed logos rather than rendering guessed dimensions', () => {
  expect(() => terminalReceiptLogoLayout({ mimeType: 'image/png', base64: 'AQIDBA==' })).toThrow('Invalid receipt logo');
});

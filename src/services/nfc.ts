import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

let nfcManagerStarted = false;

export class NfcCancelledError extends Error {
  constructor() {
    super('NFC scan cancelled');
    this.name = 'NfcCancelledError';
  }
}

export class NfcUnsupportedError extends Error {
  constructor() {
    super('NFC is not supported on this device');
    this.name = 'NfcUnsupportedError';
  }
}

const ensureNfcStarted = async () => {
  if (!nfcManagerStarted) {
    console.log('[NFC] Starting NFC Manager...');
    const supported = await NfcManager.isSupported();
    if (!supported) {
      console.error('[NFC] NFC is not supported on this device.');
      throw new NfcUnsupportedError();
    }
    await NfcManager.start();
    nfcManagerStarted = true;
    console.log('[NFC] NFC Manager started successfully.');
  }
};

const bytesToString = (bytes: number[]): string => {
  return bytes.map(b => String.fromCharCode(b)).join('');
};

export const scanLightningInvoice = async (): Promise<string> => {
  console.log('[NFC] scanLightningInvoice triggered. User ready to tap.');
  try {
    await ensureNfcStarted();

    console.log('[NFC] Requesting IsoDep technology...');
    await NfcManager.requestTechnology(NfcTech.IsoDep);

    console.log('[NFC] IsoDep connected. Executing APDU commands to read NDEF file...');

    // 1. Select NDEF Tag Application (AID: D2760000850101)
    const selectAppResp = await NfcManager.isoDepHandler.transceive([
      0x00, 0xA4, 0x04, 0x00, 0x07, 0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01, 0x00
    ]);
    console.log('[NFC] Select App Response:', selectAppResp);

    // 2. Select NDEF File (File ID: E104)
    const selectFileResp = await NfcManager.isoDepHandler.transceive([
      0x00, 0xA4, 0x00, 0x00, 0x02, 0xE1, 0x04, 0x00
    ]);
    console.log('[NFC] Select File Response:', selectFileResp);

    // 3. Read File Length (Read 2 bytes starting from offset 0)
    const readLengthResp = await NfcManager.isoDepHandler.transceive([
      0x00, 0xB0, 0x00, 0x00, 0x02
    ]);
    console.log('[NFC] Read Length Response:', readLengthResp);

    if (readLengthResp.length < 4 || readLengthResp[readLengthResp.length - 2] !== 0x90) {
      throw new Error("Failed to read NDEF file length from smart card.");
    }

    const ndefLength = (readLengthResp[0] << 8) + readLengthResp[1];
    console.log('[NFC] Computed NDEF File Length:', ndefLength);

    if (ndefLength <= 0) {
      throw new Error("Nothing found. The tag was read but had no payment data on it.");
    }

    // 4. Read Full NDEF File Content (chunked — file may exceed the 255-byte
    // single-READ-BINARY limit, and the offset must be split across P1/P2)
    const CHUNK_SIZE = 0xF0; // 240 bytes per read, safely under the APDU limit
    const contentBytes: number[] = [];
    let bytesRead = 0;

    while (bytesRead < ndefLength) {
      const remaining = ndefLength - bytesRead;
      const readSize = Math.min(CHUNK_SIZE, remaining);

      // Data starts at file offset 2 (the first 2 bytes are the NLEN header)
      const absoluteOffset = 2 + bytesRead;
      const offsetHi = (absoluteOffset >> 8) & 0xFF;
      const offsetLo = absoluteOffset & 0xFF;

      const chunkResp = await NfcManager.isoDepHandler.transceive([
        0x00, 0xB0, offsetHi, offsetLo, readSize
      ]);
      console.log(`[NFC] Content chunk @${absoluteOffset} (${readSize} bytes):`, chunkResp);

      if (chunkResp.length < 2 || chunkResp[chunkResp.length - 2] !== 0x90) {
        throw new Error("Failed to read NDEF content chunk from smart card.");
      }

      const chunkData = chunkResp.slice(0, chunkResp.length - 2); // strip 90 00 status
      contentBytes.push(...chunkData);
      bytesRead += chunkData.length;
    }

    console.log('[NFC] Full NDEF Content Bytes (length ' + contentBytes.length + '):', contentBytes);

    const ndefMessage = Ndef.decodeMessage(contentBytes);
    console.log('[NFC] Decoded NDEF Message Structure:', JSON.stringify(ndefMessage, null, 2));

    if (!ndefMessage || ndefMessage.length === 0) {
      throw new Error("Nothing found. The tag was read but had no payment data on it.");
    }

    const ndefRecord = ndefMessage[0];
    const recordPayload = ndefRecord.payload as number[];
    const payloadUint8 = new Uint8Array(recordPayload);

    let payloadStr = '';
    const recordType = ndefRecord.type as number[];
    const typeStr = String.fromCharCode(...recordType);

    if (typeStr === 'U') {
      payloadStr = Ndef.uri.decodePayload(payloadUint8);
    } else if (typeStr === 'T') {
      payloadStr = Ndef.text.decodePayload(payloadUint8);
    } else {
      payloadStr = bytesToString(recordPayload);
    }

    console.log('[NFC] Raw Decoded Payload String:', payloadStr);

    // --- ROBUST INVOICE EXTRACTION ---
    let cleanInvoice = payloadStr.trim();

    // Check if it's wrapped in a BIP21 URI with a lightning parameter
    const lightningParamMatch = cleanInvoice.match(/[?&]lightning=([^&]+)/i);
    if (lightningParamMatch && lightningParamMatch[1]) {
      cleanInvoice = decodeURIComponent(lightningParamMatch[1]);
      console.log('[NFC] Extracted invoice from BIP21 lightning query parameter.');
    } else {
      // Otherwise, scan using a regex for BOLT11/BOLT12 signatures (lnbc, lntb, lnbcrt)
      const boltMatch = cleanInvoice.match(/ln(bc|tb|rt)[0-9a-z]+/i);
      if (boltMatch) {
        cleanInvoice = boltMatch[0];
        console.log('[NFC] Extracted invoice via BOLT regex pattern match.');
      } else {
        // Fallback cleanup if neither matched
        cleanInvoice = cleanInvoice
          .replace(/^[a-z]{2}/i, '') // strip language code (e.g., 'en')
          .replace(/^bitcoin:\??/i, '')
          .replace(/^lightning:/i, '')
          .trim();
      }
    }

    console.log('[NFC] Cleaned Invoice String (ready for SendScreen):', cleanInvoice);

    if (cleanInvoice) {
      return cleanInvoice;
    } else {
      throw new Error("Nothing found. The tag was read but had no payment data on it.");
    }

  } catch (ex: any) {
    console.warn('[NFC] Scan encountered an error or was cancelled:', ex);
    if (ex.toString() === 'Error' || ex.message === 'cancelled') {
      throw new NfcCancelledError();
    }
    throw ex;
  } finally {
    console.log('[NFC] Cleaning up NFC technology request...');
    NfcManager.cancelTechnologyRequest();
  }
};
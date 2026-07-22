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

export const isNfcSupported = async (): Promise<boolean> => {
    try {
        return await NfcManager.isSupported();
    } catch {
        return false;
    }
};

const ensureStarted = async (): Promise<boolean> => {
    if (nfcManagerStarted) return true;
    try {
        const supported = await NfcManager.isSupported();
        if (!supported) return false;
        await NfcManager.start();
        nfcManagerStarted = true;
        return true;
    } catch (e) {
        console.warn('NFC: failed to start NfcManager', e);
        return false;
    }
};

const decodeNdefRecord = (record: any): string | null => {
    try {
        const payload = new Uint8Array(record.payload);

        if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
            return Ndef.uri.decodePayload(payload);
        }
        if (Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_TEXT)) {
            return Ndef.text.decodePayload(payload);
        }

        // Unknown record type — best effort fallback
        try {
            return Ndef.uri.decodePayload(payload);
        } catch {
            return Ndef.text.decodePayload(payload);
        }
    } catch {
        return null;
    }
};

/**
 * Scans an NFC tag and returns the decoded string payload (e.g. a
 * BIP21 URI, a raw Lightning invoice, or an LNURL), or null if the
 * tag had no usable NDEF content.
 *
 * Throws NfcUnsupportedError if the device has no NFC, or
 * NfcCancelledError if the user backed out of the scan sheet.
 */
export const scanNfcTag = async (): Promise<string | null> => {
    const ready = await ensureStarted();
    if (!ready) {
        throw new NfcUnsupportedError();
    }

    try {
        await NfcManager.requestTechnology(NfcTech.Ndef, {
            alertMessage: 'Hold your phone near the tag',
        } as any);

        const tag = await NfcManager.getTag();

        if (!tag?.ndefMessage || tag.ndefMessage.length === 0) {
            return null;
        }

        for (const record of tag.ndefMessage) {
            const decoded = decodeNdefRecord(record);
            if (decoded) return decoded;
        }
        return null;
    } catch (ex: any) {
        const message = String(ex?.message ?? ex ?? '').toLowerCase();
        if (message.includes('cancel')) {
            throw new NfcCancelledError();
        }
        throw ex instanceof Error ? ex : new Error(message || 'NFC scan failed');
    } finally {
        try {
            await NfcManager.cancelTechnologyRequest();
        } catch {
            // session may already be closed — safe to ignore
        }
    }
};
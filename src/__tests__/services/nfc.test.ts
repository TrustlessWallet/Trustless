import { scanLightningInvoice, NfcCancelledError } from '../../services/nfc';
import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';

// Mock the entire react-native-nfc-manager library
jest.mock('react-native-nfc-manager', () => ({
    __esModule: true,
    default: {
        isSupported: jest.fn().mockResolvedValue(true),
        start: jest.fn().mockResolvedValue(undefined),
        requestTechnology: jest.fn().mockResolvedValue(undefined),
        cancelTechnologyRequest: jest.fn().mockResolvedValue(undefined),
        isoDepHandler: {
            transceive: jest.fn(),
        },
    },
    NfcTech: {
        IsoDep: 'isoDep',
    },
    Ndef: {
        decodeMessage: jest.fn(),
        uri: { decodePayload: jest.fn() },
        text: { decodePayload: jest.fn() },
    },
}));

describe('NFC Payload Parsing (scanLightningInvoice)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const setupMockNfcPayload = (payloadStr: string, type: 'U' | 'T' | 'raw' = 'U') => {
        let callCount = 0;

        (NfcManager.isoDepHandler.transceive as jest.Mock).mockImplementation(() => {
            callCount++;
            if (callCount === 1) return [0x90, 0x00];
            if (callCount === 2) return [0x90, 0x00];
            if (callCount === 3) return [0x00, 0x02, 0x90, 0x00];
            return [0x01, 0x02, 0x90, 0x00];
        });

        (Ndef.decodeMessage as jest.Mock).mockReturnValue([
            {
                type: type === 'U' ? [85] : type === 'T' ? [84] : [0],
                payload: [1, 2],
            },
        ]);

        if (type === 'U') {
            (Ndef.uri.decodePayload as jest.Mock).mockReturnValue(payloadStr);
        } else if (type === 'T') {
            (Ndef.text.decodePayload as jest.Mock).mockReturnValue(payloadStr);
        }
    };

    it('extracts a pure BOLT11 invoice', async () => {
        const bolt11 = 'lnbc100n1pjxyz12345';
        setupMockNfcPayload(bolt11);

        const result = await scanLightningInvoice();
        expect(result).toBe(bolt11);
    });

    it('extracts BOLT11 from a complex BIP21 URI', async () => {
        const bolt11 = 'lnbc500n1pjabc12345';
        const bip21 = `bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.00050000&lightning=${bolt11}`;
        setupMockNfcPayload(bip21);

        const result = await scanLightningInvoice();
        expect(result).toBe(bolt11);
    });

    it('extracts a raw LNURL (bech32 encoded)', async () => {
        const lnurl = 'LNURL1DP68GURN8GHJ7MRW9E6XJURN9UH8WETVDSKKKMN0WAHZ7MRWW4EXCUP0X9URQWZPV3J';
        setupMockNfcPayload(lnurl);

        const result = await scanLightningInvoice();
        expect(result).toBe(lnurl);
    });

    it('preserves LUD-17 lnurlp:// prefixes for the lnurl resolver', async () => {
        const lud17 = 'lnurlp://api.trustless.com/pay';
        setupMockNfcPayload(lud17);

        const result = await scanLightningInvoice();

        expect(result).toBe(lud17);
    });

    it('cleans up raw lightning addresses', async () => {
        const lnAddress = 'lightning:satoshi@trustless.com';
        setupMockNfcPayload(lnAddress);

        const result = await scanLightningInvoice();
        expect(result).toBe('satoshi@trustless.com');
    });

    it('throws an error if the NFC tag is completely empty (0 length)', async () => {
        let callCount = 0;
        (NfcManager.isoDepHandler.transceive as jest.Mock).mockImplementation(() => {
            callCount++;
            if (callCount === 3) return [0x00, 0x00, 0x90, 0x00]; // 0 length returned by APDU
            return [0x90, 0x00];
        });

        await expect(scanLightningInvoice()).rejects.toThrow(
            'Nothing found. The tag was read but had no payment data on it.'
        );
    });

    it('throws NfcCancelledError if the user cancels the iOS modal', async () => {
        // Mock a failure at the initial connection stage
        (NfcManager.requestTechnology as jest.Mock).mockRejectedValue(new Error('cancelled'));

        await expect(scanLightningInvoice()).rejects.toThrow(NfcCancelledError);
    });
});
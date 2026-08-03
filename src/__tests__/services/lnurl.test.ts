import { resolveLnurlOrAddress, fetchLnurlInvoice } from '../../services/lnurl';
import { bech32 } from 'bech32';

// Mock global fetch to prevent actual network calls during tests
global.fetch = jest.fn();

// Mock bech32 to easily test LNURL1... strings without computing valid checksums
jest.mock('bech32', () => ({
    bech32: {
        decode: jest.fn(),
        fromWords: jest.fn()
    }
}));

describe('LNURL Service (lnurl.ts)', () => {
    let originalConsoleError: typeof console.error;

    beforeAll(() => {
        // Silence console.error for expected failures to keep test output clean
        originalConsoleError = console.error;
        console.error = jest.fn();
    });

    afterAll(() => {
        // Restore console.error after tests finish
        console.error = originalConsoleError;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('resolveLnurlOrAddress', () => {
        it('resolves a Lightning Address (LUD-16) correctly', async () => {
            const mockResponse = { minSendable: 1000, maxSendable: 10000, callback: 'https://test.com/cb' };
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => mockResponse
            });

            const result = await resolveLnurlOrAddress('satoshi@trustless.com');

            // Asserts proper translation to .well-known endpoint
            expect(global.fetch).toHaveBeenCalledWith('https://trustless.com/.well-known/lnurlp/satoshi');
            expect(result).toEqual(mockResponse);
        });

        it('strips "lightning:" prefix and resolves Lightning Address', async () => {
            const mockResponse = { minSendable: 1000, maxSendable: 10000 };
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => mockResponse
            });

            const result = await resolveLnurlOrAddress('lightning:satoshi@trustless.com');

            expect(global.fetch).toHaveBeenCalledWith('https://trustless.com/.well-known/lnurlp/satoshi');
            expect(result).toEqual(mockResponse);
        });

        it('resolves a LUD-17 lnurlp:// URL correctly', async () => {
            const mockResponse = { minSendable: 1000 };
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => mockResponse
            });

            const result = await resolveLnurlOrAddress('lnurlp://api.trustless.com/pay');

            // Asserts proper translation to https
            expect(global.fetch).toHaveBeenCalledWith('https://api.trustless.com/pay');
            expect(result).toEqual(mockResponse);
        });

        it('resolves a standard Bech32 encoded LNURL correctly', async () => {
            const targetUrl = 'https://api.trustless.com/bech32-endpoint';
            const mockBytes = Array.from(targetUrl).map(c => c.charCodeAt(0));
            
            // Mock the bech32 decoding to return our target URL's byte array
            (bech32.decode as jest.Mock).mockReturnValue({ words: [] });
            (bech32.fromWords as jest.Mock).mockReturnValue(mockBytes);

            const mockResponse = { callback: 'https://test.com/cb' };
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => mockResponse
            });

            const result = await resolveLnurlOrAddress('lnurl1mockedstring');

            expect(bech32.decode).toHaveBeenCalledWith('lnurl1mockedstring', 2000);
            expect(global.fetch).toHaveBeenCalledWith(targetUrl);
            expect(result).toEqual(mockResponse);
        });

        it('returns null for unrecognised formats', async () => {
            const result = await resolveLnurlOrAddress('invalid_random_string');
            
            // Should fail safely before making network requests
            expect(global.fetch).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('throws an error bubbling up the provider reason if status is "ERROR"', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({ status: 'ERROR', reason: 'Account suspended' })
            });

            await expect(resolveLnurlOrAddress('satoshi@trustless.com')).rejects.toThrow('Account suspended');
            
            expect(console.error).toHaveBeenCalledWith(
                '[LNURL] Resolution failed:',
                expect.any(Error)
            );
        });

        it('throws on network failure instead of failing silently', async () => {
            (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network timeout'));

            await expect(resolveLnurlOrAddress('satoshi@trustless.com')).rejects.toThrow('Network timeout');

            expect(console.error).toHaveBeenCalledWith(
                '[LNURL] Resolution failed:',
                expect.any(Error)
            );
        });
    });

    describe('fetchLnurlInvoice', () => {
        it('appends amount query parameter with "?" if none exists', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({ pr: 'lnbc100mock' })
            });

            const result = await fetchLnurlInvoice('https://api.trustless.com/cb', 10000);

            // Assert exact URL construction
            expect(global.fetch).toHaveBeenCalledWith('https://api.trustless.com/cb?amount=10000');
            expect(result).toBe('lnbc100mock');
        });

        it('appends amount query parameter with "&" if query params already exist', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({ pr: 'lnbc100mock2' })
            });

            const result = await fetchLnurlInvoice('https://api.trustless.com/cb?user=123', 25000);

            // Assert exact URL construction
            expect(global.fetch).toHaveBeenCalledWith('https://api.trustless.com/cb?user=123&amount=25000');
            expect(result).toBe('lnbc100mock2');
        });

        it('throws an error bubbling up the provider reason if status is "ERROR"', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({ status: 'ERROR', reason: 'Amount too low' })
            });

            // Assert that the thrown error matches the provider's exact string
            await expect(fetchLnurlInvoice('https://api.trustless.com/cb', 10)).rejects.toThrow('Amount too low');
        });

        it('throws a default error if provider returns {"status": "ERROR"} without a specific reason', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                json: async () => ({ status: 'ERROR' }) 
            });

            await expect(fetchLnurlInvoice('https://api.trustless.com/cb', 10)).rejects.toThrow('Failed to fetch invoice from provider.');
        });
    });
});
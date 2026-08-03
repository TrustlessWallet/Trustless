import { bech32 } from 'bech32';

export const resolveLnurlOrAddress = async (input: string) => {
    let url = '';
    const cleanInput = input.trim().replace(/^lightning:/i, '');

    try {
        // 1. Lightning Address (e.g. username@domain.com)
        if (cleanInput.includes('@')) {
            const [username, domain] = cleanInput.split('@');
            url = `https://${domain}/.well-known/lnurlp/${username}`;
        }
        // 2. LUD-17 format (e.g. lnurlp://domain.com)
        else if (cleanInput.toLowerCase().startsWith('lnurlp://') || cleanInput.toLowerCase().startsWith('lnurlw://')) {
            url = cleanInput.replace(/^lnurl[pw]:\/\//i, 'https://');
        }
        // 3. Standard LNURL (bech32 encoded)
        else if (cleanInput.toLowerCase().startsWith('lnurl1')) {
            const decoded = bech32.decode(cleanInput, 2000);
            const bytes = bech32.fromWords(decoded.words);
            url = bytes.map(b => String.fromCharCode(b)).join('');
        } else {
            return null; // Not an LNURL or Lightning Address
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'ERROR') {
            throw new Error(data.reason || 'LNURL provider returned an error.');
        }

        return data; // Returns the LNURL metadata (minSendable, maxSendable, callback)
    } catch (e) {
        console.error('[LNURL] Resolution failed:', e);
        throw e;
    }
};

export const fetchLnurlInvoice = async (callback: string, amountMsat: number) => {
    const separator = callback.includes('?') ? '&' : '?';
    const response = await fetch(`${callback}${separator}amount=${amountMsat}`);
    const data = await response.json();

    if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Failed to fetch invoice from provider.');
    }

    return data.pr; // Returns the raw BOLT11 invoice
};
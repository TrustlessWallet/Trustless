import { bech32 } from 'bech32';

export const isLightningAddress = (input: string): boolean => {
    const clean = input.trim().replace(/^lightning:/i, '');
    const match = /^([A-Za-z0-9._+~-]+)@([A-Za-z0-9.-]+)$/.exec(clean);
    if (!match) return false;
    const domain = match[2];
    const labels = domain.split('.');
    if (labels.length < 2 || labels.some(label => !label || label.length > 63 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) return false;
    if (labels.every(label => /^\d+$/.test(label))) {
        return labels.length === 4 && labels.every(label => Number(label) <= 255);
    }
    return !/^\d+$/.test(labels[labels.length - 1]);
};

export const resolveLnurlOrAddress = async (input: string, options?: { signal?: AbortSignal }) => {
    let url = '';
    const cleanInput = input.trim().replace(/^lightning:/i, '');

    // 1. Lightning Address (e.g. username@domain.com)
    if (isLightningAddress(cleanInput)) {
        const [username, domain] = cleanInput.split('@');
        url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(username)}`;
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

    if (!/^https?:\/\//i.test(url) || !new URL(url).hostname) return null;
    const response = options?.signal
        ? await fetch(url, { signal: options.signal })
        : await fetch(url);
    const data = await response.json();

    if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL provider returned an error.');
    }

    return data; // Returns the LNURL metadata (minSendable, maxSendable, callback)
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

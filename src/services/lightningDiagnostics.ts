/** Keep claim failures without logging complete native payment/transfer records. */
export function summarizeLightningClaimLog(line: string): string | undefined {
    const start = line.search(/Failed to claim transfer |Giving up claiming transfer |Failed to check if transfer |Error claiming pending transfers on stream reconnection:|Failed to update balances before PaymentSucceeded event:|Error processing event:/);
    if (start < 0) return undefined;
    return line.slice(start)
        .replace(/(?:https?:\/\/|lnbc|lntb|lnbcrt|lno1|lnurl1)\S+/gi, '[redacted]')
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[transfer]')
        .replace(/\[(?:\s*\d+\s*,){3,}\s*\d*\s*\]/g, '[bytes]')
        .replace(/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[redacted]')
        .slice(0, 1600);
}

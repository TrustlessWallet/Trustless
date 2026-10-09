import { summarizeLightningClaimLog } from '../../services/lightningDiagnostics';

it('retains the native claim cause while removing transfer and key material', () => {
    const id = '0194c7a2-5e1b-7c3d-9f00-3a1b2c4d5e6f';
    const key = 'ab'.repeat(32);
    const result = summarizeLightningClaimLog(`WARN spark: Failed to claim transfer ${id}: invalid signature ${key}, bytes [1, 2, 3, 4]`);
    expect(result).toBe('Failed to claim transfer [transfer]: invalid signature [redacted], bytes [bytes]');
});

it('does not forward unrelated native payment records', () => {
    expect(summarizeLightningClaimLog('Received event: Transfer { secret: example }')).toBeUndefined();
});

it('retains retry exhaustion and redacts network URLs', () => {
    expect(summarizeLightningClaimLog('Giving up claiming transfer example after 5 attempts')).toContain('after 5 attempts');
    expect(summarizeLightningClaimLog('Error processing event: connection https://example.test/private')).toBe('Error processing event: connection [redacted]');
});

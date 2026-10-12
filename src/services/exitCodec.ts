import { Buffer } from 'buffer';
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'crypto';

// SDK records contain bigint values and tagged enums. Keep both intact across restarts.
export const encodeExit = (value: unknown): string => JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? { $sats: item.toString() } : item);
export const decodeExit = <T>(text: string): T => JSON.parse(text, (_key, item) => {
    if (item && typeof item === 'object' && Object.keys(item).length === 1 && '$sats' in item) {
        if (typeof item.$sats !== 'string' || !/^\d{1,20}$/.test(item.$sats)) throw new Error('Invalid recovery amount.');
        return BigInt(item.$sats);
    }
    return item;
});

export function encryptExit(text: string, key: Buffer): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: ciphertext.toString('base64') });
}
export function decryptExit(text: string, key: Buffer): string {
    const envelope = JSON.parse(text);
    if (envelope.v !== 1 || !/^[0-9a-f]{24}$/.test(envelope.iv) || !/^[0-9a-f]{32}$/.test(envelope.tag)) throw new Error('Invalid encrypted recovery data.');
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]).toString('utf8');
}
function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
    if (password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
    return new Promise((resolve, reject) => pbkdf2(password, salt, 210000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key)));
}
export async function exportExitBackup(value: unknown, password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await passwordKey(password, salt);
    try { return JSON.stringify({ format: 'trustless-exit-1', salt: salt.toString('hex'), payload: encryptExit(encodeExit(value), key) }); }
    finally { key.fill(0); }
}
export async function importExitBackup<T>(text: string, password: string): Promise<T> {
    if (text.length > 30 * 1024 * 1024) throw new Error('Recovery backup is too large.');
    const backup = JSON.parse(text);
    if (backup.format !== 'trustless-exit-1' || !/^[0-9a-f]{32}$/.test(backup.salt)) throw new Error('Unsupported recovery backup.');
    const key = await passwordKey(password, Buffer.from(backup.salt, 'hex'));
    try { return decodeExit<T>(decryptExit(backup.payload, key)); }
    catch { throw new Error('Incorrect backup password or damaged backup.'); }
    finally { key.fill(0); }
}

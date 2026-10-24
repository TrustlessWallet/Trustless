import * as Keychain from 'react-native-keychain';
import * as bip39 from 'bip39';

const legacyService = (id: string) => `com.btc.trustless.mnemonic.${id}`;
const secureService = (id: string) => `com.btc.trustless.mnemonic.v2.${id}`;
const deleted = new Set<string>();
const pending = new Map<string, Promise<false | { password: string }>>();
const options = (id: string) => ({
    service: secureService(id),
    accessible: Keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY ?? 'AccessibleWhenUnlockedThisDeviceOnly' as Keychain.ACCESSIBLE,
});

export function generateWalletMnemonic(strength: number = 128): string {
    const runtime = globalThis as typeof globalThis & { nativeCallSyncHook?: unknown; RN$Bridgeless?: boolean };
    // Match the polyfill's insecure remote-debugger branch and refuse to create funded-wallet material there.
    if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof runtime.nativeCallSyncHook === 'undefined' && !runtime.RN$Bridgeless) {
        throw new Error('Secure randomness is unavailable in this debugger. Create wallets on the device.');
    }
    if (![128, 160, 192, 224, 256].includes(strength)) throw new Error('Unsupported mnemonic entropy size.');
    return bip39.generateMnemonic(strength);
}

export function canonicalMnemonic(value: string): string {
    const phrase = value.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ');
    if (!bip39.validateMnemonic(phrase)) throw new Error('Invalid recovery phrase. Check its words and checksum.');
    return phrase;
}

export async function storeWalletMnemonic(id: string, mnemonic: string): Promise<void> {
    if (deleted.has(id)) throw new Error('This wallet was removed.');
    const phrase = canonicalMnemonic(mnemonic);
    const saved = await Keychain.setGenericPassword('user', phrase, options(id));
    if (!saved) throw new Error('Could not securely store the recovery phrase.');
    const verified = await Keychain.getGenericPassword({ service: secureService(id) });
    if (!verified || verified.password !== phrase) throw new Error('Could not verify recovery phrase storage.');
}

/** Copy, read back and only then remove legacy storage. Never erase the sole copy on failure. */
export function readWalletCredentials(id: string): Promise<false | { password: string }> {
    if (deleted.has(id)) return Promise.resolve(false);
    const existing = pending.get(id);
    if (existing) return existing;
    const task = (async () => {
        const secure = await Keychain.getGenericPassword({ service: secureService(id) });
        if (secure) {
            // Complete interrupted migrations rather than retaining a weaker duplicate forever.
            const legacy = await Keychain.getGenericPassword({ service: legacyService(id) });
            if (legacy) {
                if (legacy.password !== secure.password) throw new Error('Recovery phrase copies disagree. Restore from your backup before continuing.');
                if (!await Keychain.resetGenericPassword({ service: legacyService(id) })) throw new Error('Could not finish recovery phrase protection.');
            }
            return { password: secure.password };
        }
        const legacy = await Keychain.getGenericPassword({ service: legacyService(id) });
        if (!legacy) return false as const;
        const written = await Keychain.setGenericPassword('user', legacy.password, options(id));
        if (!written) throw new Error('Could not upgrade recovery phrase protection.');
        const verified = await Keychain.getGenericPassword({ service: secureService(id) });
        if (!verified || verified.password !== legacy.password) throw new Error('Could not verify protected recovery phrase.');
        if (!await Keychain.resetGenericPassword({ service: legacyService(id) })) throw new Error('Could not finish recovery phrase protection.');
        return { password: verified.password };
    })();
    pending.set(id, task);
    void task.finally(() => { if (pending.get(id) === task) pending.delete(id); }).catch(() => {});
    return task;
}

export async function deleteWalletMnemonic(id: string): Promise<void> {
    deleted.add(id);
    // Finish a migration before removing either copy, so it cannot recreate a deleted wallet secret.
    const task = pending.get(id);
    if (task) await task.catch(() => {});
    await Keychain.resetGenericPassword({ service: secureService(id) });
    await Keychain.resetGenericPassword({ service: legacyService(id) });
}

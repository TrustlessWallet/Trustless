import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { generateWalletMnemonic, readWalletCredentials, storeWalletMnemonic } from './walletSecrets';

type Journal = { version: 1; state: 'started' | 'completed' | 'used'; walletId?: string } |
    { version: 2; installationId: string; state: 'started' | 'completed' | 'used'; walletId?: string };
const INSTALLATION_ID_KEY = '@trustlessInstallationId';
const journalService = (network: string) => `com.btc.trustless.firstLaunchWallet.${network}`;
const backupKey = (network: string, walletId: string) => `@walletBackupStatus.${network}.${walletId}`;
const journalOptions = (network: string) => ({
    service: journalService(network),
    accessible: Keychain.ACCESSIBLE?.WHEN_UNLOCKED_THIS_DEVICE_ONLY ?? 'AccessibleWhenUnlockedThisDeviceOnly' as Keychain.ACCESSIBLE,
});

async function readJournal(network: string): Promise<Journal | null> {
    const stored = await Keychain.getGenericPassword({ service: journalService(network) });
    if (!stored) return null;
    const value = JSON.parse(stored.password) as Journal;
    if ((value.version !== 1 && (value.version !== 2 || !value.installationId)) ||
        !['started', 'completed', 'used'].includes(value.state) ||
        (value.state === 'started' && !value.walletId)) {
        throw new Error('First-launch wallet journal is invalid.');
    }
    return value;
}

async function installationId(newId: () => string): Promise<string> {
    const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
    if (existing) return existing;
    const id = newId();
    await AsyncStorage.setItem(INSTALLATION_ID_KEY, id);
    if (await AsyncStorage.getItem(INSTALLATION_ID_KEY) !== id) throw new Error('Could not verify app installation state.');
    return id;
}

async function writeJournal(network: string, value: Journal): Promise<void> {
    const serialized = JSON.stringify(value);
    if (!await Keychain.setGenericPassword('user', serialized, journalOptions(network))) {
        throw new Error('Could not record first-launch wallet state.');
    }
    const verified = await Keychain.getGenericPassword({ service: journalService(network) });
    if (!verified || verified.password !== serialized) throw new Error('Could not verify first-launch wallet state.');
}

/** Claim a fixed ID before creating any secret. A failed eligibility read never creates a wallet. */
export async function claimFirstLaunchWallet(network: string, activeWalletService: string, newId: () => string): Promise<string | null> {
    const install = await installationId(newId);
    const journal = await readJournal(network);
    if (journal?.version === 2 && journal.installationId === install) {
        return journal.state === 'started' ? journal.walletId! : null;
    }
    // A v1 setup interrupted before this migration still owns its protected phrase.
    if (journal?.version === 1 && journal.state === 'started') {
        await writeJournal(network, { ...journal, version: 2, installationId: install });
        return journal.walletId!;
    }
    // A v1 journal has no installation ID. If onboarding state remains, it
    // belongs to this install. Reset App removes that state, so a fully erased
    // legacy install cannot be distinguished from a reinstall.
    if (journal?.version === 1 && await AsyncStorage.getItem('@hasCompletedOnboarding') !== null) {
        await writeJournal(network, { ...journal, version: 2, installationId: install });
        return null;
    }
    if (await AsyncStorage.getItem('@hasCompletedOnboarding') !== null) return null;
    const priorInstallation = journal !== null && (journal.version === 1 || journal.installationId !== install);
    if (!priorInstallation && await Keychain.getGenericPassword({ service: activeWalletService })) {
        throw new Error('An active wallet reference exists without its wallet record. Restore the wallet or retry.');
    }
    if (!priorInstallation) {
        const services = await Keychain.getAllGenericPasswordServices();
        if (services.some(service => service.startsWith('com.btc.trustless.mnemonic.') ||
            service.startsWith('com.btc.trustless.firstLaunchWallet.') ||
            service.startsWith('com.btc.trustless.activeWalletId.'))) {
            throw new Error('Existing protected wallet data was found. Restore the wallet instead of creating another.');
        }
    }
    const walletId = newId();
    await writeJournal(network, { version: 2, installationId: install, state: 'started', walletId });
    return walletId;
}

export async function firstLaunchMnemonic(walletId: string): Promise<string> {
    const existing = await readWalletCredentials(walletId);
    if (existing) return existing.password;
    const mnemonic = generateWalletMnemonic();
    await storeWalletMnemonic(walletId, mnemonic);
    return mnemonic;
}

export async function markFirstLaunchUsed(network: string, existingWalletId: string | undefined, newId: () => string): Promise<void> {
    const install = await installationId(newId);
    const journal = await readJournal(network);
    if (journal?.version === 2 && journal.installationId === install &&
        (journal.state === 'completed' || journal.state === 'used')) return;
    if (journal?.state === 'started' && journal.walletId === existingWalletId) {
        await writeJournal(network, { version: 2, installationId: install, state: 'completed', walletId: existingWalletId });
        return;
    }
    await writeJournal(network, { version: 2, installationId: install, state: 'used' });
}

export async function markFirstLaunchCompleted(network: string, walletId: string): Promise<void> {
    const install = await installationId(() => { throw new Error('App installation state is missing.'); });
    const journal = await readJournal(network);
    if (!journal || journal.version !== 2 || journal.installationId !== install ||
        journal.state !== 'started' || journal.walletId !== walletId) {
        throw new Error('First-launch wallet journal changed.');
    }
    await writeJournal(network, { ...journal, state: 'completed' });
}

export async function setBackupPending(network: string, walletId: string): Promise<void> {
    await AsyncStorage.setItem(backupKey(network, walletId), 'pending');
}

export async function isBackupPending(network: string, walletId: string): Promise<boolean> {
    const journal = await readJournal(network);
    if (!journal || journal.state === 'used' || journal.walletId !== walletId) return false;
    return await AsyncStorage.getItem(backupKey(network, walletId)) !== 'confirmed';
}

export async function confirmWalletBackup(network: string, walletId: string): Promise<void> {
    await AsyncStorage.setItem(backupKey(network, walletId), 'confirmed');
}

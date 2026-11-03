import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { claimFirstLaunchWallet, confirmWalletBackup, firstLaunchMnemonic, isBackupPending, markFirstLaunchCompleted, markFirstLaunchUsed, setBackupPending } from '../../services/firstLaunchWallet';
import { generateWalletMnemonic, readWalletCredentials, storeWalletMnemonic } from '../../services/walletSecrets';

jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn(), setGenericPassword: jest.fn(), getAllGenericPasswordServices: jest.fn(), ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' } }));
jest.mock('../../services/walletSecrets', () => ({ generateWalletMnemonic: jest.fn(), readWalletCredentials: jest.fn(), storeWalletMnemonic: jest.fn() }));

const records = new Map<string, string>();
const preferences = new Map<string, string>();
const firstId = jest.fn(() => 'fixed-wallet-id');

beforeEach(() => {
    records.clear(); preferences.clear(); jest.clearAllMocks();
    (Keychain.getGenericPassword as jest.Mock).mockImplementation(async ({ service }) =>
        records.has(service) ? { password: records.get(service) } : false);
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(async (_user, password, { service }) => { records.set(service, password); return true; });
    (Keychain.getAllGenericPasswordServices as jest.Mock).mockImplementation(async () => [...records.keys()]);
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async key => preferences.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key, value) => { preferences.set(key, value); });
    (readWalletCredentials as jest.Mock).mockResolvedValue(false);
    (generateWalletMnemonic as jest.Mock).mockReturnValue('generated-phrase');
    (storeWalletMnemonic as jest.Mock).mockResolvedValue(undefined);
});

it('keeps a fixed ID and the existing protected phrase across an interrupted first launch', async () => {
    expect(await claimFirstLaunchWallet('Bitcoin', 'com.btc.trustless.activeWalletId.Bitcoin', firstId)).toBe('fixed-wallet-id');
    expect(await firstLaunchMnemonic('fixed-wallet-id')).toBe('generated-phrase');
    (readWalletCredentials as jest.Mock).mockResolvedValue({ password: 'generated-phrase' });
    expect(await claimFirstLaunchWallet('Bitcoin', 'com.btc.trustless.activeWalletId.Bitcoin', firstId)).toBe('fixed-wallet-id');
    expect(await firstLaunchMnemonic('fixed-wallet-id')).toBe('generated-phrase');
    expect(firstId).toHaveBeenCalledTimes(1);
    expect(generateWalletMnemonic).toHaveBeenCalledTimes(1);
    expect(storeWalletMnemonic).toHaveBeenCalledTimes(1);
    await setBackupPending('Bitcoin', 'fixed-wallet-id');
    await markFirstLaunchCompleted('Bitcoin', 'fixed-wallet-id');
    expect(await claimFirstLaunchWallet('Bitcoin', 'com.btc.trustless.activeWalletId.Bitcoin', firstId)).toBeNull();
});

it('suppresses creation after previous use, onboarding, or residual credentials', async () => {
    await markFirstLaunchUsed('Bitcoin');
    expect(await claimFirstLaunchWallet('Bitcoin', 'active', firstId)).toBeNull();
    records.clear(); preferences.set('@hasCompletedOnboarding', 'true');
    expect(await claimFirstLaunchWallet('Bitcoin', 'active', firstId)).toBeNull();
    preferences.clear(); records.set('com.btc.trustless.mnemonic.v2.orphan', 'secret');
    await expect(claimFirstLaunchWallet('Bitcoin', 'active', firstId)).rejects.toThrow('Existing protected wallet data');
    expect(firstId).not.toHaveBeenCalled();
});

it('acknowledges only the selected wallet backup', async () => {
    await setBackupPending('Bitcoin', 'first');
    await setBackupPending('Bitcoin', 'second');
    await confirmWalletBackup('Bitcoin', 'first');
    expect(await isBackupPending('Bitcoin', 'first')).toBe(false);
    expect(await isBackupPending('Bitcoin', 'second')).toBe(true);
    expect(await isBackupPending('Bitcoin-testnet', 'first')).toBe(true);
});

it('does not create a second wallet after a journal write or read-back failure', async () => {
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValueOnce(false);
    await expect(claimFirstLaunchWallet('Bitcoin', 'active', firstId)).rejects.toThrow('Could not record');
    expect(await isBackupPending('Bitcoin', 'unrelated')).toBe(true);
    expect(await claimFirstLaunchWallet('Bitcoin', 'active', firstId)).toBe('fixed-wallet-id');
});

it('never replaces an already stored first-launch phrase', async () => {
    await claimFirstLaunchWallet('Bitcoin', 'active', firstId);
    (readWalletCredentials as jest.Mock).mockResolvedValue({ password: 'previously-stored-phrase' });
    expect(await firstLaunchMnemonic('fixed-wallet-id')).toBe('previously-stored-phrase');
    expect(generateWalletMnemonic).not.toHaveBeenCalled();
    expect(storeWalletMnemonic).not.toHaveBeenCalled();
});

it('allows an imported standard wallet to acknowledge its missing backup marker', async () => {
    expect(await isBackupPending('Bitcoin', 'imported-wallet')).toBe(true);
    await confirmWalletBackup('Bitcoin', 'imported-wallet');
    expect(await isBackupPending('Bitcoin', 'imported-wallet')).toBe(false);
});

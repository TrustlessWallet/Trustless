import * as Keychain from 'react-native-keychain';
import { canonicalMnemonic, generateWalletMnemonic, storeWalletMnemonic, readWalletCredentials, deleteWalletMnemonic } from '../../services/walletSecrets';

jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn(), setGenericPassword: jest.fn(), resetGenericPassword: jest.fn(), ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' } }));
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const legacy = 'com.btc.trustless.mnemonic.wallet';
const secure = 'com.btc.trustless.mnemonic.v2.wallet';
let records: Map<string, string>;
beforeEach(() => {
  jest.resetAllMocks();
  records = new Map();
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(async ({ service }) => records.has(service) ? { password: records.get(service) } : false);
  (Keychain.setGenericPassword as jest.Mock).mockImplementation(async (_user, value, { service }) => { records.set(service, value); return true; });
  (Keychain.resetGenericPassword as jest.Mock).mockImplementation(async ({ service }) => { records.delete(service); return true; });
});

it('validates and canonicalizes a new mnemonic before any storage', async () => {
  expect(canonicalMnemonic('  '+phrase.toUpperCase().replace(/ /g, '\n  ')+' ')).toBe(phrase);
  await expect(storeWalletMnemonic('wallet', 'abandon '.repeat(12))).rejects.toThrow('Invalid recovery phrase');
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  await storeWalletMnemonic('wallet', phrase);
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith('user', phrase, { service: secure, accessible: 'device-only' });
});

it('migrates only after verifying the protected copy and coalesces concurrent reads', async () => {
  records.set(legacy, phrase);
  const values = await Promise.all([readWalletCredentials('wallet'), readWalletCredentials('wallet')]);
  expect(values).toEqual([{ password: phrase }, { password: phrase }]);
  expect(records.get(secure)).toBe(phrase);
  expect(records.has(legacy)).toBe(false);
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: legacy });
});

it('does not erase legacy storage if writing the protected copy fails', async () => {
  records.set(legacy, phrase);
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(false);
  await expect(readWalletCredentials('wallet')).rejects.toThrow('Could not upgrade');
  expect(records.get(legacy)).toBe(phrase);
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});

it('does not erase legacy storage if read-back verification fails', async () => {
  records.set(legacy, phrase);
  (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  await expect(readWalletCredentials('wallet')).rejects.toThrow('Could not verify');
  expect(records.get(legacy)).toBe(phrase);
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});

it('removes both copies only when explicitly deleting the wallet', async () => {
  records.set(legacy, phrase); records.set(secure, phrase);
  records.set('com.btc.trustless.mnemonic.delete-test', phrase); records.set('com.btc.trustless.mnemonic.v2.delete-test', phrase);
  records.delete(legacy); records.delete(secure);
  await deleteWalletMnemonic('delete-test');
  expect(records.size).toBe(0);
  expect(await readWalletCredentials('delete-test')).toBe(false);
});

it('finishes an interrupted migration and refuses to discard conflicting copies', async () => {
  records.set(legacy, phrase); records.set(secure, phrase);
  expect(await readWalletCredentials('wallet')).toEqual({ password: phrase });
  expect(records.has(legacy)).toBe(false);
  records.set(legacy, 'different phrase');
  await expect(readWalletCredentials('wallet')).rejects.toThrow('copies disagree');
  expect(records.get(legacy)).toBe('different phrase');
  expect(records.get(secure)).toBe(phrase);
});

it('refuses mnemonic generation in the polyfill remote-debugger fallback configuration', () => {
  const runtime = globalThis as any;
  const sync = runtime.nativeCallSyncHook;
  const bridge = runtime.RN$Bridgeless;
  try {
    runtime.nativeCallSyncHook = undefined; runtime.RN$Bridgeless = false;
    expect(() => generateWalletMnemonic(128)).toThrow('Secure randomness is unavailable');
  } finally { runtime.nativeCallSyncHook = sync; runtime.RN$Bridgeless = bridge; }
});

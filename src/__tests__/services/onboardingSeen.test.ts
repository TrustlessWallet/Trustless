import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { finishOnboarding, ONBOARDING_SEEN_KEY, restoreOnboardingSeen } from '../../services/onboardingSeen';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(async () => true),
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
});

it('only offers onboarding on a fresh device with no wallets', async () => {
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBeNull();
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
});

it('repairs the missing flag for an existing wallet on any network', async () => {
  await restoreOnboardingSeen(async () => true);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('true');
});

it('restores a completed device preference even when local storage is erased', async () => {
  (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({ username: 'onboarding', password: 'seen' });
  const hasWallet = jest.fn(async () => false);
  await restoreOnboardingSeen(hasWallet);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('true');
  expect(hasWallet).not.toHaveBeenCalled();
});

it('keeps a saved first-wallet handoff retryable on relaunch', async () => {
  await finishOnboarding();
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('wallet-pending');
});

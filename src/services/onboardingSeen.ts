import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

export const ONBOARDING_SEEN_KEY = '@hasCompletedOnboarding';
const service = 'com.btc.trustless.onboardingSeen';

async function rememberOnDevice() {
  try {
    if (await Keychain.getGenericPassword({ service })) return;
    await Keychain.setGenericPassword('onboarding', 'seen', {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    console.warn('Could not back up the onboarding preference:', error);
  }
}

/** Repair older installs that already have wallet data or lost their local preference. */
export async function restoreOnboardingSeen(hasWallet: () => Promise<boolean>) {
  if (await AsyncStorage.getItem(ONBOARDING_SEEN_KEY) !== null) {
    void rememberOnDevice();
    return;
  }
  const remembered = await Keychain.getGenericPassword({ service }).catch(() => false);
  if (remembered || await hasWallet()) {
    await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
    if (!remembered) void rememberOnDevice();
  }
}

export async function finishOnboarding() {
  // Keep first-wallet creation retryable if the process exits after this write.
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'wallet-pending');
  void rememberOnDevice();
}

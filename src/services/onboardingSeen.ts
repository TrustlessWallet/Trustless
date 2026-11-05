import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_SEEN_KEY = '@hasCompletedOnboarding';
// Distinguishes completion on this install from the old device-wide flag.
export const ONBOARDING_INSTALL_KEY = '@onboardingCompletedInInstall';

export async function restoreOnboardingSeen(hasWallet: () => Promise<boolean>) {
  const seen = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
  const completedHere = await AsyncStorage.getItem(ONBOARDING_INSTALL_KEY);
  if (completedHere === 'true' && seen !== null) return;

  if (seen === 'wallet-pending' || completedHere === 'true' || await hasWallet()) {
    await AsyncStorage.multiSet([
      [ONBOARDING_SEEN_KEY, seen === 'wallet-pending' ? seen : 'true'],
      [ONBOARDING_INSTALL_KEY, 'true'],
    ]);
  } else if (seen !== null) {
    // Older builds could copy the previous install's Keychain flag into an empty install.
    await AsyncStorage.removeItem(ONBOARDING_SEEN_KEY);
  }
}

export async function finishOnboarding() {
  // Keep first-wallet creation retryable if the process exits after this write.
  await AsyncStorage.multiSet([
    [ONBOARDING_SEEN_KEY, 'wallet-pending'],
    [ONBOARDING_INSTALL_KEY, 'true'],
  ]);
}

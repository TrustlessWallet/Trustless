import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_SEEN_KEY = '@hasCompletedOnboarding';
// Distinguishes completion on this install from the old device-wide flag.
export const ONBOARDING_INSTALL_KEY = '@onboardingCompletedInInstall';

export async function restoreOnboardingSeen(hasWallet: () => Promise<boolean>) {
  const seen = await AsyncStorage.getItem(ONBOARDING_SEEN_KEY);
  const completedHere = await AsyncStorage.getItem(ONBOARDING_INSTALL_KEY);
  if (completedHere === 'true' && seen !== null) return;
  // A wallet prepared during an unfinished tutorial does not count as completion.
  if (completedHere === 'preparing' && seen === null) return;

  if (seen === 'wallet-pending' || completedHere === 'true' || await hasWallet()) {
    await AsyncStorage.multiSet([
      [ONBOARDING_SEEN_KEY, seen === 'wallet-pending' ? seen : 'true'],
      [ONBOARDING_INSTALL_KEY, 'true'],
    ]);
  } else {
    // Older builds could copy the previous install's Keychain flag into an empty install.
    if (seen !== null) await AsyncStorage.removeItem(ONBOARDING_SEEN_KEY);
    await AsyncStorage.setItem(ONBOARDING_INSTALL_KEY, 'preparing');
  }
}

export async function finishOnboarding(walletReady = false) {
  // Keep first-wallet creation retryable if the process exits after this write.
  await AsyncStorage.multiSet([
    [ONBOARDING_SEEN_KEY, walletReady ? 'true' : 'wallet-pending'],
    [ONBOARDING_INSTALL_KEY, 'true'],
  ]);
}

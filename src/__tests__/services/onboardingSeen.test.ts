import AsyncStorage from '@react-native-async-storage/async-storage';
import { finishOnboarding, ONBOARDING_INSTALL_KEY, ONBOARDING_SEEN_KEY, restoreOnboardingSeen } from '../../services/onboardingSeen';

beforeEach(async () => { await AsyncStorage.clear(); });

it('offers onboarding when reinstalling leaves app storage and the wallet database empty', async () => {
  await finishOnboarding();
  await AsyncStorage.clear();
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBeNull();
});

it('repairs a legacy completion flag copied into an empty reinstall', async () => {
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBeNull();
});

it('migrates an existing wallet on any network even if the local flag is missing', async () => {
  await restoreOnboardingSeen(async () => true);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('true');
  expect(await AsyncStorage.getItem(ONBOARDING_INSTALL_KEY)).toBe('true');
});

it('keeps completion after wallet reset within this install', async () => {
  await finishOnboarding();
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('true');
});

it('keeps a saved first-wallet handoff retryable on relaunch', async () => {
  await finishOnboarding();
  await restoreOnboardingSeen(async () => false);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBe('wallet-pending');
});

it('resumes an unfinished tutorial even if its wallet was already prepared', async () => {
  await restoreOnboardingSeen(async () => false);
  await restoreOnboardingSeen(async () => true);
  expect(await AsyncStorage.getItem(ONBOARDING_SEEN_KEY)).toBeNull();
});

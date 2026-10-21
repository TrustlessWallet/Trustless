import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { authenticate_terminal_cashier, authenticate_terminal_refund, get_biometric_prompt_shown, is_tx_biometrics_enabled, set_biometric_prompt_shown, TX_BIOMETRIC_CONFIRM_KEY } from '../../services/authState';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  ACCESS_CONTROL: { BIOMETRY_ANY_OR_DEVICE_PASSCODE: 'BIOMETRY_ANY_OR_DEVICE_PASSCODE' },
}));

const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';

describe('is_tx_biometrics_enabled', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
  });

  it('is off when the master "Enable Biometrics" setting was never turned on, even if the hardware is enrolled', async () => {
    // Simulates a fresh install: hardware present + enrolled, but the user
    // never flipped "Enable Biometrics" on in Settings, so neither key has
    // been written yet.
    expect(await is_tx_biometrics_enabled()).toBe(false);
  });

  it('is off when the master toggle is explicitly disabled', async () => {
    await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'false');
    expect(await is_tx_biometrics_enabled()).toBe(false);
  });

  it('defaults to on for transactions once the master toggle is enabled', async () => {
    await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'true');
    expect(await is_tx_biometrics_enabled()).toBe(true);
  });

  it('respects the per-transaction sub-setting once the master toggle is enabled', async () => {
    await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'true');
    await AsyncStorage.setItem(TX_BIOMETRIC_CONFIRM_KEY, 'false');
    expect(await is_tx_biometrics_enabled()).toBe(false);
  });

  it('is off when no biometric hardware is enrolled, regardless of settings', async () => {
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
    await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'true');
    expect(await is_tx_biometrics_enabled()).toBe(false);
  });
});

describe('authenticate_terminal_refund', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });
  it('does not clear the privacy guard of a subsequent authentication prompt', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
    await authenticate_terminal_refund();
    set_biometric_prompt_shown(true);
    jest.advanceTimersByTime(1500);
    expect(get_biometric_prompt_shown()).toBe(true);
    set_biometric_prompt_shown(false);
  });
  it('prompts even when ordinary transaction biometrics are disabled', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    expect(await authenticate_terminal_refund()).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
      promptMessage: 'Authorize refund', cancelLabel: 'Cancel', fallbackLabel: 'Use Passcode', disableDeviceFallback: false,
    });
  });

  it('rejects cancellation and local authentication errors', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false });
    expect(await authenticate_terminal_refund()).toBe(false);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    expect(await authenticate_terminal_refund()).toBe(false);
    expect(get_biometric_prompt_shown()).toBe(true);
    jest.advanceTimersByTime(1500);
    expect(get_biometric_prompt_shown()).toBe(false);
  });
});

describe('authenticate_terminal_cashier', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });
  it('requires fresh local auth with passcode fallback even when optional biometrics are off', async () => {
    await AsyncStorage.setItem(BIOMETRICS_ENABLED_KEY, 'false');
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: true });
    expect(await authenticate_terminal_cashier('Unlock cashier mode')).toBe(true);
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({
      promptMessage: 'Unlock cashier mode', cancelLabel: 'Cancel', fallbackLabel: 'Use Passcode', disableDeviceFallback: false,
    });
    jest.advanceTimersByTime(1500);
    expect(get_biometric_prompt_shown()).toBe(false);
  });
  it('does not let an older prompt clear a newer privacy guard', async () => {
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    expect(await authenticate_terminal_cashier('Enable cashier mode')).toBe(false);
    set_biometric_prompt_shown(true);
    jest.advanceTimersByTime(1500);
    expect(get_biometric_prompt_shown()).toBe(true);
    set_biometric_prompt_shown(false);
  });
  it('returns quietly for cancellation but reports unavailable or failed owner auth', async () => {
    for (const error of ['app_cancel', 'system_cancel']) {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error });
      expect(await authenticate_terminal_cashier('Unlock cashier mode')).toBe(false);
    }
    for (const error of ['not_available', 'not_enrolled', 'lockout', 'authentication_failed']) {
      (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValueOnce({ success: false, error });
      await expect(authenticate_terminal_cashier('Unlock cashier mode')).rejects.toThrow(error);
    }
    (LocalAuthentication.authenticateAsync as jest.Mock).mockRejectedValueOnce(new Error('native unavailable'));
    await expect(authenticate_terminal_cashier('Unlock cashier mode')).rejects.toThrow('native unavailable');
  });
});

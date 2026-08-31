import * as keychain from 'react-native-keychain';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';

let is_biometric_prompt_shown = false;
let is_backup_flow_active = false;

export const TX_BIOMETRIC_CONFIRM_KEY = '@require_biometric_tx_confirm';

export const authenticate_session = async (): Promise<boolean> => {
  try {
    const credentials = await keychain.getGenericPassword({
      authenticationPrompt: { title: 'Authenticate to unlock wallet' },
    });

    if (credentials) {
      return true;
    }

    const fallback_auth = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to upgrade session security',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
    });

    if (fallback_auth.success) {
      await keychain.setGenericPassword('wallet_session', 'encrypted_token_placeholder', {
        accessControl: keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
      });
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
};

export const set_biometric_prompt_shown = (value: boolean) => {
  is_biometric_prompt_shown = value;
};

export const get_biometric_prompt_shown = () => {
  return is_biometric_prompt_shown || is_backup_flow_active;
};

export const set_backup_flow_active = (value: boolean) => {
  is_backup_flow_active = value;
};

export const is_tx_biometrics_enabled = async (): Promise<boolean> => {
  const isBiometricAvailable = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (!isBiometricAvailable || !isEnrolled) return false;

  const pref = await AsyncStorage.getItem(TX_BIOMETRIC_CONFIRM_KEY);
  return pref === null ? true : pref === 'true';
};

export const set_tx_biometrics_enabled = async (enabled: boolean): Promise<void> => {
  await AsyncStorage.setItem(TX_BIOMETRIC_CONFIRM_KEY, enabled ? 'true' : 'false');
};

export const authenticate_transaction_action = async (
  promptMessage: string = 'Confirm transaction'
): Promise<boolean> => {
  const isRequired = await is_tx_biometrics_enabled();
  if (!isRequired) return true;

  set_biometric_prompt_shown(true);

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch (error) {
    console.error('Transaction biometric auth failed:', error);
    return false;
  }
};
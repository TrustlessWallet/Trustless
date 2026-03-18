import * as keychain from 'react-native-keychain';
import * as LocalAuthentication from 'expo-local-authentication';

let is_biometric_prompt_shown = false;
let is_backup_flow_active = false;

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
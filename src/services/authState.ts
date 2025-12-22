let isSessionAuthenticated = false;
let isBiometricPromptShown = false;

export const setAppIsAuthenticated = (value: boolean) => {
  isSessionAuthenticated = value;
};

export const getAppIsAuthenticated = () => {
  return isSessionAuthenticated;
};

export const setBiometricPromptShown = (value: boolean) => {
  isBiometricPromptShown = value;
};

export const getBiometricPromptShown = () => {
  return isBiometricPromptShown;
};
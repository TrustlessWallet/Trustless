import React, { useEffect, useState } from 'react';
import { AppState, View, Image } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { get_is_nfc_scanning } from '../services/nfc';
import { get_biometric_prompt_shown, set_biometric_prompt_shown } from '../services/authState';

export default function PrivacySwitcherOverlay({ isBooting }: { isBooting: boolean }) {
  const { isDark } = useTheme();
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const subscription = AppState.addEventListener('change', nextAppState => {
      setAppState(nextAppState);

      if (nextAppState === 'active') {
        // Delay resetting the biometric flag. 
        // Lightning network initialization requests the keychain immediately after the initial unlock, 
        // which causes the app to briefly dip into the 'inactive' state. 
        // Keeping this true for a brief window prevents the privacy screen from flashing.
        timer = setTimeout(() => {
          set_biometric_prompt_shown(false);
        }, 1500);
      } else {
        // Clear the timeout if the app goes inactive again so it doesn't reset prematurely
        if (timer) clearTimeout(timer);
      }
    });

    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // A real background transition must always hide the current screen,
  // including a recovery phrase or QR code while a system prompt is pending.
  if (appState === 'active' || (appState !== 'background' && (get_is_nfc_scanning() || get_biometric_prompt_shown())) || isBooting) return null;

  const splashBg = isDark ? '#000000' : '#ffffff';
  const splashIcon = isDark
    ? require('../../assets/splash-icon-black.png')
    : require('../../assets/splash-icon-white.png');

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: splashBg, zIndex: 99999 }}>
      <Image
        source={splashIcon}
        style={{ height: '100%', width: '100%', resizeMode: 'cover' }}
        fadeDuration={0}
      />
    </View>
  );
}

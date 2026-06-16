import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, LogBox, View, Image, Text, TextInput, Animated, AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation/AppNavigator';
import { WalletProvider } from './src/contexts/WalletContext';
import { ThemeProvider, useTheme } from './src/contexts/ThemeContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setNetwork, onNetworkChange } from './src/constants/network';
import {
  useFonts,
  SpaceMono_400Regular,
  SpaceMono_400Regular_Italic,
  SpaceMono_700Bold,
  SpaceMono_700Bold_Italic,
} from '@expo-google-fonts/space-mono';
import * as Font from 'expo-font';
import { Feather } from '@expo/vector-icons';
import 'react-native-get-random-values';

import './shim';

import { registerRootComponent } from 'expo';
import { initDatabase } from './src/services/database';

interface TextWithDefaultProps extends Text { defaultProps?: { allowFontScaling?: boolean }; }
interface TextInputWithDefaultProps extends TextInput { defaultProps?: { allowFontScaling?: boolean }; }

((Text as unknown) as TextWithDefaultProps).defaultProps = ((Text as unknown) as TextWithDefaultProps).defaultProps || {};
((Text as unknown) as TextWithDefaultProps).defaultProps!.allowFontScaling = false;

((TextInput as unknown) as TextInputWithDefaultProps).defaultProps = ((TextInput as unknown) as TextInputWithDefaultProps).defaultProps || {};
((TextInput as unknown) as TextInputWithDefaultProps).defaultProps!.allowFontScaling = false;

LogBox.ignoreLogs(['Setting a timer', 'AsyncStorage has been extracted']);

const queryClient = new QueryClient();
const NETWORK_PREF_KEY = '@network_preference';
const THEME_PREF_KEY = '@app_theme_preference';

const ThemedStatusBar = () => {
  const { isDark, theme } = useTheme();
  return (
    <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={isDark ? '#000000' : theme.colors.background} />
  );
};

// Renders the correct splash screen dynamically when the user swipes up to the app switcher
const PrivacySwitcherOverlay = () => {
  const { isDark } = useTheme();
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      setAppState(nextAppState);
    });
    return () => subscription.remove();
  }, []);

  // If the app is active and being used, hide the overlay
  if (appState === 'active') return null;

  const splashBg = isDark ? '#000000' : '#ffffff';
  const splashIcon = isDark
    ? require('./assets/splash-icon-black.png')
    : require('./assets/splash-icon-white.png');

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: splashBg, zIndex: 99999 }}>
      <Image 
        source={splashIcon} 
        style={{ height: '100%', width: '100%', resizeMode: 'cover' }} 
        fadeDuration={0} // Prevent image fade-in blink
      />
    </View>
  );
};

export default function App() {
  const [isAppInitialized, setIsAppInitialized] = useState(false);
  const [initialIsDark, setInitialIsDark] = useState(false);

  const [networkLoaded, setNetworkLoaded] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [appKey, setAppKey] = useState(0);

  const [showLaunchOverlay, setShowLaunchOverlay] = useState(true);
  const [navBootReady, setNavBootReady] = useState(false);

  const launchOpacity = useRef(new Animated.Value(1)).current;
  const splashStartMs = useRef<number>(Date.now()).current;

  let [fontsLoaded] = useFonts({
    'SpaceMono-Regular': SpaceMono_400Regular,
    'SpaceMono-Italic': SpaceMono_400Regular_Italic,
    'SpaceMono-Bold': SpaceMono_700Bold,
    'SpaceMono-BoldItalic': SpaceMono_700Bold_Italic,
  });

  useEffect(() => {
    const prepareApp = async () => {
      try {
        await initDatabase();
        try { await Font.loadAsync(Feather.font); } catch (e) { console.error(e); }

        onNetworkChange(() => setAppKey(prev => prev + 1));

        const savedNetwork = await AsyncStorage.getItem(NETWORK_PREF_KEY);
        setNetwork(savedNetwork === 'testnet' ? 'testnet' : 'mainnet');

        const savedTheme = await AsyncStorage.getItem(THEME_PREF_KEY);
        setInitialIsDark(savedTheme === 'dark');

        setDbReady(true);
      } catch (e) {
        console.warn('PREPARE APP ERROR:', e);
      } finally {
        setNetworkLoaded(true);
        setIsAppInitialized(true);
      }
    };
    prepareApp();
  }, []);

  useEffect(() => {
    const appReady = Boolean(fontsLoaded && networkLoaded && dbReady && navBootReady && isAppInitialized);
    if (!appReady) return;

    const minSplashMs = 1000;
    const elapsed = Date.now() - splashStartMs;
    const remaining = Math.max(0, minSplashMs - elapsed);

    const t = setTimeout(() => {
      Animated.timing(launchOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setShowLaunchOverlay(false);
      });
    }, remaining);

    return () => clearTimeout(t);
  }, [fontsLoaded, networkLoaded, dbReady, navBootReady, isAppInitialized, launchOpacity, splashStartMs]);

  // Notice there is no longer an "if (!isAppInitialized) return <View>..." block here.
  // We return the entire tree from the very first frame to prevent React from unmounting
  // and remounting the splash screen component, which causes blinking.

  return (
    <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
      
      {/* We wait for initialization before rendering the heavy app logic */}
      {isAppInitialized && (
        <QueryClientProvider client={queryClient}>
          <ThemeProvider initialIsDark={initialIsDark}>
            {dbReady && networkLoaded ? (
              <WalletProvider key={appKey}>
                <View style={{ flex: 1 }}>
                  <ThemedStatusBar />
                  <PrivacySwitcherOverlay />
                  <AppNavigator onBootReady={() => setNavBootReady(true)} />
                </View>
              </WalletProvider>
            ) : (
              <View style={{ flex: 1 }}><ThemedStatusBar /></View>
            )}
          </ThemeProvider>
        </QueryClientProvider>
      )}

      {/* The animated launch splash overlay - CONSTANTLY RENDERED from initial load to prevent blinking */}
      {showLaunchOverlay && (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#ffffff', opacity: launchOpacity, zIndex: 99999 }}
        >
          <Image 
            source={require('./assets/splash-icon-white.png')} 
            style={{ height: '100%', width: '100%', resizeMode: 'cover' }} 
            fadeDuration={0} // CRITICAL: Prevents React Native from causing a translucent blink
          />
        </Animated.View>
      )}

    </View>
  );
}

registerRootComponent(App);
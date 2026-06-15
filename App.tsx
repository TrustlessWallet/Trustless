import React, { useState, useEffect, useRef } from 'react';
import { StatusBar, LogBox, View, Image, Text, TextInput, Animated, Appearance } from 'react-native';
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


interface TextWithDefaultProps extends Text {
  defaultProps?: { allowFontScaling?: boolean };
}
interface TextInputWithDefaultProps extends TextInput {
  defaultProps?: { allowFontScaling?: boolean };
}

((Text as unknown) as TextWithDefaultProps).defaultProps =
  ((Text as unknown) as TextWithDefaultProps).defaultProps || {};
((Text as unknown) as TextWithDefaultProps).defaultProps!.allowFontScaling = false;

((TextInput as unknown) as TextInputWithDefaultProps).defaultProps =
  ((TextInput as unknown) as TextInputWithDefaultProps).defaultProps || {};
((TextInput as unknown) as TextInputWithDefaultProps).defaultProps!.allowFontScaling = false;

LogBox.ignoreLogs([
  'Setting a timer',
  'AsyncStorage has been extracted',
]);

const queryClient = new QueryClient();
const NETWORK_PREF_KEY = '@network_preference';
const THEME_PREF_KEY = '@app_theme_preference';

const ThemedStatusBar = () => {
  const { isDark, theme } = useTheme();
  const statusBarBg = isDark ? '#000000' : theme.colors.background;
  const barStyle = isDark ? 'light-content' : 'dark-content';

  return (
    <StatusBar
      barStyle={barStyle}
      backgroundColor={statusBarBg}
    />
  );
};

export default function App() {
  const [networkLoaded, setNetworkLoaded] = useState(false);
  const [dbReady, setDbReady] = useState(false);
const [splashTheme, setSplashTheme] = useState<'light' | 'dark'>('light');
  const [appKey, setAppKey] = useState(0);
  const [showSplashOverlay, setShowSplashOverlay] = useState(true);
  const [navBootReady, setNavBootReady] = useState(false);
  const splashOpacity = useRef(new Animated.Value(1)).current;
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

        try {
          await Font.loadAsync(Feather.font);
        } catch (fontError) {
          console.error('Error loading Feather font:', fontError);
        }

        // 1. Register listener BEFORE hydrating the network
        onNetworkChange(() => {
          setAppKey(prev => prev + 1);
        });

        // 2. Hydrate network state
        const savedNetwork = await AsyncStorage.getItem(NETWORK_PREF_KEY);
        setNetwork(savedNetwork === 'testnet' ? 'testnet' : 'mainnet');

        // 3. Hydrate theme state
        const savedTheme = await AsyncStorage.getItem(THEME_PREF_KEY);
        if (savedTheme) {
          setSplashTheme(savedTheme as 'light' | 'dark');
        } else {
          setSplashTheme('light');
        }

        // 4. Mark DB as ready ONLY after hydration is complete
        setDbReady(true);
      } catch (e) {
        console.warn('PREPARE APP ERROR:', e);
      } finally {
        setNetworkLoaded(true);
      }
    };
    prepareApp();
  }, []);

  useEffect(() => {
    const appReady = Boolean(fontsLoaded && networkLoaded && dbReady && navBootReady);
    if (!appReady) return;

    const minSplashMs = 1000;
    const elapsed = Date.now() - splashStartMs;
    const remaining = Math.max(0, minSplashMs - elapsed);

    const t = setTimeout(() => {
      Animated.timing(splashOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setShowSplashOverlay(false);
      });
    }, remaining);

    return () => clearTimeout(t);
  }, [fontsLoaded, networkLoaded, dbReady, navBootReady, splashOpacity, splashStartMs]);

  const splashBg = splashTheme === 'dark' ? '#000000' : '#ffffff';
  const splashIcon = splashTheme === 'dark'
    ? require('./assets/splash-icon-black.png')
    : require('./assets/splash-icon-white.png');

  return (
    <View style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {dbReady && networkLoaded ? (
            <WalletProvider key={appKey}>
              <View style={{ flex: 1 }}>
                <ThemedStatusBar />
                <AppNavigator onBootReady={() => setNavBootReady(true)} />
              </View>
            </WalletProvider>
          ) : (
            <View style={{ flex: 1 }}>
              <ThemedStatusBar />
            </View>
          )}
        </ThemeProvider>
      </QueryClientProvider>

      {showSplashOverlay && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: splashBg,
            opacity: splashOpacity,
          }}
        >
          <Image
            source={splashIcon}
            style={{ height: '100%', width: '100%', resizeMode: 'cover' }}
          />
        </Animated.View>
      )}
    </View>
  );
}

registerRootComponent(App);
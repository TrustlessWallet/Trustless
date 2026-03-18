import React, { useState, useEffect } from 'react';
import { StatusBar, LogBox, View, Image, Text, TextInput } from 'react-native';
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

const ThemedAppRoot = () => {
  const { theme } = useTheme();
  const rootBgColor = theme.colors.background;

  return (
    <View style={{ flex: 1, backgroundColor: rootBgColor }}>
      <ThemedStatusBar />
      <AppNavigator />
    </View>
  );
};

export default function App() {
  const [networkLoaded, setNetworkLoaded] = useState(false);
  const [dbReady, setDbReady] = useState(false);
  const [splashTheme, setSplashTheme] = useState<'light' | 'dark'>('light');
  const [appKey, setAppKey] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

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
        setDbReady(true);

        try {
          await Font.loadAsync(Feather.font);
        } catch (fontError) {
          console.error('Error loading Feather font:', fontError);
        }

        const savedNetwork = await AsyncStorage.getItem(NETWORK_PREF_KEY);
        setNetwork(savedNetwork === 'testnet' ? 'testnet' : 'mainnet');

        const savedTheme = await AsyncStorage.getItem(THEME_PREF_KEY);
        if (savedTheme) {
          setSplashTheme(savedTheme as 'light' | 'dark');
        } else {
          setSplashTheme('light');
        }

      } catch (e) {
        console.warn('PREPARE APP ERROR:', e);
      } finally {
        setNetworkLoaded(true);
        onNetworkChange(() => {
          setAppKey(prev => prev + 1);
        });
      }
    };

    prepareApp();
  }, []);

  useEffect(() => {
    if (fontsLoaded && networkLoaded && dbReady) {
      setIsInitialLoading(false);
    }
  }, [fontsLoaded, networkLoaded, dbReady]);

  if (isInitialLoading) {
    const splashBg = splashTheme === 'dark' ? '#000000' : '#ffffff';
    const splashIcon = splashTheme === 'dark' 
      ? require('./assets/splash-icon-black.png') 
      : require('./assets/splash-icon-white.png');

    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: splashBg }}>
        <Image 
          source={splashIcon}
          style={{ height: '100%', width: '100%', resizeMode: 'cover' }}
        />
      </View>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WalletProvider key={appKey}> 
          <ThemedAppRoot />
        </WalletProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

registerRootComponent(App);
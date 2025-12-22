import React, { useState, useEffect } from 'react';
import { StatusBar, LogBox, View, Image, useColorScheme } from 'react-native';
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

LogBox.ignoreLogs([
  'Setting a timer',
  'AsyncStorage has been extracted',
]);

const queryClient = new QueryClient();
const NETWORK_PREF_KEY = '@network_preference';
const THEME_PREF_KEY = '@theme_preference';

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
  const { theme, isDark } = useTheme();
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
  const [splashTheme, setSplashTheme] = useState<'light' | 'dark'>('light');
  const systemScheme = useColorScheme();
  const [appKey, setAppKey] = useState(0);

  useEffect(() => {
    const prepareApp = async () => {
      try {
        const savedNetwork = await AsyncStorage.getItem(NETWORK_PREF_KEY);
        if (savedNetwork === 'testnet') {
          setNetwork('testnet');
        } else {
          setNetwork('mainnet');
        }

        const savedTheme = await AsyncStorage.getItem(THEME_PREF_KEY);
        if (savedTheme) {
          setSplashTheme(savedTheme as 'light' | 'dark');
        } else {
          setSplashTheme(systemScheme === 'dark' ? 'dark' : 'light');
        }

      } catch (e) {
        console.warn(e);
      } finally {
        setNetworkLoaded(true);
      }
    };

    prepareApp();

    onNetworkChange(() => {
      setAppKey(prev => prev + 1);
    });
  }, []);

  let [fontsLoaded] = useFonts({
    'SpaceMono-Regular': SpaceMono_400Regular,
    'SpaceMono-Italic': SpaceMono_400Regular_Italic,
    'SpaceMono-Bold': SpaceMono_700Bold,
    'SpaceMono-BoldItalic': SpaceMono_700Bold_Italic,
  });

  if (!fontsLoaded || !networkLoaded) {
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
import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { View, TouchableOpacity, AppState, Text, Image, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';

import TabNavigator from './TabNavigator';
import AddAddressScreen from '../screens/AddAddressScreen';
import QRScannerScreen from '../screens/QRScannerScreen';
import BackupIntroScreen from '../screens/BackupIntroScreen';
import ShowMnemonicScreen from '../screens/ShowMnemonicScreen';
import VerifyMnemonicScreen from '../screens/VerifyMnemonicScreen';
import RecoverWalletScreen from '../screens/RecoverWalletScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import SendScreen from '../screens/SendScreen';
import TransactionConfirmScreen from '../screens/TransactionConfirmScreen';
import TransactionDetailsScreen from '../screens/TransactionDetailsScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import WalletSwitcherScreen from '../screens/WalletSwitcherScreen';
import AddWalletOptionsScreen from '../screens/AddWalletOptionsScreen';
import BackupDisclaimerScreen from '../screens/BackupDisclaimerScreen';
import AddressBookScreen from '../screens/AddressBookScreen';
import AddSavedAddressScreen from '../screens/AddSavedAddressScreen';
import BalanceDetailScreen from '../screens/BalanceDetailScreen';
import CoinControlScreen from '../screens/CoinControlScreen';
import AuthCheckScreen from '../screens/AuthCheckScreen';
import OnboardingWelcomeScreen from '../screens/OnboardingWelcomeScreen';
import OnboardingTrackerScreen from '../screens/OnboardingTrackerScreen';
import OnboardingWalletScreen from '../screens/OnboardingWalletScreen';
import AddressDetailsScreen from '../screens/AddressDetailsScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import TermsConditionsScreen from '../screens/TermsConditionsScreen';
import { getAppIsAuthenticated, setAppIsAuthenticated, getBiometricPromptShown, setBiometricPromptShown } from '../services/authState'; 

const Stack = createNativeStackNavigator<RootStackParamList>();
const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';
const AUTO_LOCK_TIME_KEY = '@autoLockTime';
const DEFAULT_SCREEN_KEY = '@defaultScreen';

const AppNavigator = () => {
  const { loading: walletLoading } = useWallet();
  const { theme, isDark } = useTheme(); 
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const [isLoading, setIsLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [hasShownOnboarding, setHasShownOnboarding] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isBackgrounded, setIsBackgrounded] = useState(false);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('MainTabs');
  const [initialTab, setInitialTab] = useState<keyof TabParamList>('Tracker');
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>(undefined);
  const appState = useRef(AppState.currentState);
  
  const splashOpacity = useRef(new Animated.Value(1)).current;

  const splashIcon = isDark 
    ? require('../../assets/splash-icon-black.png') 
    : require('../../assets/splash-icon-white.png');
  const splashBg = isDark ? '#000000' : '#ffffff';

  const navigationTheme = {
    dark: isDark,
    colors: {
      primary: theme.colors.primary,
      background: theme.colors.background,
      card: isDark ? theme.colors.surface : theme.colors.background, 
      text: theme.colors.primary,
      border: theme.colors.border,
      notification: theme.colors.bitcoin,
    },
    fonts: DefaultTheme.fonts,
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      if (nextAppState.match(/inactive|background/)) {
        setIsBackgrounded(true);
      } else if (nextAppState === 'active') {
        setIsBackgrounded(false);
        setBiometricPromptShown(false);
      }

      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        await checkAuthNeeded();
      } else if (nextAppState.match(/inactive|background/)) {
        await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
        setAppIsAuthenticated(false);
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const checkAuthNeeded = async () => {
    try {
      const hasCompletedOnboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');
      if (!hasCompletedOnboarding) return;

      const authCompleted = getAppIsAuthenticated();
      if (authCompleted) return;

      const isBiometricsEnabled = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const autoLockTime = await AsyncStorage.getItem(AUTO_LOCK_TIME_KEY);

      if (isBiometricsEnabled === 'true' && isEnrolled && autoLockTime !== null && autoLockTime !== 'Off') {
        const lockTimeMinutes = parseInt(autoLockTime, 10);
        let shouldAuth = false;

        if (lockTimeMinutes === 0) {
          shouldAuth = true;
        } else {
          const lastActiveTime = await AsyncStorage.getItem('@lastActiveTime');
          if (lastActiveTime) {
            const timeSinceLastActive = Date.now() - parseInt(lastActiveTime, 10);
            const lockTimeMs = lockTimeMinutes * 60 * 1000;
            if (timeSinceLastActive >= lockTimeMs) {
              shouldAuth = true;
            }
          }
        }

        if (shouldAuth && navigationRef.isReady()) {
          navigationRef.navigate('AuthCheck');
        }
      }
    } catch (e) {
      console.error("Failed to check auth needed", e);
    }
  };

  useEffect(() => {
    const checkInitialStatus = async () => {
      try {
        const hasCompletedOnboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');
        const savedDefaultScreen = await AsyncStorage.getItem(DEFAULT_SCREEN_KEY);
        setInitialTab(savedDefaultScreen === 'Wallet' ? 'Wallet' : 'Tracker');

        if (hasCompletedOnboarding === null) {
          setNeedsOnboarding(true);
          setIsLoading(false);
          return;
        }

        const isBiometricsEnabled = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        
        if (isBiometricsEnabled === 'true' && isEnrolled) {
          setInitialRoute('AuthCheck');
        }
      } catch (e) {
        console.error("Failed to check app status", e);
      } finally {
        setIsLoading(false);
      }
    };

    if (!walletLoading) {
      checkInitialStatus();
    }
  }, [walletLoading]);

  useEffect(() => {
    if (!isLoading && needsOnboarding && navigationRef.isReady() && !hasShownOnboarding) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (navigationRef.isReady()) {
            navigationRef.reset({
              index: 3,
              routes: [
                { name: 'MainTabs' },
                { name: 'OnboardingWallet' },
                { name: 'OnboardingTracker' },
                { name: 'OnboardingWelcome' },
              ],
            });
            setHasShownOnboarding(true);
            setTimeout(() => {
              setShowSplash(false);
            }, 100);
          }
        }, 0);
      });
    } else if (!isLoading && !needsOnboarding) {
      setShowSplash(false);
    }
  }, [isLoading, needsOnboarding, navigationRef, hasShownOnboarding]);

  const shouldShowSplash = walletLoading || isLoading || showSplash || (isBackgrounded && !getBiometricPromptShown());

  useEffect(() => {
    Animated.timing(splashOpacity, {
      toValue: shouldShowSplash ? 1 : 0,
      duration: 200, 
      useNativeDriver: true,
    }).start();
  }, [shouldShowSplash]);

  const screenOptions: NativeStackNavigationOptions = {
    contentStyle: { backgroundColor: theme.colors.background },
    headerStyle: {
      backgroundColor: isDark ? theme.colors.surface : theme.colors.background,
    },
    headerTintColor: theme.colors.primary,
    headerTitleStyle: {
      fontFamily: 'SpaceMono-Bold',
      color: theme.colors.primary,
      fontSize: 17,
    },
    headerShadowVisible: false,
    headerBackVisible: false,
    headerLeft: () => null,
    animationTypeForReplace: 'push' as const,
    header: (props: any) => {
      const { navigation, route, options } = props;
      const title = options.headerTitle !== undefined 
        ? options.headerTitle 
        : options.title !== undefined 
        ? options.title 
        : route.name;
      
      return (
        <View style={{ 
          height: 58, 
          backgroundColor: isDark ? theme.colors.surface : theme.colors.background,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 16,
        }}>
          <View style={{ width: 48, height: 24 }} />
          
          <Text style={{ 
            flex: 1, 
            textAlign: 'center',
            fontFamily: 'SpaceMono-Bold', 
            fontSize: 17, 
            color: theme.colors.primary 
          }} numberOfLines={1}>
            {typeof title === 'string' ? title : ''}
          </Text>
          
          {options.headerRight ? (
            <View style={{ width: 48, alignItems: 'flex-end' }}>
              {options.headerRight({})}
            </View>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>
      );
    },
  };
  
  const CloseButton = ({ onPress }: { onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={{ padding: 4 }}>
      <Feather name="x" size={24} color={theme.colors.primary} />
    </TouchableOpacity>
  );

  if (walletLoading || isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: splashBg, justifyContent: 'center', alignItems: 'center' }}>
        <Image 
          source={splashIcon}
          style={{ height: '100%', width: '100%', resizeMode: 'cover' }}
        />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer 
        ref={navigationRef} 
        theme={navigationTheme}
        onReady={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name)}
        onStateChange={() => setCurrentRouteName(navigationRef.getCurrentRoute()?.name)}
      >
        <Stack.Navigator
          initialRouteName={initialRoute}
          screenOptions={screenOptions}
        >
          <Stack.Screen
            name="MainTabs"
            component={TabNavigator}
            options={{ 
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background }
            }}
            initialParams={{ screen: initialTab }}
          />
          <Stack.Screen name="AuthCheck" component={AuthCheckScreen} options={{ headerShown: false }} />
          
          <Stack.Group screenOptions={{ presentation: 'formSheet' }}>
            <Stack.Screen name="AddAddress" component={AddAddressScreen} options={{ title: 'Add bitcoin address' }} />
            <Stack.Screen name="BackupIntro" component={BackupIntroScreen} options={{ title: 'Create wallet' }} />
            <Stack.Screen name="ShowMnemonic" component={ShowMnemonicScreen} options={{ title: 'Recovery phrase' }} />
            <Stack.Screen name="VerifyMnemonic" component={VerifyMnemonicScreen} options={{ title: 'Verify phrase' }} />
            <Stack.Screen name="RecoverWallet" component={RecoverWalletScreen} options={{ title: 'Recover wallet' }} />
            <Stack.Screen name="Send" component={SendScreen} options={{ title: 'Send bitcoin' }} />
            <Stack.Screen name="TransactionConfirm" component={TransactionConfirmScreen} options={{ title: 'Confirm transaction' }} />
            <Stack.Screen name="WalletSwitcher" component={WalletSwitcherScreen} options={{ title: 'Wallets' }} />
            <Stack.Screen name="AddWalletOptions" component={AddWalletOptionsScreen} options={{ title: 'Add wallet' }} />
            <Stack.Screen name="BackupDisclaimer" component={BackupDisclaimerScreen} options={{ title: 'Backup wallet' }} />
            <Stack.Screen name="AddressBook" component={AddressBookScreen} options={{ title: 'Saved addresses' }} />
            <Stack.Screen name="AddSavedAddress" component={AddSavedAddressScreen} options={{ title: 'Add new address' }} />
            <Stack.Screen name="BalanceDetail" component={BalanceDetailScreen} options={{ title: 'Balance details' }} />
            <Stack.Screen name="CoinControl" component={CoinControlScreen} options={{ title: 'Select coins to spend' }} />
          </Stack.Group>

          <Stack.Group screenOptions={{ presentation: 'modal' }}>
            <Stack.Screen 
            name="AddressDetails" 
            component={AddressDetailsScreen} 
            options={({ navigation }) => ({
              title: 'Address details',
              headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
            })}
            />
          </Stack.Group>

          <Stack.Group screenOptions={{ presentation: 'modal' }}>
            <Stack.Screen
              name="Receive"
              component={ReceiveScreen}
              options={({ navigation }) => ({
                title: 'Receive bitcoin',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
            <Stack.Screen
              name="QRScanner"
              component={QRScannerScreen}
              options={{ title: 'Scan QR code' }}
            />
            <Stack.Screen
              name="TransactionHistory"
              component={TransactionHistoryScreen}
              options={({ navigation }) => ({
                title: 'Transaction history',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
            <Stack.Screen
              name="TransactionDetails"
              component={TransactionDetailsScreen}
              options={({ navigation }) => ({
                title: 'Transaction details',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
            <Stack.Screen
              name="OnboardingWelcome"
              component={OnboardingWelcomeScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OnboardingTracker"
              component={OnboardingTrackerScreen}
              options={{ title: 'Tracker' }}
            />
            <Stack.Screen
              name="OnboardingWallet"
              component={OnboardingWalletScreen}
              options={{ title: 'Wallet' }}
            />
            <Stack.Screen
              name="PrivacyPolicy"
              component={PrivacyPolicyScreen}
              options={({ navigation }) => ({
                title: 'Privacy Policy',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
            <Stack.Screen
              name="TermsConditions"
              component={TermsConditionsScreen}
              options={({ navigation }) => ({
                title: 'Terms & Conditions',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
          </Stack.Group>
        </Stack.Navigator>
      </NavigationContainer>
      
      <Animated.View style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: splashBg,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        opacity: splashOpacity,
      }}
      pointerEvents={shouldShowSplash ? 'auto' : 'none'}
      >
        <Image 
          source={splashIcon}
          style={{ height: '100%', width: '100%', resizeMode: 'cover' }}
        />
      </Animated.View>
    </>
  );
};

export default AppNavigator;
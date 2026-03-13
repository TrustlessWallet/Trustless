import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { View, TouchableOpacity, AppState, Text, Image, Animated, Platform, Modal, Dimensions } from 'react-native';
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
import ImportWatchOnlyScreen from '../screens/ImportWatchOnlyScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import SendScreen from '../screens/SendScreen';
import TransactionConfirmScreen from '../screens/TransactionConfirmScreen';
import TransactionDetailsScreen from '../screens/TransactionDetailsScreen';
import TransactionHistoryScreen from '../screens/TransactionHistoryScreen';
import WalletSwitcherScreen from '../screens/WalletSwitcherScreen';
import WalletOptionsScreen from '../screens/WalletOptionsScreen';
import ShowPublicKeyScreen from '../screens/ShowPublicKeyScreen';
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
import SupportScreen from '../screens/SupportScreen';
import { getAppIsAuthenticated, setAppIsAuthenticated, getBiometricPromptShown, setBiometricPromptShown } from '../services/authState'; 

const Stack = createNativeStackNavigator<RootStackParamList>();
const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';
const AUTO_LOCK_TIME_KEY = '@autoLockTime';
const DEFAULT_SCREEN_KEY = '@defaultScreen';

const AppNavigator = () => {
  const { loading: wallet_loading } = useWallet();
  const { theme, isDark } = useTheme(); 
  const navigation_ref = useNavigationContainerRef<RootStackParamList>();
  const [is_loading, set_is_loading] = useState(true);
  const [needs_onboarding, set_needs_onboarding] = useState(false);
  const [has_shown_onboarding, set_has_shown_onboarding] = useState(false);
  const [show_splash, set_show_splash] = useState(true);
  const [is_backgrounded, set_is_backgrounded] = useState(false);
  const [initial_route, set_initial_route] = useState<keyof RootStackParamList>('MainTabs');
  const [initial_tab, set_initial_tab] = useState<keyof TabParamList>('Wallet'); 
  const [current_route_name, set_current_route_name] = useState<string | undefined>(undefined);
  const app_state = useRef(AppState.currentState);

  const [splash_visible, set_splash_visible] = useState(true);
  
  const splash_opacity = useRef(new Animated.Value(1)).current;

  const is_android = Platform.OS === 'android';

  const splash_icon = isDark 
    ? require('../../assets/splash-icon-black.png') 
    : require('../../assets/splash-icon-white.png');
  const splash_bg = isDark ? '#000000' : '#ffffff';

  const navigation_theme = {
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
    const subscription = AppState.addEventListener('change', async next_app_state => {
      if (next_app_state.match(/inactive|background/)) {
        set_is_backgrounded(true);
      } else if (next_app_state === 'active') {
        set_is_backgrounded(false);
        setBiometricPromptShown(false);
      }

      if (
        app_state.current.match(/inactive|background/) &&
        next_app_state === 'active'
      ) {
        await check_auth_needed();
      } else if (next_app_state.match(/inactive|background/)) {
        await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
        setAppIsAuthenticated(false);
      }
      app_state.current = next_app_state;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const check_auth_needed = async () => {
    try {
      const has_completed_onboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');
      if (!has_completed_onboarding) return;

      const auth_completed = getAppIsAuthenticated();
      if (auth_completed) return;

      const is_biometrics_enabled = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
      const is_enrolled = await LocalAuthentication.isEnrolledAsync();
      const auto_lock_time = await AsyncStorage.getItem(AUTO_LOCK_TIME_KEY);

      if (is_biometrics_enabled === 'true' && is_enrolled && auto_lock_time !== null && auto_lock_time !== 'Off') {
        const lock_time_minutes = parseInt(auto_lock_time, 10);
        let should_auth = false;

        if (lock_time_minutes === 0) {
          should_auth = true;
        } else {
          const last_active_time = await AsyncStorage.getItem('@lastActiveTime');
          if (last_active_time) {
            const time_since_last_active = Date.now() - parseInt(last_active_time, 10);
            const lock_time_ms = lock_time_minutes * 60 * 1000;
            if (time_since_last_active >= lock_time_ms) {
              should_auth = true;
            }
          }
        }

        if (should_auth && navigation_ref.isReady()) {
          navigation_ref.navigate('AuthCheck');
        }
      }
    } catch (e) {
      console.error("Failed to check auth needed", e);
    }
  };

  useEffect(() => {
    const check_initial_status = async () => {
      try {
        const has_completed_onboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');
        const saved_default_screen = await AsyncStorage.getItem(DEFAULT_SCREEN_KEY);
        set_initial_tab(saved_default_screen === 'Tracker' ? 'Tracker' : 'Wallet');

        if (has_completed_onboarding === null) {
          set_needs_onboarding(true);
          set_is_loading(false);
          return;
        }

        const is_biometrics_enabled = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
        const is_enrolled = await LocalAuthentication.isEnrolledAsync(); 
        
        if (is_biometrics_enabled === 'true' && is_enrolled) {
          set_initial_route('AuthCheck');
        }
      } catch (e) {
        console.error("Failed to check app status", e);
      } finally {
        set_is_loading(false);
      }
    };

    if (!wallet_loading) {
      check_initial_status();
    }
  }, [wallet_loading]);

  useEffect(() => {
    if (!is_loading && needs_onboarding && navigation_ref.isReady() && !has_shown_onboarding) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (navigation_ref.isReady()) {
            navigation_ref.reset({
              index: 3,
              routes: [
                { name: 'MainTabs' },
                { name: 'OnboardingWallet' },
                { name: 'OnboardingTracker' },
                { name: 'OnboardingWelcome' },
              ],
            });
            set_has_shown_onboarding(true);
            setTimeout(() => {
              set_show_splash(false);
            }, 100);
          }
        }, 0);
      });
    } else if (!is_loading && !needs_onboarding) {
      set_show_splash(false);
    }
  }, [is_loading, needs_onboarding, navigation_ref, has_shown_onboarding]);

  const should_show_splash = wallet_loading || is_loading || show_splash || (is_backgrounded && !getBiometricPromptShown());

  useEffect(() => {
    if (should_show_splash) {
      set_splash_visible(true);
      Animated.timing(splash_opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(splash_opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        set_splash_visible(false);
      });
    }
  }, [should_show_splash]);

  const screen_options: NativeStackNavigationOptions = {
    contentStyle: { backgroundColor: theme.colors.background },
    animation: is_android ? 'slide_from_right' : undefined,
    gestureEnabled: true,
    gestureDirection: 'horizontal',

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
          
          <Text 
          allowFontScaling={false}
          style={{ 
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

  const android_sheet_options: Partial<NativeStackNavigationOptions> = is_android ? {
    presentation: 'formSheet',
    sheetAllowedDetents: [0.95],
    sheetCornerRadius: 24,
    sheetGrabberVisible: true,
    animation: 'slide_from_bottom', 
  } : {};

  if (wallet_loading || is_loading) {
    const { width, height } = Dimensions.get('screen');
    return (
      <View style={{ flex: 1, backgroundColor: splash_bg }}>
        <Image 
          source={splash_icon}
          style={{ width: width, height: height, resizeMode: 'cover', position: 'absolute' }}
        />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        </View>
      </View>
    );
  }

  return (
    <>
      <NavigationContainer 
        ref={navigation_ref} 
        theme={navigation_theme}
        onReady={() => set_current_route_name(navigation_ref.getCurrentRoute()?.name)}
        onStateChange={() => set_current_route_name(navigation_ref.getCurrentRoute()?.name)}
      >
        <Stack.Navigator
          initialRouteName={initial_route}
          screenOptions={screen_options}
        >
          <Stack.Screen
            name="MainTabs"
            component={TabNavigator}
            options={{ 
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.background }
            }}
            initialParams={{ screen: initial_tab }}
          />
          <Stack.Screen name="AuthCheck" component={AuthCheckScreen} options={{ headerShown: false }} />
          
          <Stack.Group screenOptions={{ 
            presentation: 'formSheet',
            ...android_sheet_options, 
          }}>
            <Stack.Screen name="AddAddress" component={AddAddressScreen} options={{ title: 'Add bitcoin address' }} />
            <Stack.Screen name="BackupIntro" component={BackupIntroScreen} options={{ title: 'Create wallet' }} />
            <Stack.Screen name="ShowMnemonic" component={ShowMnemonicScreen} options={{ title: 'Recovery phrase' }} />
            <Stack.Screen name="VerifyMnemonic" component={VerifyMnemonicScreen} options={{ title: 'Verify phrase' }} />
            <Stack.Screen name="RecoverWallet" component={RecoverWalletScreen} options={{ title: 'Recover wallet' }} />
            <Stack.Screen name="ImportWatchOnly" component={ImportWatchOnlyScreen} options={{ title: 'Import watch-only' }} />
            <Stack.Screen name="Send" component={SendScreen} options={{ title: 'Send bitcoin' }} />
            <Stack.Screen name="TransactionConfirm" component={TransactionConfirmScreen} options={{ title: 'Confirm transaction' }} />
            <Stack.Screen name="WalletSwitcher" component={WalletSwitcherScreen} options={{ title: 'Wallets' }} />
            <Stack.Screen name="WalletOptions" component={WalletOptionsScreen} options={{ title: 'Wallet options' }} />
            <Stack.Screen name="AddWalletOptions" component={AddWalletOptionsScreen} options={{ title: 'Add wallet' }} />
            <Stack.Screen name="BackupDisclaimer" component={BackupDisclaimerScreen} options={{ title: 'Backup wallet' }} />
            <Stack.Screen name="AddressBook" component={AddressBookScreen} options={{ title: 'Saved addresses' }} />
            <Stack.Screen name="AddSavedAddress" component={AddSavedAddressScreen} options={{ title: 'Add new address' }} />
            <Stack.Screen name="CoinControl" component={CoinControlScreen} options={{ title: 'Select coins to spend' }} />
          </Stack.Group>

          <Stack.Group screenOptions={{ presentation: 'modal', ...android_sheet_options }}>

            <Stack.Screen
              name="BalanceDetail"
              component={BalanceDetailScreen}
              options={{ title: 'Balance details' }}
            />

            <Stack.Screen 
            name="AddressDetails" 
            component={AddressDetailsScreen} 
            options={({ navigation }) => ({
              title: 'Address details',
              headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
            })}
            />

            <Stack.Screen
              name="ShowPublicKey"
              component={ShowPublicKeyScreen}
              options={({ navigation }) => ({
                title: 'Public key',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
          </Stack.Group>

          <Stack.Group screenOptions={{ presentation: 'modal', ...android_sheet_options }}>
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
            <Stack.Screen
              name="Support"
              component={SupportScreen}
              options={({ navigation }) => ({
                title: 'Support Trustless',
                headerRight: () => <CloseButton onPress={() => navigation.goBack()} />,
              })}
            />
          </Stack.Group>
        </Stack.Navigator>
      </NavigationContainer>
      
      <Modal
        visible={splash_visible}
        transparent={true}
        animationType="none"
        statusBarTranslucent={true}
        onRequestClose={() => {}}
      >
        <Animated.View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: Dimensions.get('screen').width,
          height: Dimensions.get('screen').height,
          backgroundColor: splash_bg,
          justifyContent: 'center',
          alignItems: 'center',
          opacity: splash_opacity,
        }}>
          <Image 
            source={splash_icon}
            style={{ 
              width: '100%', 
              height: '100%', 
              resizeMode: 'cover' 
            }}
          />
        </Animated.View>
      </Modal>
    </>
  );
};

export default AppNavigator;
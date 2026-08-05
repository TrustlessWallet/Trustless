import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, useNavigationContainerRef, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { RootStackParamList, TabParamList } from '../types';
import { useWallet } from '../contexts/WalletContext';
import { useTheme } from '../contexts/ThemeContext';
import { View, TouchableOpacity, AppState, Text, Image, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import ExportPSBTScreen from '../screens/ExportPSBTScreen';
import ImportPSBTScreen from '../screens/ImportPSBTScreen';
import TabNavigator from './TabNavigator';
import QRScannerScreen from '../screens/QRScannerScreen';
import BackupIntroScreen from '../screens/BackupIntroScreen';
import ShowMnemonicScreen from '../screens/ShowMnemonicScreen';
import ShowMnemonicQRScreen from '../screens/ShowMnemonicQRScreen';
import VerifyMnemonicScreen from '../screens/VerifyMnemonicScreen';
import RecoverWalletScreen from '../screens/RecoverWalletScreen';
import ImportWatchOnlyScreen from '../screens/ImportWatchOnlyScreen';
import ReceiveScreen from '../screens/ReceiveScreen';
import SendScreen from '../screens/SendScreen';
import TransactionConfirmScreen from '../screens/TransactionConfirmScreen';
import TransactionSuccessScreen from '../screens/TransactionSuccessScreen';
import TransactionDetailsScreen from '../screens/TransactionDetailsScreen';
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
import OnboardingWalletScreen from '../screens/OnboardingWalletScreen';
import AddressDetailsScreen from '../screens/AddressDetailsScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import TermsConditionsScreen from '../screens/TermsConditionsScreen';
import SupportScreen from '../screens/SupportScreen';
import { get_biometric_prompt_shown, set_biometric_prompt_shown } from '../services/authState';
import { LightningTopUpScreen } from '../screens/LightningTopUpScreen';
import { WithdrawToOnchainScreen } from '../screens/WithdrawToOnchainScreen';
import { get_is_nfc_scanning } from '../services/nfc';

const Stack = createNativeStackNavigator<RootStackParamList>();
const BIOMETRICS_ENABLED_KEY = '@biometricsEnabled';
const AUTO_LOCK_TIME_KEY = '@autoLockTime';

const PrivacyOverlayScreen = () => {
  const { isDark } = useTheme();

  const splash_icon_img = isDark
    ? require('../../assets/splash-icon-black.png')
    : require('../../assets/splash-icon-white.png');

  const bg_color = isDark ? '#000000' : '#ffffff';

  return (
    <View style={{ flex: 1, backgroundColor: bg_color, justifyContent: 'center', alignItems: 'center' }}>
      <Image
        source={splash_icon_img}
        style={{ width: '100%', height: '100%', resizeMode: 'cover', position: 'absolute' }}
      />
    </View>
  );
};

const AppNavigator = ({ onBootReady }: { onBootReady?: () => void }) => {
  const { wallets, loading: wallet_loading } = useWallet();
  const { theme, isDark } = useTheme();
  const navigation_ref = useNavigationContainerRef<RootStackParamList>();
  const [is_loading, set_is_loading] = useState(true);
  const [needs_onboarding, set_needs_onboarding] = useState(false);
  const [has_shown_onboarding, set_has_shown_onboarding] = useState(false);
  const [is_backgrounded, set_is_backgrounded] = useState(false);
  const [initial_route, set_initial_route] = useState<keyof RootStackParamList>('MainTabs');
  const [initial_tab, set_initial_tab] = useState<keyof TabParamList>('Wallet');
  const [current_route_name, set_current_route_name] = useState<string | undefined>(undefined);
  const [is_nav_ready, set_is_nav_ready] = useState(false);
  const app_state = useRef(AppState.currentState);

  const [initial_nav_state, set_initial_nav_state] = useState<any>(null);
  const [nav_state_resolved, set_nav_state_resolved] = useState(false);
  const [is_checking_auth, set_is_checking_auth] = useState(false);

  const is_android = Platform.OS === 'android';

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
      const is_prompt_active = get_biometric_prompt_shown();
      const is_nfc_active = get_is_nfc_scanning();

      if (next_app_state.match(/inactive|background/)) {
        set_is_backgrounded(true);
      } else if (next_app_state === 'active') {
        if (!is_prompt_active && !is_nfc_active) {
          set_is_checking_auth(true);
        }
        set_is_backgrounded(false);
      }

      if (
        app_state.current.match(/inactive|background/) &&
        next_app_state === 'active'
      ) {
        if (!is_prompt_active && !is_nfc_active) {
          try {
            await check_auth_needed_ref.current();
          } finally {
            set_is_checking_auth(false);
          }
        }
        set_biometric_prompt_shown(false);
      } else if (next_app_state.match(/inactive|background/)) {
        if (!is_prompt_active && !is_nfc_active) {
          await AsyncStorage.setItem('@lastActiveTime', Date.now().toString());
        }
      }
      app_state.current = next_app_state;
    });

    return () => {
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!wallet_loading && wallets.length > 0 && app_state.current === 'active') {
      const check_pending_auth = async () => {
        const is_biometrics_enabled = await AsyncStorage.getItem(BIOMETRICS_ENABLED_KEY);
        const is_enrolled = await LocalAuthentication.isEnrolledAsync();
        const auto_lock_time = await AsyncStorage.getItem(AUTO_LOCK_TIME_KEY);

        if (is_biometrics_enabled === 'true' && is_enrolled && auto_lock_time !== null && auto_lock_time !== 'Off') {
          const lock_time_minutes = parseInt(auto_lock_time, 10);
          if (lock_time_minutes === 0) {
            await check_auth_needed();
          } else {
            const last_active_time = await AsyncStorage.getItem('@lastActiveTime');
            if (last_active_time) {
              const time_since_last_active = Date.now() - parseInt(last_active_time, 10);
              const lock_time_ms = lock_time_minutes * 60 * 1000;
              if (time_since_last_active >= lock_time_ms) {
                await check_auth_needed();
              }
            }
          }
        }
      };

      check_pending_auth();
    }
  }, [wallet_loading, wallets.length]);

  const check_auth_needed = async () => {
    try {
      if (wallet_loading) return;
      if (wallets.length === 0) return;

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
          navigation_ref.navigate('AuthCheck' as never);
        }
      }
    } catch (e) {
      console.error("Failed to check auth needed", e);
    }
  };

  const check_auth_needed_ref = useRef(check_auth_needed);
  useEffect(() => {
    check_auth_needed_ref.current = check_auth_needed;
  });

  useEffect(() => {
    const check_initial_status = async () => {
      try {
        set_initial_tab('Wallet');

        const has_completed_onboarding = await AsyncStorage.getItem('@hasCompletedOnboarding');

        if (has_completed_onboarding === null) {
          set_needs_onboarding(true);
          set_is_loading(false);
          return;
        }

        set_needs_onboarding(false);

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
    if (nav_state_resolved) return;
    if (wallet_loading || is_loading) return;

    if (needs_onboarding && !has_shown_onboarding) {
      set_initial_nav_state({
        stale: false,
        type: 'stack',
        key: 'root',
        index: 2,
        routeNames: ['MainTabs', 'OnboardingWallet', 'OnboardingWelcome', 'AuthCheck'],
        routes: [
          { key: 'MainTabs', name: 'MainTabs', params: { screen: initial_tab } },
          { key: 'OnboardingWallet', name: 'OnboardingWallet' },
          { key: 'OnboardingWelcome', name: 'OnboardingWelcome' },
        ],
      });
      set_has_shown_onboarding(true);
      set_nav_state_resolved(true);
      return;
    }

    set_initial_nav_state(undefined);
    set_nav_state_resolved(true);
  }, [nav_state_resolved, wallet_loading, is_loading, needs_onboarding, has_shown_onboarding, initial_tab]);

  const is_privacy_active = (is_backgrounded || is_checking_auth) && !get_biometric_prompt_shown() && !get_is_nfc_scanning();

  useEffect(() => {
    if (!is_nav_ready || !navigation_ref.isReady()) return;

    const current_route = navigation_ref.getCurrentRoute()?.name;

    if (is_privacy_active && current_route !== 'PrivacyOverlay') {
      navigation_ref.navigate('PrivacyOverlay' as never);
    } else if (!is_privacy_active && current_route === 'PrivacyOverlay') {
      if (navigation_ref.canGoBack()) {
        navigation_ref.goBack();
      }
    }
  }, [is_privacy_active, is_nav_ready, current_route_name]);

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

  if (wallet_loading || is_loading || !nav_state_resolved) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <NavigationContainer
      ref={navigation_ref}
      theme={navigation_theme}
      initialState={initial_nav_state || undefined}
      onReady={() => {
        set_is_nav_ready(true);
        set_current_route_name(navigation_ref.getCurrentRoute()?.name);
        onBootReady?.();
      }}
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
          <Stack.Screen name="BackupIntro" component={BackupIntroScreen} options={{ title: 'Create wallet' }} />
          <Stack.Screen name="ShowMnemonic" component={ShowMnemonicScreen} options={{ title: 'Recovery phrase' }} />
          <Stack.Screen name="ShowMnemonicQR" component={ShowMnemonicQRScreen} options={{ title: 'Recovery QR' }} />
          <Stack.Screen name="VerifyMnemonic" component={VerifyMnemonicScreen} options={{ title: 'Verify phrase' }} />
          <Stack.Screen name="RecoverWallet" component={RecoverWalletScreen} options={{ title: 'Recover wallet' }} />
          <Stack.Screen name="ImportWatchOnly" component={ImportWatchOnlyScreen} options={{ title: 'Import watch-only' }} />
          <Stack.Screen name="Send" component={SendScreen} options={{ title: 'Send bitcoin' }} />
          <Stack.Screen name="LightningTopUp" component={LightningTopUpScreen} options={{ title: 'Lightning top up' }} />
          <Stack.Screen name="WithdrawToOnchain" component={WithdrawToOnchainScreen} options={{ title: 'Withdraw to on-chain' }} />
          <Stack.Screen name="TransactionConfirm" component={TransactionConfirmScreen} options={{ title: 'Confirm transaction' }} />
          <Stack.Screen name="TransactionSuccess" component={TransactionSuccessScreen} options={{ headerShown: false }} />
          <Stack.Screen name="ExportPSBT" component={ExportPSBTScreen} options={{ title: 'Export transaction' }} />
          <Stack.Screen name="ImportPSBT" component={ImportPSBTScreen} options={{ title: 'Scan signed transaction', presentation: 'modal' }} />
          <Stack.Screen name="WalletSwitcher" component={WalletSwitcherScreen} options={{ title: 'Wallets' }} />
          <Stack.Screen name="WalletOptions" component={WalletOptionsScreen} options={{ title: 'Wallet options' }} />
          <Stack.Screen name="AddWalletOptions" component={AddWalletOptionsScreen} options={{ title: 'Add wallet' }} />
          <Stack.Screen name="BackupDisclaimer" component={BackupDisclaimerScreen} options={{ title: 'Backup wallet' }} />
          <Stack.Screen name="AddressBook" component={AddressBookScreen} options={{ title: 'Saved addresses' }} />
          <Stack.Screen name="AddSavedAddress" component={AddSavedAddressScreen} options={{ title: 'Add new address' }} />
          <Stack.Screen name="CoinControl" component={CoinControlScreen} options={{ title: 'Select coins to spend' }} />
        </Stack.Group>

        {/* Modals with Close Buttons */}
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
            name="OnboardingWallet"
            component={OnboardingWalletScreen}
            options={{ headerShown: false }}
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

        <Stack.Screen
          name={"PrivacyOverlay" as any}
          component={PrivacyOverlayScreen}
          options={{
            headerShown: false,
            presentation: 'fullScreenModal',
            animation: 'fade',
            gestureEnabled: false,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;
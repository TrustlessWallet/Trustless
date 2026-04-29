import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, FlatList, Dimensions, Image, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 

const { width } = Dimensions.get('window');
const REPO_URL = 'https://github.com/TrustlessWallet/Trustless';

const slides = [
  {
    key: '1',
    headline: 'Create your wallet',
    body: 'Generate non-custodial wallet in seconds. Your keys, your Bitcoin.',
    image: require('../../assets/Wallet-onboarding.png'),
  },
  {
    key: '2',
    headline: 'Manage multiple wallets',
    body: 'Create, import, and switch between several wallets.',
    image: require('../../assets/Wallets-onboarding.png'),
  },
  {
    key: '3',
    headline: 'Rotate addresses',
    body: 'Have 20 unused addresses at all times. Privacy above all else.',
    image: require('../../assets/Receive-onboarding.png'),
  },
  {
    key: '4',
    headline: 'Control your coins',
    body: 'Manually select which UTXOs to spend. You are in charge.',
    image: require('../../assets/Coin-control-onboarding.png'),
  },
  {
    key: '5',
    headline: 'Send Bitcoin',
    body: 'Adjust fees and review all details before broadcasting.',
    image: require('../../assets/Transaction-onboarding.png'),
  },
  {
    key: '6',
    headline: 'Connect your node',
    body: 'Connect to your own Electrum node for maximum privacy.',
    image: require('../../assets/Node-onboarding.png'),
  },
  {
    key: '7',
    headline: "Don't trust, verify",
    body: 'Trustless is fully open source.\n',
    link_text: 'Audit the code yourself.',
    link: REPO_URL,
    image: require('../../assets/Open-source-onboarding.png'),
  },
];

const SlideItem = React.memo(({ item, styles, handle_link_press }: any) => {
  return (
    <View style={styles.slide}>
      <View style={styles.phone_container}>
        <Image
          source={item.image}
          style={styles.image_fill}
          resizeMode="contain"
        />
      </View>

      <View style={styles.text_container}>
        <Text style={styles.headline}>{item.headline}</Text>
        <Text style={styles.body_text}>
          {item.body}
          {item.link_text && item.link && (
            <Text 
              style={styles.link_text} 
              onPress={() => handle_link_press(item.link)}
            >
              {item.link_text}
            </Text>
          )}
        </Text>
      </View>
    </View>
  );
});

const OnboardingWalletScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingWallet'>>();
  const [current_index, set_current_index] = useState(0);
  const flat_list_ref = useRef<FlatList>(null);
  const { theme, isDark } = useTheme(); 
  const styles = useMemo(() => get_styles(theme, isDark), [theme, isDark]); 

  const mark_onboarding_complete = async () => {
    try {
      await AsyncStorage.setItem('@hasCompletedOnboarding', 'true');
    } catch (e) {
      console.error('Failed to save onboarding status', e);
    }
  };

  const handle_complete_onboarding = async () => {
    await mark_onboarding_complete();
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  };

  useEffect(() => {
    return () => {
      mark_onboarding_complete();
    };
  }, []);

  const handle_next = () => {
    if (current_index < slides.length - 1) {
      flat_list_ref.current?.scrollToIndex({ index: current_index + 1 });
    } else {
      handle_complete_onboarding();
    }
  };

  const handle_link_press = (url: string) => {
    Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
  };

  const on_viewable_items_changed = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const new_index = viewableItems[0].index;
      set_current_index(new_index);
    }
  }).current;

  const render_item = ({ item }: any) => (
    <SlideItem 
      item={item}
      styles={styles}
      handle_link_press={handle_link_press}
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        ref={flat_list_ref}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={on_viewable_items_changed}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        keyExtractor={(item) => item.key}
        renderItem={render_item}
        removeClippedSubviews={true} 
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
      />
      
      <View style={styles.footer}>
        <View style={styles.dots_container}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, index === current_index && styles.dot_active]}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={handle_next}>
          <Text style={styles.button_text}>
            {current_index === slides.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const get_styles = (theme: Theme, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  slide: {
    width: width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: theme.colors.background,
  },
  phone_container: {
    height: '80%',
    aspectRatio: 9 / 19.5, 
    justifyContent: 'center',
    alignItems: 'center',
  },
  image_fill: {
    width: '100%',
    height: '100%',
  },
  text_container: {
    alignItems: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
  },
  body_text: {
    fontSize: 16,
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 8,
  },
  link_text: {
    color: theme.colors.bitcoin,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  footer: {
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  dots_container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border,
    marginHorizontal: 4,
  },
  dot_active: {
    backgroundColor: theme.colors.primary,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  button_text: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default OnboardingWalletScreen;
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Pressable, SafeAreaView, FlatList, Dimensions, Image, Linking, Clipboard } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from '../components/StyledText';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 


const { width } = Dimensions.get('window');
const REPO_URL = 'https://github.com/TrustlessWallet/Trustless';
const OPEN_SOURCE_IMAGE_WIDTH = 1486;
const OPEN_SOURCE_IMAGE_HEIGHT = 3040;
const IMAGE_ASPECT_RATIO = OPEN_SOURCE_IMAGE_WIDTH / OPEN_SOURCE_IMAGE_HEIGHT;
const QR_OVERLAY = {
  left: 230 / OPEN_SOURCE_IMAGE_WIDTH,
  top: 1010 / OPEN_SOURCE_IMAGE_HEIGHT,
  width: 1015 / OPEN_SOURCE_IMAGE_WIDTH,
  height: 1045 / OPEN_SOURCE_IMAGE_HEIGHT,
};
const QR_CARD_PADDING = 16;


const slides = [
  {
    key: '1',
    headline: 'Create your wallet',
    body: 'Non-custodial wallet in seconds.\nYour keys, your Bitcoin.',
    image: require('../../assets/Wallet-onboarding.png'),
  },
  {
    key: '2',
    headline: 'Send Bitcoin',
    body: 'Adjust fees and review all details before broadcasting.',
    image: require('../../assets/Transaction-onboarding.png'),
  },
  {
    key: '3',
    headline: 'Rotate addresses',
    body: 'Have 20 unused addresses at all times. Privacy above all else.',
    image: require('../../assets/Receive-onboarding.png'),
  },
  {
    key: '4',
    headline: 'Use lightning',
    body: 'Instant payments with low fees.\nJust tap and go.',
    image: require('../../assets/Lightning-onboarding.png'),
  },
  {
    key: '5',
    headline: 'Find merchants',
    body: 'Discover places that accept Bitcoin \n and Lightning near you.',
    image: require('../../assets/Map-onboarding.png'),
  },
  {
    key: '6',
    headline: 'Control your coins',
    body: 'Manually select which UTXOs to spend. You are in charge.',
    image: require('../../assets/Coin-control-onboarding.png'),
  },
  {
    key: '7',
    headline: 'Connect your node',
    body: 'Connect to your own Electrum node for maximum privacy.',
    image: require('../../assets/Node-onboarding.png'),
  },
  {
    key: '8',
    headline: 'Open source',
    body: 'Trustless is fully open source.\n',
    link_text: 'Audit the code yourself.',
    link: REPO_URL,
    image: require('../../assets/Open-source-onboarding.png'),
    qr_value: REPO_URL,
  },
];

const SlideItem = React.memo(({ item, styles, handle_link_press, theme }: any) => {
  const [copied, set_copied] = useState(false);
  const [qr_box_width, set_qr_box_width] = useState(0);
  const copy_timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copy_timeout_ref.current) clearTimeout(copy_timeout_ref.current);
    };
  }, []);

  const copy_repo_url = () => {
    if (!item.qr_value) return;
    Clipboard.setString(item.qr_value);
    set_copied(true);
    if (copy_timeout_ref.current) clearTimeout(copy_timeout_ref.current);
    copy_timeout_ref.current = setTimeout(() => set_copied(false), 1500);
  };

  return (
    <View style={styles.slide}>
      <View style={styles.phone_container}>
        <View style={styles.image_aspect_wrapper}>
          <Image
            source={item.image}
            style={styles.image_fill}
            resizeMode="contain"
          />

          {item.qr_value && (
            <View style={styles.qr_overlay_position} pointerEvents="box-none">
              <Pressable
                style={({ pressed }) => [styles.qr_card, { opacity: pressed ? 0.8 : 1 }]}
                onPress={copy_repo_url}
                onLayout={(e) => set_qr_box_width(e.nativeEvent.layout.width)}
              >
                {copied && (
                  <View style={styles.qr_copied_overlay} pointerEvents="none">
                    <Feather name="copy" size={28} color={theme.colors.primary} />
                    <Text style={styles.qr_copied_text}>Copied!</Text>
                  </View>
                )}
                {qr_box_width > 0 && (
                  <QRCode
                    value={item.qr_value}
                    size={qr_box_width - QR_CARD_PADDING * 2}
                    backgroundColor={theme.colors.background}
                    color={theme.colors.primary}
                  />
                )}
              </Pressable>
            </View>
          )}
        </View>
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

  useEffect(() => {
    mark_onboarding_complete();
  }, []);

  const handle_complete_onboarding = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  };

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
      theme={theme}
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
        removeClippedSubviews={false} 
        initialNumToRender={slides.length}
        maxToRenderPerBatch={slides.length}
        windowSize={21}
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
            {current_index === slides.length - 1 ? 'Get started' : 'Next'}
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
    height: '85%',
    aspectRatio: 9 / 19.5, 
    justifyContent: 'center',
    alignItems: 'center',
  },
  image_aspect_wrapper: {
    width: '100%',
    aspectRatio: IMAGE_ASPECT_RATIO,
  },
  image_fill: {
    width: '100%',
    height: '100%',
  },
  qr_overlay_position: {
    position: 'absolute',
    left: `${QR_OVERLAY.left * 100}%`,
    top: `${QR_OVERLAY.top * 100}%`,
    width: `${QR_OVERLAY.width * 100}%`,
    height: `${QR_OVERLAY.height * 100}%`,
  },
  qr_card: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: QR_CARD_PADDING,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isDark ? 0.3 : 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  qr_copied_overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.background + 'CC',
    borderRadius: 8,
    gap: 8,
    zIndex: 10,
  },
  qr_copied_text: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  text_container: {
    alignItems: 'center',
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: -8
  },
  body_text: {
    fontSize: 16,
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 4,
  },
  link_text: {
    color: theme.colors.bitcoin,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  footer: {
    paddingBottom: 32,
    marginTop: 8,
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
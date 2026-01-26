import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, FlatList, Dimensions, Image, Linking, Clipboard } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video, { VideoRef } from 'react-native-video';
import QRCode from 'react-native-qrcode-svg';
import { Feather } from '@expo/vector-icons';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 

const { width } = Dimensions.get('window');

const REPO_URL = 'https://github.com/pechen987/Trustless';

const slides = [
  {
    key: '1',
    headline: 'Create your wallet',
    body: 'Generate new, non-custodial wallet in seconds. Your keys, your Bitcoin.',
    video: require('../../assets/CreateWalletOnboardingFinal.mov'),
    type: 'video',
  },
  {
    key: '2',
    headline: 'Manage multiple wallets',
    body: 'Create, import, and switch between several wallets.',
    video: require('../../assets/ManageMultipleWalletsOnboardingFinal.mov'),
    type: 'video',
  },
  {
    key: '3',
    headline: 'Change receive addresses',
    body: 'Have 20 unused addresses at all times. Privacy above all else.',
    video: require('../../assets/ChangeReceiveAddressOnboardingFinal.mov'),
    type: 'video',
  },
   {
    key: '4',
    headline: 'Coin control',
    body: 'Manually select which UTXOs to spend. You are in charge.',
    video: require('../../assets/CoinControlOnboardingFinal.mov'),
    type: 'video',
  },
  {
    key: '5',
    headline: 'Connect your node',
    body: 'Connect to your own Electrum or Esplora node for maximum privacy.',
    video: require('../../assets/CustomNodeOnboardingFinal.mov'),
    type: 'video',
  },
  {
    key: '6',
    headline: 'Switch networks',
    body: 'Toggle between Mainnet and Testnet for development or testing.',
    video: require('../../assets/NetworkSwitcherOnboardingFinal.mov'),
    type: 'video',
  },
  {
    key: '7',
    headline: 'Fully open source',
    body: 'Trustless is built for transparency. ',
    linkText: 'Audit the code yourself.',
    link: REPO_URL,
    type: 'qr',
  },
];

const OnboardingWalletScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingWallet'>>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const videoRefs = useRef<(VideoRef | null)[]>([]);
  const isScreenFocused = useIsFocused();
  const { theme, isDark } = useTheme(); 
  const styles = useMemo(() => getStyles(theme, isDark), [theme, isDark]); 

  const handleCompleteOnboarding = async () => {
    try {
      await AsyncStorage.setItem('@hasCompletedOnboarding', 'true');
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    } catch (e) {
      console.error('Failed to save onboarding status', e);
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      handleCompleteOnboarding();
    }
  };

  const handleLinkPress = (url: string) => {
    Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
  };

  const handleCopyLink = () => {
    Clipboard.setString(REPO_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      AsyncStorage.setItem('@hasCompletedOnboarding', 'true');
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (isScreenFocused && videoRefs.current[currentIndex]) {
      videoRefs.current[currentIndex]?.seek(0);
    }
  }, [currentIndex, isScreenFocused]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      const newIndex = viewableItems[0].index;
      setCurrentIndex(newIndex);
    }
  }).current;

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        keyExtractor={(item) => item.key}
        renderItem={({ item, index }) => (
          <View style={styles.slide}>
            <View style={styles.phoneContainer}>
              <View style={[
                  styles.videoWrapper, 
                  item.type === 'qr' && styles.qrWrapperBackground 
                ]}>
                {item.type === 'video' ? (
                  <Video
                    ref={(ref: VideoRef | null) => {
                      videoRefs.current[index] = ref;
                    }}
                    source={item.video}
                    style={styles.videoFill}
                    muted={true}
                    repeat={true}
                    resizeMode="cover"
                    paused={!isScreenFocused || currentIndex !== index}
                  />
                ) : (
                  <View style={styles.qrContainer}>
                    <TouchableOpacity 
                      style={styles.qrBox} 
                      onPress={handleCopyLink}
                      activeOpacity={0.8}
                    >
                      {copied && (
                        <View style={styles.copiedOverlay}>
                          <Feather name="copy" size={24} color={theme.colors.primary} />
                          <Text style={styles.copiedText}>Copied!</Text>
                        </View>
                      )}
                      <QRCode 
                        value={REPO_URL}
                        size={150} 
                        color={theme.colors.primary}
                        backgroundColor={theme.colors.background}
                      />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <Image
                source={require('../../assets/iPhone16Plus.png')}
                style={styles.frameOverlay}
                resizeMode="contain"
              />
            </View>

            <View style={styles.textContainer}>
              <Text style={styles.headline}>{item.headline}</Text>
              <Text style={styles.bodyText}>
                {item.body}
                {item.linkText && item.link && (
                  <Text 
                    style={styles.linkText} 
                    onPress={() => handleLinkPress(item.link!)}
                  >
                    {item.linkText}
                  </Text>
                )}
              </Text>
            </View>
          </View>
        )}
      />
      
      <View style={styles.footer}>
        <View style={styles.dotsContainer}>
          {slides.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, index === currentIndex && styles.dotActive]}
            />
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>
            {currentIndex === slides.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const getStyles = (theme: Theme, isDark: boolean) => StyleSheet.create({
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
    paddingTop: 8,
    backgroundColor: theme.colors.background,
  },
  phoneContainer: {
    height: '70%',
    aspectRatio: 9 / 19.5, 
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    position: 'relative',
  },
  videoWrapper: {
    width: '103%', 
    height: '102%',
    borderRadius: 30, 
    overflow: 'hidden', 
    position: 'absolute',
    zIndex: 20, 
    backgroundColor: 'black', 
  },
  qrWrapperBackground: {
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    width: '100%',
    height: '100%',
  },
  qrBox: {
    padding: 16,
    backgroundColor: theme.colors.background,
    borderRadius: 8,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: isDark ? 0.3 : 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden', 
  },
  copiedOverlay: { 
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: isDark ? 'rgba(0, 0, 0, 0.95)' : 'rgba(255, 255, 255, 0.95)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: 8,
    zIndex: 10,
  },
  copiedText: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: theme.colors.primary 
  },
  videoFill: {
    width: '100%',
    height: '100%',
  },
  frameOverlay: {
    width: '115%',
    height: '105%',
    zIndex: 1, 
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: 4,
  },
  bodyText: {
    fontSize: 16,
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 8,
  },
  linkText: {
    color: theme.colors.bitcoin,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  footer: {
    paddingBottom: 32,
    paddingHorizontal: 24,
  },
  dotsContainer: {
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
  dotActive: {
    backgroundColor: theme.colors.primary,
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default OnboardingWalletScreen;
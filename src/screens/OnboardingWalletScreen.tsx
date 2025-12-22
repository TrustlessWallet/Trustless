import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, FlatList, Dimensions, Image } from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video, { VideoRef } from 'react-native-video';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
const { width } = Dimensions.get('window');
const slides = [
  {
    key: '1',
    headline: 'Create your wallet',
    body: 'Generate new, non-custodial wallet in seconds. Your keys, your Bitcoin.',
    video: require('../../assets/CreateWalletOnboardingFinal.mov'),
  },
  {
    key: '2',
    headline: 'Manage multiple wallets',
    body: 'Create, import, and switch between several wallets.',
    video: require('../../assets/ManageMultipleWalletsOnboardingFinal.mov'),
  },
  {
    key: '3',
    headline: 'Change receive addresses',
    body: 'Have 20 unused addresses at all times. Privacy above all else.',
    video: require('../../assets/ChangeReceiveAddressOnboardingFinal.mov'),
  },
   {
    key: '4',
    headline: 'Coin control',
    body: 'Manually select which UTXOs to spend. You are in charge.',
    video: require('../../assets/CoinControlOnboardingFinal.mov'),
  },
];
const OnboardingWalletScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingWallet'>>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const videoRefs = useRef<(VideoRef | null)[]>([]);
  const isScreenFocused = useIsFocused();
  const { theme } = useTheme(); 
  const styles = useMemo(() => getStyles(theme), [theme]); 
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
            {}
            <View style={styles.phoneContainer}>
              {}
              <View style={styles.videoWrapper}>
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
              </View>
              {}
              <Image
                source={require('../../assets/iPhone16Plus.png')}
                style={styles.frameOverlay}
                resizeMode="contain"
              />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.headline}>{item.headline}</Text>
              <Text style={styles.bodyText}>{item.body}</Text>
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
const getStyles = (theme: Theme) => StyleSheet.create({
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
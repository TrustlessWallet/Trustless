import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, Dimensions, Image } from 'react-native';
import { Text } from '../components/StyledText';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import Video from 'react-native-video';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';
const { width } = Dimensions.get('window');
const OnboardingTrackerScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingTracker'>>();
  const isFocused = useIsFocused();
  const { theme } = useTheme();
  const styles = useMemo(() => getStyles(theme), [theme]);
  const handleNext = () => {
    navigation.goBack();
  };
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.phoneContainer}>
          <View style={styles.videoWrapper}>
            {isFocused && (
              <Video
                key={Date.now()}
                source={require('../../assets/TrackerOnboardingFinal.mov')} 
                style={styles.videoFill}
                muted={true}
                repeat={true}
                resizeMode="cover"
              />
            )}
          </View>
          {}
          <Image
            source={require('../../assets/iPhone16Plus.png')}
            style={styles.frameOverlay}
            resizeMode="contain"
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.headline}>Track any wallet</Text>
          <Text style={styles.bodyText}>
            Add bitcoin addresses to monitor. No keys required.
          </Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>Continue</Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  phoneContainer: {
    height: '65%',
    aspectRatio: 9 / 19.5, 
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    position: 'relative',
  },
  videoWrapper: {
    width: '104%', 
    height: '103%',
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
    width: '114.5%',
    height: '105.5%',
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
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});
export default OnboardingTrackerScreen;
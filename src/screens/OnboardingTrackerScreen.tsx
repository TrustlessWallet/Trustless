import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView, Image } from 'react-native';
import { Text } from '../components/StyledText';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { Theme } from '../constants/theme';

const OnboardingTrackerScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingTracker'>>();
  const { theme } = useTheme();
  const styles = useMemo(() => get_styles(theme), [theme]);
  
  const handle_next = () => {
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.phone_container}>
          <Image
            source={require('../../assets/Tracking onboarding.png')} 
            style={styles.image_fill}
            resizeMode="contain"
          />
        </View>
        <View style={styles.text_container}>
          <Text style={styles.headline}>Track any wallet</Text>
          <Text style={styles.body_text}>
            Add bitcoin addresses to monitor. No keys required.
          </Text>
        </View>
        <TouchableOpacity style={styles.button} onPress={handle_next}>
          <Text style={styles.button_text}>Continue</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const get_styles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  phone_container: {
    height: '70%',
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
    marginBottom: 24,
  },
  headline: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: 4,
  },
  body_text: {
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
  },
  button_text: {
    color: theme.colors.inversePrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default OnboardingTrackerScreen;
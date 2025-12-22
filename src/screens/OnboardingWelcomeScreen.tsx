import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';
import { Text } from '../components/StyledText';
import { useTheme } from '../contexts/ThemeContext'; 
import { Theme } from '../constants/theme'; 
const OnboardingWelcomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OnboardingWelcome'>>();
  const { theme } = useTheme(); 
  const styles = useMemo(() => getStyles(theme), [theme]); 
  const handleNext = () => {
    navigation.goBack();
  };
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.walletName}>Trustless</Text>
        <View style={styles.centerText}>
            <Text style={styles.featureText}>No state</Text>
            <Text style={styles.featureText}>No banks</Text>
            <Text style={styles.featureText}>No trust</Text>
        </View>
        <View style={styles.bottomContainer}>
          <Text style={styles.welcomeText}>
            Welcome to <Text style={styles.orangeSymbol}>Bitcoin</Text>
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleNext}>
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
        </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
  },
  walletName: {
    fontSize: 48,
    fontWeight: 'bold',
    color: theme.colors.primary, 
    marginTop: '20%',
  },
  centerText: {
    alignItems: 'center',
  },
  featureText: {
    fontSize: 24,
    color: theme.colors.primary, 
    marginVertical: 8,
  },
  bottomContainer: {
    width: '100%',
    alignItems: 'center',
  },
  welcomeText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.primary, 
    marginBottom: 24,
  },
  orangeSymbol: {
    color: theme.colors.bitcoin, 
    fontWeight: 'bold',
  },
  button: {
    backgroundColor: theme.colors.primary, 
    borderRadius: 8,
    paddingVertical: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonText: {
    color: theme.colors.inversePrimary, 
    fontSize: 16,
    fontWeight: '600',
  },
});
export default OnboardingWelcomeScreen;
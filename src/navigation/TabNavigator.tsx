import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import DashboardScreen from '../screens/DashboardScreen';
import WalletScreen from '../screens/WalletScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { Text } from '../components/StyledText';

const Tab = createBottomTabNavigator<TabParamList>();

const TabNavigator = () => {
  const { theme, isDark } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Tab.Navigator
        screenOptions={{
          sceneStyle: { backgroundColor: theme.colors.background },
          headerShown: true, 
          headerTitle: '', 
          headerStyle: {
            backgroundColor: isDark ? theme.colors.background : theme.colors.background,
            height: 58, 
          },
          headerShadowVisible: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.muted,
          tabBarStyle: {
            backgroundColor: theme.colors.background,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            elevation: 0,
          },
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
            fontFamily: 'SpaceMono-Bold',
          }
        }}
      >
        <Tab.Screen 
          name="Tracker" 
          component={DashboardScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ 
                color, 
                fontSize: 24, 
                fontWeight: focused ? 'bold' : 'normal',
                fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular' 
              }}>
                T
              </Text>
            )
          }}
        />
        <Tab.Screen 
          name="Wallet" 
          component={WalletScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ 
                color, 
                fontSize: 24, 
                fontWeight: focused ? 'bold' : 'normal',
                fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular'
              }}>
                W
              </Text>
            )
          }}
        />
        <Tab.Screen 
          name="Settings" 
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <Text style={{ 
                color, 
                fontSize: 24, 
                fontWeight: focused ? 'bold' : 'normal',
                fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular'
              }}>
                S
              </Text>
            )
          }}
        />
      </Tab.Navigator>
    </View>
  );
};

export default TabNavigator;
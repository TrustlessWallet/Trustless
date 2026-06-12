import React from 'react';
import { View } from 'react-native';
import { createNativeBottomTabNavigator } from '@react-navigation/bottom-tabs/unstable';
import { useIsFocused } from '@react-navigation/native';

import { TabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import WalletScreen from '../screens/WalletScreen';
import SettingsScreen from '../screens/SettingsScreen';
import MapScreen from '../screens/MapScreen';

const Tab = createNativeBottomTabNavigator<TabParamList>();

const TabNavigator = () => {
  const { theme } = useTheme();
  const isFocused = useIsFocused();

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      pointerEvents={isFocused ? 'auto' : 'none'}
    >
      <Tab.Navigator
        initialRouteName="Wallet"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.surface,
        }}
      >
        {/* Map Screen */}
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            title: '',
            tabBarIcon: ({ focused }) => ({
              type: 'sfSymbol',
              name: focused ? 'map.fill' : 'map',
            } as any), 
          }}
        />
        
        {/* Wallet Screen */}
        <Tab.Screen
          name="Wallet"
          component={WalletScreen}
          options={{
            title: '',
            tabBarIcon: ({ focused }) => ({
              type: 'sfSymbol',
              name: focused ? 'bitcoinsign.circle.fill' : 'bitcoinsign.circle',
            } as any),
          }}
        />
        
        {/* Settings Screen */}
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: '',
            tabBarIcon: ({ focused }) => ({
              type: 'sfSymbol',
              name: focused ? 'gearshape.fill' : 'gearshape',
            } as any),
          }}
        />
      </Tab.Navigator>
    </View>
  );
};

export default TabNavigator;
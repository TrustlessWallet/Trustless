import React from 'react';
import { View, StyleSheet, useWindowDimensions, Text as RNText, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import WalletScreen from '../screens/WalletScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useIsFocused } from '@react-navigation/native';
import MapScreen from '../screens/MapScreen';
import { GlassView } from '../components/GlassView';

const Tab = createBottomTabNavigator<TabParamList>();

function LiquidGlassTabBar({ state, descriptors, navigation, theme }: BottomTabBarProps & { theme: any }) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const TAB_BAR_WIDTH = SCREEN_WIDTH - 48;
  const TAB_WIDTH = TAB_BAR_WIDTH / state.routes.length;

  const BUBBLE_W = TAB_WIDTH - 16;
  const BUBBLE_H = 56;
  const bubbleLeft = state.index * TAB_WIDTH + 8;

  return (
    <View style={styles.container}>
      {/* ── Background glass pill ── */}
      <GlassView
        width={TAB_BAR_WIDTH}
        height={72}
        shape="capsule"
        tintColor={theme.colors.surface + '99'}
        interactive={true}
        fallbackColor={theme.colors.surface}
        fallbackOpacity={0.99}
        style={styles.glassLayer}
      />

      {/* ── Liquid-glass bubble (at root level to prevent clipping) ── */}
      <View
        style={[
          styles.bubble,
          {
            width: BUBBLE_W,
            height: BUBBLE_H,
            left: bubbleLeft,
          },
        ]}
        pointerEvents="none"
      >
        <GlassView
          width={BUBBLE_W}
          height={BUBBLE_H}
          shape="capsule"
          variant="clear"
          tintColor={theme.colors.surface + '10'}
          fallbackColor={theme.colors.primary}
          fallbackOpacity={0.85}
          interactive={true}
          style={styles.glassOverflowOverride}
        />
      </View>

      {/* ── Tab touch targets ── */}
      <View style={styles.touchArea}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const labelText =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          const activeColor = isFocused ? theme.colors.primary : theme.colors.primary;
          const inactiveColor = theme.colors.primary;
          const color = isFocused ? activeColor : inactiveColor;

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tabButton}
              activeOpacity={0.8}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
            >
              <View style={styles.tabContent}>
                {options.tabBarIcon?.({ focused: isFocused, color, size: 24 })}
                <RNText
                  style={{
                    color,
                    fontSize: 11,
                    fontFamily: isFocused ? 'SpaceMono-Bold' : 'SpaceMono-Regular',
                    marginTop: 2,
                  }}
                >
                  {labelText}
                </RNText>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

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
        tabBar={(props) => <LiquidGlassTabBar {...props} theme={theme} />}
        screenOptions={{
          sceneStyle: { backgroundColor: theme.colors.background },
          headerShown: false,
          tabBarStyle: { position: 'absolute' },
        }}
      >
        <Tab.Screen
          name="Map"
          component={MapScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <RNText
                style={{
                  color,
                  fontSize: 24,
                  fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular',
                }}
              >
                M
              </RNText>
            ),
          }}
        />
        <Tab.Screen
          name="Wallet"
          component={WalletScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <RNText
                style={{
                  color,
                  fontSize: 24,
                  fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular',
                }}
              >
                W
              </RNText>
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <RNText
                style={{
                  color,
                  fontSize: 24,
                  fontFamily: focused ? 'SpaceMono-Bold' : 'SpaceMono-Regular',
                }}
              >
                S
              </RNText>
            ),
          }}
        />
      </Tab.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    height: 72,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'visible',
  },
  glassLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 0,
    overflow: 'visible',
  },
  touchArea: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    zIndex: 2,
    overflow: 'visible',
  },
  tabButton: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  bubble: {
    position: 'absolute',
    top: 8,
    zIndex: 1,
    overflow: 'visible',
  },
  glassOverflowOverride: {
    overflow: 'visible',
  },
  tabContent: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
});

export default TabNavigator;
import React, { useRef, useEffect } from 'react';
import { View, Platform, StyleSheet, Animated, PanResponder, useWindowDimensions, Text as RNText, TouchableOpacity } from 'react-native';
import { createBottomTabNavigator, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { TabParamList } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import WalletScreen from '../screens/WalletScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useIsFocused } from '@react-navigation/native';
import MapScreen from '../screens/MapScreen';

import { Host, ZStack } from '@expo/ui/swift-ui';
import { glassEffect, cornerRadius, frame, tint } from '@expo/ui/swift-ui/modifiers';

const Tab = createBottomTabNavigator<TabParamList>();

function LiquidGlassTabBar({ state, descriptors, navigation, theme }: BottomTabBarProps & { theme: any }) {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const TAB_BAR_WIDTH = SCREEN_WIDTH - 48;
  const TAB_WIDTH = TAB_BAR_WIDTH / state.routes.length;

  const BUBBLE_W = TAB_WIDTH - 16;
  const BUBBLE_H = 56;

  // +8 baked in so the bubble sits centred in its slot (avoids Animated.add in render)
  const translateX = useRef(new Animated.Value(state.index * TAB_WIDTH + 8)).current;
  // Tracks raw drag delta so we can derive a horizontal stretch
  const dragDx = useRef(new Animated.Value(0)).current;

  // scaleX: stretches up to ~1.25 at ±60 px of drag, then eases back
  const scaleX = dragDx.interpolate({
    inputRange: [-60, -20, 0, 20, 60],
    outputRange: [1.25, 1.12, 1, 1.12, 1.25],
    extrapolate: 'clamp',
  });

  // scaleY: squishes slightly when stretched (liquid feel)
  const scaleY = dragDx.interpolate({
    inputRange: [-60, -20, 0, 20, 60],
    outputRange: [1.20, 1.1, 1, 1.1, 1.20],
    extrapolate: 'clamp',
  });

  // Keep live refs so the panResponder (created once) always reads current values.
  // Without this, state.index / TAB_WIDTH / navigation are stale closures.
  const stateRef = useRef(state);
  const navigationRef = useRef(navigation);
  const tabWidthRef = useRef(TAB_WIDTH);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { navigationRef.current = navigation; }, [navigation]);
  useEffect(() => { tabWidthRef.current = TAB_WIDTH; }, [TAB_WIDTH]);

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: state.index * TAB_WIDTH + 8,
      useNativeDriver: true,
      bounciness: 14,
      speed: 14,
    }).start();
  }, [state.index, TAB_WIDTH]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 5,

      onPanResponderGrant: (evt) => {
        const TW = tabWidthRef.current;
        const numRoutes = stateRef.current.routes.length;
        const touchX = evt.nativeEvent.pageX - 24;
        const offset = touchX - TW / 2;
        dragDx.setValue(0);
        Animated.timing(translateX, {
          toValue: Math.max(8, Math.min(offset + 8, TW * (numRoutes - 1) + 8)),
          duration: 50,
          useNativeDriver: true,
        }).start();
      },

      onPanResponderMove: (evt, gestureState) => {
        const TW = tabWidthRef.current;
        const numRoutes = stateRef.current.routes.length;
        const touchX = evt.nativeEvent.pageX - 24;
        const offset = touchX - TW / 2;
        translateX.setValue(Math.max(8, Math.min(offset + 8, TW * (numRoutes - 1) + 8)));
        dragDx.setValue(Math.max(-80, Math.min(80, gestureState.dx)));
      },

      onPanResponderRelease: () => {
        const TW = tabWidthRef.current;
        const currentState = stateRef.current;
        const nav = navigationRef.current;

        // Read bubble position directly — unambiguous regardless of drag origin
        const bubbleLeft = (translateX as any)._value - 8;
        let index = Math.round(bubbleLeft / TW);
        index = Math.max(0, Math.min(index, currentState.routes.length - 1));

        // Snap bubble to resolved slot
        Animated.spring(translateX, {
          toValue: index * TW + 8,
          useNativeDriver: true,
          bounciness: 12,
          speed: 14,
        }).start();

        // Release stretch
        Animated.spring(dragDx, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 18,
          speed: 16,
        }).start();

        if (currentState.index !== index) {
          const route = currentState.routes[index];
          const event = nav.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!event.defaultPrevented) {
            nav.navigate(route.name);
          }
        }
      },

      onPanResponderTerminate: () => {
        const TW = tabWidthRef.current;
        const currentState = stateRef.current;
        Animated.spring(translateX, {
          toValue: currentState.index * TW + 8,
          useNativeDriver: true,
          bounciness: 12,
          speed: 14,
        }).start();
        Animated.spring(dragDx, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 18,
          speed: 16,
        }).start();
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      {/* ── Background glass pill ── */}
      {Platform.OS === 'ios' ? (
        <Host style={styles.glassLayer}>
          <ZStack
            modifiers={[
              frame({ width: TAB_BAR_WIDTH, height: 72 }),
              glassEffect({ glass: { tint: theme.colors.surface + '99', variant: 'clear', interactive: true } }),
              cornerRadius(36),
            ]}
          >
            <View />
          </ZStack>
        </Host>
      ) : (
        <View
          style={[
            styles.glassLayer,
            { opacity: 0.95, borderRadius: 36 },
          ]}
        />
      )}

      {/* ── Liquid-glass bubble ── */}
      <Animated.View
        style={[
          styles.bubble,
          {
            width: BUBBLE_W,
            height: BUBBLE_H,
            transform: [
              { translateX },
              // Stretch horizontally and squish vertically while dragging
              { scaleX },
              { scaleY },
            ],
          },
        ]}
        pointerEvents="none"
      >
        {Platform.OS === 'ios' ? (
          <Host style={StyleSheet.absoluteFill}>
            <ZStack
              modifiers={[
                frame({ width: BUBBLE_W, height: BUBBLE_H }),
                glassEffect({ glass: { variant: 'clear' } }),
                cornerRadius(28),
              ]}
            >
              <View />
            </ZStack>
          </Host>
        ) : (
          // Android fallback: semi-transparent tinted pill
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: theme.colors.primary,
                opacity: 0.85,
                borderRadius: 28,
              },
            ]}
          />
        )}
      </Animated.View>

      {/* ── Tab touch targets ── */}
      <View style={styles.touchArea} {...panResponder.panHandlers}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const labelText =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title !== undefined
              ? options.title
              : route.name;

          // On iOS the bubble is now glass-coloured, so use the primary colour for
          // focused icons/labels so they still pop against the glass.
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
  },
  glassLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  bubble: {
    position: 'absolute',
    top: 8,
    left: 0,
    borderRadius: 28,
    zIndex: 1,
    overflow: 'hidden',
  },
  touchArea: {
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    zIndex: 2,
  },
  tabButton: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default TabNavigator;
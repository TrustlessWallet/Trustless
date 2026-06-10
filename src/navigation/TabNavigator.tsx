import React, { useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
  Text as RNText,
  TouchableOpacity,
  PanResponder,
  Animated
} from 'react-native';
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

  const BUBBLE_W = TAB_WIDTH - 18;
  const BUBBLE_H = 56;

  const stateRef = useRef({
    index: state.index,
    routes: state.routes,
    navigation: navigation,
    tabWidth: TAB_WIDTH,
  });

  useEffect(() => {
    stateRef.current = {
      index: state.index,
      routes: state.routes,
      navigation: navigation,
      tabWidth: TAB_WIDTH,
    };
  }, [state.index, state.routes, navigation, TAB_WIDTH]);

  const animatedX = useRef(new Animated.Value(state.index * TAB_WIDTH)).current;
  const currentX = useRef(state.index * TAB_WIDTH);

  useEffect(() => {
    const listenerId = animatedX.addListener(({ value }) => {
      currentX.current = value;
    });
    return () => animatedX.removeListener(listenerId);
  }, [animatedX]);

  useEffect(() => {
    Animated.spring(animatedX, {
      toValue: state.index * TAB_WIDTH,
      useNativeDriver: true,
      bounciness: 2,
      speed: 14,
    }).start();
  }, [state.index, TAB_WIDTH, animatedX]);


  const dragStartX = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5;
      },
      onPanResponderGrant: () => {
        animatedX.stopAnimation();
        // Record the exact position when the drag starts
        dragStartX.current = currentX.current;
        animatedX.setOffset(dragStartX.current);
        animatedX.setValue(0);
      },
      onPanResponderMove: (_, gestureState) => {
        const { tabWidth, routes } = stateRef.current;
        const minX = 0;
        const maxX = (routes.length - 1) * tabWidth;

        // Calculate new position
        let targetX = dragStartX.current + gestureState.dx;

        // Clamp between min and max bounds
        if (targetX < minX) targetX = minX;
        if (targetX > maxX) targetX = maxX;

        // Apply the clamped value relative to the start offset
        animatedX.setValue(targetX - dragStartX.current);
      },
      onPanResponderRelease: () => {
        animatedX.flattenOffset();

        const { tabWidth, routes, index, navigation } = stateRef.current;

        let targetIndex = Math.round(currentX.current / tabWidth);
        targetIndex = Math.max(0, Math.min(targetIndex, routes.length - 1));

        Animated.spring(animatedX, {
          toValue: targetIndex * tabWidth,
          useNativeDriver: true,
          bounciness: 2,
          speed: 14,
        }).start();

        if (targetIndex !== index) {
          navigation.navigate(routes[targetIndex].name);
        }
      },
    })
  ).current;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* ── Background glass pill ── */}
      <GlassView
        width={TAB_BAR_WIDTH}
        height={72}
        shape="capsule"
        tintColor={theme.colors.surface + '99'}
        interactive={false}
        fallbackColor={theme.colors.surface}
        fallbackOpacity={0.99}
        style={styles.glassLayer}
      />

      {/* ── Liquid-glass bubble ── */}
      <Animated.View
        style={[
          styles.bubble,
          {
            width: BUBBLE_W,
            height: BUBBLE_H,
            left: 8,
            transform: [{ translateX: animatedX }]
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
      </Animated.View>

      {/* ── Tab touch targets ── */}
      <View style={styles.touchArea} pointerEvents="box-none">
        {state.routes.map((route, idx) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === idx;

          const labelText =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : options.title !== undefined
                ? options.title
                : route.name;

          const color = theme.colors.primary;

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
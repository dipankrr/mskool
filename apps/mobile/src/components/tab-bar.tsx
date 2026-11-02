import { useCallback, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useFocusEffect } from "expo-router";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Animated, { makeMutable, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { colors } from "../theme/brand-admin";
import { motion, radius, shadow, spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * The floating tab bar (probe anatomy): a 64 pt capsule hovering 12 pt above
 * the safe area, 6 pt of padding, icon over an 11 pt label. The active tab is
 * a tinted capsule with the accent colour; inactive tabs stay muted. iOS 26+
 * wears real Liquid Glass; everywhere else the solid white capsule carries a
 * soft shadow — one platform never fakes the other's material.
 *
 * The bar itself is generic: labels and icons arrive through each screen's
 * `title` / `tabBarIcon` options, so the tab set stays declarative in the
 * layout (role-aware there, not here).
 */
export const TAB_BAR_HEIGHT = 64;

/** Bottom scroll inset that clears the floating bar on any device. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return TAB_BAR_HEIGHT + spacing.md + insets.bottom + spacing.md;
}

/** How far the bar has slid down. The app has one bar, so this is one value. */
const tabBarOffset = makeMutable(0);

/** Ignores the small jitter of a finger resting on the list. */
const SCROLL_THRESHOLD = 8;

/**
 * For a long list on a tab: the bar slides away while scrolling down and returns
 * on any scroll up, giving the rows the room. It always comes back on leaving the
 * screen, so no other tab can open without it. Reanimated follows the phone's
 * reduced-motion setting, which turns the slide into a jump.
 */
export function useHideTabBarOnScroll() {
  const space = useTabBarSpace();
  const lastY = useRef(0);

  useFocusEffect(
    useCallback(
      () => () => {
        tabBarOffset.value = withTiming(0, { duration: motion.quick });
      },
      [],
    ),
  );

  return useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const moved = y - lastY.current;
      if (Math.abs(moved) < SCROLL_THRESHOLD) return;
      lastY.current = y;
      const hide = moved > 0 && y > 0;
      tabBarOffset.value = withTiming(hide ? space : 0, { duration: motion.base });
    },
    [space],
  );
}

/** For something floating just above the bar: it moves down with the bar. */
export function useFollowTabBar() {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: tabBarOffset.value }],
  }));
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateY: tabBarOffset.value }],
  }));
  const liquidGlass = Platform.OS === "ios" && isLiquidGlassAvailable();

  const tabs = state.routes
    .map((route, index) => ({ route, index }))
    // expo-router's `href: null` arrives here as `tabBarItemStyle:
    // { display: "none" }` (TabsClient strips the href option and installs
    // that style for the default bar); a custom bar must honour it itself,
    // or a hidden tab would still render.
    .filter(({ route }) => {
      const itemStyle = StyleSheet.flatten(
        descriptors[route.key]?.options.tabBarItemStyle,
      );
      return itemStyle?.display !== "none";
    })
    .map(({ route, index }) => {
      const { options } = descriptors[route.key]!;
      const focused = state.index === index;
      const color = focused ? colors.accentDeep : colors.muted;
      const label = options.title ?? route.name;

      return (
        <Pressable
          key={route.key}
          testID={`tab-${route.name}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: focused }}
          accessibilityLabel={label}
          onPress={() => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          }}
          onLongPress={() => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          }}
          style={[styles.tab, focused ? styles.tabOn : null]}
        >
          {options.tabBarIcon?.({ focused, color, size: 22 })}
          {/* The capsule is a fixed 64 pt and iOS tab labels don't take
              Dynamic Type either. With six tabs there is no width to grow
              into — even 1.15× ellipsised "Attendance" and "Homework" at
              1.3× system text — so the label stays at its designed size. */}
          <ThemedText
            variant="tab"
            color={color}
            numberOfLines={1}
            maxFontSizeMultiplier={1}
          >
            {label}
          </ThemedText>
        </Pressable>
      );
    });

  return (
    <Animated.View style={[styles.bar, { bottom: spacing.md + insets.bottom }, slide]}>
      {liquidGlass ? (
        <GlassView glassEffectStyle="regular" style={styles.capsule}>
          {tabs}
        </GlassView>
      ) : (
        <View style={[styles.capsule, styles.solid]}>{tabs}</View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    height: TAB_BAR_HEIGHT,
  },
  capsule: {
    flex: 1,
    borderRadius: radius.full,
    flexDirection: "row",
    gap: spacing.xs,
    padding: 6,
  },
  solid: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.tabBar,
  },
  tab: {
    flex: 1,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  tabOn: {
    backgroundColor: colors.accentStrong,
  },
});

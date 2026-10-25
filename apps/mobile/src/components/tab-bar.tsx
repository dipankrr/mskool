import { Platform, Pressable, StyleSheet, View } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { colors } from "../theme/brand-admin";
import { radius, shadow, spacing } from "../theme/tokens";
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

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
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
              Dynamic Type either; cap the growth so five tabs never
              ellipsise "Homework" at the largest system text sizes. */}
          <ThemedText
            variant="tab"
            color={color}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
          >
            {label}
          </ThemedText>
        </Pressable>
      );
    });

  const style = [styles.bar, { bottom: spacing.md + insets.bottom }];

  if (liquidGlass) {
    return (
      <GlassView glassEffectStyle="regular" style={style}>
        {tabs}
      </GlassView>
    );
  }
  return <View style={[style, styles.solid]}>{tabs}</View>;
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    height: TAB_BAR_HEIGHT,
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

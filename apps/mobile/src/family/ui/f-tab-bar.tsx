import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

export type FTabItem = { key: string; label: string; icon: AppIconName };

/** Bottom room a tab screen needs so its last row clears the floating bar. */
export function useFamilyTabBarSpace(): number {
  const { components } = useFamilyTheme();
  return components.tabBar.height + components.tabBar.margin;
}

/**
 * The floating bar as a plain view: icon in a pill over a label, the active
 * tab's pill filled. Look from `components.tabBar`.
 */
export function FTabBarView({
  items,
  activeKey,
  onPress,
  style,
}: {
  items: FTabItem[];
  activeKey: string;
  onPress: (key: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useFamilyTheme();
  const k = theme.components.tabBar;
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.capsule,
        {
          height: k.height,
          borderRadius: k.radius,
          backgroundColor: k.bg,
          padding: k.padding,
          borderColor: k.border,
          boxShadow: k.shadow,
        },
        style,
      ]}
    >
      {items.map((item) => {
        const focused = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            testID={`family-tab-${item.key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => {
              if (!focused) void Haptics.selectionAsync();
              onPress(item.key);
            }}
            style={[styles.tab, { gap: theme.space.xxs }]}
          >
            <View style={[styles.iconPill, { width: k.iconPill.width, height: k.iconPill.height }]}>
              {/* Its own view, mounted when active: on Android a background that
                  switches from transparent to a colour can lose its rounding. */}
              {focused ? (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { borderRadius: k.iconPill.radius, backgroundColor: k.activeBg },
                  ]}
                />
              ) : null}
              <AppIcon name={item.icon} size={k.iconSize} color={focused ? k.activeFg : k.fg} />
            </View>
            <FText
              variant="caption"
              tint={focused ? theme.color.ink : k.fg}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
              // Five tabs on a 360-wide phone: a long word shrinks instead of touching its neighbour.
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={styles.label}
            >
              {item.label}
            </FText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The bar for expo-router's `Tabs`. Each screen sets `title` (translated)
 * and `tabBarIcon` via the layout; a hidden tab (`href: null`) is skipped.
 */
export function FTabBar({ state, descriptors, navigation, icons }: BottomTabBarProps & { icons: Record<string, AppIconName> }) {
  const insets = useSafeAreaInsets();
  const { components } = useFamilyTheme();
  const items: FTabItem[] = state.routes
    .filter((route) => StyleSheet.flatten(descriptors[route.key]?.options.tabBarItemStyle)?.display !== "none")
    .map((route) => ({
      key: route.name,
      label: descriptors[route.key]?.options.title ?? route.name,
      icon: icons[route.name] ?? "home",
    }));
  const active = state.routes[state.index]?.name ?? "";

  return (
    <View
      style={[
        styles.floating,
        { left: components.tabBar.margin, right: components.tabBar.margin, bottom: insets.bottom + components.tabBar.margin / 2 },
      ]}
    >
      <FTabBarView
        items={items}
        activeKey={active}
        onPress={(name) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route) return;
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (name !== active && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  floating: {
    position: "absolute",
  },
  capsule: {
    flexDirection: "row",
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { letterSpacing: 0 },
  iconPill: {
    alignItems: "center",
    justifyContent: "center",
  },
});

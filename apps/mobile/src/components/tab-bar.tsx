import { createRef, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useFocusEffect } from "expo-router";
import { BlurTargetView, BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import Animated, {
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "expo-router/js-tabs";

import { motion, radius, spacing } from "../theme/tokens";
import { PAST_BANNER_HEIGHT, PastSessionBanner, usePastBannerShown } from "./past-session-banner";
import { ThemedText } from "./themed-text";

/**
 * The floating tab bar (probe anatomy): a 64 pt bar with 24 pt corners
 * hovering 12 pt above the safe area, 6 pt of padding, icon over an 11 pt label.
 *
 * It is smoked glass: a dark graphite bar, so it stands out on the app's
 * white screens, with a lit top edge, a light rim and a soft gloss over its top
 * half. The selected tab is a lighter glass pill that slides between tabs; its
 * leading edge moves first, so the pill stretches across both tabs for a moment
 * and then lets go of the old one. The values come from the owner's tuning in
 * docs/design/mobile/prototype/tab-bar-v6.html (2026-11-16).
 *
 * The screen behind is blurred (expo-blur) under the 85-96% smoke, as in the
 * mockup, so rows scrolling under the bar turn to a soft smear instead of
 * showing through. On Android that costs a redraw per frame, which the library
 * itself warns is slow on Android 11 and older, so those phones get the same
 * bar drawn solid (the smoke's colour over the page) and no blur. On Android
 * the blur reads a target view that must not contain the bar: every tab screen
 * is wrapped in one through the navigator's `screenLayout` (TabScreenLayout).
 * iOS 26+ wears real Liquid Glass in its dark scheme instead.
 *
 * The bar itself is generic: labels and icons arrive through each screen's
 * `title` / `tabBarIcon` options, so the tab set stays declarative in the
 * layout (role-aware there, not here).
 */
export const TAB_BAR_HEIGHT = 64;

/** Corners: a rounded rectangle, not a full capsule (owner, 2026-11-16). */
const BAR_PADDING = 6;
const BAR_RADIUS = radius.xl;
/** The pill sits 6 pt inside the bar, so its corners follow the bar's. */
const PILL_RADIUS = BAR_RADIUS - BAR_PADDING;

const glass = {
  fill: "linear-gradient(180deg, rgba(28, 34, 48, 0.85), rgba(10, 14, 22, 0.96))",
  /** The same smoke laid over the app's canvas, for phones that don't blur. */
  fillSolid: "linear-gradient(180deg, rgb(60, 66, 78), rgb(19, 23, 31))",
  /** 22 pt, the mockup's blur: Android divides intensity by its reduction factor of 4. */
  blurIntensity: 88,
  gloss: "linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 52%)",
  edges:
    "inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.25), " +
    "inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 20px 42px -6px rgba(10, 14, 21, 0.38)",
  pill: "linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.1))",
  pillEdges:
    "inset 0 1px 0 rgba(255, 255, 255, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.14), " +
    "0 4px 10px rgba(0, 0, 0, 0.38)",
  iconGlow: "drop-shadow(0px 0px 6px rgba(255, 255, 255, 0.4))",
  /** iOS Liquid Glass tint, close to the graphite above. */
  tint: "rgba(10, 14, 22, 0.55)",
  on: "#FFFFFF",
  off: "rgba(255, 255, 255, 0.7)",
} as const;

/**
 * Real blur where it is cheap enough: iOS, and Android 12 (API 31) and up.
 * Matches expo-blur's own `dimezisBlurViewSdk31Plus` cut-off.
 */
const BLURS =
  Platform.OS === "ios" || (Platform.OS === "android" && Number(Platform.Version) >= 31);

/** One blur target per tab screen, shared by the screen and the bar. */
const blurTargets = new Map<string, RefObject<View | null>>();
function blurTargetFor(routeKey: string): RefObject<View | null> {
  let ref = blurTargets.get(routeKey);
  if (!ref) {
    ref = createRef<View>();
    blurTargets.set(routeKey, ref);
  }
  return ref;
}

/**
 * The tabs navigator's `screenLayout`: wraps each tab screen (with any stack
 * inside it) in the view the bar blurs. A plain View off Android.
 */
export function TabScreenLayout({
  route,
  children,
}: {
  route: { key: string };
  children: ReactNode;
}) {
  return (
    <BlurTargetView ref={blurTargetFor(route.key)} style={styles.target}>
      {children}
    </BlurTargetView>
  );
}

/** Bottom scroll inset that clears the floating bar on any device. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  // The past-session warning (ADR-066) sits on the bar; make room while it shows.
  const banner = usePastBannerShown() ? PAST_BANNER_HEIGHT + spacing.sm : 0;
  return TAB_BAR_HEIGHT + spacing.md + insets.bottom + spacing.md + banner;
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

/**
 * Like useFollowTabBar, but stops after `maxShift`: a bar-wide button drops
 * into the tab bar's place and stays clear of the home indicator.
 */
export function useFollowTabBarCapped(maxShift: number) {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(tabBarOffset.value, maxShift) }],
  }));
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
  const activeKey = state.routes[state.index]?.key ?? "";

  // Where each tab sits in the capsule, so the pill knows where to slide.
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const onTabLayout = useCallback((key: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setFrames((prev) =>
      prev[key]?.x === x && prev[key]?.width === width ? prev : { ...prev, [key]: { x, width } },
    );
  }, []);
  const target = frames[activeKey];

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
      const color = focused ? glass.on : glass.off;
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
          onLayout={(event) => onTabLayout(route.key, event)}
          style={styles.tab}
        >
          <View style={focused ? styles.glow : null}>
            {options.tabBarIcon?.({ focused, color, size: 22 })}
          </View>
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
      <View style={styles.banner} pointerEvents="box-none">
        <PastSessionBanner tabKey={state.routes[state.index]?.key ?? ""} />
      </View>
      {liquidGlass ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme="dark"
          tintColor={glass.tint}
          style={styles.capsule}
        >
          <Pill x={target?.x} width={target?.width} />
          {tabs}
        </GlassView>
      ) : (
        <View style={[styles.capsule, styles.edges]}>
          <View pointerEvents="none" style={styles.material}>
            {BLURS ? (
              // Keyed by tab: each tab screen is its own target, so the blur
              // is set up again for the screen that is now open.
              <BlurView
                key={activeKey}
                blurTarget={blurTargetFor(activeKey)}
                blurMethod="dimezisBlurViewSdk31Plus"
                intensity={glass.blurIntensity}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={[StyleSheet.absoluteFill, BLURS ? styles.smoke : styles.smokeSolid]} />
            <View style={styles.gloss} />
          </View>
          <Pill x={target?.x} width={target?.width} />
          {tabs}
        </View>
      )}
    </Animated.View>
  );
}

/**
 * The selected tab's glass pill. Moving to another tab, the edge on the side
 * it travels towards goes first and the other follows a beat later, so the
 * pill stretches over both tabs before settling. It appears in place (no
 * slide) the first time, and hides while the open screen has no tab of its own.
 */
function Pill({ x, width }: { x?: number; width?: number }) {
  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => {
    if (x === undefined || width === undefined) {
      shown.value = 0;
      return;
    }
    const nextLeft = x;
    const nextRight = x + width;
    if (shown.value === 0) {
      left.value = nextLeft;
      right.value = nextRight;
      shown.value = 1;
      return;
    }
    const timing = { duration: motion.base };
    if (nextLeft > left.value) {
      right.value = withTiming(nextRight, timing);
      left.value = withDelay(motion.quick, withTiming(nextLeft, timing));
    } else {
      left.value = withTiming(nextLeft, timing);
      right.value = withDelay(motion.quick, withTiming(nextRight, timing));
    }
  }, [x, width, left, right, shown]);

  const style = useAnimatedStyle(() => ({
    left: left.value,
    width: Math.max(0, right.value - left.value),
    opacity: shown.value,
  }));

  return <Animated.View pointerEvents="none" style={[styles.pill, style]} />;
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    height: TAB_BAR_HEIGHT,
  },
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: TAB_BAR_HEIGHT + spacing.sm,
  },
  capsule: {
    flex: 1,
    borderRadius: BAR_RADIUS,
    flexDirection: "row",
    gap: spacing.xs,
    padding: BAR_PADDING,
  },
  target: {
    flex: 1,
  },
  edges: {
    boxShadow: glass.edges,
  },
  /** Blur, smoke and gloss, clipped to the bar's corners. */
  material: {
    ...StyleSheet.absoluteFill,
    borderRadius: BAR_RADIUS,
    overflow: "hidden",
  },
  smoke: {
    experimental_backgroundImage: glass.fill,
  },
  smokeSolid: {
    experimental_backgroundImage: glass.fillSolid,
  },
  gloss: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: glass.gloss,
  },
  pill: {
    position: "absolute",
    top: BAR_PADDING,
    bottom: BAR_PADDING,
    borderRadius: PILL_RADIUS,
    experimental_backgroundImage: glass.pill,
    boxShadow: glass.pillEdges,
  },
  tab: {
    flex: 1,
    borderRadius: PILL_RADIUS,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  glow: {
    filter: glass.iconGlow,
  },
});

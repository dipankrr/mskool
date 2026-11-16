import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { AREAS, withAlpha } from "./areas";
import type { AreaKey } from "./areas";

const TAB_W = 80;
const TAB_H = 90;
const TAB_ON_H = 100;
const SLIM_H = 44;
const SLIM_ON_H = 48;
const ICON = 44;
const FLARE = 12;
// The gap matches the flare, so a chosen tab's curve never covers its neighbour.
const GAP = FLARE;
const PAD = 20;

/**
 * The pinned bar at the top of More: one tab per area, sitting on a band in
 * the chosen area's colour. The chosen tab is cut from the page below it, its
 * bottom corners curving out into the page, so the bar reads as the top of
 * the screen rather than a second navigation.
 *
 * `slim` (0..1) follows the page's scroll: the pictures fold away and the
 * names stay, so a long list gets its room and switching is still one tap.
 *
 * With three tabs or fewer they share the width; more than that scroll
 * sideways, and the chosen one is brought into view.
 */
export function AreaBar({
  areas,
  active,
  onChange,
  slim,
}: {
  areas: AreaKey[];
  active: AreaKey;
  onChange: (key: AreaKey) => void;
  slim: SharedValue<number>;
}) {
  const insets = useSafeAreaInsets();
  const look = AREAS[active];
  const fill = areas.length <= 3;
  const scroller = useRef<ScrollView>(null);
  const width = useRef(0);

  // Bring the chosen tab into view; the first ones are already there.
  useEffect(() => {
    if (fill) return;
    const index = areas.indexOf(active);
    const left = PAD + index * (TAB_W + GAP);
    const x = Math.max(0, left - (width.current - TAB_W) / 2);
    scroller.current?.scrollTo({ x, animated: true });
  }, [active, areas, fill]);

  const tabs = areas.map((key) => (
    <Tab
      key={key}
      area={key}
      on={key === active}
      fill={fill}
      slim={slim}
      onPress={() => {
        if (key === active) return;
        void Haptics.selectionAsync();
        onChange(key);
      }}
    />
  ));

  return (
    <View
      style={[
        styles.band,
        { paddingTop: insets.top, experimental_backgroundImage: `linear-gradient(180deg, ${look.band}, ${look.band2})` },
      ]}
    >
      <View style={styles.rule} />
      {fill ? (
        <View style={[styles.row, styles.fillRow]} accessibilityRole="tablist">
          {tabs}
        </View>
      ) : (
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          onLayout={(event: LayoutChangeEvent) => {
            width.current = event.nativeEvent.layout.width;
          }}
          contentContainerStyle={styles.row}
          accessibilityRole="tablist"
        >
          {tabs}
        </ScrollView>
      )}
    </View>
  );
}

function Tab({
  area,
  on,
  fill,
  slim,
  onPress,
}: {
  area: AreaKey;
  on: boolean;
  fill: boolean;
  slim: SharedValue<number>;
  onPress: () => void;
}) {
  const look = AREAS[area];
  const box = useAnimatedStyle(() => ({
    height: interpolate(slim.value, [0, 1], on ? [TAB_ON_H, SLIM_ON_H] : [TAB_H, SLIM_H]),
  }));
  const picture = useAnimatedStyle(() => ({
    height: interpolate(slim.value, [0, 1], [ICON, 0]),
    opacity: interpolate(slim.value, [0, 0.6], [1, 0]),
    marginBottom: interpolate(slim.value, [0, 1], [spacing.sm, 0]),
    transform: [{ scale: interpolate(slim.value, [0, 1], [on ? 1.06 : 0.92, 0.6]) }],
  }));
  const dot = useAnimatedStyle(() => ({
    width: interpolate(slim.value, [0, 1], [0, 7]),
    marginRight: interpolate(slim.value, [0, 1], [0, 6]),
    opacity: slim.value,
  }));

  return (
    <Animated.View style={[styles.tab, fill ? styles.tabFill : null, on ? styles.tabOn : styles.tabOff, box]}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={look.label}
        accessibilityState={{ selected: on }}
        onPress={onPress}
        style={styles.press}
        testID={`more-area-${area}`}
      >
        <Animated.View
          style={[
            styles.icon,
            {
              experimental_backgroundImage: `linear-gradient(150deg, ${look.h1}, ${look.h0})`,
              boxShadow: `0 6px 14px ${withAlpha(look.h0, on ? 0.36 : 0.24)}`,
            },
            on ? null : styles.iconOff,
            picture,
          ]}
        >
          <View style={styles.gloss} />
          <AppIcon name={look.icon} size={22} color={colors.onAccent} />
        </Animated.View>
        <View style={styles.labelRow}>
          <Animated.View style={[styles.dot, { backgroundColor: look.h0 }, dot]} />
          <ThemedText
            variant={on ? "bodyStrong" : "body"}
            color={on ? colors.ink : colors.muted}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={styles.label}
          >
            {look.label}
          </ThemedText>
        </View>
      </Pressable>
      {on ? (
        <>
          {/* The page's colour, with a quarter of band laid over it: the curve
              where the tab meets the page on each side. */}
          <View style={[styles.flare, styles.flareLeft]}>
            <View style={[styles.flareCut, styles.flareCutLeft, { backgroundColor: look.band2 }]} />
          </View>
          <View style={[styles.flare, styles.flareRight]}>
            <View style={[styles.flareCut, styles.flareCutRight, { backgroundColor: look.band2 }]} />
          </View>
        </>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: "relative",
  },
  rule: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: "rgba(16, 24, 40, 0.08)",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: GAP,
    paddingHorizontal: PAD,
    paddingTop: spacing.sm,
  },
  fillRow: {
    paddingHorizontal: PAD,
  },
  tab: {
    width: TAB_W,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  tabFill: {
    flex: 1,
    width: undefined,
  },
  tabOff: {
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(255, 255, 255, 0.95)",
  },
  tabOn: {
    backgroundColor: colors.canvas,
    boxShadow: "0 -6px 18px rgba(16, 24, 40, 0.07)",
    zIndex: 2,
  },
  press: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  icon: {
    width: ICON,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconOff: {
    opacity: 0.92,
  },
  gloss: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "55%",
    experimental_backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.42), rgba(255,255,255,0))",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    height: 7,
    borderRadius: 4,
  },
  label: {
    letterSpacing: -0.1,
  },
  flare: {
    position: "absolute",
    bottom: 0,
    width: FLARE,
    height: FLARE,
    backgroundColor: colors.canvas,
  },
  flareLeft: {
    left: -FLARE,
  },
  flareRight: {
    right: -FLARE,
  },
  flareCut: {
    width: FLARE,
    height: FLARE,
  },
  flareCutLeft: {
    borderBottomRightRadius: FLARE,
  },
  flareCutRight: {
    borderBottomLeftRadius: FLARE,
  },
});

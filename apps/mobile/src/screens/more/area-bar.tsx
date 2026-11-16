import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { AREAS } from "./areas";
import type { AreaKey } from "./areas";

const TAB_W = 80;
const TAB_H = 90;
const TAB_ON_H = 100;
const SLIM_H = 44;
const SLIM_ON_H = 48;
const ICON = 44;
const FLARE = 12;
/** Outlines, as in the reference: faint round every tab, dark round the chosen one. */
const LINE = "rgba(16, 24, 40, 0.14)";
const LINE_ON = "#1E2A44";
const LINE_W = 1;
const LINE_ON_W = 1.5;
/** The small picture beside the name in the slim bar. */
const MINI = 16;
const MINI_GAP = 6;
/** Half the small picture and its gap: how far the name slides right. */
const MINI_SHIFT = (MINI + MINI_GAP) / 2;
// The gap matches the flare, so a chosen tab's curve never covers its neighbour.
const GAP = FLARE;
const PAD = 20;

/** The bar's height under the status bar, full and slim. The page scrolls
 * beneath it, so More pads its content by the full height. */
export const BAR_FULL = spacing.sm + TAB_ON_H;
export const BAR_SLIM = spacing.sm + SLIM_ON_H;

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
  style,
}: {
  areas: AreaKey[];
  active: AreaKey;
  onChange: (key: AreaKey) => void;
  slim: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const look = AREAS[active];
  const fill = areas.length <= 3;
  const scroller = useRef<ScrollView>(null);
  const width = useRef(0);
  // Each tab is as wide as its name, so where it sits is measured, not computed.
  const spots = useRef(new Map<AreaKey, { x: number; w: number }>());

  // Bring the chosen tab into view, centred where the row allows.
  useEffect(() => {
    if (fill) return;
    const spot = spots.current.get(active);
    if (!spot) return;
    const x = Math.max(0, spot.x - (width.current - spot.w) / 2);
    scroller.current?.scrollTo({ x, animated: true });
  }, [active, fill]);

  const tabs = areas.map((key) => (
    <Tab
      key={key}
      area={key}
      on={key === active}
      fill={fill}
      slim={slim}
      onPlace={(x, w) => spots.current.set(key, { x, w })}
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
        style,
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
  onPlace,
  onPress,
}: {
  area: AreaKey;
  on: boolean;
  fill: boolean;
  slim: SharedValue<number>;
  onPlace: (x: number, width: number) => void;
  onPress: () => void;
}) {
  const look = AREAS[area];
  const box = useAnimatedStyle(() => ({
    height: interpolate(slim.value, [0, 1], on ? [TAB_ON_H, SLIM_ON_H] : [TAB_H, SLIM_H]),
  }));
  const picture = useAnimatedStyle(() => ({
    height: interpolate(slim.value, [0, 1], [ICON, 0]),
    // Unchosen pictures are dimmed, so the chosen one stands out.
    opacity: interpolate(slim.value, [0, 0.5], [on ? 1 : 0.55, 0], "clamp"),
    marginBottom: interpolate(slim.value, [0, 1], [spacing.sm, 0]),
    transform: [{ scale: interpolate(slim.value, [0, 1], [on ? 1 : 0.86, 0.5]) }],
  }));
  // As the big picture folds away, a small one fades in beside the name at
  // its full size (never cropped), and the pair slides to stay centred.
  const mini = useAnimatedStyle(() => ({
    opacity: interpolate(slim.value, [0.5, 1], [0, 1], "clamp"),
    transform: [{ scale: interpolate(slim.value, [0.5, 1], [0.6, 1], "clamp") }],
  }));
  const name = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(slim.value, [0, 1], [0, MINI_SHIFT]) }],
  }));

  return (
    <Animated.View
      onLayout={(event: LayoutChangeEvent) => onPlace(event.nativeEvent.layout.x, event.nativeEvent.layout.width)}
      style={[styles.tab, fill ? styles.tabFill : null, on ? styles.tabOn : styles.tabOff, box]}
    >
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
            },
            picture,
          ]}
        >
          <View style={styles.gloss} />
          <AppIcon name={look.icon} size={22} color={colors.onAccent} />
        </Animated.View>
        <Animated.View style={[styles.labelRow, name]}>
          <Animated.View style={[styles.mini, mini]}>
            <AppIcon name={look.icon} size={MINI} color={on ? look.h0 : colors.muted} />
          </Animated.View>
          <ThemedText
            variant={on ? "bodyStrong" : "body"}
            color={on ? look.h0 : colors.muted}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={styles.label}
          >
            {look.label}
          </ThemedText>
        </Animated.View>
      </Pressable>
      {on ? (
        <>
          {/* The page's colour, with a quarter of band laid over it: the curve
              where the tab meets the page on each side. */}
          {/* The curve carries the chosen tab's outline out into the page line. */}
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
    height: LINE_W,
    backgroundColor: LINE,
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
  // At least the picture's width, and wide enough for the whole name.
  tab: {
    minWidth: TAB_W,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  tabFill: {
    flex: 1,
    minWidth: 0,
  },
  // Unchosen tabs recede: a faint wash and a quieter picture. The chosen
  // one is solid, joined to the page, and named in the area's colour.
  tabOff: {
    backgroundColor: "rgba(255, 255, 255, 0.32)",
    borderWidth: LINE_W,
    borderBottomWidth: 0,
    borderColor: LINE,
  },
  tabOn: {
    backgroundColor: colors.canvas,
    borderWidth: LINE_ON_W,
    borderBottomWidth: 0,
    borderColor: LINE_ON,
    zIndex: 2,
  },
  press: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.md,
    // Room for the small picture once the name has slid over.
    paddingHorizontal: spacing.lg + 2,
  },
  icon: {
    width: ICON,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
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
  mini: {
    position: "absolute",
    left: -(MINI + MINI_GAP),
    width: MINI,
    height: MINI,
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
    left: -FLARE - LINE_ON_W + LINE_ON_W,
    marginLeft: -LINE_ON_W,
  },
  flareRight: {
    right: -FLARE - LINE_ON_W + LINE_ON_W,
    marginRight: -LINE_ON_W,
  },
  flareCut: {
    width: FLARE,
    height: FLARE,
  },
  flareCutLeft: {
    borderBottomRightRadius: FLARE,
    borderRightWidth: LINE_ON_W,
    borderBottomWidth: LINE_ON_W,
    borderColor: LINE_ON,
  },
  flareCutRight: {
    borderBottomLeftRadius: FLARE,
    borderLeftWidth: LINE_ON_W,
    borderBottomWidth: LINE_ON_W,
    borderColor: LINE_ON,
  },
});

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHideTabBarOnScroll, useTabBarSpace } from "../../components/tab-bar";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { AcademicsArea } from "./academics-area";
import { AreaBar, BAR_FULL, BAR_SLIM } from "./area-bar";
import { AREAS, areasFor } from "./areas";
import type { AreaKey } from "./areas";
import { ExamsArea } from "./exams-area";
import { OverviewArea } from "./overview";
import { SchoolArea } from "./school-area";
import { StaffArea } from "./staff-area";
import { TeachingArea } from "./teaching-area";

/**
 * The bar slims over exactly the distance it gives up, so its bottom edge and
 * the page move together, as if the page were pushing it.
 */
const SLIM_OVER = BAR_FULL - BAR_SLIM;

/**
 * Kept for the life of the app, so coming back to More lands on the area you
 * left; a fresh start opens on Overview.
 */
let lastArea: AreaKey = "overview";

/**
 * More (v3, `prototype/more-v3.html`): the areas that have no bottom tab,
 * each a screen of its own behind a pinned bar across the top. Overview
 * opens first. The bar slims as the page scrolls and stays pinned.
 *
 * Which areas a caller gets follows their permission hints (`areasFor`);
 * with only one there is no bar, just that screen.
 */
export function MoreScreen() {
  const { has } = usePermissions();
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const hideTabBar = useHideTabBarOnScroll();

  const running = Boolean(academicYear && currentYear && academicYear.id === currentYear.id);
  const mine = trpc.assignment.mine.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) && running, staleTime: 60_000 },
  );
  const areas = areasFor(has, (mine.data?.length ?? 0) > 0);
  const [area, setArea] = useState<AreaKey>(() => lastArea);
  const shown: AreaKey = areas.includes(area) ? area : "overview";

  // 0 (full) to 1 (slim), following the finger: the bar shrinks over the
  // first stretch of scroll and opens again the same way.
  const slim = useSharedValue(0);

  // A new area starts at its top, with the bar open.
  useEffect(() => {
    slim.set(0);
  }, [shown, slim]);

  const choose = (next: AreaKey) => {
    lastArea = next;
    setArea(next);
  };

  const hideTabBarAt = (y: number) =>
    hideTabBar({ nativeEvent: { contentOffset: { x: 0, y } } } as NativeSyntheticEvent<NativeScrollEvent>);
  const scroller = useAnimatedRef<Animated.ScrollView>();
  // Letting go part-way never leaves the bar half-slim: it settles to
  // whichever end is nearer.
  const settle = (y: number) => {
    "worklet";
    if (y > 0 && y < SLIM_OVER) scrollTo(scroller, 0, y < SLIM_OVER / 2 ? 0 : SLIM_OVER, true);
  };
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      slim.set(interpolate(event.contentOffset.y, [0, SLIM_OVER], [0, 1], Extrapolation.CLAMP));
      runOnJS(hideTabBarAt)(event.contentOffset.y);
    },
    onEndDrag: (event) => {
      // A flick carries on by itself; only a slow release settles here.
      if (Math.abs(event.velocity?.y ?? 0) < 0.2) settle(event.contentOffset.y);
    },
    onMomentumEnd: (event) => settle(event.contentOffset.y),
  });

  const withBar = areas.length > 1;

  // The bar floats over the page and only ever changes its own size; the page
  // scrolls beneath it and never reflows, which is what made the slim jumpy.
  return (
    <View style={styles.screen}>
      {withBar ? null : <View style={{ height: insets.top, backgroundColor: AREAS[shown].band2 }} />}
      <Animated.ScrollView
        ref={scroller}
        key={shown}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[
          styles.content,
          { paddingTop: (withBar ? insets.top + BAR_FULL : 0) + spacing.md + 2, paddingBottom: tabSpace + spacing.lg },
        ]}
        testID={`more-${shown}`}
      >
        {shown === "overview" ? <OverviewArea areas={areas} onOpen={choose} /> : null}
        {shown === "exams" ? <ExamsArea /> : null}
        {shown === "academics" ? <AcademicsArea /> : null}
        {shown === "staff" ? <StaffArea /> : null}
        {shown === "teaching" ? <TeachingArea /> : null}
        {shown === "school" ? <SchoolArea /> : null}
      </Animated.ScrollView>
      {withBar ? <AreaBar areas={areas} active={shown} onChange={choose} slim={slim} style={styles.bar} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});

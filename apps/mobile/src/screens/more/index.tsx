import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
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
import { AreaBar } from "./area-bar";
import { AREAS, areasFor } from "./areas";
import type { AreaKey } from "./areas";
import { ExamsArea } from "./exams-area";
import { OverviewArea } from "./overview";
import { SchoolArea } from "./school-area";
import { StaffArea } from "./staff-area";
import { TeachingArea } from "./teaching-area";

/** The scroll distance over which the bar goes from full to slim. */
const SLIM_OVER = 72;

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
    slim.value = 0;
  }, [shown, slim]);

  const choose = (next: AreaKey) => {
    lastArea = next;
    setArea(next);
  };

  const hideTabBarAt = (y: number) =>
    hideTabBar({ nativeEvent: { contentOffset: { x: 0, y } } } as NativeSyntheticEvent<NativeScrollEvent>);
  const onScroll = useAnimatedScrollHandler((event) => {
    slim.set(interpolate(event.contentOffset.y, [0, SLIM_OVER], [0, 1], Extrapolation.CLAMP));
    runOnJS(hideTabBarAt)(event.contentOffset.y);
  });

  return (
    <View style={styles.screen}>
      {areas.length > 1 ? (
        <AreaBar areas={areas} active={shown} onChange={choose} slim={slim} />
      ) : (
        <View style={{ height: insets.top, backgroundColor: AREAS[shown].band2 }} />
      )}
      <Animated.ScrollView
        key={shown}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace + spacing.lg }]}
        testID={`more-${shown}`}
      >
        {shown === "overview" ? <OverviewArea areas={areas} onOpen={choose} /> : null}
        {shown === "exams" ? <ExamsArea /> : null}
        {shown === "academics" ? <AcademicsArea /> : null}
        {shown === "staff" ? <StaffArea /> : null}
        {shown === "teaching" ? <TeachingArea /> : null}
        {shown === "school" ? <SchoolArea /> : null}
      </Animated.ScrollView>
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
    paddingTop: spacing.md + 2,
  },
});

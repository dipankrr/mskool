import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useHideTabBarOnScroll, useTabBarSpace } from "../../components/tab-bar";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { motion, spacing } from "../../theme/tokens";
import { AcademicsArea } from "./academics-area";
import { AreaBar } from "./area-bar";
import { AREAS, areasFor } from "./areas";
import type { AreaKey } from "./areas";
import { ExamsArea } from "./exams-area";
import { OverviewArea } from "./overview";
import { SchoolArea } from "./school-area";
import { StaffArea } from "./staff-area";
import { TeachingArea } from "./teaching-area";

/** How far the page scrolls before the bar slims. */
const SLIM_AT = 24;

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

  const slim = useSharedValue(0);
  const slimNow = useRef(false);
  const setSlim = (value: boolean) => {
    if (slimNow.current === value) return;
    slimNow.current = value;
    slim.value = withTiming(value ? 1 : 0, { duration: motion.base });
  };

  // A new area starts at its top, with the bar open.
  useEffect(() => {
    setSlim(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const choose = (next: AreaKey) => {
    lastArea = next;
    setArea(next);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setSlim(event.nativeEvent.contentOffset.y > SLIM_AT);
    hideTabBar(event);
  };

  return (
    <View style={styles.screen}>
      {areas.length > 1 ? (
        <AreaBar areas={areas} active={shown} onChange={choose} slim={slim} />
      ) : (
        <View style={{ height: insets.top, backgroundColor: AREAS[shown].band2 }} />
      )}
      <ScrollView
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
      </ScrollView>
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

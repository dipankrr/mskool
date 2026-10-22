import { useState } from "react";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import { MarkingPanel } from "./marking-panel";
import { SectionSheet } from "./section-sheet";
import { SummaryPanel } from "./summary-panel";
import { useAttendanceSection } from "./use-attendance-section";
import { ViewToggle } from "./view-toggle";
import type { AttendanceView } from "./view-toggle";

/**
 * Staff attendance — the tab shell (chunk 2). The shell owns what both panels
 * share: which section (route params first — a home card names one — else the
 * first visible), the section switcher, and the Mark ⇄ Summary toggle.
 *
 * Both panels stay mounted; the inactive one is hidden with `display: none`
 * plus accessibility hiding, so an unsaved marking draft survives a glance at
 * the summary. A section change remounts both (the `key`), the chunk-1 rule
 * that a draft belongs to one section's day.
 */
export function AttendanceScreen() {
  const { has, hasAny } = usePermissions();
  const canSee = hasAny("attendance:read", "attendance:create");
  const canManage = has("attendance:update");
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const { academicYear, yearPending } = useActiveContext();
  const [view, setView] = useState<AttendanceView>("mark");
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Which section this tab shows — the shared hook, so the manage surfaces
  // (chunk 3) resolve the same one from the same params.
  const { sectionsQuery, section, sectionLabel, sectionOptions } =
    useAttendanceSection(params.sectionId);

  const yearState = academicYear ? "ready" : yearPending ? "loading" : "none";

  if (!canSee) {
    return (
      <Frame>
        <EmptyState
          icon="attendance"
          title={copy.attendance.noAccessTitle}
          message={copy.attendance.noAccessBody}
          testID="attendance-no-access"
        />
      </Frame>
    );
  }

  if (
    yearState === "loading" ||
    (yearState === "ready" && sectionsQuery.isPending)
  ) {
    return (
      <Frame>
        <Skeleton width={150} height={30} />
        <Skeleton width={220} height={16} style={styles.gapTopSm} />
        <View style={styles.skeletonBlock}>
          <Skeleton height={72} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      </Frame>
    );
  }

  if (yearState === "none") {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <Card style={styles.gapTopLg}>
          <ThemedText variant="bodyStrong">
            {copy.session.noYearTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      </Frame>
    );
  }

  if (sectionsQuery.isError) {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <ErrorCard
          cause={sectionsQuery.error}
          onRetry={() => void sectionsQuery.refetch()}
          style={styles.gapTopLg}
          testID="attendance-sections-error"
        />
      </Frame>
    );
  }

  if (!section) {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <EmptyState
          icon="school"
          title={copy.classes.emptyTitle}
          message={copy.classes.emptyBody}
          testID="attendance-no-sections"
        />
      </Frame>
    );
  }

  // `sectionLabel` is null only when there is no section, and the guard
  // above has already returned for that.
  const title = sectionLabel ?? section.name;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.head}>
        <View style={styles.titleBar}>
          <Pressable
            testID="attendance-section-switcher"
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={copy.attendance.section.open}
            hitSlop={8}
            onPress={() => setSwitcherOpen(true)}
            style={styles.titleRow}
          >
            <ThemedText
              variant="title"
              numberOfLines={1}
              style={styles.titleText}
            >
              {title}
            </ThemedText>
            <AppIcon name="chevronDown" size={18} color={colors.chevron} />
          </Pressable>
          {canManage ? (
            <Pressable
              testID="attendance-manage-entry"
              accessibilityRole="button"
              accessibilityLabel={copy.attendance.manage.open}
              accessibilityHint={copy.attendance.manage.openHint}
              hitSlop={8}
              onPress={() =>
                router.push({
                  pathname: "/attendance/manage",
                  params: { sectionId: section.id },
                })
              }
              style={({ pressed }) => [
                styles.gear,
                pressed ? styles.gearPressed : null,
              ]}
            >
              <AppIcon name="settings" size={20} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <ViewToggle value={view} onChange={setView} />
      </View>
      <View style={styles.flex}>
        <PanelFrame visible={view === "mark"}>
          <MarkingPanel key={`mark-${section.id}`} sectionId={section.id} />
        </PanelFrame>
        <PanelFrame visible={view === "summary"}>
          <SummaryPanel
            key={`summary-${section.id}`}
            sectionId={section.id}
            visible={view === "summary"}
          />
        </PanelFrame>
      </View>
      <SectionSheet
        visible={switcherOpen}
        options={sectionOptions}
        currentId={section.id}
        onSelect={(id) => {
          setSwitcherOpen(false);
          if (id !== section.id) router.setParams({ sectionId: id });
        }}
        onDismiss={() => setSwitcherOpen(false)}
      />
    </SafeAreaView>
  );
}

/**
 * One panel's slot. The inactive panel keeps its state (draft, scroll) but is
 * display-hidden and closed to assistive tech, so nothing invisible is
 * reachable and nothing visible is stale.
 */
function PanelFrame({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={[styles.flex, visible ? null : styles.hidden]}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      {children}
    </View>
  );
}

/** The plain scroller every pre-section state lives in. */
function Frame({ children }: { children: ReactNode }) {
  const tabSpace = useTabBarSpace();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  hidden: {
    display: "none",
  },
  head: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  gear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  gearPressed: {
    backgroundColor: colors.field,
  },
  titleText: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
  },
  skeletonBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  gapTopSm: {
    marginTop: spacing.sm,
  },
  gapTopLg: {
    marginTop: spacing.lg,
  },
  cardBody: {
    marginTop: spacing.xs,
  },
});

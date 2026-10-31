import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { formatLongWeekday, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import { ClassCard } from "./class-card";
import { OpenExamsCard } from "./open-exams";
import { SetupCard } from "./setup-card";

/**
 * Staff home (probe frame 01): branch chip, "Today" and the day line, then
 * "Your classes" — every visible section of the current session with its
 * live attendance state. Read-only this slice; the marking walk arrives with
 * the attendance screen.
 *
 * Data shape: sections + class names come from the permissive list
 * procedures (scope-clipped server-side); today's state comes from
 * `attendance.status` per card. Every branch is a real state — loading,
 * missing session, error with retry, empty, loaded.
 */
export function StaffHomeScreen() {
  const { me } = useMe();
  const { organizationId, schoolId, academicYear, yearPending } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const tabSpace = useTabBarSpace();
  const { has } = usePermissions();
  const canSetUp = has("academic_year:create");

  const sectionsQuery = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled: Boolean(organizationId && academicYear),
      staleTime: 60_000,
    },
  );
  const classesQuery = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) },
    { enabled: Boolean(organizationId), staleTime: 300_000 },
  );

  const classNameById = new Map(
    (classesQuery.data ?? []).map((cls) => [cls.id, cls.name]),
  );
  const sections = (sectionsQuery.data ?? []).filter(
    (section) => section.status === "active",
  );
  const membership = me?.memberships.find(
    (m) => m.organization.id === organizationId,
  );
  const roleTypes = membership?.roleTypes ?? [];

  const yearState = academicYear
    ? "ready"
    : yearPending
      ? "loading"
      : "none";

  // Someone setting the school up has the card; an empty "Your classes" under
  // it would only repeat what it says.
  const nothingToShow =
    canSetUp &&
    (yearState === "none" ||
      (yearState === "ready" && sectionsQuery.isSuccess && sections.length === 0));

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        {branchName ? (
          <View style={styles.chip}>
            <AppIcon name="school" size={14} color={colors.tone.neutral.fg} />
            <ThemedText variant="chip" numberOfLines={1}>
              {branchName}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.header}>
          <ThemedText variant="title">{copy.home.title}</ThemedText>
          <ThemedText variant="subtitle">
            {formatLongWeekday(todayIso())}
          </ThemedText>
        </View>

        <SetupCard />

        <OpenExamsCard />

        {nothingToShow ? null : <SectionLabel>{copy.home.classesLabel}</SectionLabel>}

        {nothingToShow ? null : yearState === "loading" || (yearState === "ready" && sectionsQuery.isPending) ? (
          <View style={styles.cards}>
            <Skeleton height={76} testID="home-loading-1" />
            <Skeleton height={76} testID="home-loading-2" />
          </View>
        ) : yearState === "none" ? (
          <Card>
            <ThemedText variant="bodyStrong">
              {copy.setup.teacherTitle}
            </ThemedText>
            <ThemedText variant="meta" style={styles.cardBody}>
              {copy.setup.teacherBody}
            </ThemedText>
          </Card>
        ) : sectionsQuery.isError ? (
          <ErrorCard
            cause={sectionsQuery.error}
            onRetry={() => void sectionsQuery.refetch()}
            testID="home-classes-error"
          />
        ) : sections.length === 0 ? (
          <EmptyState
            icon="school"
            title={copy.classes.emptyTitle}
            message={copy.classes.emptyBody}
            testID="home-classes-empty"
          />
        ) : (
          <View style={styles.cards}>
            {sections.map((section) => (
              <ClassCard
                key={section.id}
                sectionId={section.id}
                sectionName={section.name}
                className={classNameById.get(section.classId) ?? null}
                roleTypes={roleTypes}
                sectionCount={sections.length}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  header: {
    marginTop: spacing.xxl,
  },
  cards: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  cardBody: {
    marginTop: spacing.xs,
  },
});

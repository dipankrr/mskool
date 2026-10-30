import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { router } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { IconTile } from "../../../components/icon-tile";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveBranchName } from "../../../hooks/use-active-context";
import { annualCopy } from "../../../lib/annual-copy";
import { policyCounts } from "../../../lib/annual";
import { copy } from "../../../lib/copy";
import { criteriaCounts } from "../../../lib/pass-criteria";
import { colors } from "../../../theme/brand-admin";
import { spacing } from "../../../theme/tokens";
import { useAnnualPolicies } from "../annual/use-annual";
import { useExamScope } from "../use-exam-data";
import {
  useGradingScalesAdmin,
  usePassCriteriaAdmin,
  useSubjectTypesAdmin,
} from "./use-grading";

/**
 * GRADING SETUP (chunk 7F) — the hub. One sentence: where do I change how this
 * school grades?
 *
 * Three destinations, each with a live count, so the screen answers "is
 * anything missing?" before a tap. The reads are the same ones the lists use,
 * so a count can never disagree with the list behind it. If any read fails the
 * hub shows one error and no half-truths.
 */
export function GradingHubScreen() {
  const scope = useExamScope();
  const branchName = useActiveBranchName();

  const types = useSubjectTypesAdmin();
  const scales = useGradingScalesAdmin();
  const criteria = usePassCriteriaAdmin();
  const annual = useAnnualPolicies();

  const typeRows = types.data ?? [];
  const scaleRows = scales.data ?? [];
  const criteriaRows = criteria.data ?? [];

  const inUse = typeRows.filter((row) => row.hasAssessmentData).length;
  const defaultScale =
    scaleRows.find((row) => row.isDefault)?.name ?? null;
  const counts = criteriaCounts(criteriaRows);
  const annualCounts = policyCounts(annual.data ?? []);

  const year = scope.academicYear;
  const meta = copy.exams.meta(year?.name ?? null, branchName);
  const pending =
    types.isPending ||
    scales.isPending ||
    (Boolean(year) && (criteria.isPending || annual.isPending));
  const failure = types.error ?? scales.error ?? criteria.error ?? annual.error ?? null;

  const refetchAll = () => {
    void types.refetch();
    void scales.refetch();
    if (year) {
      void criteria.refetch();
      void annual.refetch();
    }
  };

  const shell = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.grading.title}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="grading-back"
      titleTestID="grading-title"
      onRefresh={scope.canRead && scope.addressable ? refetchAll : undefined}
      refreshing={
        types.isRefetching || scales.isRefetching || criteria.isRefetching
      }
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return shell(
      <EmptyState
        icon="lock"
        title={copy.exams.grading.deniedTitle}
        message={copy.exams.grading.deniedBody}
        testID="grading-denied"
      />,
    );
  }

  if (!scope.ready) {
    return shell(<HubSkeleton />);
  }

  if (!scope.organizationId || !scope.schoolId) {
    return shell(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="grading-no-branch"
      />,
    );
  }

  if (pending) return shell(<HubSkeleton />);

  if (failure) {
    return shell(
      <ErrorCard cause={failure} onRetry={refetchAll} testID="grading-error" />,
    );
  }

  return shell(
    <View style={styles.body}>
      <Notice
        tone="neutral"
        icon="info"
        message={copy.exams.grading.intro}
        testID="grading-intro"
      />

      <Card padless testID="grading-destinations">
        <HubRow
          title={copy.exams.grading.hub.subjectTypes}
          meta={copy.exams.grading.hub.subjectTypesMeta(
            typeRows.length,
            inUse,
          )}
          detail={copy.exams.grading.hub.subjectTypesDetail}
          icon="subject"
          onPress={() => router.push("/exams/setup/subject-types")}
          first
          testID="grading-subject-types"
        />
        <HubRow
          title={copy.exams.grading.hub.scales}
          meta={copy.exams.grading.hub.scalesMeta(
            scaleRows.length,
            defaultScale,
          )}
          detail={copy.exams.grading.hub.scalesDetail}
          icon="grade"
          onPress={() => router.push("/exams/setup/grading-scales")}
          testID="grading-scales"
        />
        <HubRow
          title={copy.exams.grading.hub.criteria}
          meta={
            year
              ? copy.exams.grading.hub.criteriaMeta(
                  year.name,
                  counts.defaults,
                  counts.classes,
                )
              : copy.exams.grading.hub.criteriaNoSession
          }
          detail={copy.exams.grading.hub.criteriaDetail}
          icon="checkCircle"
          onPress={
            year ? () => router.push("/exams/setup/pass-criteria") : undefined
          }
          testID="grading-criteria"
        />
        <HubRow
          title={annualCopy.setup.rowTitle}
          meta={
            year
              ? annualCounts.defaults + annualCounts.classes === 0
                ? annualCopy.setup.rowNone
                : annualCopy.setup.rowMeta(year.name, annualCounts.defaults, annualCounts.classes)
              : copy.exams.grading.hub.criteriaNoSession
          }
          detail={annualCopy.setup.rowDetail}
          icon="exams"
          onPress={year ? () => router.push("/exams/setup/annual-rules") : undefined}
          testID="grading-annual-rules"
        />
      </Card>
    </View>,
  );
}

/**
 * A destination row with two secondary lines: the live count first, the
 * explanation second. `LinkRow` carries one detail line; a hub needs both, so
 * the anatomy is local rather than bending the shared component.
 */
function HubRow({
  title,
  meta,
  detail,
  icon,
  onPress,
  first,
  testID,
}: {
  title: string;
  meta: string;
  detail: string;
  icon: AppIconName;
  /** Omitted for an honest row that cannot open (no running session). */
  onPress?: () => void;
  first?: boolean;
  testID?: string;
}) {
  const content = (
    <>
      <IconTile name={icon} tone={onPress ? "accent" : "neutral"} />
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        <ThemedText variant="caption" numberOfLines={1}>
          {meta}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {detail}
        </ThemedText>
      </View>
      {onPress ? (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.row, first ? null : styles.divider]}
        testID={testID}
        accessible
        accessibilityLabel={`${title}. ${meta}. ${detail}`}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${meta}`}
      accessibilityHint={detail}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

function HubSkeleton() {
  return (
    <View style={styles.skeletons} testID="grading-loading">
      <Skeleton height={8} />
      <Skeleton height={92} />
      <Skeleton height={92} />
      <Skeleton height={92} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
});

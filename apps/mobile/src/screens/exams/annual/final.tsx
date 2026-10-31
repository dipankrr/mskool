import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { annualCopy } from "../../../lib/annual-copy";
import type { StatusKind } from "../../../lib/annual";
import { useBranchMeta } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { isoOf } from "../../../lib/exam-results";
import { formatTimestampDate } from "../../../lib/format";
import { colors } from "../../../theme/brand-admin";
import { spacing, touch } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { StatusChip } from "./parts";
import { useAnnualNames, useAnnualOverview } from "./use-annual";

const c = annualCopy.final;

/**
 * FINAL RESULTS (chunk 7G, ADR-053) - one row per class, each with where its
 * year stands. Nothing here generates anything: the act lives on the class,
 * where its readiness is visible first. (The year-wide compute this replaces
 * could not say which class had failed, or why.)
 */
export function FinalResultsScreen() {
  const scope = useExamScope();
  const names = useAnnualNames();
  const overview = useAnnualOverview();

  const year = scope.academicYear;
  const branchMeta = useBranchMeta();
  const classRows = [...(names.classes.data ?? [])].sort(
    (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
  );
  const progress = new Map((overview.data ?? []).map((row) => [row.classId, row]));

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={c.title}
      meta={branchMeta}
      backAccessibilityLabel={copy.common.back}
      backTestID="exam-final-back"
      titleTestID="exam-final-title"
      onRefresh={
        scope.canRead && scope.addressable
          ? () => {
              void overview.refetch();
              void names.classes.refetch();
            }
          : undefined
      }
      refreshing={overview.isRefetching || names.classes.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState icon="lock" title={c.deniedTitle} message={c.deniedBody} testID="exam-final-denied" />,
    );
  }
  if (scope.ready && !year) {
    return frame(
      <EmptyState icon="calendarOff" title={c.noSessionTitle} message={c.noSessionBody} testID="exam-final-no-session" />,
    );
  }
  if (!scope.ready || overview.isPending || names.classes.isPending) {
    return frame(
      <View style={styles.body} testID="exam-final-loading">
        <Skeleton height={76} />
        <Skeleton height={76} />
        <Skeleton height={76} />
      </View>,
    );
  }
  if (overview.isError) {
    return frame(<ErrorCard cause={overview.error} onRetry={() => void overview.refetch()} testID="exam-final-error" />);
  }
  if (classRows.length === 0) {
    return frame(
      <EmptyState icon="exams" title={c.noClasses} message="" testID="exam-final-empty" />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Notice tone="neutral" icon="info" title={c.introTitle} message={c.introBody} testID="exam-final-intro" />
      <Card padless testID="exam-final-classes">
        {classRows.map((klass, index) => {
          const row = progress.get(klass.id);
          const status: StatusKind = !row ? "none" : row.publishedStudents > 0 ? "published" : "draft";
          const meta = !row
            ? c.classMetaNone
            : status === "published"
              ? c.classMetaPublished(row.students)
              : c.classMeta(row.students, formatTimestampDate(isoOf(row.computedAt)));
          return (
            <Pressable
              key={klass.id}
              testID={`final-class-${klass.id}`}
              accessibilityRole="button"
              accessibilityLabel={`${klass.name}. ${c.status[status]}. ${meta}`}
              onPress={() =>
                router.push({ pathname: "/exams/final/[classId]", params: { classId: klass.id } })
              }
              style={({ pressed }) => [
                styles.row,
                index === 0 ? null : styles.divider,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.rowText}>
                <ThemedText variant="bodyStrong" numberOfLines={1}>
                  {klass.name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={2}>
                  {meta}
                </ThemedText>
              </View>
              <StatusChip status={status} />
            </Pressable>
          );
        })}
      </Card>
    </View>,
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.field },
  rowText: { flex: 1, gap: spacing.xxs },
});

import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveBranchName } from "../../../hooks/use-active-context";
import { annualCopy } from "../../../lib/annual-copy";
import {
  policyCounts,
  policyPromotionLine,
  sortPolicies,
  uncoveredPolicyScopes,
} from "../../../lib/annual";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import { colors } from "../../../theme/brand-admin";
import { spacing, touch } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { useCriteriaClasses } from "../grading/use-grading";
import { QuietChip, SectionHead } from "../grading/ui";
import { useAnnualPolicies } from "./use-annual";

type PolicyRow = inferRouterOutputs<AppRouter>["exam"]["annual"]["policies"]["list"][number];

const c = annualCopy.rules;

/**
 * ANNUAL RULES (chunk 7G) - how a year's terms become the year's result, one
 * rule per scope. The school default comes first, then class rules in the
 * school's own class order. A rule's scope cannot move once saved (the unique
 * indexes name it); a wrong rule is edited.
 */
export function AnnualRulesScreen() {
  const scope = useExamScope();
  const branchName = useActiveBranchName();
  const policies = useAnnualPolicies();
  const classes = useCriteriaClasses();

  const year = scope.academicYear;
  const rows = policies.data ?? [];
  const classRows = [...(classes.data ?? [])].sort(
    (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
  );
  const classIndex = new Map(classRows.map((row, index) => [row.id, index]));
  const ordered = sortPolicies(rows, (id) => classIndex.get(id) ?? 10_000);
  const className = (id: string) => classRows.find((row) => row.id === id)?.name ?? c.classFallback;
  const options = uncoveredPolicyScopes(
    classRows.map((row) => ({ id: row.id, name: row.name })),
    rows,
  );
  const counts = policyCounts(rows);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={c.title}
      meta={copy.exams.meta(year?.name ?? null, branchName)}
      backAccessibilityLabel={copy.common.back}
      backTestID="annual-rules-back"
      titleTestID="annual-rules-title"
      action={
        year && scope.canCreate && options.length > 0
          ? {
              label: c.add,
              icon: "add",
              onPress: () => router.push("/exams/setup/annual-rules/new"),
              testID: "annual-rules-add",
            }
          : undefined
      }
      onRefresh={
        scope.canRead && scope.addressable
          ? () => {
              void policies.refetch();
              void classes.refetch();
            }
          : undefined
      }
      refreshing={policies.isRefetching || classes.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState icon="lock" title={copy.exams.deniedTitle} message={copy.exams.deniedBody} testID="annual-rules-denied" />,
    );
  }
  if (scope.ready && !year) {
    return frame(
      <EmptyState icon="calendarOff" title={c.noSessionTitle} message={c.noSessionBody} testID="annual-rules-no-session" />,
    );
  }
  if (scope.ready && (!scope.organizationId || !scope.schoolId)) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="annual-rules-no-branch"
      />,
    );
  }
  if (!scope.ready || policies.isPending || classes.isPending) {
    return frame(
      <View style={styles.skeletons} testID="annual-rules-loading">
        <Skeleton height={96} />
        <Skeleton height={96} />
      </View>,
    );
  }
  if (policies.isError) {
    return frame(
      <ErrorCard cause={policies.error} onRetry={() => void policies.refetch()} testID="annual-rules-error" />,
    );
  }

  return frame(
    <View style={styles.body}>
      {classes.isError ? (
        <Notice
          tone="caution"
          title={copy.exams.grading.criteria.classNamesTitle}
          message={errorMessage(classes.error)}
          testID="annual-rules-classes-error"
        />
      ) : null}

      {ordered.length === 0 ? (
        <EmptyState icon="checkCircle" title={c.emptyTitle} message={c.emptyBody} testID="annual-rules-empty">
          {scope.canCreate && options.length > 0 ? (
            <CapsuleButton
              title={c.add}
              icon="add"
              size="compact"
              onPress={() => router.push("/exams/setup/annual-rules/new")}
              testID="annual-rules-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SectionHead title={c.title} hint={c.ruleCount(counts.defaults, counts.classes)} />
          <Card padless testID="annual-rules-list">
            {ordered.map((row, index) => (
              <RuleRow
                key={row.id}
                row={row}
                title={row.classId === null ? c.defaultRule : className(row.classId)}
                first={index === 0}
                onPress={
                  scope.canUpdate || scope.canCreate
                    ? () =>
                        router.push({
                          pathname: "/exams/setup/annual-rules/[policyId]",
                          params: { policyId: row.id },
                        })
                    : undefined
                }
              />
            ))}
          </Card>
          {scope.canCreate && options.length === 0 ? (
            <ThemedText variant="meta" style={styles.hint}>
              {c.allScopesBody}
            </ThemedText>
          ) : null}
        </>
      )}
    </View>,
  );
}

function RuleRow({
  row,
  title,
  first,
  onPress,
}: {
  row: PolicyRow;
  title: string;
  first: boolean;
  onPress?: () => void;
}) {
  const line2 = policyPromotionLine(row);
  const label = `${title}. ${row.summary}. ${line2}`;
  const body = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={3}>
          {row.summary}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {line2}
        </ThemedText>
      </View>
      {row.classId === null ? <QuietChip label={c.defaultChip} tone="positive" testID={`annual-rule-default-${row.id}`} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View
        style={[styles.row, first ? null : styles.divider]}
        accessible
        accessibilityLabel={label}
        testID={`annual-rule-row-${row.id}`}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={`annual-rule-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={c.editTitle}
      onPress={onPress}
      style={({ pressed }) => [styles.row, first ? null : styles.divider, pressed ? styles.rowPressed : null]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  skeletons: { gap: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowPressed: { backgroundColor: colors.field },
  rowText: { flex: 1, gap: spacing.xxs },
  hint: { paddingHorizontal: spacing.xs },
});

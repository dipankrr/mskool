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
import { useBranchMeta } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import {
  criteriaCounts,
  criteriaMeta,
  sortCriteriaRows,
  uncoveredScopes,
} from "../../../lib/pass-criteria";
import { colors } from "../../../theme/brand-admin";
import { spacing, touch } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { QuietChip, SectionHead } from "./ui";
import {
  useCriteriaClasses,
  useCriteriaSubjects,
  usePassCriteriaAdmin,
} from "./use-grading";

type CriteriaRow = inferRouterOutputs<AppRouter>["exam"]["passCriteria"]["list"][number];

/**
 * PASS CRITERIA (chunk 7F) — what passing a year means, one rule per scope.
 *
 * The school default comes first, then class overrides in the school's own
 * class order. There is no delete on the server, so this screen never offers
 * one: a wrong rule is edited, and a scope cannot move once saved.
 */
export function PassCriteriaScreen() {
  const scope = useExamScope();
  const branchName = useBranchMeta();
  const criteria = usePassCriteriaAdmin();
  const classes = useCriteriaClasses();
  const subjects = useCriteriaSubjects();

  const year = scope.academicYear;
  const rows = criteria.data ?? [];

  const classRows = [...(classes.data ?? [])].sort(
    (a, b) => a.numericOrder - b.numericOrder || a.name.localeCompare(b.name),
  );
  const classIndex = new Map(classRows.map((row, index) => [row.id, index]));
  const ordered = sortCriteriaRows(
    rows,
    (classId) => classIndex.get(classId) ?? 10_000,
  );
  const className = (classId: string) =>
    classRows.find((row) => row.id === classId)?.name ??
    copy.exams.grading.criteria.classFallback;
  const subjectName = (subjectId: string) =>
    (subjects.data ?? []).find((subject) => subject.id === subjectId)?.name ??
    null;

  const options = uncoveredScopes(
    classRows.map((row) => ({ id: row.id, name: row.name })),
    rows,
  );
  const counts = criteriaCounts(rows);

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.grading.criteria.title}
      meta={branchName}
      backAccessibilityLabel={copy.common.back}
      backTestID="pass-criteria-back"
      titleTestID="pass-criteria-title"
      action={
        year && scope.canCreate && options.length > 0
          ? {
              label: copy.exams.grading.criteria.add,
              icon: "add",
              onPress: () => router.push("/exams/setup/pass-criteria/new"),
              testID: "pass-criteria-add",
            }
          : undefined
      }
      onRefresh={
        scope.canRead && scope.addressable
          ? () => {
              void criteria.refetch();
              void classes.refetch();
            }
          : undefined
      }
      refreshing={criteria.isRefetching || classes.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="pass-criteria-denied"
      />,
    );
  }

  if (!scope.ready || !year) {
    if (scope.ready && !year) {
      return frame(
        <EmptyState
          icon="calendarOff"
          title={copy.exams.grading.criteria.noSessionTitle}
          message={copy.exams.grading.criteria.noSessionBody}
          testID="pass-criteria-no-session"
        />,
      );
    }
    return frame(
      <View style={styles.skeletons} testID="pass-criteria-loading">
        <Skeleton height={84} />
        <Skeleton height={84} />
      </View>,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="pass-criteria-no-branch"
      />,
    );
  }

  if (criteria.isPending || classes.isPending) {
    return frame(
      <View style={styles.skeletons} testID="pass-criteria-loading">
        <Skeleton height={84} />
        <Skeleton height={84} />
      </View>,
    );
  }

  if (criteria.isError) {
    return frame(
      <ErrorCard
        cause={criteria.error}
        onRetry={() => void criteria.refetch()}
        testID="pass-criteria-error"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      {classes.isError ? (
        <Notice
          tone="caution"
          title={copy.exams.grading.criteria.classNamesTitle}
          message={errorMessage(classes.error)}
          testID="pass-criteria-classes-error"
        />
      ) : null}

      {ordered.length === 0 ? (
        <EmptyState
          icon="checkCircle"
          title={copy.exams.grading.criteria.emptyTitle}
          message={copy.exams.grading.criteria.emptyBody}
          testID="pass-criteria-empty"
        >
          {scope.canCreate && options.length > 0 ? (
            <CapsuleButton
              title={copy.exams.grading.criteria.add}
              icon="add"
              size="compact"
              onPress={() => router.push("/exams/setup/pass-criteria/new")}
              testID="pass-criteria-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SectionHead
            title={copy.exams.grading.criteria.title}
            hint={copy.exams.grading.criteria.ruleCount(
              counts.defaults,
              counts.classes,
            )}
          />
          <Card padless testID="pass-criteria-list">
            {ordered.map((row, index) => {
              const meta = criteriaMeta(row, subjectName);
              return (
                <CriteriaListRow
                  key={row.id}
                  row={row}
                  title={
                    row.classId === null
                      ? copy.exams.grading.criteria.defaultRule
                      : className(row.classId)
                  }
                  line1={meta.line1}
                  line2={meta.line2}
                  first={index === 0}
                  onPress={
                    scope.canUpdate
                      ? () =>
                          router.push({
                            pathname: "/exams/setup/pass-criteria/[criteriaId]",
                            params: { criteriaId: row.id },
                          })
                      : undefined
                  }
                />
              );
            })}
          </Card>
          {scope.canCreate && options.length === 0 ? (
            <ThemedText variant="meta" style={styles.hint}>
              {copy.exams.grading.criteria.allScopesBody}
            </ThemedText>
          ) : null}
        </>
      )}
    </View>,
  );
}

function CriteriaListRow({
  row,
  title,
  line1,
  line2,
  first,
  onPress,
}: {
  row: CriteriaRow;
  title: string;
  line1: string;
  line2: string;
  first: boolean;
  onPress?: () => void;
}) {
  const label = `${title}. ${line1}. ${line2}`;
  const body = (
    <>
      <View style={styles.rowText}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {title}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {line1}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {line2}
        </ThemedText>
      </View>
      {row.classId === null ? (
        <QuietChip
          label={copy.exams.grading.criteria.defaultChip}
          tone="positive"
          testID={`pass-criteria-default-${row.id}`}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.row, first ? null : styles.divider]}
        accessible
        accessibilityLabel={label}
        testID={`pass-criteria-row-${row.id}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={`pass-criteria-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={copy.exams.grading.criteria.editTitle}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {body}
    </Pressable>
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
    alignItems: "flex-start",
    gap: spacing.md,
    minHeight: touch.row,
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
  hint: {
    paddingHorizontal: spacing.xs,
  },
});

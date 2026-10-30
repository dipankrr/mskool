import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
import {
  filterCounts,
  filterStudents,
  isFlagged,
  sortStudents,
  verdictCountsLine,
} from "../../../lib/annual";
import type { AnnualFilter } from "../../../lib/annual";
import { annualCopy } from "../../../lib/annual-copy";
import { copy } from "../../../lib/copy";
import { errorMessage } from "../../../lib/errors";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing, touch } from "../../../theme/tokens";
import { ConfirmSheet } from "../../homework/confirm-sheet";
import { ChipRow } from "../chip-row";
import type { Chip } from "../chip-row";
import { useExamScope } from "../use-exam-data";
import { StatusChip, VerdictPill, pct } from "./parts";
import {
  useAnnualClassActions,
  useAnnualNames,
  useAnnualReadiness,
  useAnnualTable,
} from "./use-annual";

type Issue = NonNullable<inferRouterOutputs<AppRouter>["exam"]["annual"]["readiness"]>["blockers"][number];

const c = annualCopy.klass;

/**
 * ONE CLASS'S YEAR (chunk 7G, ADR-053) - readiness first, then the act, then
 * the list. Generate is a preview (nothing is visible to families); Publish
 * freezes the class's annual cards and says why when it cannot. Every blocker
 * is a door to the screen that fixes it.
 */
export function ClassAnnualScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const scope = useExamScope();
  const names = useAnnualNames();
  const readiness = useAnnualReadiness(classId);
  const table = useAnnualTable(classId);
  const actions = useAnnualClassActions(classId);

  const [filter, setFilter] = useState<AnnualFilter>("all");
  const [section, setSection] = useState<string>("*");
  const [banner, setBanner] = useState<{ tone: "positive" | "critical"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const className = names.className(classId) ?? "";
  const year = scope.academicYear;
  const students = useMemo(() => table.data?.students ?? [], [table.data]);
  const sections = useMemo(
    () => [...new Set(students.map((s) => s.sectionName).filter((n): n is string => Boolean(n)))].sort(),
    [students],
  );
  const inSection = section === "*" ? students : students.filter((s) => s.sectionName === section);
  const counts = filterCounts(inSection);
  const visible = sortStudents(filterStudents(inSection, filter));

  const status = readiness.data?.status ?? "none";
  const policy = readiness.data?.policy ?? null;
  const hasRows = students.length > 0;
  const published = status === "published";

  const frame = (children: ReactNode, footer?: ReactNode) => (
    <ScreenFrame
      title={className || annualCopy.final.title}
      meta={year?.name ?? undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="class-annual-back"
      titleTestID="class-annual-title"
      footer={footer}
      onRefresh={
        scope.canRead && scope.addressable
          ? () => {
              void readiness.refetch();
              void table.refetch();
            }
          : undefined
      }
      refreshing={readiness.isRefetching || table.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState icon="lock" title={annualCopy.final.deniedTitle} message={annualCopy.final.deniedBody} testID="class-annual-denied" />,
    );
  }
  if (!scope.ready || readiness.isPending || table.isPending) {
    return frame(
      <View style={styles.body} testID="class-annual-loading">
        <Skeleton height={96} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }
  if (readiness.isError || table.isError) {
    return frame(
      <ErrorCard
        cause={readiness.error ?? table.error}
        onRetry={() => {
          void readiness.refetch();
          void table.refetch();
        }}
        testID="class-annual-error"
      />,
    );
  }
  if (!readiness.data || !table.data) {
    return frame(
      <EmptyState icon="exams" title={c.loadError} message="" testID="class-annual-missing" />,
    );
  }

  const generate = () => {
    setBanner(null);
    void actions
      .generate()
      .then((out) => {
        if (out) setBanner({ tone: "positive", text: c.generatedBanner(out.generated) });
      })
      .catch((cause) => setBanner({ tone: "critical", text: `${c.generateFailed}: ${errorMessage(cause)}` }));
  };

  const openIssue = (issue: Issue) => {
    if (issue.code === "no_policy") {
      router.push("/exams/setup/annual-rules");
      return;
    }
    if (issue.examId) {
      router.push({
        pathname: "/exams/[examId]/class/[classId]",
        params: { examId: issue.examId, classId },
      });
    }
  };

  const sectionChips: readonly Chip<string>[] = [
    { value: "*", label: annualCopy.klass.filters.all, testID: "annual-section-all" },
    ...sections.map((name) => ({ value: name, label: name, testID: `annual-section-${name}` })),
  ];
  const filterChips: readonly Chip<AnnualFilter>[] = (
    ["all", "detained", "compartment", "flagged"] as const
  ).map((value) => ({
    value,
    label: `${c.filters[value]} ${counts[value]}`,
    testID: `annual-filter-${value}`,
  }));

  const footer =
    scope.canUpdate || scope.canPublish ? (
      <View style={styles.footer}>
        {readiness.data.publishBlockedReason && !published && hasRows ? (
          <ThemedText variant="meta" color={colors.muted} testID="class-annual-publish-reason">
            {readiness.data.publishBlockedReason}
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          {scope.canUpdate && !published ? (
            <CapsuleButton
              title={actions.generating ? c.generating : hasRows ? c.generateAgain : c.generate}
              icon="refresh"
              variant={hasRows ? "secondary" : "primary"}
              loading={actions.generating}
              disabled={actions.generating || actions.publishing || !policy}
              onPress={generate}
              testID="class-annual-generate"
              style={styles.action}
            />
          ) : null}
          {scope.canPublish && !published ? (
            <CapsuleButton
              title={c.publish}
              icon="check"
              disabled={Boolean(readiness.data.publishBlockedReason) || actions.generating || actions.publishing}
              onPress={() => setConfirm(true)}
              testID="class-annual-publish"
              style={styles.action}
            />
          ) : null}
        </View>
      </View>
    ) : undefined;

  const heldBack = students.filter((s) => s.promotionStatus !== "promoted").length;
  const termCount = table.data.terms.length;

  return frame(
    <View style={styles.body}>
      {policy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${policy.summary}. ${c.rulesLink}`}
          onPress={() => router.push("/exams/setup/annual-rules")}
          style={({ pressed }) => [styles.policy, pressed ? styles.pressed : null]}
          testID="class-annual-policy"
        >
          <ThemedText variant="meta" style={styles.policyText} numberOfLines={3}>
            {policy.summary}
          </ThemedText>
          <StatusChip status={status} testID="class-annual-status" />
        </Pressable>
      ) : null}

      {banner ? (
        <Notice
          tone={banner.tone}
          title={banner.text}
          icon={banner.tone === "positive" ? "checkCircle" : "info"}
          testID="class-annual-banner"
        />
      ) : null}
      {actions.generating ? (
        <Notice
          tone="neutral"
          icon="info"
          title={c.generatingClass(className, readiness.data.studentCount)}
          testID="class-annual-generating"
        />
      ) : null}
      {published ? <Notice tone="positive" icon="checkCircle" title={c.publishedNote} testID="class-annual-published" /> : null}
      {status === "stale" ? <Notice tone="caution" icon="info" title={c.staleNote} testID="class-annual-stale" /> : null}

      {readiness.data.blockers.length > 0 ? (
        <IssueCard
          title={c.blockersTitle}
          tone="critical"
          issues={readiness.data.blockers}
          onOpen={openIssue}
          testID="class-annual-blockers"
        />
      ) : null}
      {readiness.data.warnings.length > 0 ? (
        <IssueCard
          title={c.warningsTitle}
          tone="neutral"
          issues={readiness.data.warnings}
          onOpen={openIssue}
          testID="class-annual-warnings"
        />
      ) : null}
      {readiness.data.blockers.length === 0 && readiness.data.warnings.length === 0 && policy ? (
        <Notice tone="positive" icon="checkCircle" title={c.readyTitle} message={c.readyBody} testID="class-annual-ready" />
      ) : null}

      {!hasRows ? (
        <EmptyState icon="exams" title={c.emptyTitle} message={c.emptyBody} testID="class-annual-empty" />
      ) : (
        <>
          <ThemedText variant="meta" color={colors.muted} testID="class-annual-counts">
            {verdictCountsLine(inSection)}
          </ThemedText>
          {sections.length > 1 ? (
            <ChipRow label="Sections" value={section} options={sectionChips} onChange={setSection} />
          ) : null}
          <ChipRow label="Filter" value={filter} options={filterChips} onChange={setFilter} />
          {visible.length === 0 ? (
            <EmptyState icon="exams" title={c.emptyFilter} message="" testID="class-annual-empty-filter" />
          ) : (
            <Card padless testID="class-annual-list">
              {visible.map((student, index) => (
                <Pressable
                  key={student.studentId}
                  testID={`annual-student-${student.studentId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${student.name}. ${annualCopy.verdicts[student.promotionStatus]}. ${
                    student.percentage ? `${pct(student.percentage)} percent.` : ""
                  }`}
                  onPress={() =>
                    router.push({
                      pathname: "/exams/final/[classId]/student/[studentId]",
                      params: { classId, studentId: student.studentId },
                    })
                  }
                  style={({ pressed }) => [
                    styles.row,
                    index === 0 ? null : styles.divider,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View style={styles.rowText}>
                    <ThemedText variant="bodyStrong" numberOfLines={1}>
                      {student.name}
                    </ThemedText>
                    <ThemedText variant="meta" numberOfLines={1}>
                      {[
                        student.sectionName,
                        student.rollNumber ? `Roll ${student.rollNumber}` : null,
                        student.percentage ? `${pct(student.percentage)}%${student.grade ? ` · ${student.grade}` : ""}` : null,
                        student.rankInClass ? c.rank(student.rankInClass) : null,
                        isFlagged(student) ? c.termsTag(student.termsUsed, termCount) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </ThemedText>
                  </View>
                  <VerdictPill status={student.promotionStatus} />
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}

      {confirm ? (
        <ConfirmSheet
          title={c.publishTitle}
          body={c.publishBody(students.length, heldBack)}
          confirmLabel={c.publishConfirm}
          keepLabel={c.cancel}
          submitting={actions.publishing}
          error={null}
          onConfirm={() => {
            void actions
              .publish()
              .then((out) => {
                setConfirm(false);
                if (out) setBanner({ tone: "positive", text: c.publishedBanner(out.published) });
              })
              .catch((cause) => {
                setConfirm(false);
                setBanner({ tone: "critical", text: `${c.publishFailed}: ${errorMessage(cause)}` });
              });
          }}
          onClose={() => setConfirm(false)}
          testIDPrefix="annual-publish"
        />
      ) : null}
    </View>,
    footer,
  );
}

function IssueCard({
  title,
  tone,
  issues,
  onOpen,
  testID,
}: {
  title: string;
  tone: "critical" | "neutral";
  issues: readonly Issue[];
  onOpen: (issue: Issue) => void;
  testID: string;
}) {
  return (
    <Card testID={testID}>
      <ThemedText
        variant="sectionLabel"
        color={tone === "critical" ? colors.tone.critical.fg : undefined}
        accessibilityLiveRegion={tone === "critical" ? "polite" : undefined}
      >
        {title}
      </ThemedText>
      <View style={styles.issues}>
        {issues.map((issue, index) => {
          const openable = issue.code === "no_policy" || Boolean(issue.examId);
          const body = (
            <ThemedText variant="body" style={styles.issueText}>
              {issue.message}
            </ThemedText>
          );
          return openable ? (
            <Pressable
              key={`${issue.code}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={issue.message}
              onPress={() => onOpen(issue)}
              style={({ pressed }) => [styles.issue, pressed ? styles.pressed : null]}
              testID={`${testID}-${index}`}
            >
              {body}
            </Pressable>
          ) : (
            <View key={`${issue.code}-${index}`} style={styles.issue}>
              {body}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  footer: { gap: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.sm },
  action: { flex: 1 },
  policy: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  policyText: { flex: 1 },
  pressed: { backgroundColor: colors.chip },
  issues: { marginTop: spacing.sm, gap: spacing.xs },
  issue: { paddingVertical: spacing.xs, minHeight: 36, justifyContent: "center" },
  issueText: { flexShrink: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowText: { flex: 1, gap: spacing.xxs },
});

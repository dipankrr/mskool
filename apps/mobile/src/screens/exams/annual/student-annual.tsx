import { useMemo } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { Notice } from "../../../components/notice";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { renormalizedNote, verdictInWords } from "../../../lib/annual";
import { annualCopy } from "../../../lib/annual-copy";
import { copy } from "../../../lib/copy";
import { colors } from "../../../theme/brand-admin";
import { spacing } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { VerdictPill, pct } from "./parts";
import { useAnnualTable } from "./use-annual";

const c = annualCopy.student;

/**
 * ONE STUDENT'S YEAR (chunk 7G) - the verdict in words first, because that is
 * what a principal has to say to a parent, then the subject x term grid with
 * the terms that counted in bold and the rest dimmed, so best-N and a late
 * joiner explain themselves.
 */
export function StudentAnnualScreen() {
  const { classId, studentId } = useLocalSearchParams<{ classId: string; studentId: string }>();
  const scope = useExamScope();
  const table = useAnnualTable(classId);

  const student = table.data?.students.find((s) => s.studentId === studentId) ?? null;
  const subjectName = useMemo(() => {
    const map = new Map((table.data?.subjects ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? "Subject";
  }, [table.data]);
  const terms = table.data?.terms ?? [];
  const termName = (id: string) => terms.find((t) => t.id === id)?.name ?? "Term";

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={student?.name ?? c.title}
      meta={student ? [student.sectionName, student.rollNumber ? `Roll ${student.rollNumber}` : null].filter(Boolean).join(" · ") : undefined}
      backAccessibilityLabel={copy.common.back}
      backTestID="student-annual-back"
      titleTestID="student-annual-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState icon="lock" title={annualCopy.final.deniedTitle} message={annualCopy.final.deniedBody} testID="student-annual-denied" />,
    );
  }
  if (!scope.ready || table.isPending) {
    return frame(
      <View style={styles.body} testID="student-annual-loading">
        <Skeleton height={110} />
        <Skeleton height={200} />
      </View>,
    );
  }
  if (table.isError) {
    return frame(<ErrorCard cause={table.error} onRetry={() => void table.refetch()} testID="student-annual-error" />);
  }
  if (!student) {
    return frame(
      <EmptyState icon="exams" title={c.gone} message={c.goneBody} testID="student-annual-gone" />,
    );
  }

  const renormalizedSubjects = student.subjects.filter((s) => s.renormalized && !s.isExempted);

  return frame(
    <View style={styles.body}>
      <Card testID="student-annual-verdict">
        <View style={styles.verdictHead}>
          <ThemedText variant="sectionLabel">{c.verdictTitle}</ThemedText>
          <VerdictPill status={student.promotionStatus} testID="student-annual-pill" />
        </View>
        <ThemedText variant="body" style={styles.verdictText} testID="student-annual-verdict-text">
          {verdictInWords(student, subjectName)}
        </ThemedText>
        <View style={styles.facts}>
          {student.percentage ? (
            <Fact label="Year" value={`${pct(student.percentage)}%${student.grade ? ` · ${student.grade}` : ""}`} />
          ) : null}
          <Fact label={c.ranks} value={c.rankLine(student.rankInSection, student.rankInClass)} />
          <Fact
            label={c.attendance}
            value={student.attendancePercentage ? `${pct(student.attendancePercentage)}%` : c.attendanceNone}
          />
        </View>
      </Card>

      {renormalizedSubjects.length > 0 ? (
        <Notice
          tone="caution"
          icon="info"
          title={renormalizedNote(
            renormalizedSubjects[0]!.sources,
            termName,
            terms.length,
          )}
          message={
            renormalizedSubjects.length > 1
              ? `${renormalizedSubjects.length} subjects were counted this way.`
              : undefined
          }
          testID="student-annual-renormalized"
        />
      ) : null}

      <ThemedText variant="sectionLabel" style={styles.section}>
        {c.subjectsTitle}
      </ThemedText>
      <Card padless testID="student-annual-subjects">
        <View style={[styles.gridRow, styles.gridHead]}>
          <ThemedText variant="meta" style={styles.subjectCol}>
            {" "}
          </ThemedText>
          {terms.map((t) => (
            <ThemedText key={t.id} variant="meta" style={styles.cell} numberOfLines={1}>
              {t.name.replace(/^Term\s*/i, "T")}
            </ThemedText>
          ))}
          <ThemedText variant="meta" style={styles.cell}>
            {c.termHeader}
          </ThemedText>
        </View>
        {student.subjects.map((subject) => (
          <View
            key={subject.subjectId}
            style={[styles.gridRow, styles.divider]}
            testID={`student-annual-subject-${subject.subjectId}`}
            accessible
            accessibilityLabel={`${subjectName(subject.subjectId)}. ${
              subject.isExempted
                ? c.excused
                : subject.percentage
                  ? `${pct(subject.percentage)} percent for the year. ${subject.isPassed ? "Passed" : "Not passed"}`
                  : subject.grade ?? ""
            }`}
          >
            <View style={styles.subjectCol}>
              <ThemedText variant="bodyStrong" numberOfLines={2}>
                {subjectName(subject.subjectId)}
              </ThemedText>
              {subject.displayMarks ? (
                <ThemedText variant="meta">
                  {pct(subject.displayMarks)}/{pct(subject.displayMax)}
                </ThemedText>
              ) : null}
            </View>
            {terms.map((t) => {
              const source = subject.sources.find((s) => s.termId === t.id);
              const text = source?.score ? pct(source.score) : (source?.grade ?? c.notSat);
              return (
                <ThemedText
                  key={t.id}
                  variant={source?.used ? "bodyStrong" : "body"}
                  color={source?.used ? colors.ink : colors.muted}
                  style={styles.cell}
                >
                  {text}
                </ThemedText>
              );
            })}
            <ThemedText
              variant="bodyStrong"
              color={subject.isExempted || subject.isPassed ? colors.ink : colors.tone.critical.fg}
              style={styles.cell}
            >
              {subject.isExempted ? c.excused : subject.percentage ? pct(subject.percentage) : (subject.grade ?? c.notSat)}
            </ThemedText>
          </View>
        ))}
      </Card>

      <CapsuleButton
        title={c.viewCard}
        icon="exams"
        variant="secondary"
        onPress={() =>
          router.push({
            pathname: "/exams/final/[classId]/card/[studentId]",
            params: { classId, studentId },
          })
        }
        disabled={!scope.canReadCards}
        testID="student-annual-card"
      />
    </View>,
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText variant="meta">{label}</ThemedText>
      <ThemedText variant="bodyStrong">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  verdictHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  verdictText: { marginTop: spacing.sm },
  facts: { marginTop: spacing.md, gap: spacing.sm },
  fact: { gap: spacing.xxs },
  section: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  gridRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  gridHead: { minHeight: 36 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  subjectCol: { flex: 2.2, gap: spacing.xxs },
  cell: { flex: 1, textAlign: "center" },
});

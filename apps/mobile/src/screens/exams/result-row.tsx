import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { displayMarks, fullName } from "../../lib/exams";
import { displayPercent, rankLine } from "../../lib/exam-results";
import type { ResultRow as ResultRowData, ResultVerdict } from "../../lib/exam-results";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const VERDICT_PILL: Record<ResultVerdict, { label: string; tone: Tone } | null> = {
  pass: { label: copy.exams.results.pass, tone: "positive" },
  fail: { label: copy.exams.results.fail, tone: "critical" },
  absent: { label: copy.exams.results.absent, tone: "caution" },
  none: null,
};

function rankWords(
  ranks: { section: number | null; class: number | null } | null,
): string | null {
  if (!ranks) return null;
  const text = [
    ranks.class !== null ? copy.exams.results.rankInClass(ranks.class) : null,
    ranks.section !== null ? copy.exams.results.rankInSection(ranks.section) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return text === "" ? null : text;
}

/**
 * One student in the class's ranked list: the list's order IS the rank, so the
 * row prints the numbers — total over max and the percentage, or the grade
 * alone in the GPA branch — and a pill that repeats the verdict in words. Tap
 * opens the student's result detail. This is a READ: no input lives here.
 */
export const ResultRow = memo(function ResultRow({
  row,
  onOpen,
}: {
  row: ResultRowData;
  onOpen: (studentId: string) => void;
}) {
  const { student, term } = row;
  const name = fullName(student);
  const verdict: ResultVerdict =
    term === null ? "none" : row.anyAbsent ? "absent" : term.isPassed ? "pass" : "fail";
  const pill = VERDICT_PILL[verdict];

  const gradeOnly = term !== null && term.percentage === null && term.grade !== null;
  const absentCount = row.subjects.filter((subject) => subject.isAbsent).length;
  const value = term
    ? row.anyAbsent
      ? copy.exams.results.absentOn(absentCount)
      : `${displayMarks(term.totalMarks)}/${displayMarks(term.maxMarks)}`
    : "—";
  const percent = term && !row.anyAbsent ? displayPercent(term.percentage) : null;

  const ranks = rankLine(term);
  const failed =
    term && term.subjectsFailedCount > 0 && !row.anyAbsent
      ? copy.exams.results.subjectsFailed(term.subjectsFailedCount)
      : null;
  const line = failed ?? (gradeOnly ? copy.exams.results.gradeOnlyNote : rankWords(ranks));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.exams.results.rowLabel(
        student.rollNumber,
        name,
        gradeOnly && term?.grade ? term.grade : value,
        pill ? pill.label : copy.exams.results.notComputed,
      )}
      accessibilityHint={copy.exams.results.openStudent}
      onPress={() => onOpen(student.studentId)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      testID={`result-row-${student.studentId}`}
    >
      <ThemedText variant="meta" style={styles.roll} numberOfLines={1}>
        {student.rollNumber ?? "–"}
      </ThemedText>
      <View style={styles.nameBlock}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {name}
        </ThemedText>
        {line ? (
          <ThemedText variant="meta" color={colors.muted} numberOfLines={1}>
            {line}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.valueBlock}>
        <ThemedText
          variant="name"
          style={styles.value}
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
        >
          {gradeOnly && term?.grade ? term.grade : value}
        </ThemedText>
        {percent ? (
          <ThemedText variant="meta" color={colors.muted} style={styles.value}>
            {`${percent}%`}
          </ThemedText>
        ) : null}
      </View>
      {pill ? (
        <StatusPill
          label={pill.label}
          tone={pill.tone}
          testID={`result-pill-${student.studentId}`}
        />
      ) : (
        <ThemedText variant="meta" color={colors.muted}>
          {copy.exams.results.notComputed}
        </ThemedText>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    marginBottom: spacing.sm - spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  roll: {
    width: 26,
  },
  nameBlock: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  valueBlock: {
    alignItems: "flex-end",
    gap: spacing.xxs,
  },
  value: {
    fontVariant: ["tabular-nums"],
  },
});

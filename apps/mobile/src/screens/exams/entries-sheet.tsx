import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { FormSheet } from "../../components/form-sheet";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { displayMarks } from "../../lib/exams";
import {
  entriesForSubject,
  isCorrectableEntry,
} from "../../lib/exam-results";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { useStudentEntries } from "./use-results";

/**
 * One subject's component entries for one student (`marks.studentEntries`,
 * filtered — the read spans every paper of the exam). The corrector names the
 * exact cell they are revising: a published row opens the correction sheet, an
 * un-published row points back to the paper screen, a locked row says the exam
 * is sealed. The read only displays; the apply still refuses what it must.
 */
export function EntriesSheet({
  examId,
  studentId,
  studentName,
  subject,
  windowOpen,
  canCorrect,
  onCorrect,
  onClose,
}: {
  examId: string;
  studentId: string;
  studentName: string;
  subject: { id: string; name: string };
  /** The class's window is open: corrections apply at close, not now. */
  windowOpen: boolean;
  canCorrect: boolean;
  onCorrect: (componentResultId: string) => void;
  /** `corrected` is true when a correction was applied in a nested sheet. */
  onClose: (corrected: boolean) => void;
}) {
  const entries = useStudentEntries(examId, studentId);
  const rows = useMemo(
    () => entriesForSubject(entries.data ?? [], subject.id),
    [entries.data, subject.id],
  );

  return (
    <FormSheet
      title={copy.exams.correction.entriesTitle(studentName, subject.name)}
      onClose={() => onClose(false)}
      testIDPrefix="entries-sheet"
      footer={
        <CapsuleButton
          title={copy.exams.paper.sheet.doneAction}
          size="compact"
          variant="secondary"
          onPress={() => onClose(false)}
          testID="entries-sheet-done"
        />
      }
    >
      {entries.isPending ? (
        <ThemedText variant="meta">{copy.exams.hub.review.loading}</ThemedText>
      ) : entries.isError ? (
        <ThemedText variant="meta" color={colors.tone.critical.fg}>
          {copy.exams.results.loadError}
        </ThemedText>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="exams"
          title={copy.exams.correction.entriesEmptyTitle}
          message={copy.exams.correction.entriesEmptyBody}
          testID="entries-sheet-empty"
        />
      ) : (
        <View style={styles.list}>
          {rows.map((row) => {
            const correctable = canCorrect && isCorrectableEntry(row);
            const locked = row.resultStatus === "locked";
            const unPublished =
              !correctable && !locked && row.resultStatus !== "locked";
            return (
              <Pressable
                key={row.id}
                disabled={!correctable}
                accessibilityRole={correctable ? "button" : "text"}
                accessibilityLabel={`${row.component}, ${row.isAbsent ? copy.exams.results.absent : displayMarks(row.marksObtained)} of ${displayMarks(row.maxMarks)}`}
                accessibilityHint={
                  correctable ? copy.exams.correction.correctAction : undefined
                }
                onPress={() => correctable && onCorrect(row.id)}
                style={({ pressed }) => [
                  styles.row,
                  correctable && pressed ? styles.rowPressed : null,
                ]}
                testID={`entries-row-${row.id}`}
              >
                <View style={styles.nameBlock}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {row.component}
                  </ThemedText>
                  {locked ? (
                    <ThemedText variant="meta" color={colors.tone.caution.fg}>
                      {copy.exams.correction.sealed}
                    </ThemedText>
                  ) : unPublished ? (
                    <ThemedText variant="meta" color={colors.muted}>
                      {copy.exams.correction.notPublished}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText
                  variant="body"
                  style={styles.marks}
                  numberOfLines={1}
                >
                  {row.isAbsent
                    ? copy.exams.results.absent
                    : row.isExempted
                      ? copy.exams.paper.exemptChip
                      : row.gradeObtained && row.marksObtained === null
                        ? row.gradeObtained
                        : `${displayMarks(row.marksObtained)}/${displayMarks(row.maxMarks)}`}
                </ThemedText>
                {correctable ? (
                  <StatusPill
                    label={copy.exams.correction.correctAction}
                    tone="caution"
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {windowOpen && canCorrect ? (
        <ThemedText variant="meta" color={colors.tone.caution.fg}>
          {copy.exams.correction.windowNote}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.xxs,
  },
  marks: {
    fontVariant: ["tabular-nums"],
  },
});

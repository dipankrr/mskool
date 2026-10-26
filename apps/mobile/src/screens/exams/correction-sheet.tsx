import { useMemo, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { displayMarks } from "../../lib/exams";
import {
  checkCorrection,
  REVISION_TYPES,
} from "../../lib/exam-results";
import type { RevisionType } from "../../lib/exam-results";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { useCorrection, useStudentEntries } from "./use-results";

/**
 * The ledger sheet (hard rule 7): the previous value, the revised one, a
 * reason type and a reason of at least three characters — the reason and the
 * ledger row are what make the change reviewable afterwards. The apply is the
 * server's: it refuses draft/entered rows, locked exams, and over-max marks
 * only silently (gap 21), so the range check runs HERE first. With the class's
 * window open the change applies at close; without one it is the
 * auto-window-of-one — recomputes and re-issues cards the moment it lands.
 */
export function CorrectionSheet({
  examId,
  studentId,
  componentResultId,
  subjectName,
  gradedOnly,
  windowOpen,
  onApplied,
  onClose,
}: {
  examId: string;
  studentId: string;
  componentResultId: string;
  subjectName: string;
  gradedOnly: boolean;
  windowOpen: boolean;
  onApplied: () => void;
  onClose: () => void;
}) {
  const entries = useStudentEntries(examId, studentId);
  const { apply, pending, error, reset } = useCorrection(examId);

  const entry = useMemo(
    () => (entries.data ?? []).find((row) => row.id === componentResultId) ?? null,
    [entries.data, componentResultId],
  );
  // The client-side range ceiling (gap 21): the component's own max.
  const maxMarks = entry ? Number(entry.maxMarks) : 0;

  const [text, setText] = useState("");
  const [type, setType] = useState<RevisionType | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const current = entry
    ? entry.isAbsent
      ? copy.exams.results.absent
      : entry.gradeObtained && entry.marksObtained === null
        ? entry.gradeObtained
        : `${displayMarks(entry.marksObtained)} of ${displayMarks(entry.maxMarks)}`
    : "—";

  const submit = () => {
    const verdict = checkCorrection({
      max: maxMarks,
      gradedOnly,
      text,
      revisionType: type,
      reason,
    });
    if (!verdict.ok) {
      setProblem(
        verdict.reason === "range"
          ? copy.exams.correction.errors.range(displayMarks(String(maxMarks)))
          : verdict.reason === "format"
            ? copy.exams.correction.errors.format
            : verdict.reason === "type"
              ? copy.exams.correction.errors.type
              : copy.exams.correction.errors.reason,
      );
      return;
    }
    setProblem(null);
    reset();
    void apply({
      componentResultId,
      revisedMarks: verdict.revisedMarks,
      revisedGrade: verdict.revisedGrade,
      revisionType: type as RevisionType,
      reason: reason.trim(),
    })
      .then(() => onApplied())
      .catch(() => {
        // The server's refusal prints below; the sheet stays open.
      });
  };

  return (
    <FormSheet
      title={copy.exams.correction.title}
      onClose={onClose}
      testIDPrefix="correction-sheet"
      footer={
        <>
          <CapsuleButton
            title={copy.exams.correction.confirm}
            onPress={submit}
            loading={pending}
            disabled={pending}
            testID="correction-sheet-apply"
          />
          <CapsuleButton
            title={copy.exams.correction.keep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={pending}
            testID="correction-sheet-keep"
          />
        </>
      }
    >
      <ThemedText variant="meta" color={colors.muted}>
        {subjectName}
      </ThemedText>
      <ThemedText variant="bodyStrong">
        {entry
          ? entry.isExempted
            ? copy.exams.paper.exemptChip
            : current
          : "—"}
      </ThemedText>

      {windowOpen ? (
        <ThemedText variant="meta" color={colors.tone.caution.fg}>
          {copy.exams.correction.windowNote}
        </ThemedText>
      ) : (
        <ThemedText variant="meta" color={colors.tone.caution.fg}>
          {copy.exams.correction.directNote}
        </ThemedText>
      )}

      <View style={styles.field}>
        <ThemedText variant="bodyStrong">
          {gradedOnly
            ? copy.exams.correction.revisedGradeLabel
            : copy.exams.correction.revisedLabel}
        </ThemedText>
        <TextInput
          testID="correction-sheet-value"
          value={text}
          onChangeText={setText}
          keyboardType={gradedOnly ? "default" : "decimal-pad"}
          autoCapitalize={gradedOnly ? "characters" : "none"}
          autoCorrect={false}
          selectTextOnFocus
          maxLength={gradedOnly ? 10 : undefined}
          placeholder={
            entry && !entry.isAbsent
              ? displayMarks(gradedOnly ? entry.gradeObtained : entry.marksObtained) || "–"
              : "–"
          }
          placeholderTextColor={colors.chevron}
          accessibilityLabel={
            gradedOnly
              ? copy.exams.correction.revisedGradeLabel
              : copy.exams.correction.revisedLabel
          }
          style={styles.input}
        />
      </View>

      <ChoicePills<RevisionType>
        label={copy.exams.correction.typeLabel}
        value={type}
        options={REVISION_TYPES.map((value) => ({
          value,
          label: copy.exams.correction.types[value],
        }))}
        onChange={setType}
        testIDPrefix="correction-type"
      />

      <View style={styles.field}>
        <ThemedText variant="bodyStrong">{copy.exams.correction.reasonLabel}</ThemedText>
        <TextInput
          testID="correction-sheet-reason"
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={2}
          placeholder={copy.exams.correction.reasonPlaceholder}
          placeholderTextColor={colors.chevron}
          accessibilityLabel={copy.exams.correction.reasonLabel}
          style={[styles.input, styles.reason]}
        />
      </View>

      {problem ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          accessibilityLiveRegion="polite"
          testID="correction-sheet-problem"
        >
          {problem}
        </ThemedText>
      ) : null}
      {error ? (
        <View style={styles.error}>
          <ThemedText variant="meta" color={colors.tone.critical.fg}>
            {copy.exams.correction.failed}
          </ThemedText>
          <ThemedText
            variant="meta"
            color={colors.tone.critical.fg}
            accessibilityLiveRegion="polite"
          >
            {errorMessage(error)}
          </ThemedText>
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.callout,
    color: colors.ink,
  },
  reason: {
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    minHeight: 72,
    textAlignVertical: "top",
  },
  error: {
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.tone.critical.bg,
    gap: spacing.xs,
  },
});

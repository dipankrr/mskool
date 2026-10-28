import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { GRADE_MAX, REMARKS_MAX, sanitizeGrade } from "../../lib/term-grade-draft";
import type { TermGradeDraft } from "../../lib/term-grade-draft";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { TermGradeStudent } from "./use-term-grades";

/**
 * One student's grade + remarks (chunk 7E). The row is the hot path — grade
 * only; this sheet is the quiet second view for the rare remark. It edits
 * LOCAL state and writes into the draft only on Save, so Cancel never leaves
 * a half-edited row behind.
 */
export function TermGradeSheet({
  draft,
  student,
  editable,
  onClose,
}: {
  draft: TermGradeDraft;
  student: TermGradeStudent;
  editable: boolean;
  onClose: () => void;
}) {
  const cell = draft.get(student.studentId);
  const [grade, setGrade] = useState(cell?.grade ?? "");
  const [remarks, setRemarks] = useState(cell?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (grade.trim() === "") {
      setError(copy.exams.termGrades.sheet.needGrade);
      return;
    }
    draft.setGrade(student.studentId, grade);
    draft.setRemarks(student.studentId, remarks);
    draft.commit(student.studentId);
    onClose();
  };

  return (
    <FormSheet
      title={student.name}
      onClose={onClose}
      testIDPrefix="term-grade-sheet"
      footer={
        editable ? (
          <CapsuleButton
            title={copy.exams.termGrades.sheet.save}
            onPress={save}
            testID="term-grade-sheet-save"
            style={styles.action}
          />
        ) : (
          <CapsuleButton
            title={copy.common.close}
            variant="secondary"
            onPress={onClose}
            testID="term-grade-sheet-close"
            style={styles.action}
          />
        )
      }
    >
      <View style={styles.body}>
        {cell?.remoteChange ? (
          <ThemedText
            variant="meta"
            color={colors.tone.caution.fg}
            accessibilityLiveRegion="polite"
          >
            {copy.exams.termGrades.changedElsewhere}
          </ThemedText>
        ) : null}

        <View style={styles.field}>
          <ThemedText variant="caption" style={styles.label}>
            {copy.exams.termGrades.sheet.gradeLabel}
          </ThemedText>
          <TextInput
            testID="term-grade-sheet-grade"
            value={grade}
            editable={editable}
            onChangeText={(text) => {
              setGrade(sanitizeGrade(text));
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
            maxLength={GRADE_MAX}
            maxFontSizeMultiplier={1.3}
            placeholder={copy.exams.termGrades.gradePlaceholder}
            placeholderTextColor={colors.chevron}
            accessibilityLabel={copy.exams.termGrades.sheet.gradeLabel}
            accessibilityHint={copy.exams.termGrades.sheet.gradeHelp}
            style={[styles.input, !editable ? styles.readOnly : null]}
          />
          <ThemedText variant="meta" style={styles.help}>
            {copy.exams.termGrades.sheet.gradeHelp}
          </ThemedText>
          {error ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
            >
              {error}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.field}>
          <ThemedText variant="caption" style={styles.label}>
            {copy.exams.termGrades.sheet.remarksLabel}
          </ThemedText>
          <TextInput
            testID="term-grade-sheet-remarks"
            value={remarks}
            editable={editable}
            onChangeText={(text) => setRemarks(text.slice(0, REMARKS_MAX))}
            multiline
            maxLength={REMARKS_MAX}
            maxFontSizeMultiplier={1.3}
            textAlignVertical="top"
            placeholder={copy.exams.termGrades.sheet.remarksPlaceholder}
            placeholderTextColor={colors.chevron}
            accessibilityLabel={copy.exams.termGrades.sheet.remarksLabel}
            style={[
              styles.input,
              styles.remarks,
              !editable ? styles.readOnly : null,
            ]}
          />
          <ThemedText variant="meta" style={styles.help}>
            {remarks.length} / {REMARKS_MAX}
          </ThemedText>
        </View>
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
    paddingTop: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    marginBottom: 2,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    color: colors.ink,
    fontFamily: fontFamily.medium,
    fontSize: fontSize.body,
  },
  remarks: {
    minHeight: 96,
  },
  readOnly: {
    opacity: 0.7,
  },
  help: {
    marginTop: 2,
  },
  action: {
    alignSelf: "stretch",
  },
});

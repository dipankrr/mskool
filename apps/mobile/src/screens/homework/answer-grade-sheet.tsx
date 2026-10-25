import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import {
  isValidAnswerMarks,
  trimDecimal,
} from "../../lib/homework-questions";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

const MAX_FEEDBACK = 2000;

/**
 * Marks for one hand-graded attempt answer.
 *
 * The sheet is a fresh mount per answer, so its fields start from that answer's
 * stored marks — never from the previous answer's. `isCorrect` is deliberately
 * not sent: a short answer is not a true/false, and the server only needs the
 * score and the note.
 *
 * The server caps the score at the question's maximum; the sheet refuses the
 * save first so a teacher sees the limit on the field rather than a round-trip
 * error. Zero is a real score and is accepted.
 */
export function AnswerGradeSheet({
  position,
  body,
  max,
  initialMarks,
  initialFeedback,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  position: number;
  body: string;
  max: string;
  initialMarks: string;
  initialFeedback: string;
  submitting: boolean;
  error: unknown;
  onSubmit: (input: { marks: string; feedback?: string }) => void;
  onClose: () => void;
}) {
  const text = copy.homework.grade;
  const [marks, setMarks] = useState(initialMarks);
  const [feedback, setFeedback] = useState(initialFeedback);
  const [touched, setTouched] = useState(false);

  const maxNumber = Number(max);
  const cappedMax = Number.isFinite(maxNumber) ? maxNumber : null;
  const trimmed = marks.trim();
  const marksError = !trimmed
    ? text.answerMarksRequired
    : !isValidAnswerMarks(trimmed, cappedMax)
      ? cappedMax !== null && Number(trimmed) > cappedMax
        ? text.answerMarksTooHigh(max)
        : text.answerMarksInvalid
      : undefined;
  const feedbackError =
    feedback.trim().length > MAX_FEEDBACK
      ? text.answerFeedbackTooLong
      : undefined;
  const valid = !marksError && !feedbackError;

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const note = feedback.trim();
    onSubmit({
      marks: trimDecimal(trimmed),
      ...(note.length > 0 ? { feedback: note } : {}),
    });
  };

  const footer = (
    <>
      {touched && !valid ? (
        <Notice
          tone="caution"
          title={text.answerSaveError}
          message={marksError ?? feedbackError}
          style={styles.notice}
          testID="homework-answer-grade-check"
        />
      ) : null}
      {error ? (
        <Notice
          tone="critical"
          title={text.answerSaveError}
          message={errorMessage(error)}
          style={styles.notice}
          testID="homework-answer-grade-error"
        />
      ) : null}
      <CapsuleButton
        title={text.answerSave}
        icon="check"
        onPress={save}
        loading={submitting}
        disabled={submitting}
        testID="homework-answer-grade-save"
      />
    </>
  );

  return (
    <FormSheet
      title={text.answerSheetTitle}
      onClose={onClose}
      footer={footer}
      testIDPrefix="homework-answer-grade"
    >
      <View style={styles.body}>
        <View style={styles.question}>
          <ThemedText variant="caption" color={colors.muted}>
            {text.answerSheetMeta(position, max)}
          </ThemedText>
          <ThemedText variant="bodyStrong" numberOfLines={4}>
            {body}
          </ThemedText>
        </View>

        <FormField
          label={text.answerMarks}
          value={marks}
          onChangeText={setMarks}
          onBlur={() => setTouched(true)}
          keyboardType="decimal-pad"
          suffix={`/ ${max}`}
          help={text.answerMarksHelp(max)}
          error={touched ? marksError : undefined}
          editable={!submitting}
          maxLength={8}
          testID="homework-answer-grade-marks"
        />

        <FormField
          label={text.answerFeedback}
          value={feedback}
          onChangeText={setFeedback}
          onBlur={() => setTouched(true)}
          placeholder={text.answerFeedbackPlaceholder}
          help={text.answerFeedbackHelp}
          error={touched ? feedbackError : undefined}
          editable={!submitting}
          maxLength={MAX_FEEDBACK}
          multiline
          numberOfLines={3}
          testID="homework-answer-grade-feedback"
        />
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  question: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  notice: {
    marginBottom: spacing.sm,
  },
});

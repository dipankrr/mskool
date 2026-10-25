import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { checkResubmitNote, MAX_RESUBMIT_NOTE } from "./grade-logic";

/**
 * Resubmit, not reject: the student is asked for a new version and the note
 * becomes the feedback they read. The service clears the marks on this path,
 * so the sheet says that in the body — a teacher should not discover it after
 * the fact.
 *
 * The form validates through the shared check so a one-letter note never
 * reaches the server. The parent owns the mutation and returns to the grid
 * after it succeeds.
 */
export function ResubmitSheet({
  studentName,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  studentName: string;
  submitting: boolean;
  error: unknown;
  onConfirm: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const check = checkResubmitNote(note);

  const submit = () => {
    setTouched(true);
    if (check.value) onConfirm(check.value);
  };

  return (
    <FormSheet
      title={copy.homework.grade.resubmitTitle}
      onClose={onClose}
      testIDPrefix="homework-resubmit"
      footer={
        <>
          <CapsuleButton
            title={copy.homework.grade.resubmitConfirm}
            onPress={submit}
            loading={submitting}
            disabled={submitting}
            testID="homework-resubmit-confirm"
          />
          <CapsuleButton
            title={copy.homework.actions.keep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={submitting}
            testID="homework-resubmit-keep"
            style={styles.keep}
          />
        </>
      }
    >
      <View style={styles.intro}>
        <ThemedText variant="body">{copy.homework.grade.resubmitBody}</ThemedText>
        <ThemedText variant="meta">{studentName}</ThemedText>
      </View>

      <FormField
        label={copy.homework.grade.resubmitLabel}
        value={note}
        onChangeText={setNote}
        onBlur={() => setTouched(true)}
        placeholder={copy.homework.grade.resubmitPlaceholder}
        help={copy.homework.grade.resubmitHelp}
        error={touched && check.error ? check.error : undefined}
        multiline
        numberOfLines={4}
        maxLength={MAX_RESUBMIT_NOTE}
        editable={!submitting}
        testID="homework-resubmit-note"
      />

      {error ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.error}
          accessibilityLiveRegion="polite"
        >
          {errorMessage(error)}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: spacing.xs,
  },
  error: {
    marginTop: spacing.md,
  },
  keep: {
    marginTop: spacing.sm,
  },
});

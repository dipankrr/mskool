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
import { checkExcuseReason, MAX_EXCUSE_REASON } from "./grade-logic";

/**
 * Excuse a student from the homework. The server refuses this once any work
 * exists — a submitted or reviewed row must be graded instead — so the sheet
 * keeps the body honest about the act being final here and leaves the server
 * refusal in view if someone reaches it anyway.
 */
export function ExcuseSheet({
  studentName,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  studentName: string;
  submitting: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const check = checkExcuseReason(reason);

  const submit = () => {
    setTouched(true);
    if (check.value) onConfirm(check.value);
  };

  return (
    <FormSheet
      title={copy.homework.grade.excuseTitle}
      onClose={onClose}
      testIDPrefix="homework-excuse"
      footer={
        <>
          <CapsuleButton
            title={copy.homework.grade.excuseConfirm}
            variant="destructive"
            onPress={submit}
            loading={submitting}
            disabled={submitting}
            testID="homework-excuse-confirm"
          />
          <CapsuleButton
            title={copy.homework.actions.keep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={submitting}
            testID="homework-excuse-keep"
            style={styles.keep}
          />
        </>
      }
    >
      <View style={styles.intro}>
        <ThemedText variant="body">{copy.homework.grade.excuseBody}</ThemedText>
        <ThemedText variant="meta">{studentName}</ThemedText>
      </View>

      <FormField
        label={copy.homework.grade.excuseLabel}
        value={reason}
        onChangeText={setReason}
        onBlur={() => setTouched(true)}
        placeholder={copy.homework.grade.excusePlaceholder}
        help={copy.homework.grade.excuseHelp}
        error={touched && check.error ? check.error : undefined}
        maxLength={MAX_EXCUSE_REASON}
        multiline
        numberOfLines={3}
        editable={!submitting}
        testID="homework-excuse-reason"
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

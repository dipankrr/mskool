import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { colors } from "../../theme/brand-admin";
import { fontSize, radius, spacing } from "../../theme/tokens";

const MIN_REASON = 3;
const MAX_REASON = 500;

/**
 * Cancel confirmation — the only lifecycle act that needs prose from the
 * teacher. A native `Alert.prompt` does not exist on Android, so the reason
 * gets a real sheet: one multiline field, the character counter, and the
 * finality stated in the body. The parent owns the mutation; this sheet only
 * collects a valid reason and reports the server's refusal.
 */
export function CancelSheet({
  sectionLabel,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  sectionLabel: string;
  submitting: boolean;
  error: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;
  const fieldError =
    touched && !valid ? copy.homework.actions.cancelReasonHelp : undefined;

  return (
    <FormSheet
      title={copy.homework.actions.cancelTitle}
      onClose={onClose}
      testIDPrefix="homework-cancel"
      footer={
        <>
          <CapsuleButton
            title={copy.homework.actions.cancelConfirm}
            variant="destructive"
            onPress={() => {
              setTouched(true);
              if (valid) onConfirm(trimmed);
            }}
            loading={submitting}
            disabled={submitting}
            testID="homework-cancel-confirm"
          />
          <CapsuleButton
            title={copy.homework.actions.keep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={submitting}
            testID="homework-cancel-keep"
            style={styles.keep}
          />
        </>
      }
    >
      <ThemedText variant="body">
        {copy.homework.actions.cancelBody}
      </ThemedText>
      <ThemedText variant="meta" style={styles.section}>
        {sectionLabel}
      </ThemedText>

      <View style={styles.field}>
        <View style={styles.labelRow}>
          <ThemedText variant="caption">
            {copy.homework.actions.cancelReasonLabel}
          </ThemedText>
          <ThemedText variant="caption" color={colors.muted}>
            {reason.trim().length}/{MAX_REASON}
          </ThemedText>
        </View>
        <View
          style={[
            styles.box,
            fieldError ? styles.boxError : null,
            submitting ? styles.boxDisabled : null,
          ]}
        >
          <TextInput
            value={reason}
            onChangeText={setReason}
            onBlur={() => setTouched(true)}
            placeholder={copy.homework.actions.cancelReasonPlaceholder}
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={4}
            maxLength={MAX_REASON}
            textAlignVertical="top"
            editable={!submitting}
            accessibilityLabel={copy.homework.actions.cancelReasonLabel}
            accessibilityHint={copy.homework.actions.cancelReasonHelp}
            style={styles.input}
            testID="homework-cancel-reason"
          />
        </View>
        {fieldError ? (
          <ThemedText
            variant="meta"
            color={colors.tone.critical.fg}
            style={styles.hint}
            accessibilityLiveRegion="polite"
          >
            {fieldError}
          </ThemedText>
        ) : (
          <ThemedText variant="meta" style={styles.hint}>
            {copy.homework.actions.cancelReasonHelp}
          </ThemedText>
        )}
      </View>

      {error ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.hint}
          accessibilityLiveRegion="polite"
        >
          {errorMessage(error)}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xs,
  },
  field: {
    marginTop: spacing.lg,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  box: {
    minHeight: 112,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  boxError: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  boxDisabled: {
    opacity: 0.7,
  },
  input: {
    flex: 1,
    minHeight: 96,
    color: colors.ink,
    fontSize: fontSize.callout,
  },
  hint: {
    marginTop: spacing.xs,
  },
  keep: {
    marginTop: spacing.sm,
  },
});

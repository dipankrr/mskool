import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/**
 * A lifecycle confirmation that carries no fields: publish and close change
 * what students see, so both ask first, but neither needs prose from the
 * teacher. The cancel flow keeps its own sheet because it collects a reason.
 *
 * This is a real sheet rather than `Alert.alert` for two reasons: the app
 * already speaks in sheets at decision points (the native dialog looked and
 * behaved differently on the two platforms), and the in-app surface survives
 * the Android activity detach that can silently swallow a native alert.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  keepLabel,
  tone = "default",
  submitting,
  error,
  onConfirm,
  onClose,
  testIDPrefix,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  keepLabel: string;
  tone?: "default" | "destructive";
  submitting: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
  testIDPrefix: string;
}) {
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix={testIDPrefix}
      footer={
        <>
          <CapsuleButton
            title={confirmLabel}
            variant={tone === "destructive" ? "destructive" : "primary"}
            onPress={onConfirm}
            loading={submitting}
            disabled={submitting}
            testID={`${testIDPrefix}-confirm`}
          />
          <CapsuleButton
            title={keepLabel}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={submitting}
            testID={`${testIDPrefix}-keep`}
            style={styles.keep}
          />
        </>
      }
    >
      <ThemedText variant="body">{body}</ThemedText>
      {error ? (
        <View style={styles.error}>
          <ThemedText variant="meta" color={colors.tone.critical.fg}>
            {copy.homework.actions.errorTitle}
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
  keep: {
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.tone.critical.bg,
    gap: spacing.xs,
  },
});

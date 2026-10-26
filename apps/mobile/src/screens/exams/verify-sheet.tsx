import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import type { VerifyBatch } from "../../lib/exam-draft";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/**
 * The verify confirmation: how many marks lock, for how many students, what is
 * left out and why, and what verifying means. It states counts, not "are you
 * sure": the reviewer should be able to see what they are about to do.
 *
 * `error` is a refusal from the server (scope, a sealed row), shown here, in the
 * server's words, with the sheet left open so it is read rather than swallowed.
 * Marks that moved under the reviewer are handled before this ever sends: the
 * panel re-reads, refuses, and closes the sheet with its own message.
 */
export function VerifySheet({
  batch,
  sectionName,
  checking,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  batch: VerifyBatch;
  sectionName: string | null;
  /** Re-reading the paper to be sure nothing moved. */
  checking: boolean;
  submitting: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const n = batch.items.length;
  const busy = checking || submitting;
  return (
    <FormSheet
      title={copy.exams.paper.review.sheetTitle(n)}
      onClose={() => {
        if (!busy) onClose();
      }}
      testIDPrefix="verify-sheet"
      footer={
        <>
          <CapsuleButton
            title={copy.exams.paper.review.sheetConfirm(n)}
            onPress={onConfirm}
            loading={busy}
            disabled={busy || n === 0}
            testID="verify-sheet-confirm"
          />
          <CapsuleButton
            title={copy.exams.paper.review.sheetKeep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={busy}
            testID="verify-sheet-keep"
            style={styles.keep}
          />
        </>
      }
    >
      <View style={styles.body}>
        <ThemedText variant="body">
          {copy.exams.paper.review.sheetBody(n, batch.students, sectionName)}
        </ThemedText>
        {batch.missingStudents > 0 ? (
          <ThemedText variant="meta">
            {copy.exams.paper.review.sheetExcluded(batch.missingStudents)}
          </ThemedText>
        ) : null}
        {batch.changedEntries > 0 ? (
          <ThemedText variant="meta" color={colors.tone.caution.fg}>
            {copy.exams.paper.review.sheetHeld(batch.changedEntries)}
          </ThemedText>
        ) : null}
        <ThemedText variant="meta">
          {copy.exams.paper.review.sheetConsequence}
        </ThemedText>
        {error ? (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {copy.exams.paper.review.sheetFailed}
            </ThemedText>
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {errorMessage(error)}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  keep: {
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.tone.critical.bg,
    gap: spacing.xs,
  },
});

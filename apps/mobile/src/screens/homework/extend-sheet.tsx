import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { TimeField } from "../../components/time-field";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { todayIso } from "../../lib/format";
import {
  clockOf,
  dayKeyOf,
  dayLabel,
  splitTimestamp,
} from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import {
  checkExtension,
  MAX_EXTENSION_REASON,
} from "./grade-logic";

/**
 * A per-student extension. The sheet opens on the first valid moment rather
 * than an empty picker: one day after the current deadline at the same clock
 * time, or tomorrow 08:00 when that would already be past. The close moment
 * is not a field — the row's existing grace window moves with the due date,
 * and the preview states both instants so nothing is hidden.
 */
export function ExtendSheet({
  studentName,
  currentDueAt,
  currentCloseAt,
  submitting,
  error,
  onConfirm,
  onClose,
}: {
  studentName: string;
  currentDueAt: string | Date;
  currentCloseAt: string | Date;
  submitting: boolean;
  error: unknown;
  onConfirm: (input: {
    dueAt: string;
    closeAt: string;
    reason?: string;
  }) => void;
  onClose: () => void;
}) {
  const initial = defaultExtension(currentDueAt);
  const [day, setDay] = useState<string | null>(initial.day);
  const [time, setTime] = useState<string | null>(initial.time);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const check = checkExtension({
    day,
    time,
    reason,
    currentDueAt,
    currentCloseAt,
  });

  const currentLabel = `${dayLabel(dayKeyOf(currentDueAt))} · ${
    clockOf(currentDueAt) ?? "—"
  }`;

  const preview =
    check.valid && check.dueAt && check.closeAt
      ? copy.homework.grade.extendPreview(
          `${dayLabel(dayKeyOf(check.dueAt))} · ${clockOf(check.dueAt) ?? "—"}`,
          `${dayLabel(dayKeyOf(check.closeAt))} · ${
            clockOf(check.closeAt) ?? "—"
          }`,
        )
      : null;

  const submit = () => {
    setTouched(true);
    if (check.valid && check.dueAt && check.closeAt) {
      onConfirm({
        dueAt: check.dueAt,
        closeAt: check.closeAt,
        ...(check.reason ? { reason: check.reason } : {}),
      });
    }
  };

  return (
    <FormSheet
      title={copy.homework.grade.extendTitle}
      onClose={onClose}
      testIDPrefix="homework-extend"
      footer={
        <>
          <CapsuleButton
            title={copy.homework.grade.extendConfirm}
            onPress={submit}
            loading={submitting}
            disabled={submitting}
            testID="homework-extend-confirm"
          />
          <CapsuleButton
            title={copy.homework.actions.keep}
            variant="secondary"
            size="compact"
            onPress={onClose}
            disabled={submitting}
            testID="homework-extend-keep"
            style={styles.keep}
          />
        </>
      }
    >
      <View style={styles.intro}>
        <ThemedText variant="body">
          {copy.homework.grade.extendBody(currentLabel)}
        </ThemedText>
        <ThemedText variant="meta">{studentName}</ThemedText>
      </View>

      <View style={styles.fields}>
        <DateField
          label={copy.homework.grade.extendDate}
          value={day}
          onChange={setDay}
          minimumDate={todayIso()}
          disabled={submitting}
          testID="homework-extend-day"
        />
        <TimeField
          label={copy.homework.grade.extendTime}
          value={time}
          onChange={setTime}
          disabled={submitting}
          testID="homework-extend-time"
        />
      </View>

      {preview ? (
        <View style={styles.preview} testID="homework-extend-preview">
          <ThemedText variant="meta">{preview}</ThemedText>
        </View>
      ) : null}

      {touched && check.error ? (
        <ThemedText
          variant="meta"
          color={colors.tone.critical.fg}
          style={styles.hint}
          accessibilityLiveRegion="polite"
        >
          {check.error}
        </ThemedText>
      ) : null}

      <FormField
        label={copy.homework.grade.extendReason}
        value={reason}
        onChangeText={setReason}
        placeholder={copy.homework.grade.extendReasonPlaceholder}
        help={copy.homework.grade.extendReasonHelp}
        maxLength={MAX_EXTENSION_REASON}
        multiline
        numberOfLines={2}
        editable={!submitting}
        testID="homework-extend-reason"
      />

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

/** The first moment that is both after the row's deadline and in the future. */
function defaultExtension(currentDueAt: string | Date): {
  day: string | null;
  time: string | null;
} {
  const due = new Date(currentDueAt);
  const now = new Date();
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    8,
    0,
    0,
    0,
  );
  if (Number.isNaN(due.getTime())) return splitTimestamp(tomorrow);
  const nextDay = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate() + 1,
    due.getHours(),
    due.getMinutes(),
    0,
    0,
  );
  return splitTimestamp(
    nextDay.getTime() > tomorrow.getTime() ? nextDay : tomorrow,
  );
}

const styles = StyleSheet.create({
  intro: {
    gap: spacing.xs,
  },
  fields: {
    marginTop: spacing.sm,
  },
  preview: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  hint: {
    marginTop: spacing.xs,
  },
  keep: {
    marginTop: spacing.sm,
  },
});

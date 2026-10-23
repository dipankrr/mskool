import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { ErrorCard } from "../../../components/error-card";
import { SectionLabel } from "../../../components/section-label";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { formatShortWeekday } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { fontSize, radius, spacing } from "../../../theme/tokens";
import { dayTypeLabel } from "../status-meta";

const DAY_TYPE_ORDER = [
  "working",
  "holiday",
  "half_day",
  "exam_day",
  "weekend",
] as const;
type DayType = (typeof DAY_TYPE_ORDER)[number];

function asDayType(value: string | null): DayType | null {
  return value && (DAY_TYPE_ORDER as readonly string[]).includes(value)
    ? (value as DayType)
    : null;
}

/**
 * The day editor (chunk 3): one date's day type and note. The five types are
 * the whole vocabulary the marking gate reads; the note is pre-filled with
 * what is stored, and an emptied note CLEARS it (sends null) — a deliberate
 * divergence from the web's blank-keeps, recorded in the slice plan, because
 * this editor opens on what is and should save what is shown.
 *
 * The body mounts on each open, so the draft starts from the stored row
 * without an effect resetting state (a fresh mount is the reset).
 */
export function DayEditorSheet({
  visible,
  iso,
  dayType,
  reason,
  onDismiss,
}: {
  visible: boolean;
  /** The date being edited; null while closed. */
  iso: string | null;
  /** The row's stored values — the editor opens on what is. */
  dayType: string | null;
  reason: string | null;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);

  useEffect(() => {
    if (visible) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [visible]);

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      {visible && iso ? (
        <DayEditorBody
          iso={iso}
          dayType={dayType}
          reason={reason}
          onDone={onDismiss}
        />
      ) : null}
    </BottomSheetModal>
  );
}

function DayEditorBody({
  iso,
  dayType,
  reason,
  onDone,
}: {
  iso: string;
  dayType: string | null;
  reason: string | null;
  onDone: () => void;
}) {
  const { height } = useWindowDimensions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const [type, setType] = useState<DayType | null>(() => asDayType(dayType));
  const [reasonText, setReasonText] = useState(reason ?? "");

  const save = trpc.attendance.calendar.upsert.useMutation({
    onSuccess: () => {
      void utils.attendance.calendar.list.invalidate();
      onDone();
    },
  });

  const submit = () => {
    if (!type || !organizationId || !schoolId || !academicYear) return;
    const trimmed = reasonText.trim();
    save.mutate({
      organizationId,
      schoolId,
      data: {
        academicYearId: academicYear.id,
        date: iso,
        dayType: type,
        reason: trimmed === "" ? null : trimmed,
      },
    });
  };

  return (
    <BottomSheetView style={styles.content}>
      <SectionLabel>{copy.attendance.manage.calendar.editorTitle}</SectionLabel>
      <ThemedText variant="bodyStrong" style={styles.date}>
        {formatShortWeekday(iso)}
      </ThemedText>
      <BottomSheetScrollView
        style={{ maxHeight: Math.round(height * 0.42) }}
        contentContainerStyle={styles.options}
      >
        {DAY_TYPE_ORDER.map((value) => {
          const selected = type === value;
          return (
            <Pressable
              key={value}
              testID={`day-type-${value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${dayTypeLabel(value)}, ${copy.attendance.manage.calendar.meanings[value]}`}
              onPress={() => setType(value)}
              style={({ pressed }) => [
                styles.option,
                selected ? styles.optionOn : null,
                pressed ? styles.optionPressed : null,
              ]}
            >
              <View style={styles.optionText}>
                <ThemedText variant="bodyStrong">
                  {dayTypeLabel(value)}
                </ThemedText>
                <ThemedText variant="meta">
                  {copy.attendance.manage.calendar.meanings[value]}
                </ThemedText>
              </View>
              {selected ? (
                <AppIcon name="check" size={18} color={colors.accentDeep} />
              ) : (
                <View style={styles.checkSpace} />
              )}
            </Pressable>
          );
        })}
      </BottomSheetScrollView>
      <View style={styles.reasonBlock}>
        <ThemedText variant="caption" style={styles.reasonLabel}>
          {copy.attendance.manage.calendar.reason}
        </ThemedText>
        <TextInput
          testID="day-reason"
          style={styles.reasonInput}
          value={reasonText}
          onChangeText={setReasonText}
          placeholder={copy.attendance.manage.calendar.reasonPlaceholder}
          placeholderTextColor={colors.muted}
          maxLength={255}
          accessibilityLabel={copy.attendance.manage.calendar.reason}
          accessibilityHint={copy.attendance.manage.calendar.reasonHelp}
        />
        <ThemedText variant="meta" style={styles.reasonHelp}>
          {copy.attendance.manage.calendar.reasonHelp}
        </ThemedText>
      </View>
      {save.error ? (
        <ErrorCard
          cause={save.error}
          style={styles.error}
          testID="day-save-error"
        />
      ) : null}
      <CapsuleButton
        title={
          save.isPending
            ? copy.common.saving
            : copy.attendance.manage.calendar.save
        }
        loading={save.isPending}
        disabled={!type}
        onPress={submit}
        testID="day-save"
        style={styles.save}
      />
    </BottomSheetView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  date: {
    marginTop: spacing.xs,
  },
  options: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  optionOn: {
    backgroundColor: colors.accentTint,
  },
  optionPressed: {
    backgroundColor: colors.field,
  },
  optionText: {
    flex: 1,
    gap: spacing.xxs,
  },
  checkSpace: {
    width: 18,
  },
  reasonBlock: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.field,
  },
  reasonLabel: {
    marginBottom: spacing.xs,
  },
  reasonInput: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.callout,
  },
  reasonHelp: {
    marginTop: spacing.xs,
  },
  error: {
    marginTop: spacing.md,
  },
  save: {
    marginTop: spacing.md,
    alignSelf: "stretch",
  },
});

import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { CapsuleButton } from "../../../components/capsule-button";
import { ErrorCard } from "../../../components/error-card";
import { SectionLabel } from "../../../components/section-label";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import {
  buildGenerateInput,
  cycleWeekdayState,
  defaultWeekdayRows,
  hasAnyWorkingDay,
} from "./template";
import type { WeekdayState } from "./template";

const chipBackground: Record<WeekdayState, string> = {
  working: colors.accentTint,
  half_day: colors.tone.caution.bg,
  off: colors.field,
};

const chipText: Record<WeekdayState, string> = {
  working: colors.accentDeep,
  half_day: colors.tone.caution.fg,
  off: colors.muted,
};

/**
 * The calendar generator (chunk 3): the days a week school is in session,
 * three states each (Working → Half day → Off, one tap a hop). The server
 * fills MISSING dates only — an already-set holiday survives a re-run — and
 * reports how many rows it actually inserted, which is the result line here.
 * Defaults are Mon–Fri (the web's); the body mounts on each open with them.
 */
export function GenerateSheet({
  visible,
  onDismiss,
}: {
  visible: boolean;
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
      {visible ? <GenerateBody onDone={onDismiss} /> : null}
    </BottomSheetModal>
  );
}

function GenerateBody({ onDone }: { onDone: () => void }) {
  const { height } = useWindowDimensions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const utils = trpc.useUtils();
  const [rows, setRows] = useState(defaultWeekdayRows);
  const [result, setResult] = useState<number | null>(null);

  const generate = trpc.attendance.calendar.generate.useMutation({
    onSuccess: (data) => {
      void utils.attendance.calendar.list.invalidate();
      setResult(data.generated);
    },
  });

  const valid = hasAnyWorkingDay(rows);

  const submit = () => {
    if (!valid || !organizationId || !schoolId || !academicYear) return;
    generate.mutate({
      organizationId,
      schoolId,
      data: {
        academicYearId: academicYear.id,
        ...buildGenerateInput(rows),
      },
    });
  };

  return (
    <BottomSheetView style={styles.content}>
      <SectionLabel>{copy.attendance.manage.calendar.generate}</SectionLabel>
      {academicYear ? (
        <ThemedText variant="bodyStrong" style={styles.year}>
          {academicYear.name}
        </ThemedText>
      ) : null}
      {result !== null ? (
        <View style={styles.resultBlock}>
          <ThemedText variant="bodyStrong" style={styles.resultLine}>
            {result === 0
              ? copy.attendance.manage.calendar.filledNone
              : copy.attendance.manage.calendar.filled(result)}
          </ThemedText>
          <CapsuleButton
            title={copy.attendance.manage.calendar.done}
            size="compact"
            onPress={onDone}
            testID="generate-done"
            style={styles.done}
          />
        </View>
      ) : (
        <>
          <ThemedText variant="meta" style={styles.help}>
            {copy.attendance.manage.calendar.generateHelp}
          </ThemedText>
          <BottomSheetScrollView
            style={{ maxHeight: Math.round(height * 0.5) }}
            contentContainerStyle={styles.list}
          >
            {rows.map((row, index) => (
              <Pressable
                key={row.jsDay}
                testID={`generate-day-${row.jsDay}`}
                accessibilityRole="button"
                accessibilityLabel={copy.attendance.manage.calendar.weekdayA11y(
                  copy.attendance.manage.calendar.weekdays[index] ?? "",
                  copy.attendance.manage.calendar.states[row.state],
                )}
                onPress={() =>
                  setRows((current) =>
                    current.map((item) =>
                      item.jsDay === row.jsDay
                        ? { ...item, state: cycleWeekdayState(item.state) }
                        : item,
                    ),
                  )
                }
                style={({ pressed }) => [
                  styles.dayRow,
                  pressed ? styles.dayRowPressed : null,
                ]}
              >
                <ThemedText variant="bodyStrong">
                  {copy.attendance.manage.calendar.weekdays[index]}
                </ThemedText>
                <View
                  style={[
                    styles.chip,
                    { backgroundColor: chipBackground[row.state] },
                  ]}
                >
                  <ThemedText variant="caption" color={chipText[row.state]}>
                    {copy.attendance.manage.calendar.states[row.state]}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </BottomSheetScrollView>
          {!valid ? (
            <ThemedText
              variant="meta"
              color={colors.tone.caution.fg}
              style={styles.minNote}
            >
              {copy.attendance.manage.calendar.minWorking}
            </ThemedText>
          ) : null}
          {generate.error ? (
            <ErrorCard
              cause={generate.error}
              style={styles.error}
              testID="generate-error"
            />
          ) : null}
          <CapsuleButton
            title={
              generate.isPending
                ? copy.attendance.manage.calendar.running
                : copy.attendance.manage.calendar.confirm
            }
            loading={generate.isPending}
            disabled={!valid}
            onPress={submit}
            testID="generate-confirm"
            style={styles.confirm}
          />
        </>
      )}
    </BottomSheetView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  year: {
    marginTop: spacing.xs,
  },
  help: {
    marginTop: spacing.sm,
  },
  list: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  dayRowPressed: {
    backgroundColor: colors.field,
  },
  chip: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
  },
  minNote: {
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.md,
  },
  confirm: {
    marginTop: spacing.md,
    alignSelf: "stretch",
  },
  resultBlock: {
    marginTop: spacing.sm,
  },
  resultLine: {
    marginTop: spacing.sm,
  },
  done: {
    marginTop: spacing.lg,
  },
});

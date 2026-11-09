import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import type { AcademicYear } from "../hooks/use-active-context";
import { copy } from "../lib/copy";
import { formatReadableDateRange } from "../lib/format";
import { sessionStatus } from "../lib/session-dates";
import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { CapsuleButton } from "./capsule-button";
import { StatusPill } from "./status-pill";
import { ThemedText } from "./themed-text";

/** The status chip on a past or upcoming row. Closed outranks the calendar. */
function chipOf(year: AcademicYear): { label: string; tone: Tone } | null {
  if (year.isCurrent) return null;
  if (year.status === "closed") return { label: copy.sessionSheet.closed, tone: "neutral" };
  switch (sessionStatus(year)) {
    case "upcoming":
      return { label: copy.sessions.statuses.upcoming, tone: "neutral" };
    case "not_running":
      return { label: copy.sessions.statuses.not_running, tone: "caution" };
    default:
      return { label: copy.sessionSheet.open, tone: "caution" };
  }
}

/**
 * The session picker (ADR-066): which session every screen shows. Viewing,
 * never the admin act of making a session the running one, and the header
 * says so. The running session leads as its own card; the rest follow newest
 * first with a Closed / Open chip, because "Open" is the one a write can
 * still land in. While a past session is chosen, a button goes straight back.
 */
export function SessionSheet({
  visible,
  years,
  currentYear,
  chosenId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  years: AcademicYear[];
  currentYear: AcademicYear | null;
  chosenId: string;
  /** null = back to the running session. */
  onSelect: (id: string | null) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  const others = years.filter((year) => year.id !== currentYear?.id);
  const viewingPast = Boolean(currentYear && chosenId !== currentYear.id);

  const pick = (year: AcademicYear) => {
    void Haptics.selectionAsync();
    onSelect(year.id === currentYear?.id ? null : year.id);
  };

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetView style={styles.content}>
        <ThemedText variant="title">{copy.sessionSheet.title}</ThemedText>
        <ThemedText variant="meta" style={styles.lead}>
          {copy.sessionSheet.lead}
        </ThemedText>

        <BottomSheetScrollView
          style={{ maxHeight: Math.round(height * 0.6) }}
          contentContainerStyle={styles.list}
        >
          {currentYear ? (
            <Pressable
              testID={`session-option-${currentYear.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: chosenId === currentYear.id }}
              onPress={() => pick(currentYear)}
              style={({ pressed }) => [
                styles.running,
                chosenId === currentYear.id ? styles.runningOn : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <View style={styles.rowText}>
                <View style={styles.nameLine}>
                  <ThemedText variant="name">{currentYear.name}</ThemedText>
                  <StatusPill label={copy.sessions.statuses.running} tone="positive" />
                </View>
                <ThemedText variant="meta">
                  {formatReadableDateRange(currentYear.startDate, currentYear.endDate)}
                </ThemedText>
              </View>
              <Radio on={chosenId === currentYear.id} />
            </Pressable>
          ) : null}

          {others.length > 0 ? (
            <ThemedText variant="sectionLabel" style={styles.label}>
              {copy.sessionSheet.othersLabel}
            </ThemedText>
          ) : null}

          {others.map((year) => {
            const selected = year.id === chosenId;
            const chip = chipOf(year);
            return (
              <Pressable
                key={year.id}
                testID={`session-option-${year.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => pick(year)}
                style={({ pressed }) => [
                  styles.row,
                  selected ? styles.rowOn : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <View style={styles.rowText}>
                  <View style={styles.nameLine}>
                    <ThemedText variant="bodyStrong">{year.name}</ThemedText>
                    {chip ? <StatusPill label={chip.label} tone={chip.tone} /> : null}
                  </View>
                  <ThemedText variant="meta">
                    {formatReadableDateRange(year.startDate, year.endDate)}
                  </ThemedText>
                </View>
                <Radio on={selected} />
              </Pressable>
            );
          })}
        </BottomSheetScrollView>

        {viewingPast ? (
          <CapsuleButton
            title={copy.sessionSheet.backToRunning}
            icon="sessions"
            variant="secondary"
            onPress={() => onSelect(null)}
            testID="session-back-to-running"
            style={styles.back}
          />
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function Radio({ on }: { on: boolean }) {
  return (
    <View style={[styles.radio, on ? styles.radioOn : null]}>
      {on ? <AppIcon name="check" size={14} color={colors.onAccent} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  lead: {
    marginTop: spacing.xs,
  },
  list: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  running: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  runningOn: {
    borderColor: colors.accentStrong,
    backgroundColor: colors.accentTint,
  },
  label: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  rowOn: {
    borderColor: colors.tone.caution.fg,
    backgroundColor: colors.tone.caution.bg,
  },
  pressed: {
    opacity: 0.7,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    borderColor: colors.accentDeep,
    backgroundColor: colors.accentDeep,
  },
  back: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
  },
});

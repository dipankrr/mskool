import { useEffect, useRef } from "react";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
} from "@expo/ui/community/bottom-sheet";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { SectionLabel } from "../../components/section-label";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { Status } from "./draft";
import { SHEET_ORDER, statusDescription, statusLabel, statusTone } from "./status-meta";

const statusIcon: Record<Status, AppIconName> = {
  present: "checkCircle",
  absent: "closeCircle",
  late: "clock",
  half_day: "halfDay",
  on_leave: "calendar",
};

/**
 * The five exact statuses, on long-press. Cards rather than list rows: at
 * arm's length in a corridor, a 72 dp tinted card with an icon, the status
 * word, and one line of meaning is faster than a small pill. The selected
 * card keeps its tone but gains a 2 dp border and a check; the sheet scrolls
 * at large text rather than clipping the fifth option.
 */
export function StatusSheet({
  student,
  current,
  onSelect,
  onDismiss,
}: {
  student: { name: string; roll: string | null } | null;
  current: Status | null;
  onSelect: (status: Status) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();
  const open = student !== null;

  useEffect(() => {
    if (open) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [open]);

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetScrollView
        style={{ maxHeight: Math.round(height * 0.86) }}
        contentContainerStyle={styles.content}
      >
        {student ? (
          <>
            <SectionLabel>{copy.attendance.marking.statusSheetTitle}</SectionLabel>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <ThemedText variant="title" numberOfLines={2}>
                  {student.name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>
                  {student.roll
                    ? copy.attendance.marking.roll(student.roll)
                    : copy.attendance.marking.noRoll}
                </ThemedText>
              </View>
              <Avatar name={student.name} size="lg" />
            </View>
            <ThemedText variant="meta" style={styles.hint}>
              {copy.attendance.marking.statusSheetHint}
            </ThemedText>
            <View accessibilityRole="radiogroup" style={styles.options}>
              {SHEET_ORDER.map((status) => {
                const active = current === status;
                const { fg, bg } = colors.tone[statusTone[status]];
                return (
                  <Pressable
                    key={status}
                    testID={`status-option-${status}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${statusLabel(status)}. ${statusDescription(status)}`}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSelect(status);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: bg,
                        borderColor: active ? fg : "transparent",
                      },
                      pressed ? styles.optionPressed : null,
                    ]}
                  >
                    <View style={[styles.iconChip, { backgroundColor: colors.surface }]}>
                      <AppIcon name={statusIcon[status]} size={24} color={fg} />
                    </View>
                    <View style={styles.optionText}>
                      <ThemedText variant="bodyStrong" color={fg}>
                        {statusLabel(status)}
                      </ThemedText>
                      <ThemedText variant="meta" color={colors.muted}>
                        {statusDescription(status)}
                      </ThemedText>
                    </View>
                    {active ? (
                      <AppIcon name="checkCircle" size={26} color={fg} />
                    ) : (
                      <View style={styles.emptyCheck} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: spacing.xxs,
  },
  hint: {
    marginTop: spacing.md,
  },
  options: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  option: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
  },
  optionPressed: {
    transform: [{ scale: 0.99 }],
  },
  optionText: {
    flex: 1,
    gap: spacing.xxs,
  },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCheck: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
});

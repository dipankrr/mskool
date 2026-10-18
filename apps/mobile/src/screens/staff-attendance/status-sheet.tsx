import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { SectionLabel } from "../../components/section-label";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { Status } from "./draft";
import { SHEET_ORDER, statusLabel, statusTone } from "./status-meta";

/**
 * The five exact statuses, on long-press (probe frame 03): the student's
 * name and roll head the sheet, the current status wears a check. A native
 * material sheet (`@expo/ui` community bottom sheet): swipe, backdrop tap and
 * Android hardware back all dismiss it — `enablePanDownToClose` is what wires
 * those three on both platforms.
 *
 * Controlled from the parent: `student` non-null presents, null dismisses;
 * the row options are plain RN content hosted natively.
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
  const open = student !== null;

  useEffect(() => {
    if (open) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [open]);

  return (
    <BottomSheetModal ref={ref} enablePanDownToClose onDismiss={onDismiss}>
      <BottomSheetView style={styles.content}>
        {student ? (
          <>
            <SectionLabel>{copy.attendance.marking.statusSheetTitle}</SectionLabel>
            <View style={styles.header}>
              <Avatar name={student.name} size="lg" />
              <View style={styles.headerText}>
                <ThemedText variant="name" numberOfLines={1}>
                  {student.name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>
                  {student.roll
                    ? copy.attendance.marking.roll(student.roll)
                    : copy.attendance.marking.noRoll}
                </ThemedText>
              </View>
            </View>
            <View accessibilityRole="radiogroup" style={styles.options}>
              {SHEET_ORDER.map((status) => {
                const active = current === status;
                return (
                  <Pressable
                    key={status}
                    testID={`status-option-${status}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={statusLabel(status)}
                    onPress={() => onSelect(status)}
                    style={({ pressed }) => [
                      styles.option,
                      pressed ? styles.optionPressed : null,
                    ]}
                  >
                    <StatusPill
                      label={statusLabel(status)}
                      tone={statusTone[status]}
                    />
                    <View style={styles.spacer} />
                    {active ? (
                      <AppIcon name="check" size={20} color={colors.accentDeep} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </BottomSheetView>
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
    marginTop: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  options: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  optionPressed: {
    backgroundColor: colors.field,
  },
  spacer: {
    flex: 1,
  },
});

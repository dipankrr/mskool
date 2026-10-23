import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { SectionLabel } from "../../components/section-label";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

export type SectionOption = { id: string; label: string };

/**
 * The section picker (chunk 2) — the day picker's sibling: a bottom sheet of
 * the sections the caller may see (scope-clipped list upstream, so a teacher
 * sees hers and a principal the school's), checkmark on the current one.
 * Selection applies immediately; the parent writes it to the route params.
 */
export function SectionSheet({
  visible,
  options,
  currentId,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  options: SectionOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onDismiss: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();

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
      <BottomSheetView style={styles.content}>
        <SectionLabel>{copy.attendance.section.sheetTitle}</SectionLabel>
        <BottomSheetScrollView
          style={{ maxHeight: Math.round(height * 0.55) }}
          contentContainerStyle={styles.list}
        >
          {options.map((option) => {
            const selected = option.id === currentId;
            return (
              <Pressable
                key={option.id}
                testID={`section-option-${option.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                onPress={() => onSelect(option.id)}
                style={({ pressed }) => [
                  styles.row,
                  selected ? styles.rowOn : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.label}>
                  {option.label}
                </ThemedText>
                {selected ? (
                  <AppIcon name="check" size={18} color={colors.accentDeep} />
                ) : (
                  <View style={styles.checkSpace} />
                )}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
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
  list: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  rowOn: {
    backgroundColor: colors.accentTint,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  label: {
    flex: 1,
  },
  checkSpace: {
    width: 18,
  },
});

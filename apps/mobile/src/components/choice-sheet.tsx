import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { SectionLabel } from "./section-label";
import { ThemedText } from "./themed-text";

export type ChoiceOption = {
  id: string;
  label: string;
  /** A quieter second line: a branch code, a session's date range. */
  detail?: string | null;
};

/**
 * A single-select bottom sheet (Step 1) — the section sheet's anatomy,
 * generalized for the branch picker (and, later, the session picker inside a
 * management screen). Rows are scope-clipped upstream, so this component never
 * decides what the caller may choose; it renders the list it is given,
 * checkmarks the current row, and hands the chosen id back. Selection applies
 * immediately; closing the sheet is the caller's state to own.
 */
export function ChoiceSheet({
  visible,
  title,
  options,
  currentId,
  onSelect,
  onDismiss,
  testIDPrefix,
}: {
  visible: boolean;
  title: string;
  options: ChoiceOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onDismiss: () => void;
  /** Produces `"<prefix>-<id>"` test ids, e.g. `branch-option-…`. */
  testIDPrefix: string;
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
        <SectionLabel style={styles.title}>{title}</SectionLabel>
        <BottomSheetScrollView
          style={{ maxHeight: Math.round(height * 0.55) }}
          contentContainerStyle={styles.list}
        >
          {options.map((option) => {
            const selected = option.id === currentId;
            return (
              <Pressable
                key={option.id}
                testID={`${testIDPrefix}-${option.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={
                  option.detail
                    ? `${option.label}, ${option.detail}`
                    : option.label
                }
                onPress={() => {
                  // A selection, not an action: the lightest cue the platform
                  // has. The parent applies the choice immediately.
                  void Haptics.selectionAsync();
                  onSelect(option.id);
                }}
                style={({ pressed }) => [
                  styles.row,
                  selected ? styles.rowOn : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View style={styles.rowText}>
                  <ThemedText variant="bodyStrong" numberOfLines={2}>
                    {option.label}
                  </ThemedText>
                  {option.detail ? (
                    <ThemedText variant="meta" numberOfLines={1}>
                      {option.detail}
                    </ThemedText>
                  ) : null}
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
  title: {
    marginTop: 0,
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
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  rowOn: {
    backgroundColor: colors.accentTint,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  checkSpace: {
    width: 18,
  },
});

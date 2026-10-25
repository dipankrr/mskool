import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { ASSIGNMENT_KINDS } from "../../lib/homework";
import type { AssignmentKind } from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { kindGlyph, kindLabel } from "./meta";

/**
 * The seven kinds as a small tile grid, not a dropdown. A teacher chooses the
 * kind before the title, once per assignment, and the glyph makes the choice
 * scannable in a way seven words in a sheet are not.
 *
 * Seven tiles in three columns leaves one tile on the last row, left-aligned —
 * deliberate. Stretching it would make "Quiz" look like the recommended answer.
 */
export function KindPicker({
  value,
  onChange,
}: {
  value: AssignmentKind;
  onChange: (next: AssignmentKind) => void;
}) {
  return (
    <View style={styles.wrap}>
      <ThemedText variant="caption" style={styles.label}>
        {copy.homework.form.kind}
      </ThemedText>
      <View
        style={styles.grid}
        accessibilityRole="radiogroup"
        accessibilityLabel={copy.homework.form.kind}
      >
        {ASSIGNMENT_KINDS.map((kind) => {
          const selected = kind === value;
          return (
            <Pressable
              key={kind}
              testID={`homework-kind-${kind}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={kindLabel(kind)}
              onPress={() => {
                if (selected) return;
                void Haptics.selectionAsync();
                onChange(kind);
              }}
              style={({ pressed }) => [
                styles.tile,
                selected ? styles.tileOn : null,
                pressed && !selected ? styles.tilePressed : null,
              ]}
            >
              <AppIcon
                name={kindGlyph(kind)}
                size={20}
                color={selected ? colors.accentDeep : colors.muted}
              />
              <ThemedText
                variant="caption"
                color={selected ? colors.accentDeep : colors.ink}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={styles.tileLabel}
              >
                {kindLabel(kind)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
  },
  label: {
    marginBottom: spacing.xs,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tile: {
    width: "31%",
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  tileOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  tilePressed: {
    backgroundColor: colors.field,
  },
  tileLabel: {
    textAlign: "center",
  },
});

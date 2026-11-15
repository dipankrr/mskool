import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import type { StatusCounts } from "./draft";

/** What the list can be narrowed to. Half day folds into Late's colour but keeps its own filter. */
export type TallyFilter = "present" | "absent" | "late" | "half_day" | "on_leave" | "unmarked";

type Cell = { key: TallyFilter; label: string; ink: string };

/**
 * The day's counts, which are also the list's filters (v2 mockup frame 4).
 * Tap a count to show only those students; tap it again to show everyone.
 * Half day appears only when someone has it. At large text the five cells wrap
 * 3 + 2, the same rule the old pulse card used.
 */
export function Tally({
  counts,
  filter,
  onFilter,
}: {
  counts: StatusCounts;
  filter: TallyFilter | null;
  onFilter: (next: TallyFilter | null) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const wrap = fontScale >= 1.2;
  const words = copy.attendance.marking;
  const cells: Cell[] = [
    { key: "present", label: words.statuses.present, ink: colors.tone.positive.fg },
    { key: "absent", label: words.statuses.absent, ink: colors.tone.critical.fg },
    { key: "late", label: words.statuses.late, ink: colors.tone.caution.fg },
    ...(counts.half_day > 0
      ? [{ key: "half_day" as const, label: words.statuses.half_day, ink: colors.tone.caution.fg }]
      : []),
    { key: "on_leave", label: words.tallyLeave, ink: colors.tone.neutral.fg },
    { key: "unmarked", label: words.tallyUnmarked, ink: colors.ink },
  ];

  return (
    <View style={[styles.card, wrap ? styles.cardWrap : null]} testID="attendance-tally">
      {cells.map((cell) => {
        const count = counts[cell.key];
        const on = filter === cell.key;
        return (
          <Pressable
            key={cell.key}
            testID={`tally-${cell.key}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={words.tallyA11y(count, cell.label, on)}
            onPress={() => {
              void Haptics.selectionAsync();
              onFilter(on ? null : cell.key);
            }}
            style={({ pressed }) => [
              styles.cell,
              cell.key === "unmarked" ? styles.cellWide : null,
              wrap ? styles.cellWrap : null,
              on ? styles.cellOn : null,
              pressed && !on ? styles.cellPressed : null,
            ]}
          >
            <ThemedText
              variant="title"
              color={on ? colors.onAccent : count === 0 ? colors.chevron : cell.ink}
              style={styles.count}
            >
              {count}
            </ThemedText>
            <ThemedText
              variant="caption"
              color={on ? colors.onAccent : colors.muted}
              numberOfLines={1}
              style={styles.label}
            >
              {cell.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 2,
    padding: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  cardWrap: { flexWrap: "wrap" },
  cell: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingVertical: spacing.xs + 2,
    paddingLeft: spacing.xs + 2,
    paddingRight: 2,
    borderRadius: radius.md,
    justifyContent: "center",
  },
  cellWide: { flex: 1.45 },
  cellWrap: { flexBasis: "31%", flexGrow: 1 },
  cellOn: { backgroundColor: colors.ink },
  cellPressed: { backgroundColor: colors.field },
  count: { fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] },
  label: { fontSize: fontSize.micro, letterSpacing: 0 },
});

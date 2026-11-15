import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { fontFamily, radius } from "../../theme/tokens";
import type { Status } from "./draft";
import { statusLabel, statusTone } from "./status-meta";

export type GridTile = {
  studentId: string;
  name: string;
  roll: string | null;
  status: Status | null;
};

const COLUMNS = 6;
const GAP = 5;

/**
 * The roll-call grid (owner-approved 2026-11-15): six tiles across, roll
 * number over first name, coloured by status, the whole section on one screen
 * for calling "1… 2… 3…" at the door. Same gestures as the list: tap marks
 * present, then toggles present ⇄ absent; hold opens the status sheet. The
 * first blank tile wears a ring as "next up".
 */
export function RollGrid({
  tiles,
  canMark,
  onToggle,
  onOpenSheet,
}: {
  tiles: readonly GridTile[];
  canMark: boolean;
  onToggle: (studentId: string) => void;
  onOpenSheet: (studentId: string) => void;
}) {
  const nextId = canMark ? tiles.find((tile) => tile.status === null)?.studentId : undefined;
  return (
    <View style={styles.grid} testID="attendance-grid">
      {tiles.map((tile) => (
        <Tile
          key={tile.studentId}
          tile={tile}
          next={tile.studentId === nextId}
          canMark={canMark}
          onToggle={onToggle}
          onOpenSheet={onOpenSheet}
        />
      ))}
    </View>
  );
}

const Tile = memo(function Tile({
  tile,
  next,
  canMark,
  onToggle,
  onOpenSheet,
}: {
  tile: GridTile;
  next: boolean;
  canMark: boolean;
  onToggle: (studentId: string) => void;
  onOpenSheet: (studentId: string) => void;
}) {
  const label = tile.status ? statusLabel(tile.status) : copy.attendance.marking.unmarked;
  const { bg, ink, sub } = tileColors(tile.status);
  const first = tile.name.split(" ")[0] ?? tile.name;
  return (
    <View style={styles.cellBox}>
      <Pressable
        testID={`grid-tile-${tile.studentId}`}
        disabled={!canMark}
        accessibilityRole={canMark ? "button" : undefined}
        accessibilityLabel={copy.attendance.marking.a11y.row(tile.name, tile.roll, label)}
        accessibilityHint={canMark ? copy.attendance.marking.a11y.rowHint : undefined}
        accessibilityActions={
          canMark ? [{ name: "longpress", label: copy.attendance.marking.a11y.changeAction }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "longpress") onOpenSheet(tile.studentId);
        }}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onToggle(tile.studentId);
        }}
        delayLongPress={400}
        onLongPress={() => onOpenSheet(tile.studentId)}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: bg },
          tile.status === null ? styles.tileBlank : null,
          next ? styles.tileNext : null,
          pressed ? styles.tilePressed : null,
        ]}
      >
        <ThemedText
          variant="bodyStrong"
          color={ink}
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={styles.roll}
        >
          {tile.roll ?? "–"}
        </ThemedText>
        <ThemedText
          variant="tab"
          color={sub}
          maxFontSizeMultiplier={1.1}
          numberOfLines={1}
          style={styles.first}
        >
          {first}
        </ThemedText>
      </Pressable>
    </View>
  );
});

function tileColors(status: Status | null): { bg: string; ink: string; sub: string } {
  if (!status) return { bg: "transparent", ink: colors.chevron, sub: colors.muted };
  if (status === "absent") return { bg: colors.tone.critical.fg, ink: colors.onAccent, sub: colors.onAccent };
  const tone = colors.tone[statusTone[status]];
  return { bg: tone.bg, ink: tone.fg, sub: colors.muted };
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -GAP / 2,
  },
  cellBox: {
    width: `${100 / COLUMNS}%`,
    padding: GAP / 2,
  },
  tile: {
    minHeight: 46,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  tileBlank: { borderWidth: 1.5, borderColor: colors.grabber },
  tileNext: { borderWidth: 2.5, borderColor: colors.ink },
  tilePressed: { opacity: 0.8 },
  roll: { fontFamily: fontFamily.semibold, fontSize: 17, fontVariant: ["tabular-nums"] },
  first: { fontSize: 10, marginTop: -1 },
});

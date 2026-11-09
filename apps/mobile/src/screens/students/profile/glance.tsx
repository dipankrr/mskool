import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { DimensionValue } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { profileCopy } from "../../../lib/profile-copy";
import { colors } from "../../../theme/brand-admin";
import type { Tone } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import type { Block } from "./use-profile-data";

const words = profileCopy.glance;

/**
 * One area at a glance: a label, one big number, a line under it, and a small strip
 * that shows the shape behind the number. The whole tile opens the full screen.
 */
export function Tile({
  label,
  value,
  valueSuffix,
  valueColor,
  sub,
  strip,
  scale,
  onPress,
  span,
  testID,
}: {
  label: string;
  value: string;
  valueSuffix?: string | null;
  valueColor?: string;
  sub: string;
  strip?: ReactNode;
  scale?: [string, string];
  onPress?: () => void;
  span: "half" | "full";
  testID: string;
}) {
  const body = (
    <>
      <View style={styles.head}>
        <ThemedText variant="sectionLabel" numberOfLines={1}>
          {label}
        </ThemedText>
        {onPress ? <AppIcon name="chevronRight" size={18} color={colors.chevron} /> : null}
      </View>
      <View style={styles.valueRow}>
        <ThemedText variant="numeric" color={valueColor} testID={`${testID}-value`}>
          {value}
        </ThemedText>
        {valueSuffix ? (
          <ThemedText variant="chip" color={colors.muted}>
            {valueSuffix}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText variant="meta" numberOfLines={2}>
        {sub}
      </ThemedText>
      {strip ? (
        <View style={styles.foot}>
          {strip}
          {scale ? (
            <View style={styles.scale}>
              <ThemedText variant="tab">{scale[0]}</ThemedText>
              <ThemedText variant="tab">{scale[1]}</ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
  const style = [styles.tile, span === "full" ? styles.full : styles.half];
  if (!onPress) {
    return (
      <View style={style} testID={testID} accessible accessibilityLabel={`${label}, ${value}${valueSuffix ? ` ${valueSuffix}` : ""}, ${sub}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}${valueSuffix ? ` ${valueSuffix}` : ""}, ${sub}`}
      accessibilityHint={words.openHint}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

/** A tile still loading, or failed with its own Retry; the rest of the page carries on. */
export function TileState({
  label,
  block,
  span,
  testID,
}: {
  label: string;
  block: Block<unknown>;
  span: "half" | "full";
  testID: string;
}) {
  const style = [styles.tile, span === "full" ? styles.full : styles.half];
  if (block.state === "loading") {
    return (
      <View style={style} testID={`${testID}-loading`} accessibilityLabel={label}>
        <ThemedText variant="sectionLabel">{label}</ThemedText>
        <Skeleton height={24} width="50%" style={styles.skeletonGap} />
        <Skeleton height={12} width="80%" style={styles.skeletonGap} />
      </View>
    );
  }
  if (block.state !== "error") return null;
  return (
    <View style={style} testID={`${testID}-error`}>
      <ThemedText variant="sectionLabel">{label}</ThemedText>
      <ThemedText variant="numeric" color={colors.muted} style={styles.skeletonGap}>
        —
      </ThemedText>
      <ThemedText variant="meta">{words.failed}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${words.retry} ${label}`}
        onPress={block.retry}
        style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}
        testID={`${testID}-retry`}
      >
        <ThemedText variant="chip" color={colors.accentDeep}>
          {words.retry}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** Equal boxes in a row, each one colour. `taller` marks now. */
export function Strip({
  cells,
  shape,
}: {
  cells: { key: string; color: string; outlined?: boolean; now?: boolean }[];
  shape: "square" | "bar";
}) {
  return (
    <View style={[styles.strip, shape === "bar" ? styles.stripBars : null]}>
      {cells.map((cell) => (
        <View
          key={cell.key}
          style={[
            shape === "square" ? styles.square : styles.bar,
            { backgroundColor: cell.color },
            cell.outlined ? styles.outlined : null,
            cell.now ? (shape === "bar" ? styles.barNow : styles.squareNow) : null,
          ]}
        />
      ))}
    </View>
  );
}

/** Two subject bars: best and weakest, marks as a share of the max. */
export function SubjectBars({
  rows,
}: {
  rows: { key: string; name: string; percent: number; tone: Tone | "accent" }[];
}) {
  return (
    <View style={styles.bars}>
      {rows.map((row) => (
        <View key={row.key} style={styles.barRow}>
          <ThemedText variant="tab" numberOfLines={1} style={styles.barName}>
            {row.name}
          </ThemedText>
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.max(4, Math.min(100, row.percent))}%` as DimensionValue,
                  backgroundColor: row.tone === "accent" ? colors.accent : colors.tone[row.tone].fg,
                },
              ]}
            />
          </View>
          <ThemedText variant="tab" color={colors.ink}>
            {Math.round(row.percent)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: 124,
    padding: spacing.md + spacing.xxs,
    paddingBottom: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  half: {
    flexGrow: 1,
  },
  full: {
    flexGrow: 1,
    minHeight: 0,
  },
  pressed: {
    opacity: 0.85,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  valueRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.xs,
  },
  foot: {
    marginTop: "auto",
    paddingTop: spacing.sm + spacing.xxs,
  },
  scale: {
    marginTop: spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  strip: {
    flexDirection: "row",
    gap: 3,
  },
  stripBars: {
    alignItems: "flex-end",
    height: 20,
    gap: spacing.xxs,
  },
  square: {
    width: 12,
    height: 12,
    borderRadius: spacing.xs,
  },
  squareNow: {
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  bar: {
    flex: 1,
    height: 14,
    borderRadius: 3,
  },
  barNow: {
    height: 20,
  },
  outlined: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  bars: {
    gap: spacing.xs + 1,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + spacing.xxs,
  },
  barName: {
    width: 44,
  },
  barTrack: {
    flex: 1,
    height: 6,
  },
  barFill: {
    height: 6,
    borderRadius: radius.full,
  },
  skeletonGap: {
    marginTop: spacing.sm,
  },
  retry: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
});

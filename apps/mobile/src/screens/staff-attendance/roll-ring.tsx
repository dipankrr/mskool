import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius } from "../../theme/tokens";
import type { Status } from "./draft";
import { statusTone } from "./status-meta";

/** A student's session so far, one count per status (from `attendance.summary`). */
export type SessionMix = Record<Status, number>;

/** Ring order: the register's order, so arcs sit in the same place on every row. */
const RING_ORDER: readonly Status[] = ["present", "absent", "late", "half_day", "on_leave"];

/** The owner asked for the ring quieter than the status colours (2026-11-15). */
const RING_OPACITY = 0.5;
const GAP = 1.6;

/**
 * The roll number in a circle, with an optional ring split by the student's
 * session so far (owner's ring A: multi-colour, no threshold flag). The ring is
 * decoration over facts printed elsewhere (the hold sheet and the Summary tab),
 * so the row's accessibility label carries the percentage, not this view.
 */
export const RollRing = memo(function RollRing({
  roll,
  mix,
  size = 42,
  stroke = 3.5,
  tone = "default",
}: {
  roll: string | null;
  mix: SessionMix | null;
  size?: number;
  stroke?: number;
  /** "absent" sets the inner circle white on the red-tinted row. */
  tone?: "default" | "absent";
}) {
  const total = mix ? RING_ORDER.reduce((sum, status) => sum + mix[status], 0) : 0;
  const r = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;
  const inner = size - stroke * 2 - 3;

  let offset = 0;
  const arcs =
    mix && total > 0
      ? RING_ORDER.flatMap((status) => {
          const count = mix[status];
          if (count <= 0) return [];
          const length = (circumference * count) / total;
          const draw = Math.max(length - GAP, 1.2);
          const arc = (
            <Circle
              key={status}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={colors.tone[statusTone[status]].fg}
              strokeOpacity={RING_OPACITY}
              strokeWidth={stroke}
              strokeDasharray={`${draw} ${circumference - draw}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return [arc];
        })
      : [];

  return (
    <View
      style={{ width: size, height: size }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {arcs.length > 0 ? (
        <Svg width={size} height={size} style={styles.svg}>
          {arcs}
        </Svg>
      ) : null}
      <View
        style={[
          styles.inner,
          {
            width: inner,
            height: inner,
            top: (size - inner) / 2,
            left: (size - inner) / 2,
            backgroundColor: tone === "absent" ? colors.surface : colors.chip,
          },
        ]}
      >
        <ThemedText
          variant="meta"
          color={tone === "absent" ? colors.tone.critical.fg : colors.tone.neutral.fg}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[styles.number, size > 48 ? styles.numberLg : null]}
        >
          {roll ?? "–"}
        </ThemedText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Start the first arc at 12 o'clock.
  svg: { transform: [{ rotate: "-90deg" }] },
  inner: {
    position: "absolute",
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  number: {
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.small,
    fontVariant: ["tabular-nums"],
  },
  numberLg: { fontSize: fontSize.callout },
});

import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { ThemedText } from "../../../components/themed-text";
import { colors } from "../../../theme/brand-admin";
import type { Tone } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";

export type FlagLine = {
  key: string;
  icon: AppIconName;
  tone: Tone;
  title: string;
  detail?: string | null;
  /** A word on the right ("Collect", "Place") or, without one, a chevron. */
  actionLabel?: string;
  /** A round call button instead of a word. */
  call?: { label: string; onPress: () => void };
  onPress?: () => void;
  hint?: string;
};

/**
 * Heads up (problems, worst first) and To finish (an admission's remaining steps)
 * share one card: a small title, then lines that each jump to where they're fixed.
 * The parent drops the card when it has no lines.
 */
export function FlagCard({
  title,
  count,
  lines,
  footnote,
  testID,
}: {
  title: string;
  count?: string;
  lines: FlagLine[];
  footnote?: string | null;
  testID: string;
}) {
  if (lines.length === 0 && !footnote) return null;
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <ThemedText variant="sectionLabel">{title}</ThemedText>
        {count ? <ThemedText variant="meta">{count}</ThemedText> : null}
      </View>
      {lines.map((line, index) => (
        <Line key={line.key} line={line} first={index === 0} testID={`${testID}-${line.key}`} />
      ))}
      {footnote ? (
        <ThemedText variant="meta" style={styles.footnote} testID={`${testID}-footnote`}>
          {footnote}
        </ThemedText>
      ) : null}
    </View>
  );
}

function Line({ line, first, testID }: { line: FlagLine; first: boolean; testID: string }) {
  const tone = colors.tone[line.tone];
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: tone.bg }]}>
        <AppIcon name={line.icon} size={18} color={tone.fg} />
      </View>
      <View style={styles.text}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {line.title}
        </ThemedText>
        {line.detail ? (
          <ThemedText variant="meta" numberOfLines={2}>
            {line.detail}
          </ThemedText>
        ) : null}
      </View>
      {line.call ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={line.call.label}
          hitSlop={4}
          onPress={line.call.onPress}
          style={({ pressed }) => [styles.call, pressed ? styles.pressed : null]}
          testID={`${testID}-call`}
        >
          <AppIcon name="call" size={16} color={colors.accentDeep} />
        </Pressable>
      ) : line.onPress ? (
        line.actionLabel ? (
          <ThemedText variant="chip" color={colors.accentDeep}>
            {line.actionLabel}
          </ThemedText>
        ) : (
          <AppIcon name="chevronRight" size={18} color={colors.chevron} />
        )
      ) : null}
    </>
  );
  const style = [styles.line, first ? null : styles.divided];
  if (!line.onPress) {
    return (
      <View style={style} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[line.title, line.detail].filter(Boolean).join(", ")}
      accessibilityHint={line.hint}
      onPress={line.onPress}
      style={({ pressed }) => [...style, pressed ? styles.linePressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  line: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    paddingVertical: spacing.sm,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    marginLeft: 0,
  },
  linePressed: {
    backgroundColor: colors.field,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm - spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  call: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  pressed: {
    opacity: 0.8,
  },
  footnote: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
});

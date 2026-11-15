import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

/** One area's colour: the icon square and the wash behind the card's top. */
export type Hue = { fg: string; tint: string };

export type ShowcaseLink = {
  key: string;
  label: string;
  detail?: string | null;
  /** The detail is something to fix (teaching gaps), not a description. */
  warn?: boolean;
  onPress: () => void;
};

/**
 * A front door for one area that has no tab: its name and state on a tinted
 * top, and up to four doors into it underneath. Tapping the top opens the
 * area; a link jumps straight to one part of it.
 *
 * The top and each link are separate buttons, so a screen reader hears the
 * area first and then its doors.
 */
export function ShowcaseCard({
  title,
  sub,
  icon,
  hue,
  aside,
  children,
  links,
  onPress,
  testID,
}: {
  title: string;
  sub?: string | null;
  icon: AppIconName;
  hue: Hue;
  /** Top right: a status pill, a face stack. Defaults to a chevron. */
  aside?: ReactNode;
  /** Under the heading: figures, a progress line. */
  children?: ReactNode;
  links: ShowcaseLink[];
  onPress: () => void;
  testID: string;
}) {
  // Four links read better as two rows of two than as four thin columns.
  const perRow = links.length === 4 ? 2 : 3;
  const rows: ShowcaseLink[][] = [];
  for (let i = 0; i < links.length; i += perRow) rows.push(links.slice(i, i + perRow));

  return (
    <View style={styles.card} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sub ? `${title}. ${sub}` : title}
        onPress={onPress}
        style={({ pressed }) => [
          styles.top,
          { backgroundColor: hue.tint },
          pressed ? styles.pressed : null,
        ]}
        testID={`${testID}-open`}
      >
        <View style={styles.head}>
          <View style={[styles.icon, { backgroundColor: hue.fg }]}>
            <AppIcon name={icon} size={22} color={colors.onAccent} />
          </View>
          <View style={styles.headText}>
            <ThemedText variant="numeric" numberOfLines={1}>
              {title}
            </ThemedText>
            {sub ? (
              <ThemedText variant="meta" numberOfLines={2}>
                {sub}
              </ThemedText>
            ) : null}
          </View>
          {aside ?? (
            <View style={styles.go}>
              <AppIcon name="chevronRight" size={18} color={hue.fg} />
            </View>
          )}
        </View>
        {children}
      </Pressable>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.links}>
          {row.map((link, index) => (
            <Pressable
              key={link.key}
              accessibilityRole="button"
              accessibilityLabel={link.detail ? `${link.label}, ${link.detail}` : link.label}
              onPress={link.onPress}
              style={({ pressed }) => [
                styles.link,
                index === 0 ? null : styles.linkDivider,
                pressed ? styles.linkPressed : null,
              ]}
              testID={`${testID}-${link.key}`}
            >
              <ThemedText variant="bodyStrong" numberOfLines={1}>
                {link.label}
              </ThemedText>
              {link.detail ? (
                <ThemedText
                  variant={link.warn ? "caption" : "meta"}
                  color={link.warn ? colors.tone.caution.fg : undefined}
                  numberOfLines={1}
                >
                  {link.detail}
                </ThemedText>
              ) : null}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

/** The row of figures under a card's heading. A missing figure shows a dash. */
export function ShowcaseStats({ stats }: { stats: { key: string; value: number | null; label: string }[] }) {
  return (
    <View style={styles.stats}>
      {stats.map((stat) => (
        <View key={stat.key} accessible accessibilityLabel={`${stat.value ?? "–"} ${stat.label}`}>
          <ThemedText variant="numeric">{stat.value ?? "–"}</ThemedText>
          <ThemedText variant="meta">{stat.label}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  top: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  icon: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: {
    flex: 1,
    gap: spacing.xxs,
  },
  go: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stats: {
    flexDirection: "row",
    gap: spacing.xl,
  },
  links: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  link: {
    flex: 1,
    minHeight: touch.row,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  linkDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.hairline,
  },
  linkPressed: {
    backgroundColor: colors.field,
  },
});

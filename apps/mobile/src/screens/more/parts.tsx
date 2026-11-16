import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import Svg, { Circle } from "react-native-svg";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

/**
 * The pieces every area screen in More is built from (v3): a hero in the
 * area's colour, section heads, Needs you rows with their own button, four
 * shortcuts, and plain list rows. Colours arrive as a hue pair; nothing here
 * knows which area it is drawing.
 */

export type Hue = { fg: string; bg: string };

/** Card rules, a shade darker than the app hairline (owner, More v2). */
const RULE = "rgba(16, 24, 40, 0.08)";
const WHITE_SOFT = "rgba(255, 255, 255, 0.82)";

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function Hero({
  h0,
  h1,
  kicker,
  title,
  sub,
  aside,
  children,
  testID,
}: {
  h0: string;
  h1: string;
  kicker?: string | null;
  title: string;
  sub?: string | null;
  /** Right of the title: a ring, a face stack. */
  aside?: ReactNode;
  children?: ReactNode;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.hero,
        {
          experimental_backgroundImage: `linear-gradient(135deg, ${h0}, ${h1})`,
        },
      ]}
    >
      <View style={[styles.blob, styles.blobA]} />
      <View style={[styles.blob, styles.blobB]} />
      <View style={styles.heroTop}>
        <View style={styles.grow}>
          {kicker ? (
            <ThemedText variant="caption" color={WHITE_SOFT} style={styles.kicker} numberOfLines={1}>
              {kicker}
            </ThemedText>
          ) : null}
          <ThemedText variant="title" color={colors.onAccent} style={styles.heroTitle} numberOfLines={2}>
            {title}
          </ThemedText>
          {sub ? (
            <ThemedText variant="body" color={WHITE_SOFT} style={styles.heroSub} numberOfLines={3}>
              {sub}
            </ThemedText>
          ) : null}
        </View>
        {aside}
      </View>
      {children}
    </View>
  );
}

/** Up to four figures across the hero's foot. A missing one is left out. */
export function HeroStats({ stats }: { stats: { key: string; value: string | number | null | undefined; label: string }[] }) {
  const shown = stats.filter((stat) => stat.value !== null && stat.value !== undefined);
  if (shown.length < 2) return null;
  return (
    <View style={styles.stats}>
      {shown.slice(0, 4).map((stat) => (
        <View key={stat.key} style={styles.stat} accessible accessibilityLabel={`${stat.value} ${stat.label}`}>
          <ThemedText variant="numeric" color={colors.onAccent} numberOfLines={1}>
            {stat.value}
          </ThemedText>
          <ThemedText variant="caption" color={WHITE_SOFT} numberOfLines={1} style={styles.statLabel}>
            {stat.label}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

export function HeroButtons({
  buttons,
  ink,
}: {
  buttons: { key: string; label: string; icon?: AppIconName; onPress: () => void; ghost?: boolean }[];
  /** The text colour of the white button: the area's deep colour. */
  ink: string;
}) {
  return (
    <View style={styles.heroButtons}>
      {buttons.map((button) => (
        <Pressable
          key={button.key}
          accessibilityRole="button"
          onPress={button.onPress}
          style={({ pressed }) => [
            styles.heroButton,
            button.ghost ? styles.heroButtonGhost : null,
            pressed ? styles.pressedSoft : null,
          ]}
          testID={`hero-${button.key}`}
        >
          {button.icon ? <AppIcon name={button.icon} size={16} color={button.ghost ? colors.onAccent : ink} /> : null}
          <ThemedText variant="bodyStrong" color={button.ghost ? colors.onAccent : ink} numberOfLines={1}>
            {button.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

/** A white note inside the hero (who is away, what is next). */
export function HeroNote({ icon, text }: { icon: AppIconName; text: string }) {
  return (
    <View style={styles.heroNote}>
      <AppIcon name={icon} size={16} color={colors.onAccent} />
      <ThemedText variant="meta" color={colors.onAccent} style={styles.grow} numberOfLines={3}>
        {text}
      </ThemedText>
    </View>
  );
}

export function Ring({ value, label }: { value: number; label: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.ring} accessible accessibilityLabel={`${pct}% ${label}`}>
      <Svg width={78} height={78} viewBox="0 0 78 78" style={styles.ringSvg}>
        <Circle cx={39} cy={39} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={8} />
        <Circle
          cx={39}
          cy={39}
          r={r}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
        />
      </Svg>
      <View style={styles.ringText}>
        <ThemedText variant="name" color={colors.onAccent}>
          {pct}%
        </ThemedText>
        <ThemedText variant="caption" color={WHITE_SOFT} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

/** A line across the hero with a today mark: a term, a session. */
export function TimeLine({
  segments,
  todayAt,
}: {
  /** Fractions of the whole, left to right. `fill` 0..1 shades the part gone by. */
  segments: { key: string; from: number; to: number; fill: number; label?: string | null }[];
  todayAt: number | null;
}) {
  const labelled = segments.some((segment) => segment.label);
  return (
    <View style={[styles.line, labelled ? styles.lineLabelled : null]}>
      {segments.map((segment) => (
        <View
          key={segment.key}
          style={[styles.lineSeg, { left: `${segment.from * 100}%`, width: `${Math.max(0, segment.to - segment.from) * 100 - 1.5}%` }]}
        >
          <View style={[styles.lineFill, { width: `${segment.fill * 100}%` }]} />
          {segment.label ? (
            <ThemedText variant="caption" color={WHITE_SOFT} numberOfLines={1} style={styles.lineLabel}>
              {segment.label}
            </ThemedText>
          ) : null}
        </View>
      ))}
      {todayAt !== null ? <View style={[styles.today, { left: `${todayAt * 100}%` }]} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sections, rows, shortcuts
// ---------------------------------------------------------------------------

export function Head({
  title,
  count,
  pill,
  link,
}: {
  title: string;
  /** An amber count beside the title: things waiting. */
  count?: number;
  /** A word on the right: "2 to fix", "All set". */
  pill?: { text: string; hue: Hue } | null;
  link?: { label: string; onPress: () => void } | null;
}) {
  return (
    <View style={styles.head}>
      <ThemedText variant="name" style={styles.headTitle}>
        {title}
      </ThemedText>
      {count ? (
        <View style={styles.count}>
          <ThemedText variant="caption" color={colors.onAccent}>
            {count}
          </ThemedText>
        </View>
      ) : null}
      <View style={styles.grow} />
      {pill ? <Chip text={pill.text} hue={pill.hue} /> : null}
      {link ? (
        <Pressable accessibilityRole="button" hitSlop={10} onPress={link.onPress} style={styles.headLink}>
          <ThemedText variant="caption" color={colors.muted}>
            {link.label}
          </ThemedText>
          <AppIcon name="chevronRight" size={14} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ text, hue }: { text: string; hue: Hue }) {
  return (
    <View style={[styles.chip, { backgroundColor: hue.bg }]}>
      <ThemedText variant="caption" color={hue.fg} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {text}
      </ThemedText>
    </View>
  );
}

export function Panel({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View style={styles.panel} testID={testID}>
      {children}
    </View>
  );
}

/**
 * One row: a tinted icon, two lines, and on the right either its own button
 * (a Needs you row: the act it asks for) or a chip, or a chevron when the
 * whole row opens something.
 */
export function Row({
  icon,
  leading,
  hue,
  title,
  meta,
  action,
  trailing,
  onPress,
  first,
  testID,
}: {
  icon?: AppIconName;
  /** In place of the icon: an avatar. */
  leading?: ReactNode;
  hue: Hue;
  title: string;
  meta?: string | null;
  action?: { label: string; onPress: () => void } | null;
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  testID?: string;
}) {
  const body = (
    <>
      {leading ??
        (icon ? (
          <View style={[styles.rowIcon, { backgroundColor: hue.bg }]}>
            <AppIcon name={icon} size={19} color={hue.fg} />
          </View>
        ) : null)}
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {title}
        </ThemedText>
        {meta ? (
          <ThemedText variant="meta" numberOfLines={1} style={styles.rowMeta}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${action.label}: ${title}`}
          onPress={action.onPress}
          hitSlop={6}
          style={({ pressed }) => [styles.go, { backgroundColor: hue.bg }, pressed ? styles.pressedSoft : null]}
        >
          <ThemedText variant="caption" color={hue.fg}>
            {action.label}
          </ThemedText>
        </Pressable>
      ) : (
        trailing ?? (onPress ? <AppIcon name="chevronRight" size={16} color={colors.chevron} /> : null)
      )}
    </>
  );
  const style = [styles.row, first ? null : styles.rowRule];
  if (!onPress || action) {
    return (
      <View style={style} testID={testID}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={meta ? `${title}, ${meta}` : title}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed ? styles.pressed : null]}
      testID={testID}
    >
      {body}
    </Pressable>
  );
}

export type Shortcut = {
  key: string;
  label: string;
  icon: AppIconName;
  hue: Hue;
  /** Starts something: a plus on the icon. */
  add?: boolean;
  onPress: () => void;
};

/** Up to four doors in a row; three or fewer share the width. */
export function Shortcuts({ items }: { items: Shortcut[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.shorts}>
      {items.slice(0, 4).map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          onPress={item.onPress}
          style={({ pressed }) => [styles.short, pressed ? styles.pressed : null]}
          testID={`short-${item.key}`}
        >
          <View style={[styles.shortIcon, { backgroundColor: item.hue.bg }]}>
            <AppIcon name={item.icon} size={20} color={item.hue.fg} />
            {item.add ? (
              <View style={styles.plus}>
                <AppIcon name="add" size={10} color={colors.onAccent} />
              </View>
            ) : null}
          </View>
          <ThemedText variant="caption" numberOfLines={2} style={styles.shortLabel} maxFontSizeMultiplier={1.3}>
            {item.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

export function Note({ icon, text }: { icon: AppIconName; text: string }) {
  return (
    <View style={styles.note}>
      <AppIcon name={icon} size={16} color={colors.muted} />
      <ThemedText variant="meta" style={styles.grow}>
        {text}
      </ThemedText>
    </View>
  );
}

export const neutral: Hue = { fg: colors.tone.neutral.fg, bg: colors.tone.neutral.bg };
export const caution: Hue = { fg: colors.tone.caution.fg, bg: colors.tone.caution.bg };
export const positive: Hue = { fg: colors.tone.positive.fg, bg: colors.tone.positive.bg };
export const critical: Hue = { fg: colors.tone.critical.fg, bg: colors.tone.critical.bg };

const styles = StyleSheet.create({
  grow: {
    flex: 1,
    minWidth: 0,
  },
  hero: {
    borderRadius: radius.xl + 2,
    padding: spacing.lg + 2,
    overflow: "hidden",
  },
  blob: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.11)",
  },
  blobA: {
    width: 200,
    height: 200,
    right: -60,
    top: -70,
  },
  blobB: {
    width: 160,
    height: 160,
    right: 40,
    bottom: -100,
    backgroundColor: "rgba(255, 255, 255, 0.07)",
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  kicker: {
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  heroTitle: {
    marginTop: spacing.xs,
    fontSize: 25,
    lineHeight: 29,
  },
  heroSub: {
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    marginTop: 1,
  },
  heroButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  heroButton: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  heroButtonGhost: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  heroNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
  },
  ring: {
    width: 78,
    height: 78,
  },
  ringSvg: {
    transform: [{ rotate: "-90deg" }],
  },
  ringText: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    marginTop: spacing.lg,
    height: 10,
  },
  lineLabelled: {
    height: 30,
  },
  lineSeg: {
    position: "absolute",
    top: 0,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  lineFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  lineLabel: {
    marginTop: 12,
  },
  today: {
    position: "absolute",
    top: -4,
    width: 3,
    height: 16,
    marginLeft: -1,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
    boxShadow: "0 0 0 3px rgba(255, 255, 255, 0.25)",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
    marginHorizontal: spacing.xs,
    minHeight: 26,
  },
  headTitle: {
    fontSize: 18,
    letterSpacing: -0.4,
  },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.tone.caution.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  headLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 32,
  },
  chip: {
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    borderRadius: radius.xl - 2,
    backgroundColor: colors.surface,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.06)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 62,
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.md,
  },
  rowRule: {
    borderTopWidth: 1,
    borderTopColor: RULE,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMeta: {
    marginTop: 1,
  },
  go: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    backgroundColor: colors.field,
  },
  pressedSoft: {
    opacity: 0.75,
  },
  shorts: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  short: {
    flex: 1,
    minHeight: 98,
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg - 2,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.xl - 4,
    backgroundColor: colors.surface,
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.06)",
  },
  shortIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  shortLabel: {
    textAlign: "center",
    lineHeight: 15,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md + 2,
    borderRadius: radius.lg + 2,
    backgroundColor: colors.surface,
  },
});

export const ROW_MIN = touch.row;

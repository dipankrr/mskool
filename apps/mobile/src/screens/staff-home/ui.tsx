import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { AppIcon, type AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors, type Area } from "../../theme/brand-admin";
import { fontFamily, fontSize, motion, radius, shadow, spacing } from "../../theme/tokens";

/**
 * Home's own pieces (ADR-072), drawn from the approved mockup
 * (`docs/design/mobile/prototype/staff-home-v5.html`): a soft tinted band
 * behind the greeting, white 24-radius cards with a gentle shadow, one hue
 * per area, big tabular numbers.
 */

export const HOME_GUTTER = spacing.lg;

/** The tinted band behind the greeting; fades into the canvas. */
export function Band({ tint }: { tint: string }) {
  return (
    <View style={styles.band} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tint} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.canvas} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#band)" />
      </Svg>
    </View>
  );
}

export function HomeCard({
  children,
  style,
  padless,
  onPress,
  accessibilityLabel,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padless?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const base = [styles.card, padless ? styles.padless : null, style];
  if (!onPress) {
    return (
      <View style={base} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [...base, pressed ? styles.pressed : null]}
    >
      {children}
    </Pressable>
  );
}

/** A small rounded square in an area's tint with its icon. */
export function AreaIcon({ area, icon, size = 30 }: { area: Area | "red" | "amber"; icon: AppIconName; size?: number }) {
  const tone =
    area === "red"
      ? colors.tone.critical
      : area === "amber"
        ? colors.tone.caution
        : colors.area[area];
  return (
    <View style={[styles.areaIcon, { width: size, height: size, borderRadius: size / 3, backgroundColor: tone.bg }]}>
      <AppIcon name={icon} size={size * 0.55} color={tone.fg} />
    </View>
  );
}

export function SectionHead({
  title,
  area,
  icon,
  count,
  link,
  onLink,
  right,
}: {
  title: string;
  area?: Area;
  icon?: AppIconName;
  count?: number;
  link?: string;
  onLink?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.sec}>
      {area && icon ? <AreaIcon area={area} icon={icon} size={28} /> : null}
      <ThemedText style={styles.secTitle} accessibilityRole="header">
        {title}
      </ThemedText>
      {count ? <Badge count={count} /> : null}
      <View style={styles.grow} />
      {right}
      {link ? (
        <Pressable onPress={onLink} hitSlop={10} style={styles.secLink} accessibilityRole="link">
          <ThemedText variant="meta" style={styles.secLinkText}>
            {link}
          </ThemedText>
          <AppIcon name="chevronRight" size={14} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Badge({ count, tone = "red" }: { count: number; tone?: "red" | "amber" }) {
  return (
    <View style={[styles.badge, { backgroundColor: tone === "red" ? colors.tone.critical.fg : colors.tone.caution.fg }]}>
      <ThemedText style={styles.badgeText}>{count}</ThemedText>
    </View>
  );
}

type PillTone = "positive" | "caution" | "critical" | "neutral";
export function Pill({ text, tone, icon }: { text: string; tone: PillTone | Area; icon?: AppIconName }) {
  const t = tone in colors.tone ? colors.tone[tone as PillTone] : colors.area[tone as Area];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      {icon ? <AppIcon name={icon} size={12} color={t.fg} /> : null}
      <ThemedText style={[styles.pillText, { color: t.fg }]} numberOfLines={1}>
        {text}
      </ThemedText>
    </View>
  );
}

/** "Teaching" / "Admin": where an item in Waiting on you came from. */
export function Tag({ kind }: { kind: "teaching" | "admin" }) {
  const t = kind === "teaching" ? colors.area.teaching : colors.tone.neutral;
  return (
    <View style={[styles.tag, { backgroundColor: t.bg }]}>
      <ThemedText style={[styles.tagText, { color: t.fg }]}>{kind === "teaching" ? "Teaching" : "Admin"}</ThemedText>
    </View>
  );
}

export function CapsuleAction({
  label,
  onPress,
  tone = "ink",
  icon,
  wide,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: "ink" | Area | "accent";
  icon?: AppIconName;
  wide?: boolean;
  testID?: string;
}) {
  const fill =
    tone === "ink" ? colors.ink : tone === "accent" ? colors.accent : colors.area[tone].fg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      hitSlop={6}
      style={({ pressed }) => [
        wide ? styles.ctaWide : styles.chipBtn,
        { backgroundColor: fill },
        pressed ? styles.pressed : null,
      ]}
    >
      {icon ? <AppIcon name={icon} size={wide ? 18 : 15} color={colors.onAccent} /> : null}
      <ThemedText style={wide ? styles.ctaText : styles.chipBtnText}>{label}</ThemedText>
    </Pressable>
  );
}

/** A progress ring with a figure inside. `value` 0..100. */
export function Ring({
  value,
  size = 96,
  stroke = 9,
  color = colors.accent,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.field} strokeWidth={stroke} fill="none" />
        {v > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(c * v) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringInner}>{children}</View>
    </View>
  );
}

export function Progress({ value, color, height = 6 }: { value: number; color: string; height?: number }) {
  return (
    <View style={[styles.prog, { height, borderRadius: height }]}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

/** One big number with an optional smaller suffix ("12" + "/38", "91" + "%"). */
export function Figure({ value, small, size = 34, color }: { value: string; small?: string; size?: number; color?: string }) {
  return (
    <ThemedText style={[styles.fig, { fontSize: size, lineHeight: size * 1.1 }, color ? { color } : null]}>
      {value}
      {small ? <ThemedText style={styles.figSmall}>{small}</ThemedText> : null}
    </ThemedText>
  );
}

/** A small card in a two-up grid or a sideways row. */
export function Tile({
  area,
  icon,
  label,
  children,
  onPress,
  width,
  testID,
}: {
  area?: Area | "red" | "amber";
  icon?: AppIconName;
  label: string;
  children: ReactNode;
  onPress?: () => void;
  width?: number;
  testID?: string;
}) {
  return (
    <HomeCard style={[styles.tile, width ? { width } : styles.grow]} onPress={onPress} testID={testID} accessibilityLabel={label}>
      <View style={styles.tileHead}>
        {area && icon ? <AreaIcon area={area} icon={icon} /> : null}
        <ThemedText variant="meta" style={styles.tileLabel} numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.tileBody}>{children}</View>
    </HomeCard>
  );
}

export const homeStyles = StyleSheet.create({
  row2: { flexDirection: "row", gap: 10 },
  meta: { marginTop: spacing.xs, lineHeight: 18 },
  strong: { fontFamily: fontFamily.semibold, color: colors.ink },
  rowLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 64,
  },
  divider: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.hairline, marginHorizontal: spacing.lg },
  rowTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.body, color: colors.ink },
});

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, right: 0, top: 0, height: 320 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, boxShadow: shadow.soft },
  padless: { padding: 0, overflow: "hidden" },
  pressed: { opacity: 0.85, transform: [{ scale: motion.pressScale }] },
  areaIcon: { alignItems: "center", justifyContent: "center" },
  sec: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 26,
    marginBottom: 10,
    marginHorizontal: spacing.xs,
  },
  secTitle: { fontFamily: fontFamily.bold, fontSize: 19, letterSpacing: -0.1, color: colors.ink },
  secLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  secLinkText: { fontFamily: fontFamily.semibold },
  grow: { flex: 1 },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: colors.onAccent, fontFamily: fontFamily.bold, fontSize: fontSize.caption },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: radius.full,
  },
  pillText: { fontFamily: fontFamily.semibold, fontSize: fontSize.caption },
  tag: { height: 18, paddingHorizontal: 6, borderRadius: 5, justifyContent: "center", marginLeft: 6 },
  tagText: { fontFamily: fontFamily.bold, fontSize: 10.5, letterSpacing: 0.2 },
  chipBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.full,
  },
  chipBtnText: { color: colors.onAccent, fontFamily: fontFamily.semibold, fontSize: fontSize.fine },
  ctaWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: radius.full,
    alignSelf: "stretch",
  },
  ctaText: { color: colors.onAccent, fontFamily: fontFamily.semibold, fontSize: fontSize.body },
  ringInner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  prog: { marginTop: 10, backgroundColor: colors.field, overflow: "hidden" },
  fig: { fontFamily: fontFamily.bold, letterSpacing: -1, color: colors.ink, fontVariant: ["tabular-nums"] },
  figSmall: { fontFamily: fontFamily.semibold, fontSize: fontSize.callout, color: colors.muted, letterSpacing: 0 },
  tile: { minHeight: 128, padding: 14 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  tileLabel: { fontFamily: fontFamily.semibold, flexShrink: 1 },
  tileBody: { marginTop: "auto", paddingTop: spacing.md },
});

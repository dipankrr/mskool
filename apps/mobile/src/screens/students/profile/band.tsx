import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { initials } from "../../../components/avatar";
import { ThemedText } from "../../../components/themed-text";
import { profileCopy } from "../../../lib/profile-copy";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";

const words = profileCopy;

export type BandTone = "studying" | "left";

export const bandColor = (tone: BandTone) => (tone === "left" ? colors.bandLeft : colors.band);

/** A round, translucent control on the band: Edit (labelled) or More (glyph only). */
function BandButton({
  icon,
  label,
  showLabel,
  onPress,
  hint,
  testID,
}: {
  icon: AppIconName;
  label: string;
  showLabel: boolean;
  onPress: () => void;
  hint?: string;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bandButton,
        showLabel ? styles.bandButtonWide : null,
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={showLabel ? 16 : 20} color={colors.onBand} />
      {showLabel ? (
        <ThemedText variant="bodyStrong" color={colors.onBand}>
          {label}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/**
 * The pinned top row. Over the band it is clear; once the band scrolls away it fills
 * with the band's colour and carries the student in small (photo, name, one line), so
 * you always know whose file you're in.
 */
export function ProfileTopBar({
  topInset,
  tone,
  collapsed,
  name,
  line,
  photo,
  onBack,
  backLabel,
  onEdit,
  onMore,
}: {
  topInset: number;
  tone: BandTone;
  collapsed: boolean;
  name: string;
  line: string;
  photo: ReactNode;
  onBack: () => void;
  backLabel: string;
  onEdit?: () => void;
  onMore?: () => void;
}) {
  return (
    <View
      style={[
        styles.topBar,
        { paddingTop: topInset },
        collapsed ? { backgroundColor: bandColor(tone) } : null,
      ]}
    >
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={4}
          onPress={onBack}
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
          testID="screen-back"
        >
          <AppIcon name="chevronLeft" size={24} color={colors.onBand} />
        </Pressable>
        <View style={styles.mini} accessibilityElementsHidden={!collapsed}>
          {collapsed ? (
            <>
              {photo}
              <View style={styles.flex}>
                <ThemedText variant="name" color={colors.onBand} numberOfLines={1}>
                  {name}
                </ThemedText>
                <ThemedText variant="meta" color={colors.onBandMuted} numberOfLines={1}>
                  {line}
                </ThemedText>
              </View>
            </>
          ) : null}
        </View>
        {onEdit ? (
          <BandButton
            icon="edit"
            label={words.actions.edit}
            showLabel={!collapsed}
            onPress={onEdit}
            hint={words.actions.editHint}
            testID="student-detail-edit"
          />
        ) : null}
        {onMore ? (
          <BandButton
            icon="more"
            label={words.actions.more}
            showLabel={false}
            onPress={onMore}
            hint={words.actions.moreHint}
            testID="student-more"
          />
        ) : null}
      </View>
    </View>
  );
}

/** The small photo for the collapsed bar: initials when there's no picture. */
export function MiniFace({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <View style={styles.miniFace}>
      {children ?? (
        <ThemedText variant="caption" color={colors.onBand} allowFontScaling={false}>
          {initials(name)}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * The band itself: who this is, where they sit and whether they're here today.
 * `banner` (a student who has left) sits above the photo.
 */
export function ProfileBand({
  tone,
  topSpace,
  banner,
  photo,
  name,
  meta,
  placement,
  today,
  lift = true,
}: {
  tone: BandTone;
  topSpace: number;
  /** The action card rests on the band's edge: leave room for it. */
  lift?: boolean;
  banner?: ReactNode;
  photo: ReactNode;
  name: string;
  meta: string;
  placement?: ReactNode;
  today?: ReactNode;
}) {
  return (
    <View
      style={[
        styles.band,
        { paddingTop: topSpace, backgroundColor: bandColor(tone) },
        lift ? null : styles.bandFlat,
      ]}
    >
      {banner}
      <View style={styles.hero}>
        {photo}
        <ThemedText
          variant="title"
          color={colors.onBand}
          style={styles.name}
          accessibilityRole="header"
          testID="student-detail-title"
        >
          {name}
        </ThemedText>
        <ThemedText variant="meta" color={colors.onBandMuted} style={styles.center}>
          {meta}
        </ThemedText>
        {placement}
        {today}
      </View>
    </View>
  );
}

export type CapsulePart = {
  key: string;
  label: string;
  value: string | null;
  /** Shown in place of a missing value when this viewer can fill it in. */
  fill?: { label: string; hint: string; onPress: () => void };
};

/** Class · Sec · Roll as one capsule; a gap the viewer can fill is a white button. */
export function PlacementCapsule({ parts, testID }: { parts: CapsulePart[]; testID: string }) {
  return (
    <View style={styles.capsule} testID={testID}>
      {parts.map((part, index) => {
        const divider = index > 0 ? styles.capsuleDivider : null;
        if (!part.value && part.fill) {
          return (
            <Pressable
              key={part.key}
              accessibilityRole="button"
              accessibilityLabel={`${part.label}, ${part.fill.label}`}
              accessibilityHint={part.fill.hint}
              onPress={part.fill.onPress}
              style={({ pressed }) => [
                styles.capsulePart,
                styles.capsuleFill,
                divider,
                pressed ? styles.pressed : null,
              ]}
              testID={`${testID}-${part.key}`}
            >
              <AppIcon name="add" size={14} color={colors.accentDeep} />
              <ThemedText variant="chip" color={colors.accentDeep}>
                {part.fill.label}
              </ThemedText>
            </Pressable>
          );
        }
        return (
          <View
            key={part.key}
            style={[styles.capsulePart, divider]}
            accessible
            accessibilityLabel={`${part.label} ${part.value ?? "—"}`}
            testID={`${testID}-${part.key}`}
          >
            {part.label ? (
              <ThemedText variant="meta" color={colors.onBandMuted}>
                {part.label}
              </ThemedText>
            ) : null}
            <ThemedText variant="chip" color={colors.onBand} testID={`${testID}-${part.key}-value`}>
              {part.value ?? "—"}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

export type TodayTone = "positive" | "critical" | "caution" | "neutral";

/** "Present today · marked 9:05 am": a white pill, its dot in the status colour. */
export function TodayChip({
  label,
  detail,
  tone,
  onPress,
}: {
  label: string;
  detail?: string | null;
  tone: TodayTone;
  onPress?: () => void;
}) {
  const body = (
    <>
      <View style={[styles.dot, { backgroundColor: colors.tone[tone].fg }]} />
      <ThemedText variant="chip">{label}</ThemedText>
      {detail ? <ThemedText variant="meta">· {detail}</ThemedText> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.today} accessible accessibilityLabel={[label, detail].filter(Boolean).join(", ")} testID="student-today">
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, detail].filter(Boolean).join(", ")}
      accessibilityHint={words.glance.openHint}
      onPress={onPress}
      style={({ pressed }) => [styles.today, pressed ? styles.pressed : null]}
      testID="student-today"
    >
      {body}
    </Pressable>
  );
}

/** A student who has left: when and why, above the photo. */
export function LeftBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.banner} testID="student-left-banner">
      <AppIcon name="logout" size={20} color={colors.onBand} />
      <View style={styles.flex}>
        <ThemedText variant="bodyStrong" color={colors.onBand}>
          {title}
        </ThemedText>
        <ThemedText variant="meta" color={colors.onBandMuted}>
          {detail}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  center: {
    textAlign: "center",
  },
  pressed: {
    opacity: 0.8,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  topRow: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.xs,
    paddingRight: spacing.lg,
  },
  back: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  mini: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  miniFace: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.onBandWash,
  },
  bandButton: {
    height: 40,
    minWidth: 40,
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.onBandWash,
  },
  bandButtonWide: {
    paddingLeft: spacing.md,
    paddingRight: spacing.lg,
  },
  band: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingBottom: 52,
  },
  bandFlat: {
    paddingBottom: spacing.xxl,
  },
  hero: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  name: {
    marginTop: spacing.md,
    textAlign: "center",
  },
  capsule: {
    marginTop: spacing.md,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: colors.onBandWash,
  },
  capsulePart: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md + spacing.xxs,
  },
  capsuleDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.onBandLine,
  },
  capsuleFill: {
    backgroundColor: colors.surface,
  },
  today: {
    marginTop: spacing.md,
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.full,
  },
  banner: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.onBandWash,
  },
});


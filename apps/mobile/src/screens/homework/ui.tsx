import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import type { ImageRef } from "@repo/contracts";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors, type Tone } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/**
 * The homework screens' shared visual parts: one look for a type, a progress
 * line, an information chip and a photo strip that opens full screen. Kept
 * here (screen-colocated) until another domain needs them.
 */

export type Kind = "homework" | "practice" | "project" | "reading" | "quiz";

export const KIND_ICONS: Record<Kind, AppIconName> = {
  homework: "homework",
  practice: "practice",
  project: "project",
  reading: "reading",
  quiz: "quiz",
};

/** Each type's colour (a type, never a state): tiles, the day strip's dots. */
export const KIND_COLOR: Record<Kind, string> = {
  homework: colors.accent,
  practice: colors.tone.neutral.fg,
  project: colors.tone.caution.fg,
  reading: "#2E90FA",
  quiz: colors.tone.critical.fg,
};

/** A type's icon on a soft wash of its colour; size `lg` heads a detail screen. */
export function KindTile({ kind, size = "md" }: { kind: Kind; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <View style={[styles.kindTile, big ? styles.kindTileLg : null, { backgroundColor: `${KIND_COLOR[kind]}1F` }]}>
      <AppIcon name={KIND_ICONS[kind]} size={big ? 26 : 20} color={KIND_COLOR[kind]} />
    </View>
  );
}

/** A thin bar: the part done in the accent, `warn` adds a red slice for missed work. */
export function ProgressBar({ value, total, warn = 0 }: { value: number; total: number; warn?: number }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const warnPct = total > 0 ? Math.min(1 - pct, warn / total) : 0;
  return (
    <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.barFill, { flex: pct }]} />
      {warnPct > 0 ? <View style={[styles.barWarn, { flex: warnPct }]} /> : null}
      <View style={{ flex: Math.max(0, 1 - pct - warnPct) }} />
    </View>
  );
}

/** A quiet label chip with an optional icon and tone. */
export function InfoChip({ label, icon, tone }: { label: string; icon?: AppIconName; tone?: Tone }) {
  const fg = tone ? colors.tone[tone].fg : colors.ink;
  const bg = tone ? colors.tone[tone].bg : colors.chip;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon ? <AppIcon name={icon} size={14} color={fg} /> : null}
      <ThemedText variant="chip" color={fg} numberOfLines={1}>
        {label}
      </ThemedText>
    </View>
  );
}

/** A row of thumbnails; a tap opens the photos full screen, swiping between them. */
export function PhotoStrip({ photos, size = 88 }: { photos: ImageRef[]; size?: number }) {
  const [open, setOpen] = useState<number | null>(null);
  if (photos.length === 0) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {photos.map((p, i) => (
          <Pressable
            key={p.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${copy.homework.detail.photos} ${i + 1}`}
            onPress={() => setOpen(i)}
            style={[styles.thumb, { width: size, height: size }]}
          >
            <Image source={{ uri: p.thumbUrl ?? p.url }} cachePolicy="disk" recyclingKey={p.id} style={styles.fill} contentFit="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {open !== null ? <PhotoViewer photos={photos} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function PhotoViewer({ photos, start, onClose }: { photos: ImageRef[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        <ScrollView
          horizontal
          pagingEnabled
          contentOffset={{ x: start * width, y: 0 }}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          showsHorizontalScrollIndicator={false}
        >
          {photos.map((p) => (
            <View key={p.id} style={{ width, height }}>
              <Image source={{ uri: p.url }} cachePolicy="disk" recyclingKey={p.id} style={styles.fill} contentFit="contain" />
            </View>
          ))}
        </ScrollView>
        <View style={styles.viewerBar}>
          <ThemedText variant="bodyStrong" color={colors.onAccent}>
            {`${index + 1} / ${photos.length}`}
          </ThemedText>
          <Pressable accessibilityRole="button" accessibilityLabel={copy.common.close} onPress={onClose} hitSlop={12} style={styles.viewerClose}>
            <AppIcon name="close" size={22} color={colors.onAccent} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kindTile: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  kindTileLg: { width: 52, height: 52, borderRadius: radius.md },
  bar: {
    flexDirection: "row",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: colors.field,
  },
  barFill: { backgroundColor: colors.accent },
  barWarn: { backgroundColor: colors.tone.critical.fg },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 30,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    maxWidth: "100%",
  },
  strip: { gap: spacing.sm },
  thumb: { borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.field },
  fill: { width: "100%", height: "100%" },
  viewer: { flex: 1, backgroundColor: "#000" },
  viewerBar: {
    position: "absolute",
    top: 48,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewerClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
});

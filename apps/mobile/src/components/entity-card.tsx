import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import type { Tone } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { IconTile } from "./icon-tile";
import { StatusPill } from "./status-pill";
import { ThemedText } from "./themed-text";

type EntityStatus = {
  label: string;
  /** `positive` for the live choice (Current / Running); `neutral` otherwise. */
  tone?: Tone;
};

/**
 * A content card for a list of real things — a branch, an academic session.
 * Deliberately not a table row and not a `FactRow` stack: an icon tile, a
 * two-line name, one quiet meta line, and an optional status capsule so the
 * eye can find the live row without reading every word.
 *
 * The whole card is the target when `onPress` is present. A non-pressable card
 * is still one announcement: name, meta, status — the tile and the chevron are
 * decorative.
 */
export function EntityCard({
  title,
  meta,
  icon = "school",
  status,
  emphasis = "neutral",
  onPress,
  accessibilityHint,
  testID,
  style,
}: {
  title: string;
  meta?: string | null;
  icon?: AppIconName;
  status?: EntityStatus | null;
  /** Accent marks the live choice; everything else is neutral. */
  emphasis?: "accent" | "neutral";
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const label = [title, meta, status?.label].filter(Boolean).join(". ");
  const body = (
    <>
      <IconTile
        name={icon}
        size={40}
        tone={emphasis === "accent" ? "accent" : "neutral"}
      />
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={2}>
          {title}
        </ThemedText>
        {meta ? (
          <ThemedText variant="meta" numberOfLines={2}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {status ? (
          <StatusPill label={status.label} tone={status.tone ?? "neutral"} />
        ) : null}
        {onPress ? (
          <AppIcon name="chevronRight" size={18} color={colors.chevron} />
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} style={[styles.card, style]}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  trailing: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: spacing.xs,
  },
});

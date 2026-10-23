import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { radius, spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * A destination row: title, optional detail, trailing chevron. Used by More
 * ("Profile and access") and Profile ("Change password") so the tap anatomy —
 * 48 dp floor, pressed wash, one announcement — is defined once. Rows that
 * merely show a value use `FactRow` instead.
 */
export function LinkRow({
  title,
  detail,
  icon,
  onPress,
  accessibilityHint,
  first,
  testID,
}: {
  title: string;
  detail?: string | null;
  /** Optional leading icon chip; omit for a plain row. */
  icon?: AppIconName;
  onPress: () => void;
  accessibilityHint?: string;
  /** Suppresses the divider above the row (the first row in a card). */
  first?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.pressed : null,
      ]}
    >
      {icon ? (
        <View style={styles.iconChip}>
          <AppIcon name={icon} size={18} color={colors.muted} />
        </View>
      ) : null}
      <View style={styles.text}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        {detail ? (
          <ThemedText variant="meta" numberOfLines={2}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  iconChip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
});

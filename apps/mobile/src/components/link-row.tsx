import { Pressable, StyleSheet, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import type { AppIconName } from "./app-icon";
import { IconTile } from "./icon-tile";
import { ThemedText } from "./themed-text";

/**
 * A destination row: title, optional detail, trailing chevron. Used by More's
 * Manage and Account groups and by Profile's password row, so the tap anatomy
 * — 48 dp floor, pressed wash, one announcement — is defined once. Rows that
 * merely show a value use `FactRow` instead.
 *
 * The leading tile is accent-tinted because the row goes somewhere; a merely
 * informative row uses `FactRow`'s neutral tile.
 */
export function LinkRow({
  title,
  detail,
  icon,
  onPress,
  accessibilityHint,
  locked = false,
  first,
  testID,
}: {
  title: string;
  detail?: string | null;
  /** Leading icon tile; omit for a plain row. */
  icon?: AppIconName;
  onPress: () => void;
  accessibilityHint?: string;
  /** Waits on something else, which `detail` names. Shown but not tappable. */
  locked?: boolean;
  /** Suppresses the divider above the row (the first row in a card). */
  first?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={locked && detail ? `${title}. ${detail}` : title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.pressed : null,
      ]}
    >
      {icon ? <IconTile name={icon} tone={locked ? "neutral" : "accent"} /> : null}
      <View style={styles.text}>
        <ThemedText variant="bodyStrong" color={locked ? colors.muted : undefined}>
          {title}
        </ThemedText>
        {detail ? (
          <ThemedText variant="meta" numberOfLines={2}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <AppIcon
        name={locked ? "lock" : "chevronRight"}
        size={locked ? 16 : 18}
        color={colors.chevron}
      />
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
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
});

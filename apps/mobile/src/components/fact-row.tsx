import { Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors } from "../theme/brand-admin";
import { spacing } from "../theme/tokens";
import { AppIcon } from "./app-icon";
import { ThemedText } from "./themed-text";

/**
 * A label + value line inside a card (More's context, Profile's account).
 *
 * Tappable only when there is a real choice behind it: pass `onPress` and the
 * row grows a chevron, a 48 dp touch floor, press feedback and a button role.
 * A single-branch teacher gets a plain line — no affordance for a picker that
 * would have one option.
 */
export function FactRow({
  label,
  value,
  first,
  onPress,
  accessibilityHint,
  testID,
  style,
}: {
  label: string;
  value: string;
  /** Suppresses the divider above the row (the first row in a card). */
  first?: boolean;
  onPress?: () => void;
  /** TalkBack only; ignored on the non-pressable line. */
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <>
      <ThemedText variant="body">{label}</ThemedText>
      <ThemedText
        variant="bodyStrong"
        color={colors.muted}
        numberOfLines={2}
        style={styles.value}
      >
        {value}
      </ThemedText>
      {onPress ? (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        testID={testID}
        style={[styles.row, first ? null : styles.divider, style]}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.pressed : null,
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  value: {
    flexShrink: 1,
    textAlign: "right",
  },
});

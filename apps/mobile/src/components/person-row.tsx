import { Pressable, StyleSheet, View } from "react-native";
import type {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  StyleProp,
  ViewStyle,
} from "react-native";
import type { ReactNode } from "react";

import { colors } from "../theme/brand-admin";
import { spacing, touch } from "../theme/tokens";
import { Avatar } from "./avatar";
import { ThemedText } from "./themed-text";

/**
 * A person in a grouped list: initials avatar, name, one meta line, one
 * trailing slot (a status pill, an amount, a chevron). Rows are whole-row
 * targets (≥56 pt) — pills inside them are visual. When pressable, the row
 * gains a native-feeling grey wash (no motion — nothing to reduce) and can
 * expose accessibility actions, which is how long-press workflows stay
 * reachable for screen readers.
 *
 * `first` controls the top hairline: grouped lists pass it for the first row
 * only, matching the probe's inset separators (indent = 16 + 40 + 12).
 */
export function PersonRow({
  name,
  meta,
  leading,
  trailing,
  first,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  testID,
  style,
}: {
  name: string;
  meta?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  first?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const label = accessibilityLabel ?? (meta ? `${name}, ${meta}` : name);
  const body = (
    <>
      {!first ? <View style={styles.separator} pointerEvents="none" /> : null}
      {leading ?? <Avatar name={name} />}
      <View style={styles.text}>
        <ThemedText variant="name" numberOfLines={1}>
          {name}
        </ThemedText>
        {meta ? (
          <ThemedText variant="meta" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      {trailing}
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <View
        testID={testID}
        style={[styles.row, style]}
        accessible
        accessibilityLabel={label}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={({ pressed }) => [
        styles.row,
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
    minHeight: touch.rosterRow,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  pressed: {
    backgroundColor: colors.tone.neutral.bg,
  },
  separator: {
    position: "absolute",
    top: 0,
    left: spacing.lg + 40 + spacing.md, // aligned with the text column
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  text: {
    flex: 1,
  },
});

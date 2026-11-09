import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../../components/app-icon";
import type { AppIconName } from "../../../components/app-icon";
import { ThemedText } from "../../../components/themed-text";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";

export type ProfileAction = {
  key: string;
  label: string;
  icon: AppIconName;
  hint: string;
  onPress: () => void;
  /** The one solid button: the job people most likely came for. */
  main?: boolean;
};

/**
 * The jobs people open a profile for, on a white card resting on the band's edge.
 * The parent passes only what this viewer may do (1–4); the row spreads them evenly.
 */
export function ActionRow({ actions }: { actions: ProfileAction[] }) {
  if (actions.length === 0) return null;
  return (
    <View style={styles.card} testID="student-actions">
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.hint}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
          testID={`student-action-${action.key}`}
        >
          <View style={[styles.circle, action.main ? styles.circleMain : null]}>
            <AppIcon
              name={action.icon}
              size={22}
              color={action.main ? colors.onAccent : colors.accentDeep}
            />
          </View>
          <ThemedText variant="caption" numberOfLines={1} style={styles.label}>
            {action.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: -38,
    marginHorizontal: spacing.xl,
    paddingTop: spacing.md + spacing.xxs,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  action: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: spacing.xs + spacing.xxs,
    paddingHorizontal: spacing.xxs,
  },
  pressed: {
    opacity: 0.7,
  },
  circle: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  circleMain: {
    backgroundColor: colors.accent,
  },
  label: {
    textAlign: "center",
  },
});

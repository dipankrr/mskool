import { StyleSheet, Switch, View } from "react-native";

import { colors } from "../theme/brand-admin";
import { spacing } from "../theme/tokens";
import { ThemedText } from "./themed-text";

/**
 * A boolean field as the platform renders it: label + switch, not a Yes/No
 * dropdown pretending to be a choice. The switch is the control; the label is
 * its accessibility label; the optional help line rides beneath. Disabled
 * state keeps the value visible (opacity, never hiding).
 */
export function SwitchRow({
  label,
  value,
  onChange,
  help,
  disabled = false,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  help?: string;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.text}>
          <ThemedText variant="bodyStrong" numberOfLines={2}>
            {label}
          </ThemedText>
          {help ? (
            <ThemedText variant="meta" numberOfLines={2}>
              {help}
            </ThemedText>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ true: colors.accent, false: colors.grabber }}
          thumbColor="#FFFFFF"
          accessibilityLabel={label}
          testID={testID}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
});

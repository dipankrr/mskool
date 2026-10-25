import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

/**
 * The two deadline acts that do not fit on the grading screen's footer.
 * Resubmit and save are the common path; extending a single student's
 * deadline and excusing them are occasional and consequential, so they sit
 * one deliberate tap away rather than competing with the primary action.
 */
export function GradeActionsSheet({
  onExtend,
  onExcuse,
  onClose,
}: {
  onExtend: () => void;
  onExcuse: () => void;
  onClose: () => void;
}) {
  return (
    <FormSheet
      title={copy.homework.grade.moreTitle}
      onClose={onClose}
      testIDPrefix="homework-more"
      footer={
        <CapsuleButton
          title={copy.homework.grade.moreClose}
          variant="secondary"
          size="compact"
          onPress={onClose}
          testID="homework-more-close"
        />
      }
    >
      <View style={styles.list}>
        <ActionRow
          icon="extend"
          label={copy.homework.grade.extendRow}
          note={copy.homework.grade.extendRowNote}
          onPress={onExtend}
          testID="homework-more-extend"
        />
        <View style={styles.divider} />
        <ActionRow
          icon="closeCircle"
          label={copy.homework.grade.excuseRow}
          note={copy.homework.grade.excuseRowNote}
          onPress={onExcuse}
          testID="homework-more-excuse"
        />
      </View>
    </FormSheet>
  );
}

function ActionRow({
  icon,
  label,
  note,
  onPress,
  testID,
}: {
  icon: "extend" | "closeCircle";
  label: string;
  note: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${note}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <View style={styles.icon}>
        <AppIcon name={icon} size={20} color={colors.tone.neutral.fg} />
      </View>
      <View style={styles.text}>
        <ThemedText variant="bodyStrong">{label}</ThemedText>
        <ThemedText variant="meta">{note}</ThemedText>
      </View>
      <AppIcon name="chevronRight" size={18} color={colors.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  row: {
    minHeight: touch.row,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.md + 40 + spacing.md,
    backgroundColor: colors.hairline,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
});

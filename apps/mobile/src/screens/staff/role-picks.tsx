import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { OfficeRole, RoleMeta } from "./role-logic";

/**
 * "What do they do here?" (frames R1-R3). Teacher is the wide tile on top and
 * gives no role; the office roles below give one each; Office staff means
 * neither. Office roles show only to someone who may give roles, and Org
 * admin only to someone who may give it for the whole organisation.
 */
export function RolePicks({
  firstName,
  teacher,
  onTeacher,
  roles,
  picks,
  onRole,
  onOffice,
}: {
  firstName: string;
  teacher: boolean;
  onTeacher: (next: boolean) => void;
  /** The office roles this person may give; empty hides them. */
  roles: readonly RoleMeta[];
  picks: readonly OfficeRole[];
  onRole: (role: OfficeRole) => void;
  onOffice: () => void;
}) {
  const office = !teacher && picks.length === 0;
  const who = firstName || "them";
  return (
    <View style={styles.grid}>
      <Tile
        wide
        on={teacher}
        icon="school"
        bg={colors.accentTint}
        fg={colors.accentDeep}
        title="Teacher"
        line={`Classes and subjects are given in Teaching, after you add ${who}`}
        onPress={() => onTeacher(!teacher)}
        testID="role-pick-teacher"
      />
      {roles.map((role) => (
        <Tile
          key={role.type}
          on={picks.includes(role.type)}
          icon={role.icon}
          bg={role.bg}
          fg={role.fg}
          title={role.label}
          line={role.short}
          onPress={() => onRole(role.type)}
          testID={`role-pick-${role.type}`}
        />
      ))}
      <Tile
        wide={roles.length % 2 === 0}
        on={office}
        icon="person"
        bg="#EEF0F4"
        fg="#475467"
        title="Office staff"
        line="No access to start with"
        onPress={onOffice}
        testID="role-pick-office"
      />
    </View>
  );
}

function Tile({
  wide,
  on,
  icon,
  bg,
  fg,
  title,
  line,
  onPress,
  testID,
}: {
  wide?: boolean;
  on: boolean;
  icon: AppIconName;
  bg: string;
  fg: string;
  title: string;
  line: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={`${title}. ${line}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, wide ? styles.wide : styles.half, on ? styles.on : null, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <View style={[styles.icon, { backgroundColor: bg }]}>
        <AppIcon name={icon} size={18} color={fg} />
      </View>
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText variant="meta" style={styles.line} numberOfLines={2}>
          {line}
        </ThemedText>
      </View>
      {on ? (
        <View style={styles.check}>
          <AppIcon name="check" size={12} color={colors.onAccent} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  half: { flexBasis: "47%", flexGrow: 1 },
  wide: { flexBasis: "100%" },
  on: { borderWidth: 2, borderColor: colors.accent, backgroundColor: "#FBFEFC" },
  pressed: { opacity: 0.85 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2, paddingRight: spacing.md },
  line: { color: colors.muted },
  check: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});

import { Pressable, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";
import { StaffAvatar, useMyPhoto } from "../staff/staff-photo";
import { useShell } from "./shell";

/**
 * The top row of a tab: the menu button on the left opens the sidebar, the
 * avatar on the right opens the account popup. Anything between them (Home's
 * branch chip) is the screen's own.
 *
 * While a past session is chosen the avatar wears a caution ring, so last
 * year is never mistaken for today from any tab that shows this row.
 */
export function ShellBar({ children }: { children?: ReactNode }) {
  const { openMenu, openAccount } = useShell();
  const { me } = useMe();
  const { organizationId, academicYear, currentYear } = useActiveContext();
  const photo = useMyPhoto(organizationId);
  const viewingPast = Boolean(academicYear && academicYear.id !== currentYear?.id);

  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.shell.openMenu}
        hitSlop={4}
        onPress={openMenu}
        style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}
        testID="shell-menu"
      >
        <AppIcon name="menu" size={22} color={colors.ink} />
      </Pressable>
      <View style={styles.middle}>{children}</View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          viewingPast && academicYear
            ? copy.shell.openAccountPast(academicYear.name)
            : copy.shell.openAccount
        }
        hitSlop={4}
        onPress={openAccount}
        style={({ pressed }) => [
          styles.avatar,
          viewingPast ? styles.avatarPast : null,
          pressed ? styles.avatarPressed : null,
        ]}
        testID="shell-account"
      >
        <StaffAvatar name={me?.user.name ?? ""} uri={photo.uri} cacheKey={photo.cacheKey} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: touch.comfortable,
  },
  button: {
    width: touch.min,
    height: touch.min,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  middle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    padding: 2,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: "transparent",
  },
  avatarPast: {
    borderColor: colors.tone.caution.fg,
  },
  avatarPressed: {
    opacity: 0.7,
  },
});

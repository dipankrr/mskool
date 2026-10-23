import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { FactRow } from "../../components/fact-row";
import { LinkRow } from "../../components/link-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { copy } from "../../lib/copy";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { groupPermissions } from "./permissions";

/** Scope levels in the words the rest of the app uses. */
const SCOPE_LABELS: Record<string, string> = {
  org: "Organization",
  school: "Branch",
  class: "Class",
  section: "Section",
};

/**
 * Profile and access (Step 1).
 *
 * The account is read-only except for the password: identity, the organization
 * it belongs to, and the roles, scopes and permissions the org actually
 * granted. Roles are shown as words because they are human labels — no screen
 * decides anything from them (ADR-044 / the org-customizable permission
 * model); the permission list is the authoritative view, grouped by the same
 * `resource:action` strings an administrator edits.
 *
 * Nothing here is gated. Seeing your own access is not a permission; it is how
 * a teacher can answer "why can't I see fees?" without calling the office.
 */
export function ProfileScreen() {
  const { me } = useMe();
  const { organizationId } = useActiveContext();
  const [permissionsOpen, setPermissionsOpen] = useState(false);

  // Fall back to the first membership while the context hydrates (and for a
  // stale active org): the profile is the caller's own identity either way,
  // and `organization` in the card names whichever org the rows describe.
  const membership =
    me?.memberships.find((m) => m.organization.id === organizationId) ??
    me?.memberships[0] ??
    null;

  const permissionCount = membership?.permissions.length ?? 0;
  const groups = useMemo(
    () => groupPermissions(membership?.permissions ?? []),
    [membership],
  );

  const roles = (membership?.roleTypes ?? []).map(roleLabel);
  const scopes = (membership?.scopeTypes ?? []).map(
    (scope) => SCOPE_LABELS[scope] ?? roleLabel(scope),
  );
  const roleSummary = roles.length > 0 ? roles.join(", ") : copy.profile.noRoles;

  return (
    <ScreenFrame
      title={copy.profile.title}
      backAccessibilityLabel={copy.profile.back}
      backTestID="profile-back"
    >
      <Card style={styles.identity}>
        <Avatar name={me?.user.name ?? ""} size="lg" />
        <View style={styles.identityText}>
          <ThemedText variant="name" numberOfLines={1}>
            {me?.user.name ?? ""}
          </ThemedText>
          {me?.user.email ? (
            <ThemedText variant="meta" numberOfLines={1}>
              {me.user.email}
            </ThemedText>
          ) : null}
        </View>
      </Card>

      <SectionLabel>{copy.profile.account}</SectionLabel>
      <Card padless style={styles.card}>
        <FactRow
          label={copy.profile.organization}
          value={membership?.organization.name ?? copy.more.notSet}
          first
        />
        <LinkRow
          title={copy.profile.changePassword}
          detail={copy.profile.changePasswordDetail}
          onPress={() =>
            router.push({
              pathname: "/change-password",
              params: { returnTo: "/profile" },
            })
          }
          accessibilityHint={copy.profile.changePasswordHint}
          testID="profile-change-password"
        />
      </Card>

      <SectionLabel>{copy.profile.access}</SectionLabel>
      <Card padless style={styles.card}>
        <View
          style={styles.block}
          accessible
          accessibilityLabel={`${copy.profile.roles}: ${roleSummary}`}
        >
          <ThemedText variant="meta">{copy.profile.roles}</ThemedText>
          {roles.length > 0 ? (
            <View style={styles.chips}>
              {roles.map((role) => (
                <Pill key={role} label={role} accent />
              ))}
            </View>
          ) : (
            <ThemedText variant="body">{copy.profile.noRoles}</ThemedText>
          )}
        </View>

        <View
          style={[styles.block, styles.divider]}
          accessible
          accessibilityLabel={`${copy.profile.scopes}: ${
            scopes.length > 0 ? scopes.join(", ") : copy.profile.noScopes
          }`}
        >
          <ThemedText variant="meta">{copy.profile.scopes}</ThemedText>
          {scopes.length > 0 ? (
            <View style={styles.chips}>
              {scopes.map((scope) => (
                <Pill key={scope} label={scope} />
              ))}
            </View>
          ) : (
            <ThemedText variant="body">{copy.profile.noScopes}</ThemedText>
          )}
        </View>

        <Pressable
          testID="profile-permissions"
          accessibilityRole="button"
          accessibilityState={{ expanded: permissionsOpen }}
          accessibilityLabel={`${copy.profile.permissionsLabel}, ${copy.profile.permissionCount(
            permissionCount,
          )}`}
          accessibilityHint={
            permissionsOpen
              ? copy.profile.hidePermissions
              : copy.profile.showPermissions
          }
          onPress={() => setPermissionsOpen((open) => !open)}
          style={({ pressed }) => [
            styles.block,
            styles.divider,
            styles.toggle,
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.toggleText}>
            <ThemedText variant="bodyStrong">
              {copy.profile.permissionsLabel}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.profile.permissionCount(permissionCount)}
            </ThemedText>
          </View>
          <AppIcon
            name={permissionsOpen ? "chevronDown" : "chevronRight"}
            size={18}
            color={colors.chevron}
          />
        </Pressable>

        {permissionsOpen ? (
          groups.length > 0 ? (
            groups.map((group) => (
              <View
                key={group.resource}
                style={[styles.group, styles.divider]}
              >
                <ThemedText variant="bodyStrong" accessibilityRole="header">
                  {group.label}
                </ThemedText>
                {group.actions.length > 0 ? (
                  <View style={styles.chips}>
                    {group.actions.map((action) => (
                      <Pill key={action.key} label={action.label} />
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            <ThemedText variant="body" style={[styles.block, styles.divider]}>
              {copy.profile.noPermissions}
            </ThemedText>
          )
        ) : null}
      </Card>
    </ScreenFrame>
  );
}

/** Role keys are enum words, not user copy: `class_teacher` -> "Class teacher". */
function roleLabel(value: string): string {
  const words = value.replaceAll("_", " ");
  return words.length === 0 ? words : words.charAt(0).toUpperCase() + words.slice(1);
}

function Pill({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.pill, accent ? styles.pillAccent : null]}>
      <ThemedText
        variant="caption"
        color={accent ? colors.accentDeep : colors.muted}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
  },
  card: {
    marginTop: spacing.sm,
  },
  block: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  pill: {
    minHeight: 26,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  pillAccent: {
    backgroundColor: colors.accentTint,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
  },
  toggleText: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  group: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});

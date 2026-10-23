import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { FactRow } from "../../components/fact-row";
import { IconTile } from "../../components/icon-tile";
import { LinkRow } from "../../components/link-row";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { copy } from "../../lib/copy";
import { roleLabel, scopeLabel } from "../../lib/labels";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { groupPermissions } from "./permissions";

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

  const roles = Array.from(new Set(membership?.roleTypes ?? [])).map(roleLabel);
  const scopes = (membership?.scopeTypes ?? []).map(scopeLabel);
  const roleSummary = roles.length > 0 ? roles.join(", ") : copy.profile.noRoles;
  const scopeSummary =
    scopes.length > 0 ? scopes.join(", ") : copy.profile.noScopes;

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
          icon="school"
          first
        />
        <LinkRow
          title={copy.profile.changePassword}
          detail={copy.profile.changePasswordDetail}
          icon="key"
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
          <IconTile name="shield" />
          <View style={styles.blockText}>
            <ThemedText variant="bodyStrong">{copy.profile.roles}</ThemedText>
            {roles.length > 0 ? (
              <View style={styles.chips}>
                {roles.map((role) => (
                  <StatusPill key={role} label={role} tone="neutral" />
                ))}
              </View>
            ) : (
              <ThemedText variant="meta">{copy.profile.noRoles}</ThemedText>
            )}
          </View>
        </View>

        <View
          style={[styles.block, styles.divider]}
          accessible
          accessibilityLabel={`${copy.profile.scopes}: ${scopeSummary}`}
        >
          <IconTile name="stack" />
          <View style={styles.blockText}>
            <ThemedText variant="bodyStrong">{copy.profile.scopes}</ThemedText>
            {scopes.length > 0 ? (
              <View style={styles.chips}>
                {scopes.map((scope) => (
                  <StatusPill key={scope} label={scope} tone="neutral" />
                ))}
              </View>
            ) : (
              <ThemedText variant="meta">{copy.profile.noScopes}</ThemedText>
            )}
          </View>
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
            pressed ? styles.pressed : null,
          ]}
        >
          <IconTile name="lock" />
          <View style={styles.blockText}>
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
              <View key={group.resource} style={[styles.group, styles.divider]}>
                <View style={styles.groupHead}>
                  <ThemedText variant="bodyStrong" accessibilityRole="header">
                    {group.label}
                  </ThemedText>
                  <ThemedText variant="caption" color={colors.muted}>
                    {group.actions.length}
                  </ThemedText>
                </View>
                {group.actions.length > 0 ? (
                  <View style={styles.chips}>
                    {group.actions.map((action) => (
                      <StatusPill
                        key={action.key}
                        label={action.label}
                        tone="neutral"
                      />
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

const styles = StyleSheet.create({
  identity: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xxs,
  },
  card: {
    marginTop: spacing.sm,
  },
  block: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  blockText: {
    flex: 1,
    gap: spacing.xs,
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
  pressed: {
    backgroundColor: colors.field,
  },
  group: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
});

import { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { FactRow } from "../../components/fact-row";
import { LinkRow } from "../../components/link-row";
import { SectionLabel } from "../../components/section-label";
import { StatusPill } from "../../components/status-pill";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
  useActiveOrganizationName,
} from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { logout } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { thrownMessage } from "../../lib/errors";
import { roleLabel } from "../../lib/labels";
import { colors } from "../../theme/brand-admin";
import { gutter, spacing } from "../../theme/tokens";

/**
 * "More" — identity, the context this session is running in, the management
 * surfaces the caller's permissions unlock, and the account destinations that
 * need no permission of their own.
 *
 * The branch row is a real switcher only when the org grants more than one
 * branch: one branch is a fact, not a choice, so it stays a plain line with no
 * chevron. The session is always the branch's current one (ADR-047): changing
 * it is an administrative act in Sessions management, never a personal viewing
 * mode, so this row is a label — and a retry target when the session list is
 * the thing that failed.
 *
 * Manage appears only when a write hint exists. Every gate is a permission
 * string (ADR-044); the role pills are labels, never gates. Profile and access
 * is not gated: every staff member may see their own roles, scopes and
 * permissions, which is what makes an org-customized permission set legible on
 * a phone.
 */
export function MoreScreen() {
  const { me } = useMe();
  const { has } = usePermissions();
  const {
    organizationId,
    schoolId,
    branches,
    academicYear,
    yearPending,
    yearError,
    retryYears,
    ready,
    select,
  } = useActiveContext();
  const branchName = useActiveBranchName();
  const organizationName = useActiveOrganizationName();
  const tabSpace = useTabBarSpace();
  const [signingOut, setSigningOut] = useState(false);
  const [branchSheetOpen, setBranchSheetOpen] = useState(false);

  const handleSignOut = () => {
    setSigningOut(true);
    logout().catch((error: unknown) => {
      // The session is still live server-side — say so instead of pretending
      // the user is signed out (walk finding #3: a resolved {error} used to
      // pass silently). The session boundary handles the success path.
      setSigningOut(false);
      Alert.alert(copy.more.title, thrownMessage(error));
    });
  };

  const membership =
    me?.memberships.find((m) => m.organization.id === organizationId) ??
    me?.memberships[0] ??
    null;
  const roles = Array.from(new Set(membership?.roleTypes ?? []));

  const canManageStudents = has("student:read");
  const canManageAcademic = [
    "class:read",
    "section:read",
    "subject:read",
    "academic_year:read",
    "subject_mapping:read",
    "teacher_assignment:read",
  ].some((permission) => has(permission));
  const canManageBranches =
    has("school:read") &&
    (has("school:create") || has("school:update") || has("school:delete"));
  const canManageSessions =
    has("academic_year:read") &&
    (has("academic_year:create") || has("academic_year:update"));
  const showManage =
    canManageStudents ||
    canManageAcademic ||
    canManageBranches ||
    canManageSessions;

  const canSwitchBranch = branches.length > 1;
  const branchValue = ready ? branchName ?? copy.more.notSet : copy.more.loading;
  const sessionValue = yearError
    ? copy.more.sessionRetry
    : !ready || yearPending
      ? copy.more.loading
      : academicYear?.name ?? copy.more.notSet;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        <View>
          <ThemedText variant="title">{copy.more.title}</ThemedText>
          {organizationName ? (
            <ThemedText variant="meta" style={styles.org}>
              {organizationName}
            </ThemedText>
          ) : null}
        </View>

        <Card style={styles.identity}>
          <View style={styles.identityTop}>
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
          </View>
          {roles.length > 0 ? (
            <View style={styles.roles}>
              {roles.map((role) => (
                <StatusPill key={role} label={roleLabel(role)} tone="neutral" />
              ))}
            </View>
          ) : null}
        </Card>

        <SectionLabel>{copy.more.workspace}</SectionLabel>
        <Card padless>
          <FactRow
            label={copy.more.branch}
            value={branchValue}
            icon="branches"
            iconTone="accent"
            first
            onPress={
              canSwitchBranch ? () => setBranchSheetOpen(true) : undefined
            }
            accessibilityHint={
              canSwitchBranch ? copy.more.branchHint : undefined
            }
            testID="more-branch"
          />
          <FactRow
            label={copy.more.session}
            value={sessionValue}
            icon="sessions"
            iconTone="accent"
            onPress={yearError ? retryYears : undefined}
            accessibilityHint={
              yearError ? copy.more.sessionRetryHint : undefined
            }
            testID="more-session"
          />
        </Card>

        {showManage ? (
          <>
            <SectionLabel>{copy.more.manage}</SectionLabel>
            <Card padless>
              {canManageStudents ? (
                <LinkRow
                  title={copy.more.students}
                  detail={copy.more.studentsDetail}
                  icon="students"
                  onPress={() => router.push("/students")}
                  accessibilityHint={copy.more.studentsHint}
                  first
                  testID="more-students"
                />
              ) : null}
              {canManageAcademic ? (
                <LinkRow
                  title={copy.academic.title}
                  detail={copy.academic.detail}
                  icon="manage"
                  onPress={() => router.push("/academic-setup")}
                  accessibilityHint={copy.academic.hint}
                  first={!canManageStudents}
                  testID="more-academic"
                />
              ) : null}
              {canManageBranches ? (
                <LinkRow
                  title={copy.more.branches}
                  detail={copy.more.branchesDetail}
                  icon="branches"
                  onPress={() => router.push("/branches")}
                  accessibilityHint={copy.more.branchesHint}
                  first={!canManageStudents && !canManageAcademic}
                  testID="more-branches"
                />
              ) : null}
              {canManageSessions ? (
                <LinkRow
                  title={copy.more.sessions}
                  detail={copy.more.sessionsDetail}
                  icon="sessions"
                  onPress={() => router.push("/sessions")}
                  accessibilityHint={copy.more.sessionsHint}
                  first={
                    !canManageStudents && !canManageAcademic && !canManageBranches
                  }
                  testID="more-sessions"
                />
              ) : null}
            </Card>
          </>
        ) : null}

        <SectionLabel>{copy.more.account}</SectionLabel>
        <Card padless>
          <LinkRow
            title={copy.more.profile}
            detail={copy.more.profileDetail}
            icon="profileCard"
            onPress={() => router.push("/profile")}
            accessibilityHint={copy.more.profileHint}
            first
            testID="more-profile"
          />
        </Card>

        <CapsuleButton
          title={copy.auth.signOutAction}
          icon="logout"
          variant="secondary"
          onPress={handleSignOut}
          loading={signingOut}
          testID="more-sign-out"
          style={styles.signOut}
        />
      </ScrollView>

      <ChoiceSheet
        visible={branchSheetOpen}
        title={copy.more.branchSheetTitle}
        options={branches.map((branch) => ({
          id: branch.id,
          label: branch.name,
          detail:
            [branch.code, branch.city].filter(Boolean).join(" · ") || null,
        }))}
        currentId={schoolId ?? ""}
        onSelect={(id) => {
          if (organizationId) {
            select(organizationId, id);
          }
          setBranchSheetOpen(false);
        }}
        onDismiss={() => setBranchSheetOpen(false)}
        testIDPrefix="branch-option"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  org: {
    marginTop: spacing.xxs,
  },
  identity: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  identityTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xxs,
  },
  roles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  signOut: {
    alignSelf: "stretch",
    marginTop: spacing.xxl,
  },
});

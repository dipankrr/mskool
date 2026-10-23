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
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { logout } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { thrownMessage } from "../../lib/errors";
import { colors } from "../../theme/brand-admin";
import { gutter, spacing } from "../../theme/tokens";

/**
 * "More" — identity, the context this session is running in, and the account
 * destinations that need no permission of their own.
 *
 * The branch row is a real switcher only when the org grants more than one
 * branch: one branch is a fact, not a choice, so it stays a plain line with no
 * chevron. The session is always the branch's current one (ADR-049): changing
 * it is an administrative act in Sessions management, never a personal viewing
 * mode, so this row is a label — and a retry target when the session list is
 * the thing that failed.
 *
 * Profile and access is not gated: every staff member may see their own roles,
 * scopes and permissions. That is what makes an org-customized permission set
 * legible on a phone.
 */
export function MoreScreen() {
  const { me } = useMe();
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
        <ThemedText variant="title">{copy.more.title}</ThemedText>

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

        <Card padless style={styles.card}>
          <FactRow
            label={copy.more.branch}
            value={branchValue}
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
            onPress={yearError ? retryYears : undefined}
            accessibilityHint={
              yearError ? copy.more.sessionRetryHint : undefined
            }
            testID="more-session"
          />
        </Card>

        <Card padless style={styles.card}>
          <LinkRow
            title={copy.more.profile}
            detail={copy.more.profileDetail}
            icon="person"
            onPress={() => router.push("/profile")}
            accessibilityHint={copy.more.profileHint}
            first
            testID="more-profile"
          />
        </Card>

        <CapsuleButton
          title={copy.auth.signOutAction}
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
    marginTop: spacing.xs,
  },
  signOut: {
    alignSelf: "stretch",
    marginTop: spacing.sm,
  },
});

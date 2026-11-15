import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
} from "@expo/ui/community/bottom-sheet";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { FactRow } from "../../components/fact-row";
import { IconTile } from "../../components/icon-tile";
import { LinkRow } from "../../components/link-row";
import { SectionLabel } from "../../components/section-label";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { logout } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { thrownMessage } from "../../lib/errors";
import { roleLabel } from "../../lib/labels";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";

/**
 * The account popup: who you are and where you are, from the avatar on a tab.
 * Name and roles, the branch and session this app is working in, the two
 * account screens, and sign out.
 *
 * Branch and session follow the rule More used to hold: one branch is a fact,
 * not a choice, so it is a plain line; more than one is a list you pick from.
 * The session is a picker only for a holder of `academic_year:read_history`
 * whose branch has more than one (ADR-066). While a past session is chosen its
 * block moves to the top, in the caution tone, with one tap back.
 */
export function AccountSheet({
  visible,
  onDismiss,
  onOpenSessions,
  onOpenProfile,
  onChangePassword,
}: {
  visible: boolean;
  onDismiss: () => void;
  /** The session picker is its own sheet; the shell swaps this one for it. */
  onOpenSessions: () => void;
  onOpenProfile: () => void;
  onChangePassword: () => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const { height } = useWindowDimensions();
  const { me } = useMe();
  const { has } = usePermissions();
  const {
    organizationId,
    schoolId,
    branches,
    academicYear,
    currentYear,
    years,
    selectYear,
    yearPending,
    yearError,
    retryYears,
    ready,
    select,
  } = useActiveContext();
  const branchName = useActiveBranchName();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (visible) ref.current?.present();
    else ref.current?.dismiss();
  }, [visible]);

  const membership =
    me?.memberships.find((m) => m.organization.id === organizationId) ??
    me?.memberships[0] ??
    null;
  const roles = Array.from(new Set(membership?.roleTypes ?? []));

  const canSwitchBranch = branches.length > 1;
  const canSwitchSession = !yearError && has("academic_year:read_history") && years.length > 1;
  const viewingPast = Boolean(academicYear && academicYear.id !== currentYear?.id);
  const sessionValue = yearError
    ? copy.more.sessionRetry
    : !ready || yearPending
      ? copy.more.loading
      : academicYear
        ? viewingPast
          ? copy.shell.account.ended
          : copy.more.sessionRunning
        : copy.more.notSet;

  const signOut = () => {
    setSigningOut(true);
    logout().catch((error: unknown) => {
      // The session is still live server-side: say so, never pretend.
      setSigningOut(false);
      Alert.alert(copy.shell.account.signOut, thrownMessage(error));
    });
  };

  const branchBlock = (
    <View key="branch">
      <SectionLabel>{canSwitchBranch ? copy.more.branch : copy.shell.account.youAreIn}</SectionLabel>
      <Card padless>
        {canSwitchBranch ? (
          branches.map((branch, index) => {
            const selected = branch.id === schoolId;
            return (
              <Pressable
                key={branch.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={branch.name}
                onPress={() => {
                  void Haptics.selectionAsync();
                  if (organizationId && !selected) select(organizationId, branch.id);
                  onDismiss();
                }}
                style={({ pressed }) => [
                  styles.branch,
                  index === 0 ? null : styles.divider,
                  pressed ? styles.pressed : null,
                ]}
                testID={`account-branch-${branch.id}`}
              >
                <IconTile name="branches" tone={selected ? "accent" : "neutral"} />
                <View style={styles.branchText}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {branch.name}
                  </ThemedText>
                  {branch.code || branch.city ? (
                    <ThemedText variant="meta" numberOfLines={1}>
                      {[branch.code, branch.city].filter(Boolean).join(" · ")}
                    </ThemedText>
                  ) : null}
                </View>
                {selected ? <AppIcon name="check" size={18} color={colors.accentDeep} /> : null}
              </Pressable>
            );
          })
        ) : (
          <FactRow
            label={copy.more.branch}
            value={ready ? branchName ?? copy.more.notSet : copy.more.loading}
            icon="branches"
            iconTone="accent"
            first
            testID="account-branch"
          />
        )}
        {canSwitchBranch ? null : sessionRow(false)}
      </Card>
    </View>
  );

  function sessionRow(first: boolean) {
    return (
      <FactRow
        label={academicYear?.name ?? copy.more.session}
        value={sessionValue}
        icon="sessions"
        iconTone="accent"
        first={first}
        onPress={yearError ? retryYears : canSwitchSession ? onOpenSessions : undefined}
        accessibilityHint={
          yearError ? copy.more.sessionRetryHint : canSwitchSession ? copy.more.sessionHint : undefined
        }
        testID="account-session"
      />
    );
  }

  // One branch: branch and session share the "You are in" card above.
  const sessionBlock =
    canSwitchBranch || viewingPast ? (
      <View key="session">
        <SectionLabel>{copy.more.session}</SectionLabel>
        {viewingPast && academicYear ? (
          <View style={styles.past} testID="account-past">
            <ThemedText variant="bodyStrong" color={colors.tone.caution.fg}>
              {copy.shell.account.pastTitle(academicYear.name)}
            </ThemedText>
            <ThemedText variant="meta" color={colors.tone.caution.fg}>
              {copy.shell.account.pastBody}
            </ThemedText>
            {currentYear ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  selectYear(null);
                  onDismiss();
                }}
                style={({ pressed }) => [styles.pastBack, pressed ? styles.pastBackPressed : null]}
                testID="account-past-back"
              >
                <ThemedText variant="caption" color={colors.onAccent}>
                  {copy.shell.account.pastBack(currentYear.name)}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {canSwitchBranch ? <Card padless>{sessionRow(true)}</Card> : null}
      </View>
    ) : null;

  return (
    <BottomSheetModal
      ref={ref}
      enablePanDownToClose
      onDismiss={onDismiss}
      backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.grabber }}
    >
      <BottomSheetView>
        <BottomSheetScrollView
          style={{ maxHeight: Math.round(height * 0.82) }}
          contentContainerStyle={styles.content}
        >
          <View style={styles.who}>
            <Avatar name={me?.user.name ?? ""} size="lg" />
            <View style={styles.whoText}>
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
                <StatusPill key={role} label={roleLabel(role)} tone="neutral" style={styles.role} />
              ))}
            </View>
          ) : null}

          {viewingPast ? [sessionBlock, branchBlock] : [branchBlock, sessionBlock]}

          <SectionLabel>{copy.more.account}</SectionLabel>
          <Card padless>
            <LinkRow
              title={copy.more.profile}
              detail={copy.more.profileDetail}
              icon="profileCard"
              onPress={onOpenProfile}
              accessibilityHint={copy.more.profileHint}
              first
              testID="account-profile"
            />
            <LinkRow
              title={copy.shell.account.changePassword}
              icon="key"
              onPress={onChangePassword}
              testID="account-change-password"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.shell.account.signOut}
              accessibilityState={{ busy: signingOut, disabled: signingOut }}
              disabled={signingOut}
              onPress={signOut}
              style={({ pressed }) => [
                styles.signOut,
                styles.divider,
                pressed ? styles.pressed : null,
                signingOut ? styles.busy : null,
              ]}
              testID="account-sign-out"
            >
              <View style={styles.signOutTile}>
                <AppIcon name="logout" size={18} color={colors.tone.critical.fg} />
              </View>
              <ThemedText variant="bodyStrong" color={colors.tone.critical.fg}>
                {copy.shell.account.signOut}
              </ThemedText>
            </Pressable>
          </Card>
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.huge,
  },
  who: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  whoText: {
    flex: 1,
    gap: spacing.xxs,
  },
  roles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  role: {
    backgroundColor: colors.surface,
  },
  branch: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  branchText: {
    flex: 1,
    gap: spacing.xxs,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  past: {
    gap: spacing.xs,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.tone.caution.bg,
  },
  pastBack: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 36,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.tone.caution.fg,
  },
  pastBackPressed: {
    opacity: 0.85,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  signOutTile: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tone.critical.bg,
  },
  busy: {
    opacity: 0.5,
  },
});

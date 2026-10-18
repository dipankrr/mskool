import { useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
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
 * "More" — identity, the context this session is running in, and sign out.
 * Everything shown is real: no placeholder rows (a tab that cannot do its
 * journey yet is incomplete — the Students entry arrives with its slice, and
 * the branch/session lines become the switchers when switching ships).
 */
export function MoreScreen() {
  const { me } = useMe();
  const { academicYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const tabSpace = useTabBarSpace();
  const [signingOut, setSigningOut] = useState(false);

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

        <Card style={styles.facts}>
          <FactRow label={copy.more.branch} value={branchName ?? copy.more.notSet} first />
          <FactRow
            label={copy.more.session}
            value={academicYear?.name ?? copy.more.notSet}
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
    </SafeAreaView>
  );
}

/** A label + value line inside the facts card; `first` suppresses the divider. */
function FactRow({
  label,
  value,
  first,
}: {
  label: string;
  value: string;
  first?: boolean;
}) {
  return (
    <View style={[styles.factRow, first ? null : styles.factRowDivider]}>
      <ThemedText variant="body">{label}</ThemedText>
      <ThemedText variant="bodyStrong" color={colors.muted} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
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
  facts: {
    paddingVertical: 0,
  },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  factRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  signOut: {
    alignSelf: "stretch",
  },
});

import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack, usePathname, useRouter } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { copy } from "../../lib/copy";
import { ShellProvider } from "../../screens/shell/shell";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";

/**
 * Screens about the organisation itself, which work without a branch
 * (ADR-067). Branches must stay reachable: a new org has none until its admin
 * adds the first one there.
 */
const ORG_ROUTES = ["/branches", "/branch-form", "/profile"];

/**
 * Staff shell guard (Step 0): staff-kind AND flag clear. A wrong-kind
 * session routes to its own entry (index shows the staff-only notice),
 * never a dead end. Guards are navigation behavior — enforcement stays
 * server-side in `can()`.
 *
 * With no branch to open, every list would be refused (ADR-067: each names
 * its branch), so the shell says so once instead of mounting branch screens.
 */
export default function StaffLayout() {
  const { session, sessionPending, isStaff, mustChangePassword, isFetched } =
    useMe();
  const { ready, organizationId, schoolId } = useActiveContext();
  const pathname = usePathname();
  const router = useRouter();

  if (sessionPending || (session && !isFetched)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) {
    return <Redirect href="/login" />;
  }
  if (mustChangePassword) {
    return <Redirect href="/change-password" />;
  }
  if (!isStaff) {
    return <Redirect href="/" />;
  }
  if (
    ready &&
    organizationId &&
    !schoolId &&
    !ORG_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  ) {
    return (
      <View style={styles.center} testID="no-branch">
        <EmptyState
          icon="students"
          title={copy.denied.noBranchTitle}
          message={copy.denied.noBranchBody}
        >
          <View style={styles.actions}>
            <CapsuleButton
              title={copy.denied.noBranchBranches}
              onPress={() => router.push("/branches")}
              testID="no-branch-branches"
            />
            <CapsuleButton
              title={copy.denied.noBranchProfile}
              variant="secondary"
              onPress={() => router.push("/profile")}
              testID="no-branch-profile"
            />
          </View>
        </EmptyState>
      </View>
    );
  }
  // The sidebar and the account popup sit above every staff screen, mounted
  // once here; a tab asks for them through `useShell`.
  return (
    <ShellProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
    </ShellProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.canvas,
  },
  actions: {
    gap: spacing.sm,
    alignSelf: "stretch",
  },
});

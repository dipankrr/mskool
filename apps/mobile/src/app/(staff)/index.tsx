import { Button, StyleSheet, Text, View } from "react-native";

import { logout } from "../../lib/auth";
import { errorMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { useActiveContext } from "../../hooks/use-active-context";

/**
 * Temporary post-login screen (Step 0): proves staff identity, permission
 * map, active-context resolution, authenticated tRPC access, and
 * sign-out/session-boundary cleanup. Replaced by the owner-reviewed
 * production shell after the prototype gate.
 */
export default function StaffHomeScreen() {
  const meQuery = trpc.me.get.useQuery(undefined, { staleTime: 60_000 });
  const { organizationId, schoolId, ready } = useActiveContext();

  if (meQuery.isLoading) {
    return (
      <View style={styles.container}>
        <Text testID="staff-home-loading">Loading your identity…</Text>
      </View>
    );
  }

  if (meQuery.isError) {
    return (
      <View style={styles.container}>
        <Text testID="staff-home-error">{errorMessage(meQuery.error)}</Text>
        <Button
          title="Retry"
          onPress={() => void meQuery.refetch()}
          testID="staff-home-retry"
        />
      </View>
    );
  }

  const me = meQuery.data;
  const memberships = me?.memberships ?? [];
  const permissionCount = memberships.reduce(
    (sum, m) => sum + m.permissions.length,
    0,
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title} testID="staff-home-name">
        {me?.user.name ?? me?.user.email ?? "Staff"}
      </Text>
      <Text testID="staff-home-orgs">
        {memberships.length} organization{memberships.length === 1 ? "" : "s"} ·{" "}
        {permissionCount} permissions
      </Text>
      <Text testID="staff-home-context">
        Context: {ready ? `${organizationId} / ${schoolId}` : "resolving…"}
      </Text>
      <Button
        title="Sign out"
        onPress={() => void logout()}
        testID="staff-home-signout"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
});

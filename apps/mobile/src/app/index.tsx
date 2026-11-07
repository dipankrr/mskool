import { useEffect } from "react";
import { Alert, Button, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";

import { discardDeadSession, logout } from "../lib/auth";
import { copy } from "../lib/copy";
import { thrownMessage, toFriendlyError } from "../lib/errors";
import { useMe } from "../hooks/use-me";

/**
 * Post-login dispatch (Step 0). Staff-kind → staff shell, forced-change →
 * change screen first, family (owns a child) → the family shell,
 * signed-out → login. A login with neither (no staff grant, no linked child)
 * lands on an honest notice with sign-out, never a dead end.
 */
export default function Index() {
  const {
    session,
    sessionPending,
    me,
    isStaff,
    isFamily,
    mustChangePassword,
    isFetched,
    isError,
    error,
    refetch,
  } = useMe();

  // A stored session the server no longer accepts (expired, revoked, account
  // removed) is not a connection problem: Retry can never succeed. Drop it
  // so the session gate below redirects to sign-in.
  const deadSession = isError && toFriendlyError(error).requiresSignIn;
  useEffect(() => {
    if (deadSession) void discardDeadSession();
  }, [deadSession]);

  if (sessionPending || (session && !isFetched)) {
    return null; // splash gate in _layout covers this
  }
  if (!session) {
    return <Redirect href="/login" />;
  }
  // A failed `me.get` is a connection problem, not a family session. Without
  // this branch an offline boot (or any failed hydration) falls through to
  // the staff-only notice and strands a staff user there — 2026-10-19 walk.
  if (deadSession) {
    return null;
  }
  if (isError) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{copy.auth.appName}</Text>
        <Text style={styles.body}>{thrownMessage(error)}</Text>
        <Button title={copy.common.retry} onPress={() => void refetch()} />
      </View>
    );
  }
  if (mustChangePassword) {
    return <Redirect href="/change-password" />;
  }
  if (isStaff) {
    return <Redirect href="/home" />;
  }
  if (isFamily) {
    return <Redirect href="/family/home" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{copy.auth.appName}</Text>
      <Text style={styles.body}>
        Signed in as {me?.user.name ?? me?.user.email ?? "this login"}. It has no
        school access or linked child yet. Ask the school office.
      </Text>
      <Button
        title={copy.auth.signOutAction}
        onPress={() => {
          void logout().catch((error: unknown) => {
            Alert.alert(copy.auth.appName, thrownMessage(error));
          });
        }}
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
    fontFamily: "ClashGrotesk-Semibold",
  },
  body: {
    textAlign: "center",
    fontFamily: "ClashGrotesk-Regular",
  },
});

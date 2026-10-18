import { Button, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";

import { logout } from "../lib/auth";
import { copy } from "../lib/copy";
import { useMe } from "../hooks/use-me";

/**
 * Post-login dispatch (Step 0). Staff-kind → staff shell, forced-change →
 * change screen first, signed-out → login. There is no family shell yet
 * (Step 9): a family session lands on an honest staff-only notice, never a
 * dead end and never staff screens.
 */
export default function Index() {
  const { session, sessionPending, me, isStaff, mustChangePassword, isFetched } =
    useMe();

  if (sessionPending || (session && !isFetched)) {
    return null; // splash gate in _layout covers this
  }
  if (!session) {
    return <Redirect href="/login" />;
  }
  if (mustChangePassword) {
    return <Redirect href="/change-password" />;
  }
  if (isStaff) {
    return <Redirect href="/home" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{copy.auth.appName}</Text>
      <Text style={styles.body}>
        Signed in as {me?.user.name ?? me?.user.email ?? "a family login"}.
        This preview build serves staff only — the family shell arrives later.
      </Text>
      <Button title={copy.auth.signOutAction} onPress={() => void logout()} />
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
  body: {
    textAlign: "center",
  },
});

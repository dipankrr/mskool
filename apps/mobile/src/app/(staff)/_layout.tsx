import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";

import { useMe } from "../../hooks/use-me";
import { colors } from "../../theme/brand-admin";

/**
 * Staff shell guard (Step 0): staff-kind AND flag clear. A wrong-kind
 * session routes to its own entry (index shows the staff-only notice),
 * never a dead end. Guards are navigation behavior — enforcement stays
 * server-side in `can()`.
 */
export default function StaffLayout() {
  const { session, sessionPending, isStaff, mustChangePassword, isFetched } =
    useMe();

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
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

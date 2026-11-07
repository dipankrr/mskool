import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";

import { loadSavedLanguage } from "../../family/i18n";
import { FamilyChildProvider } from "../../family/child-context";
import { FamilyThemeProvider, useFamilyTheme } from "../../family/theme";
import { useMe } from "../../hooks/use-me";

/**
 * Family shell guard: a signed-in login that owns at least one child. Other
 * sessions route to their own entry. Guards are navigation only; every
 * family read checks ownership on the server.
 */
export default function FamilyLayout() {
  const { session, sessionPending, isFamily, mustChangePassword, isFetched } = useMe();

  useEffect(() => {
    void loadSavedLanguage();
  }, []);

  if (sessionPending || (session && !isFetched)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  if (mustChangePassword) return <Redirect href="/change-password" />;
  if (!isFamily) return <Redirect href="/" />;

  return (
    <FamilyThemeProvider>
      <FamilyChildProvider>
        <FamilyStack />
      </FamilyChildProvider>
    </FamilyThemeProvider>
  );
}

function FamilyStack() {
  const { color } = useFamilyTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { logout } from "../../lib/auth";
import { useFamilyTheme } from "../theme";
import { FButton, FText } from "../ui";

/** Sign out, with the one failure a family can hit: no connection. */
export function SignOutButton({ variant = "quiet" }: { variant?: "quiet" | "secondary" }) {
  const { t } = useTranslation("family");
  const theme = useFamilyTheme();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      // The family layout's guard sends a signed-out session to sign-in. A
      // second navigation here raced it and crashed Android's view tree.
      await logout();
    } catch {
      setError(t("profile.signOutFailed"));
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: theme.space.sm }}>
      <FButton
        testID="family-sign-out"
        variant={variant}
        icon="logout"
        label={t("profile.signOut")}
        loading={busy}
        onPress={() => void signOut()}
        style={styles.center}
      />
      {error ? (
        <FText variant="meta" color="critical" align="center">
          {error}
        </FText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignSelf: "center" },
});

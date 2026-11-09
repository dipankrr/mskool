import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Button,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { login } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { thrownMessage } from "../../lib/errors";
import { bestEffort } from "../../lib/with-timeout";
import { useMe } from "../../hooks/use-me";

/**
 * Upper bound on the post-sign-in session settle. Generous — the refresh is
 * one LAN/localhost round trip — but never open-ended: if it loses the race,
 * the guard below still routes correctly.
 */
const SIGN_IN_SETTLE_MS = 4_000;

/**
 * Staff sign-in (Step 0): email + password. Shown from the login route when
 * staff pick "Staff / Teacher" on the welcome screen; the route owns the settled-session redirect. No self-signup (ADR-021) —
 * accounts are provisioned by the org with an initial password +
 * `must_change_password`. A settled session never sees the form (decided
 * here, not as a push during render): armed sessions route to the
 * forced-change screen, clear-flag sessions to the index dispatch.
 */
export function StaffLoginForm({ onBack }: { onBack: () => void }) {
  const { refetchSession } = useMe();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (submitting) return; // concurrent double-tap guard
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(email.trim(), password);
      if (result.error) {
        // Uniform refusal: no user enumeration, no credential hints.
        setError(copy.auth.invalidCredentials);
        return;
      }
      // Sign-in only *notifies* the session atom (a background refetch), so
      // navigating immediately can outrun it and the index dispatch would
      // bounce on the stale signed-out state. Settle it, bounded — a slow or
      // failed refresh must not hold the spinner, and the guard above
      // redirects correctly even if this refresh loses the race.
      await bestEffort(refetchSession(), SIGN_IN_SETTLE_MS);
      router.replace("/");
    } catch (cause) {
      setError(thrownMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  // Back (the arrow or Android's back) returns to the welcome screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <View style={styles.container}>
      <Pressable
        testID="login-back"
        accessibilityRole="button"
        accessibilityLabel={copy.common.back}
        hitSlop={12}
        onPress={onBack}
        disabled={submitting}
        style={[styles.back, { top: insets.top + 8 }]}
      >
        <AppIcon name="chevronLeft" size={24} />
      </Pressable>
      <Text style={styles.title} testID="login-title">
        {copy.auth.signInTitle}
      </Text>
      <Text style={styles.subtitle}>{copy.auth.appName}</Text>

      <Text style={styles.label}>{copy.auth.emailLabel}</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        editable={!submitting}
        testID="login-email"
      />

      <Text style={styles.label}>{copy.auth.passwordLabel}</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        editable={!submitting}
        testID="login-password"
      />

      {error ? (
        <Text style={styles.error} testID="login-error">
          {error}
        </Text>
      ) : null}

      {submitting ? (
        <ActivityIndicator testID="login-submitting" />
      ) : (
        <Button
          title={copy.auth.signInAction}
          onPress={() => void onSubmit()}
          disabled={!canSubmit}
          testID="login-submit"
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: "ClashGrotesk-Semibold",
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "ClashGrotesk-Regular",
    opacity: 0.7,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: "ClashGrotesk-Medium",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "ClashGrotesk-Regular",
    minHeight: 48,
  },
  back: {
    position: "absolute",
    left: 16,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
  },
  error: {
    color: "#b3261e",
    fontFamily: "ClashGrotesk-Regular",
    marginTop: 8,
  },
});

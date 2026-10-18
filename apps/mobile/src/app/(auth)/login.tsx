import { useState } from "react";
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, router } from "expo-router";

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
 * Staff sign-in (Step 0): email + password. No self-signup (ADR-021) —
 * accounts are provisioned by the org with an initial password +
 * `must_change_password`. A settled session never sees the form (decided
 * here, not as a push during render): armed sessions route to the
 * forced-change screen, clear-flag sessions to the index dispatch.
 */
export default function LoginScreen() {
  const { session, sessionPending, mustChangePassword, isFetched, refetchSession } =
    useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any settled session that reaches this screen is sent on: armed → set the
  // password first (2026-10-17 walk: without this branch an armed session
  // bounced here by the post-sign-in settle window dead-ended on an empty
  // form); clear flag → the index dispatch decides shell/kind.
  if (!sessionPending && session && isFetched) {
    return <Redirect href={mustChangePassword ? "/change-password" : "/"} />;
  }

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

  const canSubmit =
    email.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <View style={styles.container}>
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
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  error: {
    color: "#b3261e",
    marginTop: 8,
  },
});

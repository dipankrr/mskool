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

import { authClient, changePassword } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { looksTechnical } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { useMe } from "../../hooks/use-me";

/**
 * Forced password change (Step 0, ADR-007 rider). Requires a session — of
 * either kind — and is harmless if the flag is already clear (the change
 * verifies the current password). After the change, session + `me.get` are
 * refetched before routing; a local "changed" flag is never trusted.
 */
export default function ChangePasswordScreen() {
  const { session, sessionPending } = useMe();
  const utils = trpc.useUtils();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sessionPending && !session) {
    return <Redirect href="/login" />;
  }

  async function onSubmit() {
    if (submitting) return;
    if (newPassword !== confirmPassword) {
      setError(copy.auth.passwordMismatch);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await changePassword(currentPassword, newPassword);
      if (result.error) {
        const message =
          result.error.message && !looksTechnical(result.error.message)
            ? result.error.message
            : copy.errors.invalid;
        setError(message);
        return;
      }
      // The server route cleared must_change_password; pick that up from the
      // server before routing anywhere.
      await authClient.getSession();
      await utils.me.get.invalidate();
      router.replace("/");
    } catch (cause) {
      const message =
        cause instanceof Error && !looksTechnical(cause.message)
          ? cause.message
          : copy.errors.network;
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !submitting;

  return (
    <View style={styles.container}>
      <Text style={styles.title} testID="change-password-title">
        {copy.auth.forcedChangeTitle}
      </Text>
      <Text style={styles.subtitle}>{copy.auth.forcedChangeBody}</Text>

      <Text style={styles.label}>{copy.auth.currentPasswordLabel}</Text>
      <TextInput
        style={styles.input}
        value={currentPassword}
        onChangeText={setCurrentPassword}
        secureTextEntry
        textContentType="password"
        editable={!submitting}
        testID="change-password-current"
      />

      <Text style={styles.label}>{copy.auth.newPasswordLabel}</Text>
      <TextInput
        style={styles.input}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        textContentType="newPassword"
        editable={!submitting}
        testID="change-password-new"
      />

      <Text style={styles.label}>{copy.auth.confirmPasswordLabel}</Text>
      <TextInput
        style={styles.input}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        textContentType="newPassword"
        editable={!submitting}
        testID="change-password-confirm"
      />

      {error ? (
        <Text style={styles.error} testID="change-password-error">
          {error}
        </Text>
      ) : null}

      {submitting ? (
        <ActivityIndicator testID="change-password-submitting" />
      ) : (
        <Button
          title={copy.auth.changeAction}
          onPress={() => void onSubmit()}
          disabled={!canSubmit}
          testID="change-password-submit"
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

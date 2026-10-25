import { useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";

import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ScreenFrame } from "../../components/screen-frame";
import { ThemedText } from "../../components/themed-text";
import { authClient, changePassword } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { looksTechnical } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { useMe } from "../../hooks/use-me";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";

/** The only voluntary return allowed; anything else falls back to Home. */
const RETURN_TO_PROFILE = "/profile";

/**
 * better-auth's refusal for a wrong *current* password is the bare string
 * "Invalid password", which reads like the new password is at fault. Map it to
 * field-specific copy; anything else keeps the generic mapping.
 */
const WRONG_CURRENT = /invalid password/i;

/**
 * Password change — two entries, one form.
 *
 * **Forced** (ADR-007 rider): `must_change_password` is set, the staff guard
 * routes here before the tabs, and the copy says the step cannot be skipped.
 * No back control is drawn: there is nowhere legitimate to go. Success returns
 * to the shell root.
 *
 * **Voluntary** (Step 1): opened from Profile with `returnTo=/profile`. A back
 * control appears, and success confirms before popping to the Profile already
 * in the stack — no duplicate screen, and the system back gesture behaves.
 * The allowlist keeps a hand-typed `returnTo` from steering navigation
 * anywhere unexpected; the server owns what the password may become either
 * way.
 *
 * A session — of either kind — is required. The form is harmless if the flag
 * is already clear: the change verifies the current password. After the
 * change, session + `me.get` are refetched before routing; a local "changed"
 * flag is never trusted.
 */
export default function ChangePasswordScreen() {
  const { session, sessionPending } = useMe();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const utils = trpc.useUtils();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!sessionPending && !session) {
    return <Redirect href="/login" />;
  }

  // Equality against the literal is the allowlist: it both validates the
  // param and keeps the typed-route `Href` literal intact (a `Set.has` check
  // would widen it back to `string`). More targets get their own typed map.
  const returnTo =
    params.returnTo === RETURN_TO_PROFILE ? RETURN_TO_PROFILE : null;
  const voluntary = returnTo !== null;

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
          result.error.message && WRONG_CURRENT.test(result.error.message)
            ? copy.auth.currentPasswordMismatch
            : result.error.message && !looksTechnical(result.error.message)
              ? result.error.message
              : copy.errors.invalid;
        setError(message);
        return;
      }
      // The server route cleared must_change_password; pick that up from the
      // server before routing anywhere.
      await authClient.getSession();
      await utils.me.get.invalidate();
      if (!voluntary) {
        router.replace("/");
        return;
      }
      Alert.alert(copy.auth.passwordChangedTitle, copy.auth.passwordChangedBody, [
        {
          text: copy.common.ok,
          onPress: () => {
            // Pushed from Profile: popping is the only move that cannot leave
            // a duplicate Profile below a replaced one.
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace(returnTo);
            }
          },
        },
      ]);
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
    <ScreenFrame
      title={
        voluntary ? copy.auth.voluntaryChangeTitle : copy.auth.forcedChangeTitle
      }
      titleTestID="change-password-title"
      meta={voluntary ? copy.auth.voluntaryChangeBody : copy.auth.forcedChangeBody}
      backAccessibilityLabel={
        voluntary ? copy.auth.backToProfile : undefined
      }
      backTestID="change-password-back"
    >
      <Card padless>
        <Field
          label={copy.auth.currentPasswordLabel}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          editable={!submitting}
          textContentType="password"
          testID="change-password-current"
          first
        />
        <Field
          label={copy.auth.newPasswordLabel}
          value={newPassword}
          onChangeText={setNewPassword}
          editable={!submitting}
          textContentType="newPassword"
          testID="change-password-new"
        />
        <Field
          label={copy.auth.confirmPasswordLabel}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          editable={!submitting}
          textContentType="newPassword"
          testID="change-password-confirm"
          onSubmitEditing={() => {
            if (canSubmit) void onSubmit();
          }}
        />
      </Card>

      {error ? (
        <ThemedText
          variant="body"
          color={colors.tone.critical.fg}
          style={styles.error}
          testID="change-password-error"
        >
          {error}
        </ThemedText>
      ) : null}

      <CapsuleButton
        title={
          voluntary ? copy.auth.changePasswordAction : copy.auth.changeAction
        }
        onPress={() => void onSubmit()}
        loading={submitting}
        disabled={!canSubmit}
        testID="change-password-submit"
        style={styles.submit}
      />
    </ScreenFrame>
  );
}

/** One labelled password field; the card supplies the divider between rows. */
function Field({
  label,
  value,
  onChangeText,
  editable,
  textContentType,
  testID,
  first,
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  textContentType: "password" | "newPassword";
  testID: string;
  first?: boolean;
  onSubmitEditing?: () => void;
}) {
  return (
    <View style={[styles.field, first ? null : styles.divider]}>
      <ThemedText variant="meta">{label}</ThemedText>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        textContentType={textContentType}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        onSubmitEditing={onSubmitEditing}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  error: {
    marginTop: spacing.sm,
  },
  submit: {
    alignSelf: "stretch",
    marginTop: spacing.lg,
  },
});

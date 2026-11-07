import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import type { TextInput } from "react-native";
import { useTranslation } from "react-i18next";

import { loginByPhone } from "../../lib/auth";
import { Enter } from "../motion";
import { FamilyThemeProvider, useFamilyTheme } from "../theme";
import { FButton, FMascot, FScreen, FText, FTextField } from "../ui";
import {
  accountStatus,
  claim,
  dobToIso,
  formatPhone,
  isPhone,
  maskDob,
  MIN_PASSWORD,
  phoneDigits,
} from "../lib/sign-in";

type Step = "phone" | "password" | "setup" | "reset";

/**
 * Parent and student sign-in (ADR-037): phone first, then the server says
 * password (a claimed login) or setup (first time). "Forgot password?" is the
 * same claim with the child's details. Every refusal is one uniform line.
 */
export function FamilyLogin({
  onSignedIn,
  onStaff,
}: {
  /** Settle the session and route on (the login route owns this). */
  onSignedIn: () => Promise<void>;
  onStaff: () => void;
}) {
  return (
    <FamilyThemeProvider>
      <Flow onSignedIn={onSignedIn} onStaff={onStaff} />
    </FamilyThemeProvider>
  );
}

function Flow({ onSignedIn, onStaff }: { onSignedIn: () => Promise<void>; onStaff: () => void }) {
  const { t } = useTranslation("auth");
  const theme = useFamilyTheme();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [admission, setAdmission] = useState("");
  const [dob, setDob] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ phone?: string; dob?: string; newPassword?: string }>({});
  const dobRef = useRef<TextInput>(null);
  const newPasswordRef = useRef<TextInput>(null);

  const digits = phoneDigits(phone);

  const reset = (next: Step) => {
    setError(null);
    setFieldErrors({});
    setPassword("");
    setNewPassword("");
    // A different phone may be a different family: the child’s details go too.
    if (next === "phone") {
      setAdmission("");
      setDob("");
    }
    setStep(next);
  };

  async function onContinue() {
    if (busy) return;
    if (!isPhone(phone)) {
      setFieldErrors({ phone: t("phoneInvalid") });
      return;
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const result = await accountStatus(digits);
    setBusy(false);
    if (result === "tooMany") return setError(t("tooMany"));
    if (result === "network") return setError(t("network"));
    setStep(result);
  }

  async function signIn(secret: string): Promise<boolean> {
    try {
      const result = await loginByPhone(digits, secret);
      if (result.error) {
        setError(result.error.status === 429 ? t("tooMany") : t("wrongPassword"));
        return false;
      }
      await onSignedIn();
      return true;
    } catch {
      setError(t("network"));
      return false;
    }
  }

  async function onPassword() {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    await signIn(password);
    setBusy(false);
  }

  async function onSetup() {
    if (busy) return;
    const iso = dobToIso(dob);
    const errors = {
      dob: iso ? undefined : t("dobInvalid"),
      newPassword: newPassword.length >= MIN_PASSWORD ? undefined : t("newPasswordInvalid"),
    };
    setFieldErrors(errors);
    if (!iso || errors.newPassword || admission.trim().length === 0) {
      if (admission.trim().length === 0) setError(t("detailsMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await claim({
      phone: digits,
      admissionNumber: admission.trim(),
      dateOfBirth: iso,
      password: newPassword,
    });
    if (!result.ok) {
      setBusy(false);
      const message = {
        mismatch: t("detailsMismatch"),
        tooMany: t("tooMany"),
        network: t("network"),
        password: t("newPasswordInvalid"),
      }[result.reason];
      setError(message);
      return;
    }
    await signIn(newPassword);
    setBusy(false);
  }

  const forNumber = t("forNumber", { phone: formatPhone(digits) });

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FScreen testID="family-login">
        <Enter style={[styles.hero, { gap: theme.space.md, paddingTop: theme.space.xxl }]}>
          <FMascot size={88} mood={step === "phone" ? "happy" : "calm"} />
          <FText variant={step === "phone" ? "display" : "title"}>
            {step === "phone"
              ? t("welcomeTitle")
              : step === "password"
                ? t("passwordTitle")
                : step === "setup"
                  ? t("setupTitle")
                  : t("resetTitle")}
          </FText>
          {step === "phone" ? (
            <FText variant="body" color="muted">
              {t("welcomeBody")}
            </FText>
          ) : (
            <View style={[styles.row, { gap: theme.space.sm }]}>
              <FText variant="meta" color="muted" style={styles.shrink}>
                {forNumber}
              </FText>
              <Pressable
                testID="family-login-change"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => reset("phone")}
              >
                <FText variant="meta" color="ink">
                  {t("changeNumber")}
                </FText>
              </Pressable>
            </View>
          )}
          {step === "setup" || step === "reset" ? (
            <FText variant="body" color="muted">
              {step === "setup" ? t("setupBody") : t("resetBody")}
            </FText>
          ) : null}
        </Enter>

        <View style={{ gap: theme.space.lg }}>
          {step === "phone" ? (
            <FTextField
              testID="family-login-phone"
              label={t("phoneLabel")}
              hint={t("phoneHint")}
              error={fieldErrors.phone}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              returnKeyType="next"
              onSubmitEditing={() => void onContinue()}
              editable={!busy}
              maxLength={16}
            />
          ) : null}

          {step === "password" ? (
            <>
              <FTextField
                testID="family-login-password"
                label={t("passwordLabel")}
                value={password}
                onChangeText={setPassword}
                secure={{ show: t("showPassword"), hide: t("hidePassword") }}
                textContentType="password"
                autoComplete="password"
                autoFocus
                returnKeyType="go"
                onSubmitEditing={() => void onPassword()}
                editable={!busy}
              />
              <Pressable
                testID="family-login-forgot"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => reset("reset")}
                style={styles.start}
              >
                <FText variant="label">{t("forgot")}</FText>
              </Pressable>
            </>
          ) : null}

          {step === "setup" || step === "reset" ? (
            <>
              <FTextField
                testID="family-login-admission"
                label={t("admissionLabel")}
                hint={t("admissionHint")}
                value={admission}
                onChangeText={setAdmission}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => dobRef.current?.focus()}
                editable={!busy}
              />
              <FTextField
                ref={dobRef}
                testID="family-login-dob"
                label={t("dobLabel")}
                placeholder={t("dobHint")}
                error={fieldErrors.dob}
                value={dob}
                onChangeText={(value) => setDob(maskDob(value))}
                keyboardType="number-pad"
                returnKeyType="next"
                onSubmitEditing={() => newPasswordRef.current?.focus()}
                editable={!busy}
              />
              <FTextField
                ref={newPasswordRef}
                testID="family-login-new-password"
                label={t("newPasswordLabel")}
                hint={t("newPasswordHint")}
                error={fieldErrors.newPassword}
                value={newPassword}
                onChangeText={setNewPassword}
                secure={{ show: t("showPassword"), hide: t("hidePassword") }}
                textContentType="newPassword"
                autoComplete="password-new"
                returnKeyType="go"
                onSubmitEditing={() => void onSetup()}
                editable={!busy}
              />
            </>
          ) : null}

          {error ? (
            <FText testID="family-login-error" variant="meta" color="critical" accessibilityLiveRegion="polite">
              {error}
            </FText>
          ) : null}

          <FButton
            testID="family-login-submit"
            block
            loading={busy}
            label={
              step === "phone"
                ? t("continue")
                : step === "password"
                  ? t("signIn")
                  : step === "setup"
                    ? t("setupAction")
                    : t("resetAction")
            }
            onPress={() =>
              void (step === "phone" ? onContinue() : step === "password" ? onPassword() : onSetup())
            }
          />
        </View>

        {step === "phone" ? (
          <View style={[styles.staff, { gap: theme.space.sm, paddingTop: theme.space.xl }]}>
            <FText variant="meta" color="muted" align="center">
              {t("staffTitle")}
            </FText>
            <FButton
              testID="family-login-staff"
              variant="secondary"
              block
              icon="school"
              label={t("staffAction")}
              onPress={onStaff}
            />
          </View>
        ) : null}
      </FScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  hero: {
    alignItems: "flex-start",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  shrink: {
    flexShrink: 1,
  },
  start: {
    alignSelf: "flex-start",
  },
  staff: {
    alignItems: "stretch",
  },
});

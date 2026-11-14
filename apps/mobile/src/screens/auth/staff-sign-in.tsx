import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ThemedText } from "../../components/themed-text";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { formatPhone, phoneDigits } from "../../family/lib/sign-in";
import {
  joinWithCode,
  STAFF_MIN_PASSWORD,
  staffAccountState,
  staffLogin,
} from "../../lib/staff-sign-in";

type Step = "phone" | "password" | "code" | "newPassword";

const COPY = {
  title: "Staff sign in",
  phoneLead: "Use the phone number your school has for you.",
  phoneLabel: "Phone number",
  continue: "Continue",
  newHere: "New here? Your school office gives you a joining code. We'll ask for it next.",
  welcomeBack: "Welcome back",
  change: "Change",
  passwordLabel: "Password",
  signIn: "Sign in",
  forgot: "Forgot it? Ask your school office for a new code. You'll set a new password with it.",
  haveCode: "I have a code from the office",
  codeTitle: "Enter your code",
  codeLead: "The 6-digit code your school office sent you.",
  codeHint: "A code works once and lasts 7 days",
  next: "Next",
  newPasswordTitle: "Choose a password",
  newPasswordLead: "You'll use it with your phone number every time.",
  newPasswordLabel: "New password",
  againLabel: "Type it again",
  ruleLength: `${STAFF_MIN_PASSWORD} or more characters`,
  ruleNumber: "At least one number",
  ruleMatch: "Both match",
  setPassword: "Set password",
  badPhone: "A phone number is 10 digits.",
  wrongPassword: "That password doesn't match this phone number.",
  badCode:
    "That code doesn't match this phone number, or it has expired. Ask your school office for a new code.",
  tooMany: "Too many tries. Wait a while, then try again.",
  network: "Couldn't reach the school. Check your connection and try again.",
  passwordRule: `Use at least ${STAFF_MIN_PASSWORD} characters.`,
} as const;

/**
 * Staff sign-in (ADR-068, frames 01–03): phone first; the server answers
 * `password` for someone who has joined and `code` for everyone else. The
 * code step leads to choosing a password, then signs straight in. A joining
 * code is also the forgot-password path. No email anywhere.
 */
export function StaffSignIn({
  onBack,
  onSignedIn,
}: {
  onBack: () => void;
  /** Settles the session and routes on; `firstJoin` opens the welcome. */
  onSignedIn: (firstJoin: boolean) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const againRef = useRef<TextInput>(null);

  const digits = phoneDigits(phone);
  const phoneOk = digits.length === 10;

  const goto = (next: Step) => {
    setError(null);
    setStep(next);
  };

  const back = () => {
    if (busy) return;
    if (step === "phone") onBack();
    else if (step === "newPassword") goto("code");
    else goto("phone");
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => sub.remove();
  });

  async function onContinue() {
    if (!phoneOk) {
      setError(COPY.badPhone);
      return;
    }
    setBusy(true);
    setError(null);
    const state = await staffAccountState(digits);
    setBusy(false);
    if (state === "tooMany") setError(COPY.tooMany);
    else if (state === "network") setError(COPY.network);
    else goto(state);
  }

  async function onPassword() {
    setBusy(true);
    setError(null);
    try {
      const result = await staffLogin(digits, password);
      if (result.error) {
        setError(COPY.wrongPassword);
        return;
      }
      await onSignedIn(false);
    } catch {
      setError(COPY.network);
    } finally {
      setBusy(false);
    }
  }

  const rules = {
    length: newPassword.length >= STAFF_MIN_PASSWORD,
    number: /\d/.test(newPassword),
    match: newPassword.length > 0 && newPassword === again,
  };

  async function onSetPassword() {
    if (!rules.length) {
      setError(COPY.passwordRule);
      return;
    }
    setBusy(true);
    setError(null);
    const joined = await joinWithCode({ phone: digits, code, password: newPassword });
    if (!joined.ok) {
      setBusy(false);
      if (joined.reason === "mismatch") {
        setError(COPY.badCode);
        setStep("code");
      } else if (joined.reason === "password") setError(COPY.passwordRule);
      else if (joined.reason === "tooMany") setError(COPY.tooMany);
      else setError(COPY.network);
      return;
    }
    try {
      const result = await staffLogin(digits, newPassword);
      if (result.error) {
        setError(COPY.network);
        return;
      }
      await onSignedIn(joined.firstJoin);
    } catch {
      setError(COPY.network);
    } finally {
      setBusy(false);
    }
  }

  const primary =
    step === "phone"
      ? { title: COPY.continue, onPress: onContinue, enabled: phoneOk }
      : step === "password"
        ? { title: COPY.signIn, onPress: onPassword, enabled: password.length > 0 }
        : step === "code"
          ? { title: COPY.next, onPress: () => goto("newPassword"), enabled: code.length === 6 }
          : {
              title: COPY.setPassword,
              onPress: onSetPassword,
              enabled: rules.length && rules.match,
            };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.wash, { height: 260 + insets.top }]} pointerEvents="none" />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + spacing.sm }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          testID="staff-signin-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          onPress={back}
          style={styles.back}
        >
          <AppIcon name="chevronLeft" size={24} color={colors.accentDeep} />
        </Pressable>

        {step === "phone" ? (
          <>
            <View style={styles.mark}>
              <AppIcon name="school" size={28} color={colors.onAccent} />
            </View>
            <ThemedText variant="hero" style={styles.heading}>
              {COPY.title}
            </ThemedText>
            <ThemedText variant="body" style={styles.lead}>
              {COPY.phoneLead}
            </ThemedText>
            <Field label={COPY.phoneLabel}>
              <View style={[styles.input, styles.inputOn]}>
                <ThemedText variant="bodyStrong" style={styles.prefix}>
                  +91
                </ThemedText>
                <TextInput
                  testID="staff-phone"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  autoFocus
                  maxLength={14}
                  placeholder="98765 43210"
                  placeholderTextColor={colors.chevron}
                  style={styles.inputText}
                  onSubmitEditing={() => void onContinue()}
                  returnKeyType="next"
                  accessibilityLabel={COPY.phoneLabel}
                />
              </View>
            </Field>
          </>
        ) : null}

        {step === "password" ? (
          <>
            <ThemedText variant="hero" style={styles.heading}>
              {COPY.welcomeBack}
            </ThemedText>
            <PhoneLine digits={digits} onChange={() => goto("phone")} />
            <Field label={COPY.passwordLabel}>
              <View style={[styles.input, styles.inputOn]}>
                <AppIcon name="lock" size={18} color={colors.muted} />
                <TextInput
                  testID="staff-password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoFocus
                  textContentType="password"
                  autoComplete="password"
                  style={styles.inputText}
                  onSubmitEditing={() => void onPassword()}
                  returnKeyType="go"
                  accessibilityLabel={COPY.passwordLabel}
                />
              </View>
            </Field>
            <View style={styles.info}>
              <AppIcon name="key" size={18} color={colors.tone.neutral.fg} />
              <ThemedText variant="meta" style={styles.infoText}>
                {COPY.forgot}
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => goto("code")}
              hitSlop={8}
              style={styles.linkRow}
            >
              <ThemedText variant="bodyStrong" style={styles.link}>
                {COPY.haveCode}
              </ThemedText>
            </Pressable>
          </>
        ) : null}

        {step === "code" ? (
          <>
            <StepDots at={0} />
            <ThemedText variant="title" style={styles.heading}>
              {COPY.codeTitle}
            </ThemedText>
            <ThemedText variant="body" style={styles.lead}>
              {COPY.codeLead}
            </ThemedText>
            <PhoneLine digits={digits} onChange={() => goto("phone")} />
            <CodeBoxes value={code} onChange={setCode} />
            <View style={styles.hint}>
              <AppIcon name="clock" size={14} color={colors.muted} />
              <ThemedText variant="meta">{COPY.codeHint}</ThemedText>
            </View>
          </>
        ) : null}

        {step === "newPassword" ? (
          <>
            <StepDots at={1} />
            <ThemedText variant="title" style={styles.heading}>
              {COPY.newPasswordTitle}
            </ThemedText>
            <ThemedText variant="body" style={styles.lead}>
              {COPY.newPasswordLead}
            </ThemedText>
            <Field label={COPY.newPasswordLabel}>
              <View style={[styles.input, styles.inputOn]}>
                <AppIcon name="lock" size={18} color={colors.muted} />
                <TextInput
                  testID="staff-new-password"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoFocus
                  textContentType="newPassword"
                  autoComplete="new-password"
                  style={styles.inputText}
                  returnKeyType="next"
                  onSubmitEditing={() => againRef.current?.focus()}
                  accessibilityLabel={COPY.newPasswordLabel}
                />
              </View>
            </Field>
            <Field label={COPY.againLabel}>
              <View style={styles.input}>
                <AppIcon name="lock" size={18} color={colors.muted} />
                <TextInput
                  ref={againRef}
                  testID="staff-new-password-again"
                  value={again}
                  onChangeText={setAgain}
                  secureTextEntry
                  textContentType="newPassword"
                  style={styles.inputText}
                  returnKeyType="go"
                  onSubmitEditing={() => void onSetPassword()}
                  accessibilityLabel={COPY.againLabel}
                />
              </View>
            </Field>
            <View style={styles.rules}>
              <Rule done={rules.length} label={COPY.ruleLength} />
              <Rule done={rules.number} label={COPY.ruleNumber} />
              <Rule done={rules.match} label={COPY.ruleMatch} />
            </View>
          </>
        ) : null}

        {error ? (
          <View style={styles.error} accessibilityLiveRegion="polite">
            <AppIcon name="warningCircle" size={18} color={colors.tone.critical.fg} />
            <ThemedText variant="meta" style={styles.errorText} testID="staff-signin-error">
              {error}
            </ThemedText>
          </View>
        ) : null}

        <CapsuleButton
          testID="staff-signin-primary"
          title={primary.title}
          onPress={() => void primary.onPress()}
          disabled={!primary.enabled || busy}
          loading={busy}
          style={styles.cta}
        />
        {step === "phone" ? (
          <ThemedText variant="meta" style={styles.newHere}>
            {COPY.newHere}
          </ThemedText>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText variant="caption" style={styles.label}>
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

function PhoneLine({ digits, onChange }: { digits: string; onChange: () => void }) {
  return (
    <View style={styles.phoneLine}>
      <ThemedText variant="body" style={styles.muted}>
        +91 {formatPhone(digits)}
      </ThemedText>
      <Pressable accessibilityRole="button" onPress={onChange} hitSlop={8}>
        <ThemedText variant="bodyStrong" style={styles.link}>
          Change
        </ThemedText>
      </Pressable>
    </View>
  );
}

function StepDots({ at }: { at: 0 | 1 }) {
  return (
    <View style={styles.dots} accessibilityLabel={`Step ${at + 1} of 2`}>
      <View style={[styles.dot, at === 0 ? styles.dotOn : null]} />
      <View style={[styles.dot, at === 1 ? styles.dotOn : null]} />
    </View>
  );
}

function Rule({ done, label }: { done: boolean; label: string }) {
  return (
    <View style={styles.rule}>
      <View style={[styles.ruleMark, done ? styles.ruleDone : null]}>
        {done ? <AppIcon name="check" size={12} color={colors.onAccent} /> : null}
      </View>
      <ThemedText variant="body" style={done ? undefined : styles.muted}>
        {label}
      </ThemedText>
    </View>
  );
}

/** Six boxes over one hidden numeric input, so paste and autofill still work. */
function CodeBoxes({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const ref = useRef<TextInput>(null);
  return (
    <Pressable
      onPress={() => ref.current?.focus()}
      accessibilityRole="none"
      style={styles.codeRow}
    >
      {Array.from({ length: 6 }, (_, i) => {
        const on = i === Math.min(value.length, 5);
        return (
          <View key={i} style={[styles.codeBox, on ? styles.codeBoxOn : null]}>
            <ThemedText variant="title" style={styles.codeDigit}>
              {value[i] ?? ""}
            </ThemedText>
          </View>
        );
      })}
      <TextInput
        ref={ref}
        testID="staff-code"
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        style={styles.codeHidden}
        accessibilityLabel="Joining code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  wash: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: colors.accentTint,
    opacity: 0.6,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.huge, gap: spacing.md },
  back: { minWidth: 44, minHeight: 44, justifyContent: "center", marginLeft: -spacing.xs },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  heading: { marginTop: spacing.sm },
  lead: { color: colors.muted, marginTop: -spacing.xs },
  muted: { color: colors.muted },
  field: { gap: spacing.xs, marginTop: spacing.sm },
  label: { color: colors.muted, marginLeft: spacing.xs },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputLine,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  inputOn: { borderWidth: 2, borderColor: colors.accent },
  prefix: {
    paddingRight: spacing.sm,
    borderRightWidth: 1,
    borderRightColor: colors.inputLine,
  },
  inputText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.callout,
    color: colors.ink,
    paddingVertical: spacing.md,
  },
  phoneLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  link: { color: colors.accentDeep },
  linkRow: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  info: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    marginTop: spacing.sm,
  },
  infoText: { flex: 1, color: colors.ink },
  dots: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm },
  dot: { width: 22, height: 5, borderRadius: 99, backgroundColor: colors.chip },
  dotOn: { width: 34, backgroundColor: colors.accent },
  codeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  codeBox: {
    width: 46,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.inputLine,
    alignItems: "center",
    justifyContent: "center",
  },
  codeBoxOn: { borderWidth: 2, borderColor: colors.accent },
  codeDigit: { fontVariant: ["tabular-nums"] },
  codeHidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
  hint: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
  },
  rules: { gap: spacing.sm, marginTop: spacing.sm },
  rule: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ruleMark: {
    width: 20,
    height: 20,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  ruleDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  error: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.critical.bg,
  },
  errorText: { flex: 1, color: colors.tone.critical.fg },
  cta: { marginTop: spacing.lg },
  newHere: { textAlign: "center", paddingHorizontal: spacing.lg },
});

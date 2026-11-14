import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Share, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { formatPhone } from "../../family/lib/sign-in";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";

/** "21 Nov" in the school's time. */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

/** The WhatsApp message, written for the person who receives it. */
export function inviteMessage(input: {
  firstName: string;
  organizationName: string;
  phone: string;
  code: string;
  expiresAt: string;
  resetsPassword: boolean;
}): string {
  const until = shortDate(input.expiresAt);
  if (input.resetsPassword) {
    return [
      `Hi ${input.firstName}, here is your code to set a new password on the ${input.organizationName} app.`,
      `Open the app, tap I'm staff, enter ${formatPhone(input.phone)}, then tap "I have a code from the office".`,
      `Code: ${input.code} (works once, till ${until}).`,
    ].join("\n");
  }
  return [
    `Hi ${input.firstName}, you've been added to ${input.organizationName} on the school app.`,
    `1. Install the app and tap I'm staff`,
    `2. Enter your phone ${formatPhone(input.phone)}`,
    `3. Enter the code ${input.code}`,
    `The code works once, till ${until}.`,
  ].join("\n");
}

/**
 * Invite (ADR-068, frame 07): issues a fresh joining code (the server revokes
 * any older one), shows it once, and hands it on — WhatsApp with the message
 * written, or the phone's share sheet. Also the forgot-password path: a new
 * code lets someone who joined set a new password.
 */
export function InviteSheet({
  organizationId,
  staffId,
  name,
  onClose,
}: {
  organizationId: string;
  staffId: string;
  name: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const invite = trpc.staff.invite.useMutation({
    onSuccess: () => void utils.staff.list.invalidate(),
  });
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    invite.mutate({ organizationId, id: staffId });
    // One code per open of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = invite.data;
  const message = data ? inviteMessage(data) : "";

  async function whatsapp() {
    if (!data) return;
    setShareError(null);
    const url = `whatsapp://send?phone=91${data.phone}&text=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else await Share.share({ message });
    } catch (cause) {
      setShareError(thrownMessage(cause));
    }
  }

  return (
    <FormSheet
      title={data?.resetsPassword ? `New code for ${name}` : `Invite ${name}`}
      onClose={onClose}
      testIDPrefix="invite"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title="Share on WhatsApp"
            icon="whatsapp"
            onPress={() => void whatsapp()}
            disabled={!data}
            testID="invite-whatsapp"
          style={{ alignSelf: "stretch" }}
          />
          <CapsuleButton
            title="Share code another way"
            icon="share"
            variant="secondary"
            size="compact"
            onPress={() => void Share.share({ message })}
            disabled={!data}
            testID="invite-share"
          style={{ alignSelf: "stretch" }}
          />
        </View>
      }
    >
      {invite.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : invite.isError ? (
        <View style={styles.error}>
          <AppIcon name="warningCircle" size={18} color={colors.tone.critical.fg} />
          <ThemedText variant="meta" style={styles.errorText}>
            {thrownMessage(invite.error)}
          </ThemedText>
        </View>
      ) : data ? (
        <View style={styles.body}>
          <ThemedText variant="meta">
            {data.resetsPassword
              ? `They set a new password with ${formatPhone(data.phone)} and this code.`
              : `They join with ${formatPhone(data.phone)} and this code.`}
          </ThemedText>
          <View style={styles.code} accessibilityLabel={`Code ${data.code.split("").join(" ")}`}>
            {data.code.split("").map((digit, i) => (
              <View key={i} style={styles.digit}>
                <ThemedText variant="hero" style={styles.digitText}>
                  {digit}
                </ThemedText>
              </View>
            ))}
          </View>
          <View style={styles.facts}>
            <Fact icon="clock" label={`Valid till ${shortDate(data.expiresAt)}`} />
            <Fact icon="lock" label="Works once" />
          </View>
          <View style={styles.preview}>
            <ThemedText variant="meta" style={styles.previewText}>
              {message}
            </ThemedText>
          </View>
          {shareError ? (
            <ThemedText variant="meta" style={styles.errorText}>
              {shareError}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
    </FormSheet>
  );
}

function Fact({ icon, label }: { icon: "clock" | "lock"; label: string }) {
  return (
    <View style={styles.fact}>
      <AppIcon name={icon} size={14} color={colors.tone.neutral.fg} />
      <ThemedText variant="caption" style={styles.factText}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: spacing.xxl, alignItems: "center" },
  body: { gap: spacing.md },
  code: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xs },
  digit: {
    width: 44,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  digitText: { color: colors.accentDeep, fontVariant: ["tabular-nums"] },
  facts: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 26,
    paddingHorizontal: spacing.sm + 1,
    borderRadius: 999,
    backgroundColor: colors.tone.neutral.bg,
  },
  factText: { color: colors.tone.neutral.fg },
  preview: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderBottomLeftRadius: 4,
    backgroundColor: "#E7F8EC",
  },
  previewText: { color: "#1E3A2A", lineHeight: 19 },
  footer: { gap: spacing.sm },
  error: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.critical.bg,
  },
  errorText: { flex: 1, color: colors.tone.critical.fg },
});

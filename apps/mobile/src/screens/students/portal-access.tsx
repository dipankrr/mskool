import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { StatusPill } from "../../components/status-pill";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { guardianRelationLabel } from "./people-logic";

type PortalStatus = inferRouterOutputs<AppRouter>["portalAccess"]["status"][number];
type GuardianRow = inferRouterOutputs<AppRouter>["guardian"]["list"][number];

/**
 * The family's portal link (Step 2 chunk C, ADR-037): the staff side creates
 * and revokes LINKS — never accounts, never passwords. A pending link is
 * claimed from home with the phone, the student's admission number and date
 * of birth; the screen says so because the missing-password state is the
 * design, not a defect.
 */
export function PortalAccessScreen() {
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { organizationId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canActivate = has("portal_access:activate");
  const canRevoke = has("portal_access:change_phone");

  const [guardianSheetOpen, setGuardianSheetOpen] = useState(false);
  const [selectedGuardianId, setSelectedGuardianId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [linkError, setLinkError] = useState<unknown>(null);
  const [revokeError, setRevokeError] = useState<unknown>(null);
  const [linking, setLinking] = useState(false);
  const [revokingUserId, setRevokingUserId] = useState<string | null>(null);

  const status = trpc.portalAccess.status.useQuery(
    { organizationId: organizationId ?? "", studentId: studentId ?? "" },
    { enabled: ready && Boolean(organizationId) && canActivate && Boolean(studentId) },
  );
  const guardians = trpc.guardian.list.useQuery(
    { organizationId: organizationId ?? "", id: studentId ?? "" },
    { enabled: ready && Boolean(organizationId) && canActivate && Boolean(studentId) },
  );

  const utils = trpc.useUtils();
  const ensureLink = trpc.portalAccess.ensureLink.useMutation();
  const revokeLink = trpc.portalAccess.revokeLink.useMutation();

  const selectedGuardian: GuardianRow | null =
    (guardians.data ?? []).find((row) => row.id === selectedGuardianId) ?? null;

  const link = async () => {
    setLinkError(null);
    if (!organizationId || !studentId || !selectedGuardianId) {
      setLinkError(new Error(copy.people.portal.errors.guardian));
      return;
    }
    if (!/^\d{10}$/.test(phone.trim())) {
      setLinkError(new Error(copy.people.portal.errors.phone));
      return;
    }
    setLinking(true);
    try {
      await ensureLink.mutateAsync({
        organizationId,
        studentId,
        phone: phone.trim(),
        guardianId: selectedGuardianId,
      });
      await utils.portalAccess.status.invalidate({ studentId });
      setGuardianSheetOpen(false);
      setSelectedGuardianId(null);
      setPhone("");
    } catch (error) {
      setLinkError(error);
    } finally {
      setLinking(false);
    }
  };

  const confirmRevoke = (row: PortalStatus) => {
    Alert.alert(copy.people.portal.revokeConfirmTitle, copy.people.portal.revokeConfirmBody, [
      { text: copy.common.cancel, style: "cancel" },
      {
        text: copy.people.portal.revokeConfirm,
        style: "destructive",
        onPress: () => void revoke(row),
      },
    ]);
  };

  const revoke = async (row: PortalStatus) => {
    if (!organizationId || !studentId) return;
    setRevokeError(null);
    setRevokingUserId(row.userId);
    try {
      await revokeLink.mutateAsync({
        organizationId,
        studentId,
        userId: row.userId,
      });
      await utils.portalAccess.status.invalidate({ studentId });
    } catch (error) {
      setRevokeError(error);
    } finally {
      setRevokingUserId(null);
    }
  };

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.people.portal.title}
      meta={copy.people.portal.detail}
      backAccessibilityLabel={copy.common.back}
      titleTestID="portal-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!ready || !organizationId) {
    return frame(<Skeleton height={220} />);
  }

  if (!canActivate) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.people.deniedPortalTitle}
        message={copy.people.deniedPortalBody}
        testID="portal-denied"
      />,
    );
  }

  if (status.isPending) {
    return frame(
      <View style={styles.skeleton} accessibilityLabel={copy.people.loading}>
        <Skeleton height={28} width="52%" />
        <Skeleton height={120} />
      </View>,
    );
  }

  if (status.isError) {
    return frame(
      <ErrorCard
        cause={status.error}
        onRetry={() => void status.refetch()}
        testID="portal-error"
      />,
    );
  }

  const rows = status.data ?? [];

  return frame(
    <View style={styles.body}>
      <SectionLabel>{copy.people.portal.statusLabel}</SectionLabel>
      {rows.length === 0 ? (
        <Card>
          <ThemedText variant="meta">
            {copy.people.portal.emptyTitle} — {copy.people.portal.emptyBody}
          </ThemedText>
        </Card>
      ) : (
        <Card padless>
          {rows.map((row, index) => (
            <View
              key={row.userId}
              style={styles.row}
              testID={`portal-row-${index}`}
            >
              <View style={styles.rowText}>
                <ThemedText variant="name" numberOfLines={1}>
                  {row.username}
                </ThemedText>
                <ThemedText variant="meta">
                  {row.isActive
                    ? copy.people.portal.active
                    : row.revokedAt
                      ? copy.people.portal.revoked
                      : copy.people.portal.pending}
                  {" · "}
                  {row.hasCredential
                    ? copy.people.portal.hasCredential
                    : copy.people.portal.noCredential}
                </ThemedText>
              </View>
              {row.isActive && canRevoke ? (
                <CapsuleButton
                  title={copy.people.portal.revokeAction}
                  variant="destructive"
                  size="compact"
                  onPress={() => confirmRevoke(row)}
                  loading={revokingUserId === row.userId}
                  testID={`portal-revoke-${index}`}
                />
              ) : (
                <StatusPill
                  label={row.isActive ? copy.people.portal.active : copy.people.portal.pending}
                  tone={row.isActive ? "positive" : "neutral"}
                />
              )}
            </View>
          ))}
        </Card>
      )}

      {revokeError ? (
        <Notice
          tone="critical"
          message={toFriendlyError(revokeError).message}
          testID="portal-revoke-error"
        />
      ) : null}

      <SectionLabel>{copy.people.portal.add}</SectionLabel>
      <Card style={styles.card}>
        <Notice tone="neutral" message={copy.people.portal.addBody} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${copy.people.portal.guardianLabel}, ${selectedGuardian ? guardianName(selectedGuardian) : copy.people.portal.errors.guardian}`}
          accessibilityHint={copy.people.portal.guardianLabel}
          onPress={() => setGuardianSheetOpen(true)}
          style={({ pressed }) => [styles.picker, pressed ? styles.pickerPressed : null]}
          testID="portal-guardian-picker"
        >
          <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.pickerText}>
            {selectedGuardian
              ? `${guardianName(selectedGuardian)} · ${guardianRelationLabel(selectedGuardian.relation)}`
              : copy.people.portal.guardianLabel}
          </ThemedText>
          <AppIcon name="chevronDown" size={18} color={colors.muted} />
        </Pressable>
        <FormField
          label={copy.people.portal.phoneLabel}
          value={phone}
          onChangeText={(next) => setPhone(next.replace(/\D/g, ""))}
          placeholder={copy.people.portal.phonePlaceholder}
          keyboardType="phone-pad"
          maxLength={10}
          testID="portal-phone"
        />
        {linkError ? (
          <Notice
            tone="critical"
            message={toFriendlyError(linkError).message}
            testID="portal-link-error"
          />
        ) : null}
        <CapsuleButton
          title={copy.people.portal.add}
          icon="check"
          onPress={() => void link()}
          loading={linking}
          disabled={linking}
          testID="portal-link"
        />
      </Card>

      <ChoiceSheet
        visible={guardianSheetOpen}
        title={copy.people.portal.guardianLabel}
        options={(guardians.data ?? []).map((row) => ({
          id: row.id,
          label: guardianName(row),
          detail: `${guardianRelationLabel(row.relation)} · ${row.phone}`,
        }))}
        currentId={selectedGuardianId ?? ""}
        onSelect={(id) => {
          setSelectedGuardianId(id || null);
          const guardian = (guardians.data ?? []).find((row) => row.id === id);
          if (guardian) setPhone(guardian.phone);
          setGuardianSheetOpen(false);
        }}
        onDismiss={() => setGuardianSheetOpen(false)}
        testIDPrefix="portal-guardian"
      />
    </View>,
  );
}

function guardianName(row: GuardianRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(" ");
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
  },
  card: {
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: spacing.xxs,
  },
  picker: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.field,
  },
  pickerPressed: {
    backgroundColor: colors.chip,
  },
  pickerText: {
    flex: 1,
  },
});

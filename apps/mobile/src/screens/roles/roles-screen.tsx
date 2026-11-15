import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { ErrorCard } from "../../components/error-card";
import { FormSheet } from "../../components/form-sheet";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { OFFICE_ROLES, roleLabel } from "../staff/role-logic";
import { StaffAvatar } from "../staff/staff-photo";

const TEACHING = [
  { type: "class_teacher", label: "Class teacher", short: "Given by Teaching, per section" },
  { type: "subject_teacher", label: "Subject teacher", short: "Given by Teaching, per section" },
] as const;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * Roles (frames R9 and R17): roles ending in the next or last 7 days, then
 * each role with who holds it. A tap opens what the role can do (R19-R24).
 * Teaching roles are listed so what they can do can be read or changed;
 * who holds them is Teaching's business.
 */
export function RolesScreen() {
  const { organizationId, schoolId } = useActiveContext();
  const { has } = usePermissions();
  const orgId = organizationId ?? "";
  const holders = trpc.role.holders.useQuery(
    { organizationId: orgId },
    { enabled: Boolean(organizationId) && has("role_permission:read") },
  );
  const ending = trpc.role.ending.useQuery(
    { organizationId: orgId, forSchoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) && has("role_assignment:read") },
  );
  // Read once: a render must not read the clock (react-hooks/purity).
  const [now] = useState(() => Date.now());
  const [extending, setExtending] = useState<{ id: string; name: string; role: string; expiresAt: string } | null>(null);

  const byRole = new Map<string, { staffId: string; name: string }[]>();
  for (const h of holders.data ?? []) {
    const list = byRole.get(h.roleType) ?? [];
    if (!list.some((x) => x.staffId === h.staffId)) list.push({ staffId: h.staffId, name: h.name });
    byRole.set(h.roleType, list);
  }

  return (
    <ScreenFrame title="Roles" meta="The same at every branch" backAccessibilityLabel="Back">
      {(ending.data?.length ?? 0) > 0 ? (
        <View style={[styles.card, styles.ending]} testID="roles-ending">
          <View style={styles.endingHead}>
            <AppIcon name="clock" size={18} color={colors.tone.caution.fg} />
            <ThemedText variant="bodyStrong">Ending soon</ThemedText>
          </View>
          {ending.data!.map((e) => {
            const ended = new Date(e.expiresAt).getTime() <= now;
            return (
              <View key={e.id} style={styles.endRow}>
                <View style={styles.grow}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {e.name} · {roleLabel(e.roleType)}
                  </ThemedText>
                  <ThemedText variant="meta">
                    {ended ? `Ended ${shortDate(e.expiresAt)}` : `Ends ${shortDate(e.expiresAt)}`}
                  </ThemedText>
                </View>
                {has("role_assignment:assign") ? (
                  <CapsuleButton
                    title={ended ? "Give again" : "Extend"}
                    variant="secondary"
                    size="compact"
                    onPress={() => setExtending({ id: e.id, name: e.name, role: roleLabel(e.roleType), expiresAt: e.expiresAt })}
                    testID={`roles-extend-${e.id}`}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {!has("role_permission:read") ? (
        <ThemedText variant="meta" style={styles.note}>
          You can see roles on each person’s profile.
        </ThemedText>
      ) : holders.isPending ? (
        <Skeleton height={300} />
      ) : holders.isError ? (
        <ErrorCard cause={holders.error} onRetry={() => void holders.refetch()} />
      ) : (
        <>
          <ThemedText variant="sectionLabel" style={styles.label}>
            Office roles
          </ThemedText>
          <View style={styles.card}>
            {OFFICE_ROLES.map((role, i) => {
              const people = byRole.get(role.type) ?? [];
              return (
                <RoleRow
                  key={role.type}
                  first={i === 0}
                  icon={<AppIcon name={role.icon} size={20} color={role.fg} />}
                  bg={role.bg}
                  title={role.label}
                  line={
                    people.length === 0 ? "Nobody" : people.length === 1 ? people[0]!.name : `${people.length} people`
                  }
                  nobody={people.length === 0 && role.type === "principal"}
                  people={people}
                  onPress={() => router.push({ pathname: "/role", params: { type: role.type } })}
                  testID={`roles-${role.type}`}
                />
              );
            })}
          </View>
          <ThemedText variant="sectionLabel" style={styles.label}>
            Teaching roles
          </ThemedText>
          <View style={styles.card}>
            {TEACHING.map((role, i) => (
              <RoleRow
                key={role.type}
                first={i === 0}
                icon={<AppIcon name="school" size={20} color={colors.accentDeep} />}
                bg={colors.accentTint}
                title={role.label}
                line={role.short}
                people={[]}
                onPress={() => router.push({ pathname: "/role", params: { type: role.type } })}
                testID={`roles-${role.type}`}
              />
            ))}
          </View>
        </>
      )}

      {extending ? <ExtendSheet target={extending} onClose={() => setExtending(null)} /> : null}
    </ScreenFrame>
  );
}

function RoleRow({
  first,
  icon,
  bg,
  title,
  line,
  nobody,
  people,
  onPress,
  testID,
}: {
  first: boolean;
  icon: React.ReactNode;
  bg: string;
  title: string;
  line: string;
  nobody?: boolean;
  people: { staffId: string; name: string }[];
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, first ? null : styles.line, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <View style={[styles.tile, { backgroundColor: bg }]}>{icon}</View>
      <View style={styles.grow}>
        <ThemedText variant="name">{title}</ThemedText>
        <ThemedText variant="meta" style={nobody ? { color: colors.tone.caution.fg } : null} numberOfLines={1}>
          {line}
        </ThemedText>
      </View>
      <View style={styles.stack}>
        {people.slice(0, 3).map((p, i) => (
          <View key={p.staffId} style={[i > 0 ? styles.overlap : null, { zIndex: 3 - i }]}>
            <StaffAvatar name={p.name} size={28} />
          </View>
        ))}
      </View>
      <AppIcon name="chevronRight" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** Extend, or give again, a role with an end date (R17). */
function ExtendSheet({
  target,
  onClose,
}: {
  target: { id: string; name: string; role: string; expiresAt: string };
  onClose: () => void;
}) {
  const { organizationId, schoolId } = useActiveContext();
  const utils = trpc.useUtils();
  const extend = trpc.role.extend.useMutation();
  const today = new Date().toISOString().slice(0, 10);
  const [until, setUntil] = useState<string | null>(null);
  const [ended] = useState(() => new Date(target.expiresAt).getTime() <= Date.now());

  async function save(next: string | null) {
    if (!organizationId) return;
    await extend.mutateAsync({
      organizationId,
      schoolId: schoolId ?? undefined,
      id: target.id,
      expiresAt: next ? new Date(`${next}T23:59:59+05:30`).toISOString() : null,
    });
    await Promise.all([utils.role.ending.invalidate(), utils.role.forStaff.invalidate()]);
    onClose();
  }

  return (
    <FormSheet
      title={`${target.name} · ${target.role}`}
      onClose={onClose}
      testIDPrefix="extend"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={until ? `Keep till ${shortDate(until)}` : "Pick a date"}
            onPress={() => void save(until).catch(() => undefined)}
            disabled={!until || extend.isPending}
            loading={extend.isPending}
            style={{ alignSelf: "stretch" }}
            testID="extend-save"
          />
          <CapsuleButton
            title="No end date"
            variant="secondary"
            onPress={() => void save(null).catch(() => undefined)}
            disabled={extend.isPending}
            style={{ alignSelf: "stretch" }}
          />
        </View>
      }
    >
      <ThemedText variant="meta">
        {ended ? "Ended" : "Ends"} {shortDate(target.expiresAt)}.
      </ThemedText>
      <DateField label="Keep it till" value={until} onChange={setUntil} minimumDate={today} testID="extend-until" />
      {extend.error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(extend.error)}</ThemedText> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  ending: { padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  endingHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  endRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm },
  label: { marginTop: spacing.lg, marginBottom: spacing.xs + 2, marginLeft: spacing.xs },
  note: { marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 64 },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  stack: { flexDirection: "row" },
  overlap: { marginLeft: -8 },
  footer: { gap: spacing.sm, alignSelf: "stretch" },
  error: { color: colors.tone.critical.fg, marginTop: spacing.md },
});

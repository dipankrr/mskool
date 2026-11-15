import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { FormSheet } from "../../components/form-sheet";
import { SegmentBar } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { givableRoles, isOrgOnly, roleLabel, roleMeta } from "./role-logic";
import type { OfficeRole } from "./role-logic";

type StaffRole = {
  id: string;
  waiting: boolean;
  roleType: string;
  scopeType: string;
  scopeLabel: string;
  expiresAt: string | null;
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/**
 * The profile's Roles card (frame R5): each office role with where it applies
 * and any end date; "When they join" while waiting. Tap one to take it away
 * (R7); "Give a role" opens R6. Teacher access isn't here: it's Teaching.
 */
export function StaffRolesCard({
  staffId,
  firstName,
  current,
}: {
  staffId: string;
  firstName: string;
  current: boolean;
}) {
  const { organizationId } = useActiveContext();
  const { has } = usePermissions();
  const roles = trpc.role.forStaff.useQuery(
    { organizationId: organizationId ?? "", staffId },
    { enabled: Boolean(organizationId) && has("role_assignment:read") },
  );
  const [giving, setGiving] = useState(false);
  const [taking, setTaking] = useState<StaffRole | null>(null);
  if (!has("role_assignment:read")) return null;
  const canGive = has("role_assignment:assign") && current;
  const canTake = has("role_assignment:revoke");
  const list = roles.data ?? [];

  return (
    <>
      <View style={styles.labelRow}>
        <ThemedText variant="sectionLabel">Roles</ThemedText>
        {canGive ? (
          <Pressable onPress={() => setGiving(true)} hitSlop={8} testID="roles-give">
            <ThemedText variant="bodyStrong" style={styles.link}>
              Give a role
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.card}>
        {roles.isPending ? (
          <View style={styles.pad}>
            <Skeleton height={44} />
          </View>
        ) : list.length === 0 ? (
          <View style={styles.empty}>
            <AppIcon name="shield" size={18} color={colors.muted} />
            <ThemedText variant="meta" style={styles.grow}>
              {current ? "No office roles. Teachers don't need one." : "Roles ended when they left."}
            </ThemedText>
          </View>
        ) : (
          list.map((role, i) => {
            const meta = roleMeta(role.roleType);
            return (
              <Pressable
                key={role.id}
                accessibilityRole="button"
                accessibilityLabel={`${roleLabel(role.roleType)}, ${role.scopeLabel}${role.waiting ? ", starts when they join" : ""}`}
                disabled={!canTake}
                onPress={() => setTaking(role)}
                style={({ pressed }) => [styles.row, i > 0 ? styles.line : null, pressed ? styles.pressed : null]}
                testID={`role-row-${role.roleType}`}
              >
                <View style={[styles.tile, { backgroundColor: meta?.bg ?? colors.chip }]}>
                  <AppIcon name={meta?.icon ?? "shield"} size={20} color={meta?.fg ?? colors.ink} />
                </View>
                <View style={styles.grow}>
                  <ThemedText variant="name">{roleLabel(role.roleType)}</ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {role.scopeLabel}
                    {role.expiresAt ? ` · till ${shortDate(role.expiresAt)}` : ""}
                  </ThemedText>
                </View>
                {role.waiting ? (
                  <View style={styles.wait}>
                    <ThemedText variant="caption" style={{ color: colors.tone.caution.fg }}>
                      When {firstName || "they"} joins
                    </ThemedText>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </View>
      {giving && organizationId ? (
        <GiveRoleSheet
          staffId={staffId}
          firstName={firstName}
          held={list.map((r) => r.roleType)}
          onClose={() => setGiving(false)}
        />
      ) : null}
      {taking && organizationId ? (
        <TakeRoleSheet role={taking} firstName={firstName} onClose={() => setTaking(null)} />
      ) : null}
    </>
  );
}

/** Give one role (frame R6): which, where, and until when (optional). */
export function GiveRoleSheet({
  staffId,
  firstName,
  held,
  onClose,
}: {
  staffId: string;
  firstName: string;
  held: string[];
  onClose: () => void;
}) {
  const { organizationId, schoolId } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has, hasOrgWide } = usePermissions();
  const utils = trpc.useUtils();
  const give = trpc.role.assignStaff.useMutation();
  const orgWide = hasOrgWide("role_assignment:assign");
  const options = givableRoles({ canAssign: has("role_assignment:assign"), canAssignOrgWide: orgWide });
  const [pick, setPick] = useState<OfficeRole | null>(options.find((o) => !held.includes(o.type))?.type ?? null);
  const [where, setWhere] = useState<"school" | "org">("school");
  const [until, setUntil] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const scope = pick && isOrgOnly(pick) ? "org" : where;

  async function save() {
    if (!organizationId || !schoolId || !pick) return;
    await give.mutateAsync({
      organizationId,
      schoolId,
      staffId,
      roleType: pick,
      scopeType: scope,
      id: scope === "org" ? organizationId : schoolId,
      expiresAt: until ? new Date(`${until}T23:59:59+05:30`).toISOString() : null,
    });
    await Promise.all([utils.role.forStaff.invalidate(), utils.role.ending.invalidate()]);
    onClose();
  }

  return (
    <FormSheet
      title={`Give ${firstName || "them"} a role`}
      onClose={onClose}
      testIDPrefix="give-role"
      footer={
        <CapsuleButton
          title={pick ? `Give ${roleLabel(pick)}` : "Give a role"}
          onPress={() => void save().catch(() => undefined)}
          disabled={!pick || give.isPending}
          loading={give.isPending}
          style={{ alignSelf: "stretch" }}
          testID="give-role-save"
        />
      }
    >
      <ThemedText variant="meta" style={styles.hint}>
        It works the moment they’re on the app.
      </ThemedText>
      <View style={styles.card}>
        {options.map((option, i) => {
          const has = held.includes(option.type);
          const on = pick === option.type;
          return (
            <Pressable
              key={option.type}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: has }}
              disabled={has}
              onPress={() => setPick(option.type)}
              style={[styles.row, i > 0 ? styles.line : null, on ? styles.rowOn : null, has ? styles.dim : null]}
              testID={`give-role-${option.type}`}
            >
              <View style={[styles.tileSm, { backgroundColor: option.bg }]}>
                <AppIcon name={option.icon} size={16} color={option.fg} />
              </View>
              <View style={styles.grow}>
                <ThemedText variant="bodyStrong">{option.label}</ThemedText>
                {isOrgOnly(option.type) ? <ThemedText variant="meta">Always every branch</ThemedText> : null}
              </View>
              {has ? (
                <ThemedText variant="meta">Has it</ThemedText>
              ) : (
                <View style={[styles.radio, on ? styles.radioOn : null]} />
              )}
            </Pressable>
          );
        })}
      </View>
      {orgWide && pick && !isOrgOnly(pick) ? (
        <View style={styles.gap}>
          <SegmentBar
            label="Where"
            value={where}
            onChange={setWhere}
            options={[
              { value: "school", label: branchName ?? "This branch", testID: "give-role-branch" },
              { value: "org", label: "All branches", testID: "give-role-all" },
            ]}
          />
        </View>
      ) : null}
      <DateField
        label="Until (optional)"
        value={until}
        onChange={setUntil}
        minimumDate={today}
        help={until ? "The role stops by itself after this day." : "No end date"}
        testID="give-role-until"
      />
      {give.error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(give.error)}</ThemedText> : null}
    </FormSheet>
  );
}

const REASONS = ["Changed job", "Given by mistake", "Cover is over"];

/** Take a role away (frame R7). A live one needs a reason; a waiting one doesn't. */
function TakeRoleSheet({ role, firstName, onClose }: { role: StaffRole; firstName: string; onClose: () => void }) {
  const { organizationId, schoolId } = useActiveContext();
  const utils = trpc.useUtils();
  const revoke = trpc.role.revoke.useMutation();
  const cancel = trpc.role.cancelPending.useMutation();
  const [reason, setReason] = useState(REASONS[0]!);
  const [typed, setTyped] = useState("");
  const why = typed.trim() || reason;
  const label = roleLabel(role.roleType);
  const busy = revoke.isPending || cancel.isPending;

  async function take() {
    if (!organizationId) return;
    if (role.waiting) {
      await cancel.mutateAsync({ organizationId, schoolId: schoolId ?? undefined, id: role.id });
    } else {
      await revoke.mutateAsync({ organizationId, schoolId: schoolId ?? undefined, id: role.id, reason: why });
    }
    await Promise.all([utils.role.forStaff.invalidate(), utils.role.ending.invalidate()]);
    onClose();
  }

  return (
    <FormSheet
      title={`Take away ${label}?`}
      onClose={onClose}
      testIDPrefix="take-role"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={`Take away ${label}`}
            variant="destructive"
            onPress={() => void take().catch(() => undefined)}
            disabled={busy || (!role.waiting && why.length < 3)}
            loading={busy}
            style={{ alignSelf: "stretch" }}
            testID="take-role-confirm"
          />
          <CapsuleButton title="Keep it" variant="secondary" onPress={onClose} style={{ alignSelf: "stretch" }} />
        </View>
      }
    >
      <ThemedText variant="meta">{`${firstName} · ${role.scopeLabel}`}</ThemedText>
      <View style={styles.warn}>
        <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
        <ThemedText variant="meta" style={styles.warnText}>
          {role.waiting
            ? `${firstName} hasn't joined yet, so nothing changes for them now.`
            : `${firstName} loses ${label.toLowerCase()} access straight away. Their classes in Teaching stay as they are.`}
        </ThemedText>
      </View>
      {!role.waiting ? (
        <>
          <ThemedText variant="sectionLabel" style={styles.why}>
            Why
          </ThemedText>
          <View style={styles.chips}>
            {REASONS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityState={{ selected: !typed && reason === r }}
                onPress={() => {
                  setReason(r);
                  setTyped("");
                }}
                style={[styles.chip, !typed && reason === r ? styles.chipOn : null]}
              >
                <ThemedText variant="chip" style={!typed && reason === r ? { color: colors.accentDeep } : null}>
                  {r}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Or write a reason"
            placeholderTextColor={colors.muted}
            style={styles.input}
            accessibilityLabel="Reason"
            maxLength={500}
          />
        </>
      ) : null}
      {revoke.error || cancel.error ? (
        <ThemedText variant="meta" style={styles.error}>
          {thrownMessage(revoke.error ?? cancel.error)}
        </ThemedText>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.xl, marginBottom: spacing.xs + 2, paddingHorizontal: spacing.xs },
  link: { color: colors.accentDeep },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  pad: { padding: spacing.md },
  empty: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 60 },
  rowOn: { backgroundColor: "#FBFEFC" },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileSm: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  wait: { height: 24, paddingHorizontal: spacing.sm + 1, borderRadius: 999, justifyContent: "center", backgroundColor: colors.tone.caution.bg },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.inputLine },
  radioOn: { borderWidth: 7, borderColor: colors.accent },
  hint: { marginBottom: spacing.md },
  gap: { marginTop: spacing.md },
  error: { color: colors.tone.critical.fg, marginTop: spacing.md },
  footer: { gap: spacing.sm, alignSelf: "stretch" },
  warn: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
    marginTop: spacing.md,
  },
  warnText: { flex: 1, color: colors.tone.caution.fg },
  why: { marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  chip: { height: 34, paddingHorizontal: spacing.md, borderRadius: 999, backgroundColor: colors.chip, justifyContent: "center" },
  chipOn: { backgroundColor: colors.accentTint },
  input: {
    marginTop: spacing.sm,
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputLine,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.callout,
    color: colors.ink,
  },
});

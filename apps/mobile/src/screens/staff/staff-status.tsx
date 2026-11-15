import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { DateField } from "../../components/date-field";
import { FormSheet } from "../../components/form-sheet";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { thrownMessage } from "../../lib/errors";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";

export type WorkStatus = "active" | "on_leave" | "suspended";

const OPTIONS: { id: WorkStatus | "left"; title: string; line: string; icon: AppIconName; bg: string; fg: string }[] = [
  { id: "active", title: "Working", line: "At work as usual", icon: "check", bg: colors.accentTint, fg: colors.accentDeep },
  { id: "on_leave", title: "On leave", line: "Away for a while; their classes need cover", icon: "clock", bg: "#E6EEFF", fg: "#2556D9" },
  { id: "suspended", title: "Suspended", line: "Can't sign in until you lift it", icon: "lock", bg: "#FFF1DE", fg: "#B54708" },
  { id: "left", title: "Left", line: "Resigned, retired or let go: handover next", icon: "leave", bg: colors.tone.critical.bg, fg: colors.tone.critical.fg },
];

export const statusText = (status: string) =>
  status === "on_leave" ? "On leave" : status === "suspended" ? "Suspended" : status === "active" ? "Working" : "Left";

/**
 * One place for status (frame R10). On leave needs staff:update; suspending,
 * lifting it and leaving need staff:delete. Left goes on to the handover
 * screen (frame 14), which already exists.
 */
export function StatusSheet({
  staffId,
  firstName,
  status,
  until: initialUntil,
  note: initialNote,
  onClose,
}: {
  staffId: string;
  firstName: string;
  status: WorkStatus;
  until: string | null;
  note: string | null;
  onClose: () => void;
}) {
  const { organizationId, schoolId } = useActiveContext();
  const { has } = usePermissions();
  const utils = trpc.useUtils();
  const setLeave = trpc.staff.setLeave.useMutation();
  const deactivate = trpc.staff.deactivate.useMutation();
  const reactivate = trpc.staff.reactivate.useMutation();
  const [pick, setPick] = useState<WorkStatus | "left">(status);
  const [until, setUntil] = useState<string | null>(initialUntil);
  const [note, setNote] = useState(initialNote ?? "");
  const busy = setLeave.isPending || deactivate.isPending || reactivate.isPending;
  const error = setLeave.error ?? deactivate.error ?? reactivate.error;
  const today = new Date().toISOString().slice(0, 10);

  const allowed = (id: WorkStatus | "left") =>
    id === "on_leave"
      ? has("staff:update")
      : id === "active"
        ? status === "suspended"
          ? has("staff:delete")
          : has("staff:update")
        : has("staff:delete");

  const unchanged = pick === status && (pick !== "on_leave" || (until === initialUntil && note === (initialNote ?? "")));

  async function save() {
    if (!organizationId) return;
    const base = { organizationId, schoolId: schoolId ?? undefined, id: staffId };
    if (pick === "left") {
      onClose();
      router.push({ pathname: "/staff-leave", params: { id: staffId } });
      return;
    }
    if (pick === "on_leave") {
      await setLeave.mutateAsync({ ...base, data: { onLeave: true, until, note: note.trim() || null } });
    } else if (pick === "suspended") {
      await deactivate.mutateAsync({ ...base, data: { status: "suspended", note: note.trim() || null } });
    } else if (status === "suspended") {
      await reactivate.mutateAsync(base);
    } else {
      await setLeave.mutateAsync({ ...base, data: { onLeave: false } });
    }
    await Promise.all([utils.staff.byId.invalidate(), utils.staff.list.invalidate(), utils.role.history.invalidate()]);
    onClose();
  }

  const button =
    pick === "left"
      ? "Next: handover"
      : pick === "on_leave"
        ? status === "on_leave"
          ? "Save"
          : `Put ${firstName} on leave`
        : pick === "suspended"
          ? `Suspend ${firstName}`
          : status === "suspended"
            ? "Lift suspension"
            : `${firstName} is back`;

  return (
    <FormSheet
      title={`${firstName}'s status`}
      onClose={onClose}
      testIDPrefix="status"
      footer={
        <CapsuleButton
          title={button}
          variant={pick === "suspended" ? "destructive" : "primary"}
          onPress={() => void save().catch(() => undefined)}
          disabled={busy || unchanged || !allowed(pick)}
          loading={busy}
          style={{ alignSelf: "stretch" }}
          testID="status-save"
        />
      }
    >
      <ThemedText variant="meta" style={styles.hint}>
        Everyone except Left stays on staff and keeps their number.
      </ThemedText>
      <View style={styles.card}>
        {OPTIONS.map((option, i) => {
          const on = pick === option.id;
          const ok = allowed(option.id);
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !ok }}
              disabled={!ok}
              onPress={() => setPick(option.id)}
              style={[styles.row, i > 0 ? styles.line : null, on ? styles.rowOn : null, !ok ? styles.dim : null]}
              testID={`status-${option.id}`}
            >
              <View style={[styles.tile, { backgroundColor: option.bg }]}>
                <AppIcon name={option.icon} size={16} color={option.fg} />
              </View>
              <View style={styles.grow}>
                <ThemedText variant="bodyStrong">{option.title}</ThemedText>
                <ThemedText variant="meta">{option.id === status ? "Now" : option.line}</ThemedText>
              </View>
              {option.id === "left" ? (
                <AppIcon name="chevronRight" size={18} color={colors.muted} />
              ) : (
                <View style={[styles.radio, on ? styles.radioOn : null]} />
              )}
            </Pressable>
          );
        })}
      </View>
      {pick === "on_leave" ? (
        <DateField
          label="Back on (optional)"
          value={until}
          onChange={setUntil}
          minimumDate={today}
          help={until ? "Shown on their profile. Nothing switches back by itself." : "Not known yet"}
          testID="status-until"
        />
      ) : null}
      {pick === "on_leave" || pick === "suspended" ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={pick === "suspended" ? "Why (seen by the office only)" : "Note (optional)"}
          placeholderTextColor={colors.muted}
          style={styles.input}
          accessibilityLabel="Note"
          maxLength={500}
          testID="status-note"
        />
      ) : null}
      {pick === "suspended" && status !== "suspended" ? (
        <View style={styles.warn}>
          <AppIcon name="lock" size={18} color={colors.tone.caution.fg} />
          <ThemedText variant="meta" style={styles.warnText}>
            {firstName} is signed out at once and can’t sign in. Their roles and classes are kept, and come back when you lift it.
          </ThemedText>
        </View>
      ) : null}
      {error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(error)}</ThemedText> : null}
    </FormSheet>
  );
}

/** Move to another branch (frame R14). */
export function MoveSheet({
  staffId,
  firstName,
  fromSchoolId,
  onClose,
}: {
  staffId: string;
  firstName: string;
  fromSchoolId: string;
  onClose: () => void;
}) {
  const { organizationId, branches } = useActiveContext();
  const utils = trpc.useUtils();
  const move = trpc.staff.move.useMutation();
  const others = branches.filter((b) => b.id !== fromSchoolId);
  const [to, setTo] = useState<string | null>(others[0]?.id ?? null);
  const from = branches.find((b) => b.id === fromSchoolId)?.name ?? "this branch";
  const target = branches.find((b) => b.id === to)?.name ?? "";

  async function save() {
    if (!organizationId || !to) return;
    await move.mutateAsync({ organizationId, id: staffId, data: { toSchoolId: to } });
    await Promise.all([utils.staff.invalidate(), utils.role.forStaff.invalidate(), utils.assignment.invalidate()]);
    onClose();
  }

  return (
    <FormSheet
      title={`Move ${firstName}`}
      onClose={onClose}
      testIDPrefix="move"
      footer={
        <CapsuleButton
          title={target ? `Move to ${target}` : "Move"}
          onPress={() => void save().catch(() => undefined)}
          disabled={!to || move.isPending}
          loading={move.isPending}
          style={{ alignSelf: "stretch" }}
          testID="move-save"
        />
      }
    >
      <ThemedText variant="meta" style={styles.hint}>
        From {from}. Their record, photo and sign-in move with them.
      </ThemedText>
      <View style={styles.card}>
        {others.map((branch, i) => {
          const on = branch.id === to;
          return (
            <Pressable
              key={branch.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setTo(branch.id)}
              style={[styles.row, i > 0 ? styles.line : null, on ? styles.rowOn : null]}
            >
              <View style={[styles.tile, { backgroundColor: colors.accentTint }]}>
                <AppIcon name="school" size={16} color={colors.accentDeep} />
              </View>
              <ThemedText variant="bodyStrong" style={styles.grow}>
                {branch.name}
              </ThemedText>
              <View style={[styles.radio, on ? styles.radioOn : null]} />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.warn}>
        <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
        <ThemedText variant="meta" style={styles.warnText}>
          Their classes at {from} end today and show there as gaps. Roles given for {from} end too; roles for every branch stay.
        </ThemedText>
      </View>
      {move.error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(move.error)}</ThemedText> : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: colors.hairline },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 58 },
  rowOn: { backgroundColor: "#FBFEFC" },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  dim: { opacity: 0.45 },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.inputLine },
  radioOn: { borderWidth: 7, borderColor: colors.accent },
  input: {
    marginTop: spacing.md,
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
  warn: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
    marginTop: spacing.md,
  },
  warnText: { flex: 1, color: colors.tone.caution.fg },
  error: { color: colors.tone.critical.fg, marginTop: spacing.md },
});

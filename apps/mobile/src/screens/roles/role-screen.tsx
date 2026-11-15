import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
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
import {
  GROUP_LABELS,
  GROUP_ORDER,
  actionLabel,
  diffPermissions,
  editLock,
  groupCounts,
  orderedActions,
  permissionLabel,
  resourceLabel,
  roleLabel,
  roleMeta,
} from "../staff/role-logic";

/**
 * What a role can do (frames R19-R24). Groups with how much of each the role
 * has; open one to see each action as a chip. With role_permission:update
 * and no lock, chips toggle; changes are ringed until saved, and saving goes
 * through a review that says who it affects. Reset puts the role back to
 * its starting list. The list is organisation-wide. Groups open in place
 * (frames R20/R21 drew them as two pages) so unsaved changes stay on one
 * screen.
 */
export function RoleScreen({ type }: { type: string }) {
  const { organizationId } = useActiveContext();
  const { has, roleTypes } = usePermissions();
  const orgId = organizationId ?? "";
  const utils = trpc.useUtils();
  const matrix = trpc.role.permissions.useQuery({ organizationId: orgId }, { enabled: Boolean(organizationId) });
  const defaults = trpc.role.permissionDefaults.useQuery({ organizationId: orgId }, { enabled: Boolean(organizationId), staleTime: 300_000 });
  const holders = trpc.role.holders.useQuery({ organizationId: orgId }, { enabled: Boolean(organizationId) });
  const update = trpc.role.permissionUpdate.useMutation();
  const reset = trpc.role.permissionReset.useMutation();

  const current = useMemo(
    () => new Set((matrix.data ?? []).filter((r) => r.roleType === type).map((r) => r.permission)),
    [matrix.data, type],
  );
  const shipped = useMemo(
    () => new Set((defaults.data?.defaults ?? []).filter((r) => r.roleType === type).map((r) => r.permission)),
    [defaults.data, type],
  );
  const sensitive = useMemo(() => new Set(defaults.data?.sensitive ?? []), [defaults.data]);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState<string | null>("Finance");
  const [reviewing, setReviewing] = useState(false);
  const [resetting, setResetting] = useState(false);

  const lock = editLock(type, roleTypes);
  const canEdit = has("role_permission:update") && lock === null;
  const held = draft ?? current;
  const diff = diffPermissions(current, held);
  const fromDefaults = diffPermissions(current, shipped);
  const people = [...new Map((holders.data ?? []).filter((h) => h.roleType === type).map((h) => [h.staffId, h.name])).values()];
  const meta = roleMeta(type);
  const teaching = type === "class_teacher" || type === "subject_teacher";

  function toggle(permission: string) {
    const next = new Set(held);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    setDraft(next);
  }

  if (matrix.isPending || defaults.isPending) {
    return (
      <ScreenFrame title={roleLabel(type)} backAccessibilityLabel="Back">
        <Skeleton height={320} />
      </ScreenFrame>
    );
  }
  if (matrix.isError || defaults.isError) {
    return (
      <ScreenFrame title={roleLabel(type)} backAccessibilityLabel="Back">
        <ErrorCard cause={matrix.error ?? defaults.error} onRetry={() => void Promise.all([matrix.refetch(), defaults.refetch()])} />
      </ScreenFrame>
    );
  }

  const catalog = [...(defaults.data?.catalog ?? [])].sort(
    (a, b) => GROUP_ORDER.indexOf(a.category) - GROUP_ORDER.indexOf(b.category),
  );
  const counts = new Map(groupCounts(catalog, held).map((c) => [c.category, c]));
  const total = [...counts.values()].reduce((n, c) => n + c.total, 0);

  return (
    <ScreenFrame
      title={roleLabel(type)}
      meta="Same at every branch"
      backAccessibilityLabel="Back"
      action={
        canEdit && fromDefaults.count > 0 && diff.count === 0
          ? { label: "Reset", icon: "refresh", onPress: () => setResetting(true) }
          : undefined
      }
      footer={
        canEdit && diff.count > 0 ? (
          <View style={styles.saveBar} testID="role-save-bar">
            <ThemedText variant="bodyStrong" style={styles.saveText}>
              {diff.count} {diff.count === 1 ? "change" : "changes"}
            </ThemedText>
            <Pressable onPress={() => setDraft(null)} hitSlop={8} testID="role-undo">
              <ThemedText variant="bodyStrong" style={styles.undo}>
                Undo
              </ThemedText>
            </Pressable>
            <CapsuleButton title="Review" size="compact" onPress={() => setReviewing(true)} testID="role-review" />
          </View>
        ) : undefined
      }
    >
      <View style={styles.people}>
        <View style={[styles.tile, { backgroundColor: meta?.bg ?? colors.accentTint }]}>
          <AppIcon name={meta?.icon ?? "school"} size={20} color={meta?.fg ?? colors.accentDeep} />
        </View>
        <ThemedText variant="meta" style={styles.grow}>
          {teaching
            ? "Given by Teaching, section by section."
            : people.length === 0
              ? "Nobody has this role yet."
              : people.length <= 2
                ? `${people.join(", ")} ${people.length === 1 ? "has" : "have"} this role.`
                : `${people.length} people have this role.`}
        </ThemedText>
      </View>

      {lock ? (
        <View style={styles.lock} testID="role-lock">
          <AppIcon name="lock" size={18} color={colors.tone.caution.fg} />
          <ThemedText variant="meta" style={styles.lockText}>
            {lock === "org_admin"
              ? "Org admin can always do everything and is never changed."
              : `You're a ${roleLabel(type)} yourself, so you can't change this role. Another Org admin can.`}
          </ThemedText>
        </View>
      ) : !has("role_permission:update") ? (
        <ThemedText variant="meta" style={styles.readOnly}>
          Only an Org admin can change what a role can do.
        </ThemedText>
      ) : null}

      <View style={styles.labelRow}>
        <ThemedText variant="sectionLabel">What they can do</ThemedText>
        <ThemedText variant="meta">
          {held.size} of {total}
        </ThemedText>
      </View>
      <View style={styles.card}>
        {catalog.map((group, gi) => {
          const label = GROUP_LABELS[group.category] ?? { label: group.category, icon: "shield" as const, bg: colors.chip, fg: colors.ink };
          const count = counts.get(group.category)!;
          const isOpen = open === group.category;
          return (
            <View key={group.category} style={gi > 0 ? styles.line : null}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
                onPress={() => setOpen(isOpen ? null : group.category)}
                style={({ pressed }) => [styles.groupRow, pressed ? styles.pressed : null]}
                testID={`role-group-${group.category}`}
              >
                <View style={[styles.tile, { backgroundColor: label.bg }]}>
                  <AppIcon name={label.icon} size={18} color={label.fg} />
                </View>
                <View style={styles.grow}>
                  <ThemedText variant="name">{label.label}</ThemedText>
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${count.total ? (count.held / count.total) * 100 : 0}%` }]} />
                  </View>
                </View>
                <ThemedText variant="meta" style={styles.count}>
                  {count.held} of {count.total}
                </ThemedText>
                <AppIcon name={isOpen ? "chevronUp" : "chevronDown"} size={18} color={colors.muted} />
              </Pressable>
              {isOpen
                ? group.resources.map((resource) => (
                    <View key={resource.resource} style={styles.resource}>
                      <ThemedText variant="bodyStrong">{resourceLabel(resource.resource)}</ThemedText>
                      <View style={styles.chips}>
                        {orderedActions(resource.resource, resource.actions).map((permission) => {
                          const on = held.has(permission);
                          const changed = on !== current.has(permission);
                          return (
                            <Pressable
                              key={permission}
                              accessibilityRole="switch"
                              accessibilityState={{ checked: on, disabled: !canEdit }}
                              accessibilityLabel={permissionLabel(permission)}
                              disabled={!canEdit}
                              onPress={() => toggle(permission)}
                              style={[styles.chip, on ? styles.chipOn : null, changed ? styles.chipChanged : null, !canEdit ? styles.chipLocked : null]}
                              testID={`perm-${permission}`}
                            >
                              {sensitive.has(permission) ? (
                                <AppIcon name="shield" size={12} color={on ? colors.onAccent : colors.muted} />
                              ) : null}
                              <ThemedText variant="chip" style={on ? styles.chipOnText : styles.chipOffText}>
                                {actionLabel(permission)}
                              </ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))
                : null}
            </View>
          );
        })}
      </View>
      {canEdit ? (
        <View style={styles.legend}>
          <AppIcon name="shield" size={12} color={colors.muted} />
          <ThemedText variant="caption" style={{ color: colors.muted }}>
            Checked again on every use. Nothing changes until you review and save.
          </ThemedText>
        </View>
      ) : null}

      {reviewing ? (
        <FormSheet
          title={`Save ${diff.count} ${diff.count === 1 ? "change" : "changes"} to ${roleLabel(type)}?`}
          onClose={() => setReviewing(false)}
          testIDPrefix="role-review"
          footer={
            <View style={styles.footer}>
              <CapsuleButton
                title="Save changes"
                onPress={() =>
                  void update
                    .mutateAsync({ organizationId: orgId, roleType: type as never, add: diff.add, remove: diff.remove })
                    .then(async () => {
                      await utils.role.permissions.invalidate();
                      setDraft(null);
                      setReviewing(false);
                    })
                    .catch(() => undefined)
                }
                loading={update.isPending}
                style={{ alignSelf: "stretch" }}
                testID="role-review-save"
              />
              <CapsuleButton title="Keep editing" variant="secondary" onPress={() => setReviewing(false)} style={{ alignSelf: "stretch" }} />
            </View>
          }
        >
          <ThemedText variant="meta">
            {teaching
              ? "For every teacher given this in Teaching, at every branch, straight away."
              : people.length > 0
                ? `For ${people.length <= 2 ? people.join(" and ") : `${people.length} people`}, at every branch, straight away.`
                : "Nobody has this role yet; it applies to whoever gets it."}
          </ThemedText>
          <DiffList add={diff.add} remove={diff.remove} sensitive={sensitive} />
          {diff.add.some((p) => sensitive.has(p)) ? (
            <View style={styles.lock}>
              <AppIcon name="warning" size={18} color={colors.tone.caution.fg} />
              <ThemedText variant="meta" style={styles.lockText}>
                You’re adding something sensitive: money, results or access. Make sure {roleLabel(type).toLowerCase()} should have it.
              </ThemedText>
            </View>
          ) : null}
          {update.error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(update.error)}</ThemedText> : null}
        </FormSheet>
      ) : null}

      {resetting ? (
        <FormSheet
          title={`Reset ${roleLabel(type)}?`}
          onClose={() => setResetting(false)}
          testIDPrefix="role-reset"
          footer={
            <View style={styles.footer}>
              <CapsuleButton
                title={`Reset ${roleLabel(type)}`}
                variant="destructive"
                onPress={() =>
                  void reset
                    .mutateAsync({ organizationId: orgId, roleType: type as never })
                    .then(async () => {
                      await utils.role.permissions.invalidate();
                      setResetting(false);
                    })
                    .catch(() => undefined)
                }
                loading={reset.isPending}
                style={{ alignSelf: "stretch" }}
                testID="role-reset-confirm"
              />
              <CapsuleButton title="Cancel" variant="secondary" onPress={() => setResetting(false)} style={{ alignSelf: "stretch" }} />
            </View>
          }
        >
          <ThemedText variant="meta">
            Back to the starting list. Your school changed {fromDefaults.count} {fromDefaults.count === 1 ? "thing" : "things"}; this undoes:
          </ThemedText>
          <DiffList add={fromDefaults.add} remove={fromDefaults.remove} sensitive={sensitive} />
          {reset.error ? <ThemedText variant="meta" style={styles.error}>{thrownMessage(reset.error)}</ThemedText> : null}
        </FormSheet>
      ) : null}
    </ScreenFrame>
  );
}

function DiffList({ add, remove, sensitive }: { add: string[]; remove: string[]; sensitive: Set<string> }) {
  return (
    <View style={styles.diff}>
      {add.map((p) => (
        <View key={`+${p}`} style={styles.diffRow}>
          <View style={[styles.pm, { backgroundColor: colors.accentTint }]}>
            <ThemedText variant="bodyStrong" style={{ color: colors.accentDeep }}>
              +
            </ThemedText>
          </View>
          <ThemedText variant="body" style={styles.grow}>
            {permissionLabel(p)}
          </ThemedText>
          {sensitive.has(p) ? <AppIcon name="shield" size={14} color={colors.tone.caution.fg} /> : null}
        </View>
      ))}
      {remove.map((p) => (
        <View key={`-${p}`} style={styles.diffRow}>
          <View style={[styles.pm, { backgroundColor: colors.tone.critical.bg }]}>
            <ThemedText variant="bodyStrong" style={{ color: colors.tone.critical.fg }}>
              −
            </ThemedText>
          </View>
          <ThemedText variant="body" style={styles.grow}>
            {permissionLabel(p)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  people: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  tile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 4 },
  lock: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.tone.caution.bg, marginTop: spacing.md },
  lockText: { flex: 1, color: colors.tone.caution.fg },
  readOnly: { marginTop: spacing.md, marginLeft: spacing.xs },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: spacing.lg, marginBottom: spacing.xs + 2, paddingHorizontal: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  groupRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 64 },
  pressed: { opacity: 0.85 },
  bar: { height: 6, width: 72, borderRadius: 3, backgroundColor: colors.chip, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  count: { fontVariant: ["tabular-nums"] },
  resource: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  chip: {
    height: 34,
    paddingHorizontal: spacing.md - 1,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.inputLine,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipChanged: { borderWidth: 2, borderColor: "#F5B544" },
  chipLocked: { opacity: 0.6 },
  chipOnText: { color: colors.onAccent },
  chipOffText: { color: colors.muted },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.xs + 2, marginTop: spacing.sm, marginLeft: spacing.xs },
  saveBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.ink,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    alignSelf: "stretch",
  },
  saveText: { flex: 1, color: colors.onAccent },
  undo: { color: "rgba(255,255,255,0.7)" },
  footer: { gap: spacing.sm, alignSelf: "stretch" },
  diff: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.canvas, gap: spacing.xs },
  diffRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36 },
  pm: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  error: { color: colors.tone.critical.fg, marginTop: spacing.md },
});

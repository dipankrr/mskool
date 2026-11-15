import { StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { roleLabel, roleMeta } from "./role-logic";

type Entry = {
  id: string;
  action: string;
  at: string;
  roleType: string | null;
  scopeLabel: string | null;
  by: string | null;
  self: boolean;
  reason: string | null;
  until: string | null;
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** What one line of history says, and its tile. */
export function describe(e: Entry): { title: string; icon: AppIconName; bg: string; fg: string } {
  const meta = e.roleType ? roleMeta(e.roleType) : null;
  const role = e.roleType ? roleLabel(e.roleType) : "";
  const where = e.scopeLabel ? ` · ${e.scopeLabel}` : "";
  const roleTile = { icon: meta?.icon ?? ("shield" as AppIconName), bg: meta?.bg ?? colors.chip, fg: meta?.fg ?? colors.ink };
  switch (e.action) {
    case "role_granted":
      return { title: `Given ${role}${where}`, ...roleTile };
    case "role_revoked":
      return { title: `${role} taken away${where}`, ...roleTile };
    case "role_extended":
      return { title: `${role} ${e.until ? `now till ${day(e.until)}` : "no longer ends"}`, ...roleTile };
    case "role_expired":
      return { title: `${role} ended`, ...roleTile };
    case "staff_invited":
      return { title: "Joining code sent", icon: "key", bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg };
    case "staff_joined":
      return { title: "Joined the app", icon: "checkCircle", bg: "#E3F7EA", fg: "#1DA851" };
    case "staff_password_reset":
      return { title: "Set a new password", icon: "key", bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg };
    case "staff_login_created":
      return { title: "Sign-in created", icon: "key", bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg };
    case "staff_phone_changed":
      return { title: "Phone changed; sign-in moved", icon: "call", bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg };
    case "staff_suspended":
      return { title: "Suspended", icon: "lock", bg: colors.tone.caution.bg, fg: colors.tone.caution.fg };
    case "staff_reinstated":
      return { title: "Suspension lifted", icon: "lock", bg: colors.accentTint, fg: colors.accentDeep };
    case "staff_moved":
      return { title: "Moved to another branch", icon: "swap", bg: colors.tone.neutral.bg, fg: colors.tone.neutral.fg };
    case "staff_left":
      return { title: "Left", icon: "leave", bg: colors.tone.critical.bg, fg: colors.tone.critical.fg };
    default:
      return { title: e.action.replace(/_/g, " "), icon: "history", bg: colors.chip, fg: colors.ink };
  }
}

/**
 * One person's history (frame R16): roles given, taken away and extended,
 * sign-in events and status changes, newest first, grouped by month. Read
 * from the audit log the server already writes. Leave isn't logged there.
 */
export function StaffHistoryScreen({ id }: { id: string }) {
  const { organizationId } = useActiveContext();
  const history = trpc.role.history.useQuery(
    { organizationId: organizationId ?? "", staffId: id },
    { enabled: Boolean(organizationId) },
  );
  const person = trpc.staff.byId.useQuery(
    { organizationId: organizationId ?? "", id },
    { enabled: Boolean(organizationId) },
  );

  const months = new Map<string, Entry[]>();
  for (const entry of history.data ?? []) {
    const key = new Date(entry.at).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    months.set(key, [...(months.get(key) ?? []), entry]);
  }

  return (
    <ScreenFrame
      title="History"
      backAccessibilityLabel="Back"
      meta={person.data ? `${person.data.firstName} ${person.data.lastName}`.trim() : undefined}
    >
      {history.isPending ? (
        <Skeleton height={180} />
      ) : history.isError ? (
        <ErrorCard cause={history.error} onRetry={() => void history.refetch()} />
      ) : months.size === 0 ? (
        <ThemedText variant="meta">Nothing yet. Roles given before someone joins show here once they join; leave isn’t logged.</ThemedText>
      ) : (
        [...months.entries()].map(([month, entries]) => (
          <View key={month}>
            <ThemedText variant="sectionLabel" style={styles.label}>
              {month}
            </ThemedText>
            <View style={styles.card}>
              {entries.map((entry, i) => {
                const d = describe(entry);
                const who = entry.self ? "by themselves" : entry.by ? `by ${entry.by}` : null;
                return (
                  <View key={entry.id} style={[styles.row, i > 0 ? styles.line : null]}>
                    <View style={[styles.tile, { backgroundColor: d.bg }]}>
                      <AppIcon name={d.icon} size={16} color={d.fg} />
                    </View>
                    <View style={styles.grow}>
                      <ThemedText variant="bodyStrong">{d.title}</ThemedText>
                      <ThemedText variant="meta">
                        {[entry.reason ? `“${entry.reason}”` : null, who, new Date(entry.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })]
                          .filter(Boolean)
                          .join(" · ")}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ))
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: spacing.lg, marginBottom: spacing.xs + 2, marginLeft: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  line: { borderTopWidth: 1, borderTopColor: colors.hairline },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
});

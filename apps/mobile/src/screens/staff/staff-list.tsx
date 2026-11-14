import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveBranchName } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { JoinPill } from "./join-pill";
import { StaffAvatar } from "./staff-photo";

type Filter = "all" | "teaching" | "notJoined" | "left";

/**
 * Staff (ADR-068, frame 05): the branch's people, teaching staff first, each
 * with where they stand with the app. "Not joined" is the one chip with a
 * dot: those people can't work in the app yet.
 */
export function StaffListScreen() {
  const { organizationId, schoolId } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const enabled = Boolean(organizationId && schoolId);
  const list = trpc.staff.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", includeInactive: true },
    { enabled },
  );

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const current = rows.filter((row) => row.status !== "resigned" && row.status !== "retired" && row.status !== "terminated");
  const counts = {
    all: current.length,
    teaching: current.filter((row) => row.teachesClasses).length,
    notJoined: current.filter((row) => row.joinState !== "joined").length,
    left: rows.length - current.length,
  };
  const needle = q.trim().toLowerCase();
  const shown = (filter === "left" ? rows.filter((row) => !current.includes(row)) : current)
    .filter((row) => (filter === "teaching" ? row.teachesClasses : true))
    .filter((row) => (filter === "notJoined" ? row.joinState !== "joined" : true))
    .filter((row) =>
      needle
        ? `${row.firstName} ${row.lastName} ${row.employeeCode} ${row.phone ?? ""}`
            .toLowerCase()
            .includes(needle)
        : true,
    );
  const teaching = shown.filter((row) => row.teachesClasses);
  const office = shown.filter((row) => !row.teachesClasses);

  const chips: { key: Filter; label: string; count: number; dot?: boolean }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "teaching", label: "Teaching", count: counts.teaching },
    { key: "notJoined", label: "Not joined", count: counts.notJoined, dot: counts.notJoined > 0 },
    { key: "left", label: "Left", count: counts.left },
  ];

  return (
    <ScreenFrame
      title="Staff"
      meta={[branchName, `${counts.all} people`].filter(Boolean).join(" · ")}
      backAccessibilityLabel="Back"
      action={
        has("staff:create")
          ? { label: "Add", icon: "add", onPress: () => router.push("/staff-form") }
          : undefined
      }
      onRefresh={() => void list.refetch()}
      refreshing={list.isRefetching}
    >
      <View style={styles.search}>
        <AppIcon name="search" size={18} color={colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Name, phone or code"
          placeholderTextColor={colors.muted}
          style={styles.searchText}
          autoCorrect={false}
          testID="staff-search"
          accessibilityLabel="Search staff"
        />
      </View>
      <View style={styles.chips}>
        {chips.map((chip) => {
          const on = chip.key === filter;
          return (
            <Pressable
              key={chip.key}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setFilter(chip.key)}
              style={[styles.chip, on ? styles.chipOn : null]}
              testID={`staff-filter-${chip.key}`}
            >
              {chip.dot && !on ? <View style={styles.dot} /> : null}
              <ThemedText variant="chip" style={on ? styles.chipTextOn : null}>
                {chip.label}
              </ThemedText>
              <ThemedText variant="caption" style={on ? styles.chipCountOn : styles.chipCount}>
                {chip.count}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {list.isPending ? (
        <View style={styles.loading}>
          <Skeleton height={60} />
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : list.isError ? (
        <ErrorCard cause={list.error} onRetry={() => void list.refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon="students"
          title={rows.length === 0 ? "No staff yet" : "Nobody here"}
          message={
            rows.length === 0
              ? "Add your teachers and office staff, then invite them to the app."
              : "Try another filter or search."
          }
        />
      ) : (
        <>
          <Group title={`Teaching · ${teaching.length}`} rows={teaching} />
          <Group title={`Office · ${office.length}`} rows={office} />
        </>
      )}
    </ScreenFrame>
  );
}

type Row = inferRouterOutputs<AppRouter>["staff"]["list"][number];

function Group({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.group}>
      <ThemedText variant="sectionLabel" style={styles.groupLabel}>
        {title}
      </ThemedText>
      <View style={styles.card}>
        {rows.map((row, i) => {
          const name = `${row.firstName} ${row.lastName}`.trim();
          const left = !["active", "on_leave", "suspended"].includes(row.status);
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={name}
              onPress={() => router.push({ pathname: "/staff-profile", params: { id: row.id } })}
              style={({ pressed }) => [styles.row, i > 0 ? styles.rowLine : null, pressed ? styles.pressed : null]}
              testID={`staff-row-${row.id}`}
            >
              <StaffAvatar name={name} uri={row.photo?.url} cacheKey={row.photo?.id} />
              <View style={styles.grow}>
                <ThemedText variant="name" numberOfLines={1}>
                  {name}
                </ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>
                  {[row.designation, row.employeeCode].filter(Boolean).join(" · ")}
                </ThemedText>
              </View>
              {left ? (
                <View style={styles.leftPill}>
                  <ThemedText variant="caption" style={styles.leftText}>
                    Left
                  </ThemedText>
                </View>
              ) : (
                <JoinPill state={row.joinState} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.inputLine,
    paddingHorizontal: spacing.md,
  },
  searchText: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.body,
    color: colors.ink,
    paddingVertical: spacing.sm,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2, marginTop: spacing.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipTextOn: { color: colors.onAccent },
  chipCount: { color: colors.muted },
  chipCountOn: { color: "rgba(255,255,255,0.7)" },
  dot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.tone.caution.fg },
  loading: { gap: spacing.sm, marginTop: spacing.lg },
  group: { marginTop: spacing.lg },
  groupLabel: { marginLeft: spacing.xs, marginBottom: spacing.xs + 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.hairline },
  pressed: { backgroundColor: colors.canvas },
  grow: { flex: 1, minWidth: 0 },
  leftPill: {
    paddingHorizontal: spacing.sm + 1,
    height: 24,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: colors.tone.neutral.bg,
  },
  leftText: { color: colors.tone.neutral.fg },
});

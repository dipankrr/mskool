import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Avatar } from "../../components/avatar";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { fullName, hasLeft, staffCounts, staffGroups, teachingTags } from "../staff/staff-list-logic";
import type { StaffTab } from "../staff/staff-list-logic";
import { AREAS } from "./areas";
import { Head, Hero, HeroNote, Panel, Row, Shortcuts, caution, neutral } from "./parts";
import type { Hue, Shortcut } from "./parts";
import { daysUntil } from "./time";

const look = AREAS.staff;
const hue: Hue = { fg: look.h0, bg: look.tint };

/**
 * Staff in More: who is on roll and who is away, what needs the caller (gaps,
 * invites, roles about to end), four doors, then everyone, filtered All /
 * Teaching / Office. People who left stay in the full staff list.
 */
export function StaffArea() {
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();
  const today = todayIso();
  const here = Boolean(organizationId && schoolId);
  const running = Boolean(academicYear && currentYear && academicYear.id === currentYear.id);
  const [tab, setTab] = useState<StaffTab>("all");

  const list = trpc.staff.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", includeInactive: true },
    { enabled: here, staleTime: 60_000 },
  );
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: here && running && has("teacher_assignment:create"), staleTime: 120_000, retry: false },
  );
  const ending = trpc.role.ending.useQuery(
    { organizationId: organizationId ?? "", forSchoolId: schoolId ?? "" },
    { enabled: here && has("role_assignment:read"), staleTime: 120_000, retry: false },
  );

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => staffCounts(rows), [rows]);
  const people = useMemo(
    () => staffGroups(rows, { tab, query: "", showLeft: false }).flatMap((group) => group.rows),
    [rows, tab],
  );

  if (list.isPending && here) {
    return (
      <View style={styles.loading}>
        <Skeleton height={170} />
        <Skeleton height={140} />
        <Skeleton height={260} />
      </View>
    );
  }
  if (list.isError) {
    return <ErrorCard cause={list.error} onRetry={() => void list.refetch()} testID="more-staff-error" />;
  }

  const current = rows.filter((person) => !hasLeft(person));
  const away = current.filter((person) => person.status === "on_leave" || person.status === "suspended");
  const gaps = overview.data ? overview.data.totals.noClassTeacher + overview.data.totals.noTeacher : 0;
  const soon = (ending.data ?? []).filter((role) => {
    const days = daysUntil(role.expiresAt.slice(0, 10), today);
    return days >= 0 && days <= 7;
  });

  const needs = [
    gaps > 0 && overview.data
      ? {
          key: "gaps",
          icon: "school" as const,
          hue: caution,
          title: `${gaps} teaching ${gaps === 1 ? "gap" : "gaps"}`,
          meta: [
            overview.data.totals.noClassTeacher ? `${overview.data.totals.noClassTeacher} class teachers` : null,
            overview.data.totals.noTeacher ? `${overview.data.totals.noTeacher} subjects` : null,
          ]
            .filter(Boolean)
            .join(", "),
          action: { label: "Fill", onPress: () => router.push("/teaching") },
        }
      : null,
    counts.notOnApp.length > 0
      ? {
          key: "joined",
          icon: "mail" as const,
          hue: neutral,
          title: `${counts.notOnApp.length} not on the app`,
          meta: counts.notOnApp.slice(0, 2).map(fullName).join(", "),
          action: { label: "Invite", onPress: () => router.push("/staff-list") },
        }
      : null,
    soon.length > 0
      ? {
          key: "ending",
          icon: "shield" as const,
          hue,
          title: soon.length === 1 ? "A role ends this week" : `${soon.length} roles end this week`,
          meta: `${soon[0]!.name} · ${soon[0]!.scopeLabel}`,
          action: { label: "Extend", onPress: () => router.push("/roles") },
        }
      : null,
  ].filter((need) => need !== null);

  const shortcuts: Shortcut[] = [
    has("staff:create") ? { key: "add", label: "Add staff", icon: "personAdd", hue, add: true, onPress: () => router.push("/staff-form") } : null,
    has("teacher_assignment:create") ? { key: "assign", label: "Assign a teacher", icon: "school", hue, add: true, onPress: () => router.push("/teaching") } : null,
    has("role_assignment:assign") ? { key: "role", label: "Give a role", icon: "shield", hue, add: true, onPress: () => router.push("/roles") } : null,
    has("staff:update") ? { key: "leave", label: "Record leave", icon: "calendar", hue, add: true, onPress: () => router.push("/staff-list") } : null,
    has("teacher_assignment:read") ? { key: "teaching", label: "Teaching", icon: "school", hue, onPress: () => router.push("/teaching") } : null,
    has("role_assignment:read") || has("role_permission:read") ? { key: "roles", label: "Roles", icon: "shield", hue, onPress: () => router.push("/roles") } : null,
  ].filter((item): item is Shortcut => item !== null);

  const awayNote = away
    .slice(0, 3)
    .map((person) => `${fullName(person)} ${person.status === "suspended" ? "suspended" : "on leave"}`)
    .join(" · ");

  return (
    <View>
      <Hero
        h0={look.h0}
        h1={look.h1}
        kicker={[branchName, "staff"].filter(Boolean).join(" · ")}
        title={`${counts.all} on roll`}
        sub={`${counts.teaching} teaching · ${counts.office} office`}
        aside={
          current.length > 0 ? (
            <View style={styles.faces}>
              {current.slice(0, 4).map((person, index) => (
                <Avatar
                  key={person.id}
                  name={fullName(person)}
                  style={[styles.face, index === 0 ? null : styles.faceOverlap]}
                />
              ))}
            </View>
          ) : null
        }
        testID="more-staff-hero"
      >
        {away.length > 0 ? <HeroNote icon="calendar" text={awayNote} /> : null}
      </Hero>

      {needs.length > 0 ? (
        <>
          <Head title="Needs you" count={needs.length} />
          <Panel>
            {needs.map((need, index) => (
              <Row key={need.key} first={index === 0} icon={need.icon} hue={need.hue} title={need.title} meta={need.meta} action={need.action} />
            ))}
          </Panel>
        </>
      ) : null}

      {shortcuts.length > 0 ? (
        <>
          <Head title="Go to" />
          <Shortcuts items={shortcuts} />
        </>
      ) : null}

      <Head title="People" link={{ label: "Full list", onPress: () => router.push("/staff-list") }} />
      <View style={styles.segment} accessibilityRole="tablist">
        {(
          [
            ["all", "All", counts.all],
            ["teaching", "Teaching", counts.teaching],
            ["office", "Office", counts.office],
          ] as const
        ).map(([key, label, n]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={[styles.segmentItem, tab === key ? styles.segmentOn : null]}
            testID={`more-staff-${key}`}
          >
            <ThemedText variant="bodyStrong" color={tab === key ? colors.ink : colors.muted}>
              {label}
            </ThemedText>
            <ThemedText variant="meta">{n}</ThemedText>
          </Pressable>
        ))}
      </View>
      {people.length === 0 ? (
        <ThemedText variant="meta" style={styles.empty}>
          Nobody here yet.
        </ThemedText>
      ) : (
        <Panel>
          {people.map((person, index) => {
            const tags = teachingTags(person.teaching, 2).shown;
            const status =
              person.status === "on_leave"
                ? { label: "On leave", tone: "caution" as const }
                : person.status === "suspended"
                  ? { label: "Suspended", tone: "critical" as const }
                  : person.joinState !== "joined"
                    ? { label: "Not joined", tone: "neutral" as const }
                    : null;
            return (
              <Row
                key={person.id}
                first={index === 0}
                leading={<Avatar name={fullName(person)} />}
                hue={hue}
                title={fullName(person)}
                meta={tags.length > 0 ? tags.map((t: { label: string; classTeacher: boolean }) => (t.classTeacher ? `★ ${t.label}` : t.label)).join(" · ") : person.designation ?? "Staff"}
                trailing={status ? <StatusPill label={status.label} tone={status.tone} /> : undefined}
                onPress={() => router.push({ pathname: "/staff-profile", params: { id: person.id } })}
                testID={`more-person-${person.id}`}
              />
            );
          })}
        </Panel>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    gap: spacing.md,
  },
  faces: {
    flexDirection: "row",
  },
  face: {
    width: 38,
    height: 38,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.9)",
  },
  faceOverlap: {
    marginLeft: -10,
  },
  segment: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    marginBottom: spacing.md - 2,
    borderRadius: radius.full,
    backgroundColor: "#E6E8EE",
  },
  segmentItem: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.full,
  },
  segmentOn: {
    backgroundColor: colors.surface,
    boxShadow: "0 1px 3px rgba(16, 24, 40, 0.1)",
  },
  empty: {
    marginHorizontal: spacing.xs,
  },
});

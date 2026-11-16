import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useActiveOrganizationName } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { formatReadableDate, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { AREAS } from "./areas";
import { Head, Hero, Note, Panel, Row, Shortcuts, TimeLine, neutral } from "./parts";
import type { Hue, Shortcut } from "./parts";
import { fraction, monthInitials } from "./time";

const look = AREAS.school;
const hue: Hue = { fg: look.h0, bg: look.tint };

/**
 * School in More: the session's year line, every branch as a card (the one
 * you are in outlined), four doors, and the sessions. Switching branch or
 * session stays in the account popup; this screen is about the branches and
 * sessions themselves.
 */
export function SchoolArea() {
  const { organizationId, schoolId, branches, years, academicYear, currentYear } = useActiveContext();
  const orgName = useActiveOrganizationName();
  const { has } = usePermissions();
  const today = todayIso();
  const canBranches = has("school:read") && (has("school:create") || has("school:update") || has("school:delete"));
  const canSessions = has("academic_year:read") && (has("academic_year:create") || has("academic_year:update"));

  // Per-branch figures come from Home's All branches read (org-wide, ADR-067).
  const org = trpc.home.org.useQuery(
    { organizationId: organizationId ?? "", date: today },
    { enabled: Boolean(organizationId) && canBranches, staleTime: 120_000, retry: false },
  );
  const figures = new Map((org.data?.branches ?? []).map((row) => [row.schoolId, row]));

  const running = currentYear;
  const shortcuts: Shortcut[] = [
    has("school:create") ? { key: "add-branch", label: "Add a branch", icon: "branches", hue, add: true, onPress: () => router.push("/branch-form") } : null,
    has("academic_year:create") ? { key: "add-session", label: "Create a session", icon: "sessions", hue, add: true, onPress: () => router.push("/session-form") } : null,
    has("attendance:update") ? { key: "holidays", label: "Holidays", icon: "calendar", hue, onPress: () => router.push("/attendance/manage/calendar") } : null,
    canBranches ? { key: "branches", label: "Branches", icon: "branches", hue, onPress: () => router.push("/branches") } : null,
    canSessions ? { key: "sessions", label: "Sessions", icon: "sessions", hue, onPress: () => router.push("/sessions") } : null,
  ].filter((item): item is Shortcut => item !== null);

  const sortedYears = [...years].sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <View>
      <Hero
        h0={look.h0}
        h1={look.h1}
        kicker={orgName}
        title={running ? `${running.name} is running` : "No running session"}
        sub={running ? `${formatReadableDate(running.startDate)} to ${formatReadableDate(running.endDate)}` : "Make a session the running one in Sessions"}
        testID="more-school-hero"
      >
        {running ? (
          <>
            <TimeLine
              todayAt={fraction(running.startDate, running.endDate, today)}
              segments={[{ key: "year", from: 0, to: 1.015, fill: fraction(running.startDate, running.endDate, today) }]}
            />
            <View style={styles.months}>
              {monthInitials(running.startDate).map((m, i) => (
                <ThemedText key={i} variant="caption" color="rgba(255,255,255,0.8)" style={styles.month}>
                  {m}
                </ThemedText>
              ))}
            </View>
          </>
        ) : null}
      </Hero>

      {canBranches && branches.length > 0 ? (
        <>
          <Head title="Branches" link={{ label: String(branches.length), onPress: () => router.push("/branches") }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.branches} style={styles.branchScroll}>
            {/* The branch you are in comes first. */}
            {[...branches].sort((a, b) => Number(b.id === schoolId) - Number(a.id === schoolId)).map((branch) => {
              const here = branch.id === schoolId;
              const f = figures.get(branch.id);
              return (
                <Pressable
                  key={branch.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${branch.name}${here ? ", you are here" : ""}`}
                  onPress={() => (has("school:update") ? router.push({ pathname: "/branch-form", params: { id: branch.id } }) : router.push("/branches"))}
                  style={({ pressed }) => [styles.branch, here ? styles.branchHere : null, pressed ? styles.pressed : null]}
                  testID={`more-branch-${branch.id}`}
                >
                  <View style={styles.branchTop}>
                    <View style={[styles.branchIcon, { backgroundColor: look.tint }]}>
                      <AppIcon name="branches" size={20} color={look.h0} />
                    </View>
                    {here ? <StatusPill label="You are here" tone="neutral" style={{ backgroundColor: look.tint }} /> : null}
                  </View>
                  <ThemedText variant="name" numberOfLines={1} style={styles.branchName}>
                    {branch.name}
                  </ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {[branch.code, branch.city].filter(Boolean).join(" · ") || " "}
                  </ThemedText>
                  {f && (f.students !== null || f.staff) ? (
                    <View style={styles.branchStats}>
                      {f.students !== null ? (
                        <View>
                          <ThemedText variant="numeric">{f.students}</ThemedText>
                          <ThemedText variant="caption" color={colors.muted}>students</ThemedText>
                        </View>
                      ) : null}
                      {f.staff ? (
                        <View>
                          <ThemedText variant="numeric">{f.staff.total}</ThemedText>
                          <ThemedText variant="caption" color={colors.muted}>staff</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      ) : null}

      {shortcuts.length > 0 ? (
        <>
          <Head title="Go to" />
          <Shortcuts items={shortcuts} />
        </>
      ) : null}

      {canSessions && sortedYears.length > 0 ? (
        <>
          <Head title="Sessions" link={{ label: "All", onPress: () => router.push("/sessions") }} />
          <Panel>
            {sortedYears.slice(0, 5).map((year, index) => {
              const isRunning = year.id === running?.id;
              const viewing = year.id === academicYear?.id && !isRunning;
              const upcoming = year.startDate > today;
              const pill = isRunning
                ? { label: "Running", tone: "positive" as const }
                : viewing
                  ? { label: "Viewing", tone: "caution" as const }
                  : upcoming
                    ? { label: "Upcoming", tone: "neutral" as const }
                    : { label: "Ended", tone: "neutral" as const };
              return (
                <Row
                  key={year.id}
                  first={index === 0}
                  icon="sessions"
                  hue={isRunning ? hue : neutral}
                  title={year.name}
                  meta={`${formatReadableDate(year.startDate)} to ${formatReadableDate(year.endDate)}`}
                  trailing={<StatusPill label={pill.label} tone={pill.tone} />}
                  onPress={() =>
                    has("academic_year:update")
                      ? router.push({ pathname: "/session-form", params: { id: year.id } })
                      : router.push("/sessions")
                  }
                />
              );
            })}
          </Panel>
        </>
      ) : null}

      <Note icon="branches" text="Switching branch or session is in your account, from the avatar on Home." />
    </View>
  );
}

const styles = StyleSheet.create({
  months: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  month: {
    flex: 1,
    textAlign: "center",
  },
  branchScroll: {
    marginHorizontal: -spacing.lg,
  },
  branches: {
    gap: spacing.md - 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  branch: {
    width: 214,
    padding: spacing.lg,
    borderRadius: radius.xl - 2,
    backgroundColor: colors.surface,
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.06)",
  },
  branchHere: {
    borderWidth: 2,
    borderColor: look.h0,
  },
  branchTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  branchIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  branchName: {
    marginTop: spacing.md,
  },
  branchStats: {
    flexDirection: "row",
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
});

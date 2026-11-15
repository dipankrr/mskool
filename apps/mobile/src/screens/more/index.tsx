import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { EmptyState } from "../../components/empty-state";
import { IconTile } from "../../components/icon-tile";
import { StatusPill } from "../../components/status-pill";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { countBySegment, isEntryOpen, sortExams } from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import { stageLabel, stageTone } from "../exams/meta";
import { useExamList, useExamScope } from "../exams/use-exam-data";
import { ShellBar } from "../shell/shell-bar";
import { fullName, hasLeft, staffCounts } from "../staff/staff-list-logic";
import { teachingLine } from "../staff/teaching-logic";
import { ShowcaseCard, ShowcaseStats } from "./showcase-card";
import type { Hue, ShowcaseLink } from "./showcase-card";

/** One colour per area, as on the approved mockup (more-and-sidebar-v2). */
const HUES = {
  exams: { fg: "#C4520A", tint: "#FFF0E3" },
  academics: { fg: "#6941C6", tint: "#F1ECFD" },
  staff: { fg: "#0E7490", tint: "#E3F5F8" },
  school: { fg: "#475467", tint: "#EEF0F4" },
} as const satisfies Record<string, Hue>;

/**
 * "More": a front door for each big area that has no tab of its own (Exams,
 * Academics, Staff, School). Each card shows the area's state and a few doors
 * into it. Every other screen is in the sidebar, and who-and-where (branch,
 * session, profile, sign out) is in the account popup, both on the top row.
 *
 * A card exists only when the caller's permission hints open its area, and a
 * link only when they open that part; every gate is a permission string
 * (ADR-044). A read that has not arrived, or failed, leaves the card standing
 * with its plain description: the doors still work, and the area's own screen
 * is where its error and retry live.
 */
export function MoreScreen() {
  const { has } = usePermissions();
  const { branches, academicYear, currentYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const tabSpace = useTabBarSpace();

  const showExams = has("exam:read");
  const showAcademics = has("class:read") || has("subject:read");
  const showStaff = has("staff:read");
  // A teacher's slice of Staff: what they teach, not the staff room.
  const showTeaching = !showStaff && has("teacher_assignment:read");
  const canBranches =
    has("school:read") && (has("school:create") || has("school:update") || has("school:delete"));
  const canSessions =
    has("academic_year:read") && (has("academic_year:create") || has("academic_year:update"));
  const showSchool = canBranches || canSessions;
  const nothing = !showExams && !showAcademics && !showStaff && !showTeaching && !showSchool;

  const meta = [branchName, academicYear?.name].filter(Boolean).join(" · ");
  const schoolLinks: ShowcaseLink[] = [
    canBranches
      ? {
          key: "branches",
          label: copy.more.school.branches,
          detail: copy.more.school.branchesDetail,
          onPress: () => router.push("/branches"),
        }
      : null,
    canSessions
      ? {
          key: "sessions",
          label: copy.more.school.sessions,
          detail: copy.more.school.sessionsDetail,
          onPress: () => router.push("/sessions"),
        }
      : null,
  ].filter((link) => link !== null);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
        <ShellBar />
        <View style={styles.header}>
          <ThemedText variant="title">{copy.more.title}</ThemedText>
          {meta ? (
            <ThemedText variant="subtitle" numberOfLines={1} testID="more-context">
              {meta}
            </ThemedText>
          ) : null}
        </View>

        {nothing ? (
          <EmptyState
            icon="menu"
            title={copy.more.emptyTitle}
            message={copy.more.emptyBody}
            testID="more-empty"
          />
        ) : (
          <View style={styles.cards}>
            {showExams ? <ExamsCard /> : null}
            {showAcademics ? <AcademicsCard /> : null}
            {showStaff ? <StaffCard /> : null}
            {showTeaching ? <TeachingCard /> : null}
            {showSchool ? (
              <ShowcaseCard
                title={copy.more.school.title}
                sub={[
                  canBranches ? copy.more.school.branchCount(branches.length) : null,
                  currentYear ? copy.more.school.running(currentYear.name) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                icon="branches"
                hue={HUES.school}
                links={schoolLinks}
                onPress={() => router.push(canBranches ? "/branches" : "/sessions")}
                testID="more-school"
              />
            ) : null}

            <View
              style={styles.soon}
              accessible
              accessibilityLabel={`${copy.more.timetable.title}, ${copy.more.soon}`}
              testID="more-timetable"
            >
              <IconTile name="clock" size={40} />
              <View style={styles.soonText}>
                <ThemedText variant="name" color={colors.muted}>
                  {copy.more.timetable.title}
                </ThemedText>
                <ThemedText variant="meta">{copy.more.timetable.detail}</ThemedText>
              </View>
              <StatusPill label={copy.more.soon} tone="neutral" style={styles.soonPill} />
            </View>

            <View style={styles.hint}>
              <AppIcon name="menu" size={16} color={colors.muted} />
              <ThemedText variant="meta">{copy.more.menuHint}</ThemedText>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Exams: what is open for marks now, and how the session's exams stand. */
function ExamsCard() {
  const scope = useExamScope();
  const list = useExamList();
  const c = copy.more.exams;

  const rows = list.data ?? [];
  const open = sortExams(rows.filter((row) => isEntryOpen(row.status)));
  const first = open[0] ?? null;
  const counts = countBySegment(rows);
  const sub = !list.data
    ? c.idle
    : first
      ? open.length > 1
        ? c.openMany(open.length)
        : c.open(first.name)
      : rows.length === 0
        ? c.none
        : c.counts(counts.upcoming, counts.published);

  const links: ShowcaseLink[] = [
    {
      key: "all",
      label: c.all,
      detail: list.data ? c.allDetail(rows.length) : null,
      onPress: () => router.push("/exams"),
    },
    {
      key: "term-grades",
      label: c.termGrades,
      detail: c.termGradesDetail,
      onPress: () => router.push("/exams/term-grades"),
    },
    scope.canUpdate
      ? { key: "final", label: c.final, detail: c.finalDetail, onPress: () => router.push("/exams/final") }
      : null,
    scope.canCreate || scope.canUpdate
      ? { key: "rules", label: c.rules, detail: c.rulesDetail, onPress: () => router.push("/exams/setup") }
      : null,
  ].filter((link) => link !== null);

  return (
    <ShowcaseCard
      title={c.title}
      sub={sub}
      icon="exams"
      hue={HUES.exams}
      aside={
        first ? (
          <StatusPill
            label={stageLabel(first.status)}
            tone={stageTone(first.status)}
            style={styles.aside}
          />
        ) : undefined
      }
      links={links}
      onPress={() =>
        first && open.length === 1
          ? router.push({ pathname: "/exams/[examId]", params: { examId: first.id } })
          : router.push("/exams")
      }
      testID="more-exams"
    />
  );
}

/** Academics: the four counts that describe how the school is laid out. */
function AcademicsCard() {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const c = copy.more.academics;

  const orgReady = ready && Boolean(organizationId);
  const hasYear = Boolean(academicYear?.id);
  const orgArgs = { organizationId: organizationId ?? "", schoolId: schoolId ?? "" };
  const yearArgs = { ...orgArgs, academicYearId: academicYear?.id ?? "" };
  const fiveMinutes = { staleTime: 300_000 };

  const classes = trpc.academic.class.list.useQuery(orgArgs, {
    enabled: orgReady && has("class:read"),
    ...fiveMinutes,
  });
  const sections = trpc.academic.section.list.useQuery(yearArgs, {
    enabled: orgReady && hasYear && has("section:read"),
    staleTime: 60_000,
  });
  const subjects = trpc.subject.list.useQuery(orgArgs, {
    enabled: orgReady && has("subject:read"),
    ...fiveMinutes,
  });
  const terms = trpc.academic.term.list.useQuery(yearArgs, {
    enabled: orgReady && hasYear && has("academic_year:read"),
    ...fiveMinutes,
  });

  const stats = [
    has("class:read") ? { key: "classes", value: classes.data?.length ?? null, label: c.classes } : null,
    has("section:read")
      ? {
          key: "sections",
          value: sections.data ? sections.data.filter((row) => row.status === "active").length : null,
          label: c.sections,
        }
      : null,
    has("subject:read") ? { key: "subjects", value: subjects.data?.length ?? null, label: c.subjects } : null,
    has("academic_year:read") ? { key: "terms", value: terms.data?.length ?? null, label: c.terms } : null,
  ].filter((stat) => stat !== null);

  const links: ShowcaseLink[] = [
    has("class:read")
      ? { key: "classes", label: c.classesLink, detail: c.classesDetail, onPress: () => router.push("/class-section") }
      : null,
    has("subject:read")
      ? { key: "subjects", label: c.subjectsLink, detail: c.subjectsDetail, onPress: () => router.push("/subject-mapping") }
      : null,
    has("academic_year:read") && hasYear
      ? { key: "terms", label: c.termsLink, detail: c.termsDetail, onPress: () => router.push("/terms") }
      : null,
  ].filter((link) => link !== null);

  return (
    <ShowcaseCard
      title={c.title}
      sub={c.sub}
      icon="stack"
      hue={HUES.academics}
      links={links}
      onPress={() => router.push("/academic-setup")}
      testID="more-academics"
    >
      <ShowcaseStats stats={stats} />
    </ShowcaseCard>
  );
}

/** Staff: who is on roll, who has not joined, and the teaching gaps. */
function StaffCard() {
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const { has } = usePermissions();
  const c = copy.more.staff;
  const here = Boolean(organizationId && schoolId);

  const list = trpc.staff.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", includeInactive: true },
    { enabled: here, staleTime: 60_000 },
  );
  // Gaps describe the running session; in a past one they would mislead.
  const canSeeGaps =
    has("teacher_assignment:create") && Boolean(academicYear) && academicYear?.id === currentYear?.id;
  const overview = trpc.assignment.overview.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" },
    { enabled: here && canSeeGaps, staleTime: 60_000 },
  );

  const people = list.data ?? [];
  const counts = list.data ? staffCounts(people) : null;
  const sub = counts
    ? [c.onRoll(counts.all), counts.notOnApp.length > 0 ? c.notOnApp(counts.notOnApp.length) : null]
        .filter(Boolean)
        .join(" · ")
    : c.sub;
  const faces = people.filter((person) => !hasLeft(person)).slice(0, 3);
  const gaps = overview.data
    ? overview.data.totals.noClassTeacher + overview.data.totals.noTeacher
    : null;
  const hasSections = (overview.data?.sections.length ?? 0) > 0;

  const links: ShowcaseLink[] = [
    { key: "people", label: c.people, detail: c.peopleDetail, onPress: () => router.push("/staff-list") },
    has("teacher_assignment:read")
      ? {
          key: "teaching",
          label: c.teaching,
          detail:
            gaps === null || !hasSections ? c.teachingDetail : gaps > 0 ? c.gaps(gaps) : c.noGaps,
          warn: gaps !== null && hasSections && gaps > 0,
          onPress: () => router.push("/teaching"),
        }
      : null,
    has("role_assignment:read") || has("role_permission:read")
      ? { key: "roles", label: c.roles, detail: c.rolesDetail, onPress: () => router.push("/roles") }
      : null,
  ].filter((link) => link !== null);

  return (
    <ShowcaseCard
      title={c.title}
      sub={sub}
      icon="students"
      hue={HUES.staff}
      aside={
        faces.length > 0 ? (
          <View style={styles.faces}>
            {faces.map((person, index) => (
              <Avatar
                key={person.id}
                name={fullName(person)}
                style={[styles.face, index === 0 ? null : styles.faceOverlap]}
              />
            ))}
          </View>
        ) : undefined
      }
      links={links}
      onPress={() => router.push("/staff-list")}
      testID="more-staff"
    />
  );
}

/** A teacher's own teaching, in the words Home uses for it. */
function TeachingCard() {
  const { organizationId, schoolId, academicYear, currentYear } = useActiveContext();
  const c = copy.more.teaching;
  const ready =
    Boolean(organizationId && schoolId && academicYear) && academicYear?.id === currentYear?.id;
  const mine = trpc.assignment.mine.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: ready, staleTime: 60_000 },
  );
  const line = mine.data ? teachingLine(mine.data) ?? c.none : null;

  return (
    <ShowcaseCard
      title={c.title}
      sub={line}
      icon="school"
      hue={HUES.staff}
      links={[]}
      onPress={() => router.push("/teaching")}
      testID="more-teaching"
    />
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  header: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  cards: {
    gap: spacing.md,
  },
  aside: {
    alignSelf: "center",
    backgroundColor: colors.surface,
  },
  faces: {
    flexDirection: "row",
    alignItems: "center",
  },
  face: {
    width: 32,
    height: 32,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  faceOverlap: {
    marginLeft: -spacing.sm,
  },
  soon: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  soonText: {
    flex: 1,
    gap: spacing.xxs,
  },
  soonPill: {
    alignSelf: "center",
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});

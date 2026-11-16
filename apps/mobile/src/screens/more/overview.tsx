import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { Href } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { usePermissions } from "../../hooks/use-permissions";
import { isEntryOpen, sortExams } from "../../lib/exams";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { stageLabel } from "../exams/meta";
import { useExamList } from "../exams/use-exam-data";
import { firstName, greetingFor, istHour, percent } from "../staff-home/home-logic";
import { useHomeData } from "../staff-home/use-home-data";
import { staffCounts } from "../staff/staff-list-logic";
import { teachingLine } from "../staff/teaching-logic";
import { AREAS, withAlpha } from "./areas";
import type { AreaKey } from "./areas";
import { Head, Hero, HeroStats, Panel, Row, Shortcuts, caution, neutral } from "./parts";
import type { Hue, Shortcut } from "./parts";
import { currentTerm, daysUntil } from "./time";

const hueOf = (area: AreaKey): Hue => ({ fg: AREAS[area].h0, bg: AREAS[area].tint });

type Need = {
  key: string;
  area: AreaKey | null;
  icon: AppIconName;
  title: string;
  meta: string;
  action: string;
  go: () => void;
  warn?: boolean;
};

/**
 * Overview, the area More opens on: the school today in one hero, everything
 * that needs the caller from every area in one list, a tile per area that
 * opens its tab, and the things they most often start.
 *
 * Nothing here depends on a role's name. Each part asks only for the read
 * its permission hint allows (Home's reads, shared through the query cache),
 * and a part with nothing to say is left out.
 */
export function OverviewArea({ areas, onOpen }: { areas: AreaKey[]; onOpen: (area: AreaKey) => void }) {
  const { me } = useMe();
  const { has } = usePermissions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const home = useHomeData({ allBranches: false });
  const exams = useExamList();

  const yearArgs = { organizationId: organizationId ?? "", schoolId: schoolId ?? "", academicYearId: academicYear?.id ?? "" };
  const terms = trpc.academic.term.list.useQuery(yearArgs, {
    enabled: Boolean(organizationId && academicYear) && has("academic_year:read"),
    staleTime: 300_000,
  });
  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId) && has("class:read"), staleTime: 300_000 },
  );
  const ending = trpc.role.ending.useQuery(
    { organizationId: organizationId ?? "", forSchoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId) && has("role_assignment:read") && home.running, staleTime: 120_000 },
  );

  const term = currentTerm(terms.data ?? [], home.today);
  const sections = home.attendance.data?.sections ?? [];
  const markedSections = sections.filter((day) => day.marked > 0);
  const presentPct = percent(
    markedSections.reduce((n, day) => n + day.present, 0),
    markedSections.reduce((n, day) => n + day.marked, 0),
  );
  const staffNow = home.staff.data ? staffCounts(home.staff.data) : null;
  const awayToday = (home.staff.data ?? []).filter((person) => person.status === "on_leave").length;
  const examRows = sortExams(exams.data ?? []);
  const openExams = examRows.filter((row) => isEntryOpen(row.status));
  const ownLine = home.mine.data ? teachingLine(home.mine.data) : null;

  // Cheap to build from data already in hand, so no memo.
  const needs: Need[] = (() => {
    const list: Need[] = [];
    // The caller's own work first: papers to finish, their classes to mark.
    const papers = (home.papers.data?.open ?? []).filter((paper) => paper.entered < paper.students);
    if (papers.length > 0) {
      const next = papers[0]!;
      list.push({
        key: "papers",
        area: "exams",
        icon: "marks",
        title: papers.length === 1 ? `Enter ${next.subjectName} marks` : `${papers.length} papers to finish`,
        meta: `${next.examName} · ${next.subjectName} ${next.className}-${next.sectionName}, ${next.entered} of ${next.students}`,
        action: "Enter",
        go: () => router.push({ pathname: "/exams/[examId]", params: { examId: next.examId } }),
      });
    }
    if (home.can.markAttendance && !home.attendance.data?.wholeSchool) {
      const unmarked = sections.filter((day) => day.marked === 0);
      if (unmarked.length > 0) {
        list.push({
          key: "attendance",
          area: null,
          icon: "attendance",
          title: unmarked.length === 1 ? `Mark ${label(unmarked[0]!)}` : `${unmarked.length} classes to mark`,
          meta: `Today · ${unmarked.map(label).slice(0, 3).join(", ")}`,
          action: "Mark",
          go: () => router.navigate("/attendance"),
        });
      }
    } else if (home.attendance.data?.wholeSchool) {
      const unmarked = sections.filter((day) => day.marked === 0);
      if (unmarked.length > 0 && sections.length > 0) {
        list.push({
          key: "attendance",
          area: null,
          icon: "attendance",
          title: `${unmarked.length} of ${sections.length} classes not marked`,
          meta: `Today · ${unmarked.map(label).slice(0, 3).join(", ")}`,
          action: "View",
          go: () => router.navigate("/attendance"),
        });
      }
    }
    for (const exam of examRows) {
      if (exam.status === "under_verification" && has("marks:verify")) {
        list.push({
          key: `verify-${exam.id}`,
          area: "exams",
          icon: "checkCircle",
          title: `Verify ${exam.name}`,
          meta: `${exam.termName} · waiting for verification`,
          action: "Verify",
          go: () => router.push({ pathname: "/exams/[examId]", params: { examId: exam.id } }),
        });
      }
    }
    const gaps = home.teaching.data ? home.teaching.data.totals.noClassTeacher + home.teaching.data.totals.noTeacher : 0;
    if (gaps > 0 && home.teaching.data) {
      const t = home.teaching.data.totals;
      list.push({
        key: "gaps",
        area: "staff",
        icon: "school",
        title: `${gaps} teaching ${gaps === 1 ? "gap" : "gaps"}`,
        meta: [
          t.noClassTeacher ? `${t.noClassTeacher} without a class teacher` : null,
          t.noTeacher ? `${t.noTeacher} subjects without a teacher` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        action: "Fill",
        go: () => router.push("/teaching"),
        warn: true,
      });
    }
    if (staffNow && staffNow.notOnApp.length > 0) {
      list.push({
        key: "joined",
        area: "staff",
        icon: "mail",
        title: `${staffNow.notOnApp.length} staff not on the app`,
        meta: staffNow.notOnApp.slice(0, 2).map((p) => `${p.firstName} ${p.lastName}`.trim()).join(", "),
        action: "Invite",
        go: () => router.push("/staff-list"),
      });
    }
    const soon = (ending.data ?? []).filter((role) => {
      const days = daysUntil(role.expiresAt.slice(0, 10), home.today);
      return days >= 0 && days <= 7;
    });
    if (soon.length > 0) {
      const first = soon[0]!;
      const days = daysUntil(first.expiresAt.slice(0, 10), home.today);
      list.push({
        key: "ending",
        area: "staff",
        icon: "shield",
        title: soon.length === 1 ? `A role ends ${days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`}` : `${soon.length} roles end this week`,
        meta: `${first.name} · ${first.scopeLabel}`,
        action: "Extend",
        go: () => router.push("/roles"),
      });
    }
    const attention = home.roster.data?.attention;
    if (attention && attention.noSection > 0) {
      list.push({
        key: "no-section",
        area: null,
        icon: "students",
        title: `${attention.noSection} students have no section`,
        meta: "Students · place them in a class",
        action: "Place",
        go: () => router.navigate("/(staff)/(tabs)/students"),
      });
    }
    if (attention && attention.noPhoto > 0 && has("student:update")) {
      list.push({
        key: "no-photo",
        area: null,
        icon: "camera",
        title: `${attention.noPhoto} students without a photo`,
        meta: "Students · bulk upload or photo day",
        action: "Add",
        go: () => router.push("/students/photos"),
      });
    }
    return list;
  })();

  const tiles = areas
    .filter((area) => area !== "overview")
    .map((area) => ({ area, line: tileLine(area) }));

  function tileLine(area: AreaKey): string {
    switch (area) {
      case "exams":
        return openExams[0]
          ? `${openExams[0].name} · ${stageLabel(openExams[0].status)}`
          : exams.data
            ? `${exams.data.length} this session`
            : "Marks and results";
      case "academics":
        return classes.data ? `${classes.data.length} classes${term ? ` · ${term.name}` : ""}` : "Classes and subjects";
      case "staff":
        return staffNow ? `${staffNow.all} on roll${awayToday ? ` · ${awayToday} away` : ""}` : "People and roles";
      case "teaching":
        return ownLine ?? "Your classes";
      case "school":
        return academicYear ? `${academicYear.name} running` : "Branches and sessions";
      default:
        return "";
    }
  }

  const shortcuts = useShortcuts();
  const hour = istHour();
  const name = firstName(me?.user.name);
  const kicker = [branchName, academicYear?.name, term?.name].filter(Boolean).join(" · ");
  const sub = home.past
    ? `Viewing ${academicYear?.name ?? "a past session"}. Today's figures are hidden.`
    : sections.length > 0
      ? `${home.attendance.data?.wholeSchool ? "Attendance" : "Your classes' attendance"} is in for ${markedSections.length} of ${sections.length}.`
      : ownLine;

  return (
    <View>
      <Hero h0="#101828" h1="#2C3A52" kicker={kicker} title={`${greetingFor(hour)}${name ? `, ${name}` : ""}`} sub={sub} testID="more-overview-hero">
        {home.running ? (
          <HeroStats
            stats={[
              { key: "students", value: home.roster.data?.counts.current, label: "students" },
              { key: "present", value: presentPct === null ? null : `${presentPct}%`, label: "present" },
              { key: "staff", value: staffNow?.all, label: "staff" },
              { key: "classes", value: classes.data?.length, label: "classes" },
            ]}
          />
        ) : null}
      </Hero>

      {needs.length > 0 ? (
        <>
          <Head title="Needs you" count={needs.length} />
          <Panel testID="more-overview-needs">
            {needs.slice(0, 6).map((need, index) => {
              const hue = need.warn ? caution : need.area ? hueOf(need.area) : neutral;
              return (
                <Row
                  key={need.key}
                  first={index === 0}
                  icon={need.icon}
                  hue={hue}
                  title={need.title}
                  meta={need.meta}
                  action={{ label: need.action, onPress: need.go }}
                  testID={`more-need-${need.key}`}
                />
              );
            })}
          </Panel>
        </>
      ) : null}

      {tiles.length > 0 ? (
        <>
          <Head title="Areas" />
          <View style={styles.tiles}>
            {tiles.map(({ area, line }) => {
              const look = AREAS[area];
              return (
                <Pressable
                  key={area}
                  accessibilityRole="button"
                  accessibilityLabel={`${look.label}. ${line}`}
                  onPress={() => onOpen(area)}
                  style={({ pressed }) => [
                    styles.tile,
                    tiles.length % 2 === 1 && area === tiles[tiles.length - 1]!.area ? styles.tileWide : null,
                    { experimental_backgroundImage: `linear-gradient(160deg, #FFFFFF 35%, ${look.band})` },
                    pressed ? styles.pressed : null,
                  ]}
                  testID={`more-tile-${area}`}
                >
                  <View
                    style={[
                      styles.tileIcon,
                      {
                        experimental_backgroundImage: `linear-gradient(150deg, ${look.h1}, ${look.h0})`,
                        boxShadow: `0 5px 12px ${withAlpha(look.h0, 0.3)}`,
                      },
                    ]}
                  >
                    <AppIcon name={look.icon} size={19} color={colors.onAccent} />
                  </View>
                  <View style={styles.tileName}>
                    <ThemedText variant="name">{look.label}</ThemedText>
                    <AppIcon name="chevronRight" size={14} color={look.h0} />
                  </View>
                  <ThemedText variant="meta" numberOfLines={2}>
                    {line}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {shortcuts.length > 0 ? (
        <>
          <Head title="Start something" />
          <Shortcuts items={shortcuts} />
        </>
      ) : null}
    </View>
  );
}

function label(day: { className: string; sectionName: string }): string {
  const cls = day.className.replace(/^class\s+/i, "").trim();
  return day.sectionName.toLowerCase().startsWith(cls.toLowerCase()) ? day.sectionName : `${cls}-${day.sectionName}`;
}

/** The four things this caller most often starts, by what they may do. */
function useShortcuts(): Shortcut[] {
  const { has } = usePermissions();
  const all: (Shortcut & { can: boolean })[] = [
    { key: "create-exam", label: "Create an exam", icon: "exams", hue: hueOf("exams"), add: true, can: has("exam:create"), onPress: () => router.push("/exams/exam-form") },
    { key: "add-staff", label: "Add staff", icon: "personAdd", hue: hueOf("staff"), add: true, can: has("staff:create"), onPress: () => router.push("/staff-form") },
    { key: "admit", label: "Admit a student", icon: "students", hue: hueOf("overview"), add: true, can: has("student:create"), onPress: () => router.push("/admit-student") },
    { key: "add-class", label: "Add a class", icon: "stack", hue: hueOf("academics"), add: true, can: has("class:create"), onPress: () => router.push({ pathname: "/class-section", params: { create: "1" } } as Href) },
    { key: "assign", label: "Assign a teacher", icon: "school", hue: hueOf("staff"), add: true, can: has("teacher_assignment:create"), onPress: () => router.push("/teaching") },
    { key: "marks", label: "Enter marks", icon: "marks", hue: hueOf("exams"), add: true, can: has("marks:create"), onPress: () => router.push("/exams") },
    { key: "homework", label: "Give homework", icon: "homework", hue: hueOf("academics"), add: true, can: has("homework:create"), onPress: () => router.push("/homework/give") },
    { key: "mark", label: "Mark attendance", icon: "attendance", hue: hueOf("overview"), add: true, can: has("attendance:create"), onPress: () => router.navigate("/attendance") },
  ];
  return all.filter((item) => item.can).slice(0, 4);
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md - 2,
  },
  tile: {
    width: "48.4%",
    minHeight: 124,
    padding: spacing.lg - 2,
    borderRadius: radius.xl - 2,
    gap: spacing.xxs,
    boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04), 0 6px 18px rgba(16, 24, 40, 0.06)",
  },
  tileWide: {
    width: "100%",
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "auto",
  },
  tileName: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
});

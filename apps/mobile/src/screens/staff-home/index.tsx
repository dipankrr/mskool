import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveBranchName, useActiveContext } from "../../hooks/use-active-context";
import { useMe } from "../../hooks/use-me";
import { copy } from "../../lib/copy";
import { formatLongWeekday } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { fontFamily, spacing } from "../../theme/tokens";
import { ShellBar } from "../shell/shell-bar";
import {
  attendanceMode,
  classTeacherOf,
  firstName,
  greetingFor,
  istHour,
  ownSections,
  pageOrder,
  paperProgress,
  sectionShort,
  sortWaiting,
  teachingPairs,
  type Part,
} from "./home-logic";
import { OpenExamsCard } from "./open-exams";
import {
  ComingUp,
  DayOffCard,
  FeesCard,
  MarksCard,
  SchoolToday,
  SectionError,
  StaffCard,
  StudentsCard,
  WaitingOnYou,
  buildWaiting,
  comingUpItems,
} from "./school-parts";
import { SetupCard } from "./setup-card";
import { MyAttendance, YouTeach } from "./teaching-parts";
import { ScopeSwitch, TrustView } from "./trust-parts";
import { Band, HOME_GUTTER } from "./ui";
import { useHomeData } from "./use-home-data";

const c = copy.home;

/**
 * Staff Home (ADR-072; mockup `docs/design/mobile/prototype/staff-home-v5.html`).
 *
 * One long page put together from what this person is assigned (their own
 * sections and subject pairs), what they may do (school-wide areas) and how
 * wide their grants reach. Never from a role's name: a school can make a
 * vice principal anything from a teacher to an owner, and the page follows.
 *
 * Order is fixed (`pageOrder`); missing parts drop out. Once the caller's own
 * sections are marked, their teaching moves below the school's cards.
 */
export function StaffHomeScreen() {
  const { me } = useMe();
  const { organizationId, select, academicYear } = useActiveContext();
  const branchName = useActiveBranchName();
  const tabSpace = useTabBarSpace();
  const [allBranches, setAllBranches] = useState(false);

  const d = useHomeData({ allBranches });
  const offerAll = Boolean(d.membership?.scopeTypes.includes("org") && (d.membership?.schools.length ?? 0) >= 2);
  const showAll = offerAll && allBranches;

  const today = d.today;
  const mine = d.mine.data ?? [];
  const att = d.attendance.data;
  const dayKind = att?.day?.kind ?? null;
  const own = att ? ownSections(mine, att.sections) : [];
  const mode = d.can.markAttendance || d.can.readAttendance ? attendanceMode(own, dayKind) : "none";
  const pairs = teachingPairs(mine);
  const covers = new Map(mine.filter((m) => m.effectiveTo).map((m) => [m.sectionId, m.effectiveTo as string]));
  const ctRows = classTeacherOf(mine);
  const ctSections = new Set(ctRows.map((r) => r.sectionId));
  const papers = d.papers.data?.open ?? [];
  const progress = paperProgress(papers, today);
  const sat = progress.left.filter((p) => p.examDate <= today);

  const gapsSections = (d.teaching.data?.sections ?? []).filter((s) => s.gaps > 0);
  const waiting = sortWaiting(
    buildWaiting({
      papersLeft:
        sat.length > 0
          ? {
              count: sat.length,
              label: sat
                .slice(0, 2)
                .map((p) => `${sectionShort(p)} ${p.subjectName}`)
                .join(", ") + (sat.length > 2 ? ` +${sat.length - 2}` : ""),
              first: { examId: sat[0]!.examId, scheduleId: sat[0]!.scheduleId },
            }
          : null,
      homeworkToCheck: d.homework.data
        ? {
            count: d.homework.data.toCheck.reduce((n, row) => n + row.toCheck, 0),
            pieces: new Set(d.homework.data.toCheck.map((row) => row.homework.id)).size,
          }
        : null,
      chequesPending: d.can.approvePayments && d.fees.data ? d.fees.data.pending : null,
      gaps: d.teaching.data
        ? {
            count: d.teaching.data.totals.noTeacher + d.teaching.data.totals.noClassTeacher,
            where: gapsSections
              .slice(0, 3)
              .map((s) => sectionShort(s))
              .join(", ") + (gapsSections.length > 3 ? ` +${gapsSections.length - 3}` : ""),
          }
        : null,
      needSection: d.can.placeStudents ? (d.roster.data?.attention.noSection ?? null) : null,
    }),
  );

  const notJoined = d.staff.data ? d.staff.data.filter((s) => s.joinState !== "joined").length : null;
  const staffTotal = d.staff.data ? d.staff.data.length : null;

  const ownDone = mode !== "single" && mode !== "list";
  const order = pageOrder(ownDone);
  const hour = istHour();

  const parts: Record<Part, ReactNode> = {
    dayCard:
      mode === "dayOff" || (own.length === 0 && (dayKind === "holiday" || dayKind === "weekend")) ? (
        <DayOffCard kind={dayKind as "holiday" | "weekend"} reason={att?.day?.reason ?? null} next={null} />
      ) : (
        <SetupCard />
      ),
    myAttendance: d.attendance.isError ? (
      <SectionError onRetry={() => void d.attendance.refetch()} />
    ) : (
      <MyAttendance mode={mode} own={own} classTeacherSections={ctSections} covers={covers} />
    ),
    waiting: <WaitingOnYou items={waiting} tiles={{ marks: progress.total ? { done: progress.done, total: progress.total } : undefined }} />,
    schoolToday: att && att.wholeSchool && dayKind !== "holiday" && dayKind !== "weekend" ? <SchoolToday data={att} /> : null,
    youTeach: (
      <View>
        <YouTeach pairs={pairs} papers={papers} today={today} classTeacherLabels={[...new Set(ctRows.map((r) => sectionShort(r)))]} />
        <MarksCard papers={papers} today={today} />
      </View>
    ),
    staff: d.staff.data || d.teaching.data ? <StaffCard total={staffTotal} notJoined={notJoined} teaching={d.teaching.data ?? null} /> : null,
    fees: d.fees.data ? <FeesCard fees={d.fees.data} canCollect={d.can.collect} /> : null,
    exams: pairs.length === 0 ? <OpenExamsCard /> : null,
    students: d.roster.data ? <StudentsCard current={d.roster.data.counts.current} noSection={d.roster.data.attention.noSection} /> : null,
    comingUp: <ComingUp items={comingUpItems(att, d.papers.data)} />,
  };

  const loading = !showAll && d.running && (d.mine.isPending || (d.can.readAttendance && d.attendance.isPending));
  const refreshing = false;
  const refetchAll = () => {
    void d.mine.refetch();
    void d.attendance.refetch();
    if (d.papers.isFetched) void d.papers.refetch();
    if (d.homework.isFetched) void d.homework.refetch();
    if (d.fees.isFetched) void d.fees.refetch();
    if (d.org.isFetched) void d.org.refetch();
  };

  const tint = showAll
    ? colors.area.trust.band
    : ctRows.length > 0
      ? colors.area.attendance.band
      : pairs.length > 0
        ? colors.area.teaching.band
        : d.can.collect
          ? colors.area.fees.band
          : "#DFE9F7";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabSpace + spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={colors.accent} />}
      >
        <Band tint={tint} />
        <View style={styles.top}>
          <ShellBar>
            {branchName && !offerAll ? (
              <View style={styles.chip}>
                <AppIcon name="school" size={14} color={colors.ink} />
                <ThemedText variant="chip" numberOfLines={1} style={styles.chipText}>
                  {branchName}
                </ThemedText>
              </View>
            ) : null}
          </ShellBar>

          <View style={styles.hello}>
            <ThemedText variant="meta" style={styles.date}>
              {formatLongWeekday(today)}
            </ThemedText>
            <ThemedText style={styles.greeting} accessibilityRole="header">
              {`${greetingFor(hour)}${firstName(me?.user.name) ? `, ${firstName(me?.user.name)}` : ""}`}
            </ThemedText>
          </View>

          {offerAll && d.running ? <ScopeSwitch branchName={branchName ?? c.thisBranch} all={showAll} onChange={setAllBranches} /> : null}
        </View>

        <View style={styles.body}>
          {d.past ? (
            <Card style={styles.past} testID="home-past-session">
              <ThemedText variant="bodyStrong">{c.pastTitle(academicYear?.name ?? "")}</ThemedText>
              <ThemedText variant="meta" style={styles.pastBody}>
                {c.pastBody}
              </ThemedText>
            </Card>
          ) : !d.running ? null : showAll ? (
            d.org.data ? (
              <TrustView
                org={d.org.data}
                onOpenBranch={(schoolId) => {
                  if (organizationId) select(organizationId, schoolId);
                  setAllBranches(false);
                }}
              />
            ) : d.org.isError ? (
              <SectionError onRetry={() => void d.org.refetch()} />
            ) : (
              <View style={styles.loading}>
                <Skeleton height={130} />
                <Skeleton height={160} />
              </View>
            )
          ) : loading ? (
            <View style={styles.loading} testID="home-loading">
              <Skeleton height={180} />
              <Skeleton height={120} />
              <Skeleton height={120} />
            </View>
          ) : (
            order.map((part) => {
              const node = parts[part];
              return node ? (
                <View key={part}>
                  {node}
                </View>
              ) : null;
            })
          )}
          {d.running && !loading && !(showAll && !d.org.data) ? (
            <ThemedText variant="meta" style={styles.end}>
              {c.caughtUp}
            </ThemedText>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  top: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.85)",
    maxWidth: "100%",
  },
  chipText: { flexShrink: 1 },
  hello: { marginTop: spacing.lg },
  date: { fontFamily: fontFamily.semibold },
  greeting: { marginTop: 2, fontFamily: fontFamily.bold, fontSize: 28, letterSpacing: -0.3, lineHeight: 34, color: colors.ink },
  body: { paddingHorizontal: HOME_GUTTER, paddingTop: spacing.lg, gap: 0 },
  loading: { gap: spacing.md },
  lead: { marginBottom: spacing.md },
  past: { marginTop: spacing.sm },
  pastBody: { marginTop: spacing.xs },
  end: { textAlign: "center", marginTop: 22, color: colors.chevron, fontFamily: fontFamily.semibold },
});

import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { isEntryOpen, sortExams } from "../../lib/exams";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { stageLabel, stageTone } from "../exams/meta";
import { useExamList, useExamScope } from "../exams/use-exam-data";
import { AREAS } from "./areas";
import { Head, Hero, HeroButtons, Panel, Ring, Row, Shortcuts, caution, neutral } from "./parts";
import type { Hue, Shortcut } from "./parts";

const look = AREAS.exams;
const hue: Hue = { fg: look.h0, bg: look.tint };

/** The session's exams by where they are; the bar under the hero. */
const STAGES = [
  { key: "draft", label: "Draft", color: "#D0D5DD", match: ["draft"] },
  { key: "scheduled", label: "Scheduled", color: "#7EA6E8", match: ["scheduled", "ongoing"] },
  { key: "marks", label: "Marks", color: look.h0, match: ["marks_entry"] },
  { key: "review", label: "Review", color: "#E8A43A", match: ["under_verification"] },
  { key: "published", label: "Published", color: colors.accent, match: ["published", "locked"] },
] as const;

const OPEN_LIST = 8;

/**
 * Exams in More: the exam that is running leads, with the caller's own
 * papers as a ring when they have any; then the session's exams by stage,
 * what waits on the caller, four doors, and the list.
 */
export function ExamsArea() {
  const scope = useExamScope();
  const list = useExamList();
  const { organizationId, schoolId } = useActiveContext();
  const today = todayIso();
  const papers = trpc.home.myPapers.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "", date: today },
    { enabled: Boolean(organizationId && schoolId) && scope.canEnter, staleTime: 60_000 },
  );

  if (list.isPending && scope.addressable) {
    return (
      <View style={styles.loading}>
        <Skeleton height={180} />
        <Skeleton height={90} />
        <Skeleton height={160} />
      </View>
    );
  }
  if (list.isError) {
    return <ErrorCard cause={list.error} onRetry={() => void list.refetch()} testID="more-exams-error" />;
  }

  const rows = sortExams(list.data ?? []);
  const open = rows.filter((row) => isEntryOpen(row.status));
  const lead = open[0] ?? rows.find((row) => row.status === "scheduled" || row.status === "ongoing") ?? null;
  const mine = (papers.data?.open ?? []).filter((paper) => !lead || paper.examId === lead.id);
  const myTotal = mine.reduce((n, paper) => n + paper.students, 0);
  const myDone = mine.reduce((n, paper) => n + paper.entered, 0);
  const myLeft = mine.filter((paper) => paper.entered < paper.students);
  const openHub = (examId: string) => router.push({ pathname: "/exams/[examId]", params: { examId } });

  const shortcuts: Shortcut[] = [
    scope.canCreate ? { key: "create", label: "Create an exam", icon: "add", hue, add: true, onPress: () => router.push("/exams/exam-form") } : null,
    { key: "term-grades", label: "Term grades", icon: "star", hue, onPress: () => router.push("/exams/term-grades") },
    scope.canUpdate ? { key: "final", label: "Final results", icon: "grade", hue, onPress: () => router.push("/exams/final") } : null,
    scope.canCreate || scope.canUpdate ? { key: "rules", label: "Rules", icon: "settings", hue, onPress: () => router.push("/exams/setup") } : null,
    { key: "all", label: "All exams", icon: "exams", hue, onPress: () => router.push("/exams") },
  ].filter((item): item is Shortcut => item !== null);

  const needs = [
    ...myLeft.slice(0, 3).map((paper) => ({
      key: `paper-${paper.scheduleId}-${paper.sectionId}`,
      icon: "marks" as const,
      hue,
      title: `${paper.subjectName} · ${paper.className}-${paper.sectionName}`,
      meta: `${paper.examName} · ${paper.entered} of ${paper.students} entered`,
      action: { label: "Enter", onPress: () => openHub(paper.examId) },
    })),
    ...(scope.canVerify
      ? rows
          .filter((row) => row.status === "under_verification")
          .map((row) => ({
            key: `verify-${row.id}`,
            icon: "checkCircle" as const,
            hue: caution,
            title: `Verify ${row.name}`,
            meta: `${row.termName} · marks are in, waiting for you`,
            action: { label: "Verify", onPress: () => openHub(row.id) },
          }))
      : []),
    ...(scope.canUpdate && rows.some((row) => row.status === "draft")
      ? [
          {
            key: "drafts",
            icon: "edit" as const,
            hue: neutral,
            title: `${rows.filter((row) => row.status === "draft").length} exams still in draft`,
            meta: "Set dates and papers to schedule them",
            action: { label: "Open", onPress: () => router.push("/exams") },
          },
        ]
      : []),
  ];

  return (
    <View>
      {lead ? (
        <Hero
          h0={look.h0}
          h1={look.h1}
          kicker={`${isEntryOpen(lead.status) ? "Running now" : "Coming up"} · ${lead.termName}`}
          title={lead.name}
          sub={
            open.length > 1
              ? `${stageLabel(lead.status)} · ${open.length - 1} more open for marks`
              : stageLabel(lead.status)
          }
          aside={mine.length > 0 && myTotal > 0 ? <Ring value={Math.round((myDone / myTotal) * 100)} label="your papers" /> : null}
          testID="more-exams-hero"
        >
          <HeroButtons
            ink={look.h0}
            buttons={[
              { key: "open", label: myLeft.length > 0 ? "Enter marks" : "Open exam", icon: myLeft.length > 0 ? "marks" : "exams", onPress: () => openHub(lead.id) },
              { key: "all", label: "All exams", ghost: true, onPress: () => router.push("/exams") },
            ]}
          />
        </Hero>
      ) : (
        <Hero
          h0={look.h0}
          h1={look.h1}
          kicker="This session"
          title={rows.length > 0 ? "No exam is running" : "No exams yet"}
          sub={rows.length > 0 ? `${rows.length} this session` : "Create the first exam of the session"}
          testID="more-exams-hero"
        >
          {scope.canCreate ? (
            <HeroButtons ink={look.h0} buttons={[{ key: "create", label: "Create an exam", icon: "add", onPress: () => router.push("/exams/exam-form") }]} />
          ) : null}
        </Hero>
      )}

      {rows.length > 0 ? (
        <>
          <Head title="This session" link={{ label: `${rows.length} exams`, onPress: () => router.push("/exams") }} />
          <Panel>
            <View style={styles.stages}>
              <View style={styles.stageBar}>
                {STAGES.map((stage) => {
                  const n = rows.filter((row) => (stage.match as readonly string[]).includes(row.status)).length;
                  return n > 0 ? <View key={stage.key} style={[styles.stageSeg, { flex: n, backgroundColor: stage.color }]} /> : null;
                })}
              </View>
              <View style={styles.stageLabels}>
                {STAGES.map((stage) => {
                  const n = rows.filter((row) => (stage.match as readonly string[]).includes(row.status)).length;
                  return (
                    <View key={stage.key} style={styles.stageLabel} accessible accessibilityLabel={`${n} ${stage.label}`}>
                      <View style={styles.stageCount}>
                        <View style={[styles.stageDot, { backgroundColor: stage.color }]} />
                        <ThemedText variant="name">{n}</ThemedText>
                      </View>
                      <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
                        {stage.label}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
            </View>
          </Panel>
        </>
      ) : null}

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

      <Head title="Go to" />
      <Shortcuts items={shortcuts} />

      {rows.length > 0 ? (
        <>
          <Head title="All exams" link={rows.length > OPEN_LIST ? { label: "See all", onPress: () => router.push("/exams") } : null} />
          <Panel>
            {rows.slice(0, OPEN_LIST).map((row, index) => (
              <Row
                key={row.id}
                first={index === 0}
                icon="exams"
                hue={isEntryOpen(row.status) ? hue : neutral}
                title={row.name}
                meta={row.termName}
                trailing={<StatusPill label={stageLabel(row.status)} tone={stageTone(row.status)} />}
                onPress={() => openHub(row.id)}
                testID={`more-exam-${row.id}`}
              />
            ))}
          </Panel>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    gap: spacing.md,
  },
  stages: {
    padding: spacing.lg - 2,
  },
  stageBar: {
    flexDirection: "row",
    gap: spacing.xs,
    height: 10,
  },
  stageSeg: {
    borderRadius: 5,
  },
  stageLabels: {
    flexDirection: "row",
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  stageLabel: {
    flex: 1,
  },
  stageCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  stageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

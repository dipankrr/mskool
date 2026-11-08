import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { Href } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { localDateToIso } from "../../lib/format";
import { dueLine, sectionLabel, shortDay, type HomeworkSummary } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import { GivenToast } from "./given-toast";
import { showGivenToast, useGivenToast } from "./toast-store";

const text = copy.homework.home3;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Each type's colour on the day strip and the day list (a type, never a state). */
export const KIND_COLOR: Record<HomeworkSummary["kind"], string> = {
  homework: colors.accent,
  practice: colors.tone.neutral.fg,
  project: colors.tone.caution.fg,
  reading: "#2E90FA",
  quiz: colors.tone.critical.fg,
};

type Job = { key: string; badge: string; warm: boolean; title: string; meta: string; action: string; go: () => void };

const open = (pathname: string, params: Record<string, string>) =>
  router.push({ pathname, params } as unknown as Href);

function addDays(iso: string, n: number): string {
  const d = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  d.setDate(d.getDate() + n);
  return localDateToIso(d);
}

/**
 * The Homework tab's Home (v3, owner-approved 2026-11-09): what needs me now,
 * this week, my classes. One read (`homework.home`) plus the caller's classes
 * (`homework.pairs`); no long feed of cards.
 */
export function HomeworkScreen() {
  const { organizationId, schoolId, academicYear, yearPending } = useActiveContext();
  const { has } = usePermissions();
  const canGive = has("homework:create");
  const tabSpace = useTabBarSpace();
  const toast = useGivenToast();
  const scope = { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) };

  const home = trpc.homework.home.useQuery(scope, { enabled: Boolean(organizationId), staleTime: 30_000 });
  const pairs = trpc.homework.pairs.useQuery(scope, { enabled: Boolean(organizationId), staleTime: 60_000 });
  const data = home.data;

  const today = localDateToIso(new Date());
  const weekDays = useMemo(
    () => (data ? Array.from({ length: 6 }, (_, i) => addDays(data.weekStart, i)) : []),
    [data],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  // "Out" means due after the moment the screen opened (the tab remounts often enough).
  const [openedAt] = useState(() => Date.now());
  const day = picked ?? (weekDays.includes(today) ? today : (weekDays[0] ?? today));

  const byDay = useMemo(() => {
    const m = new Map<string, HomeworkSummary[]>();
    for (const hw of data?.week ?? []) {
      const k = localDateToIso(new Date(hw.dueAt));
      m.set(k, [...(m.get(k) ?? []), hw]);
    }
    return m;
  }, [data]);

  const jobs: Job[] = useMemo(() => {
    if (!data) return [];
    const out: Job[] = data.toCheck.map((t) => {
      const sent = t.homework.comesBack === "sent";
      return {
        key: `${t.homework.id}:${t.sectionId}`,
        badge: sectionLabel(t.className, t.sectionName),
        warm: sent,
        title: t.homework.title,
        meta: sent
          ? text.reviewMeta(t.homework.subjectName, t.toCheck)
          : text.checkMeta(t.homework.subjectName, dueLine(t.homework.dueAt).toLowerCase()),
        action: sent ? text.review : text.check,
        go: () =>
          open(sent ? "/homework/review" : "/homework/check", {
            id: t.homework.id,
            sectionId: t.sectionId,
            subjectId: t.homework.subjectId,
          }),
      };
    });
    for (const q of data.quizzes) {
      if (q.answersToMark <= 0) continue;
      const sec = q.sections.find((s) => s.submitted > 0) ?? q.sections[0];
      if (!sec) continue;
      out.push({
        key: `quiz:${q.id}`,
        badge: sectionLabel(sec.className, sec.sectionName),
        warm: false,
        title: q.title,
        meta: text.markMeta(q.answersToMark),
        action: text.mark,
        go: () => open("/homework/quiz", { id: q.id, sectionId: sec.sectionId, subjectId: q.subjectId }),
      });
    }
    return out;
  }, [data]);

  const nextBack = useMemo(() => {
    const future = (data?.outNow ?? []).filter((h) => h.comesBack === "brought" || h.comesBack === "sent");
    return [...future].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;
  }, [data]);

  const classes = useMemo(() => {
    const seen = new Set<string>();
    const live = [...(data?.week ?? []), ...(data?.outNow ?? [])].filter((h) =>
      seen.has(h.id) ? false : (seen.add(h.id), true),
    );
    return (pairs.data ?? []).flatMap((subject) =>
      subject.sections.map((sec) => {
        const mine = live.filter(
          (h) => h.subjectId === subject.subjectId && h.sections.some((s) => s.sectionId === sec.sectionId),
        );
        const out = mine.filter((h) => h.status === "published" && new Date(h.dueAt).getTime() > openedAt).length;
        const toCheck = (data?.toCheck ?? [])
          .filter((t) => t.sectionId === sec.sectionId && t.homework.subjectId === subject.subjectId)
          .reduce((n, t) => n + t.toCheck, 0);
        const toMark = (data?.quizzes ?? [])
          .filter((q) => q.subjectId === subject.subjectId && q.sections.some((s) => s.sectionId === sec.sectionId))
          .reduce((n, q) => n + q.answersToMark, 0);
        let back = 0;
        let total = 0;
        for (const h of mine) {
          if (h.comesBack === "none") continue;
          const s = h.sections.find((x) => x.sectionId === sec.sectionId);
          if (!s) continue;
          total += s.total;
          back += s.submitted + s.checked + s.redo;
        }
        return {
          key: `${subject.subjectId}:${sec.sectionId}`,
          subjectId: subject.subjectId,
          sectionId: sec.sectionId,
          label: sectionLabel(sec.className, sec.sectionName),
          subject: subject.subjectName,
          out,
          toCheck,
          toMark,
          pct: total ? back / total : 0,
        };
      }),
    );
  }, [pairs.data, data, openedAt]);

  const dayList = byDay.get(day) ?? [];
  const weekLabel =
    weekDays.length === 6
      ? text.weekRange(
          `${MONTHS[Number(weekDays[0]!.slice(5, 7)) - 1]} ${Number(weekDays[0]!.slice(8, 10))}`,
          `${Number(weekDays[5]!.slice(8, 10))}`,
        )
      : "";

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace + 84 }]}
        refreshControl={
          <RefreshControl
            refreshing={home.isRefetching}
            onRefresh={() => {
              void home.refetch();
              void pairs.refetch();
            }}
          />
        }
      >
        <View style={styles.titleRow}>
          <ThemedText variant="title" style={styles.grow}>
            {copy.homework.title}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/homework/all" as Href)}
            hitSlop={8}
            style={styles.link}
            testID="homework-all"
          >
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {copy.homework.all.open}
            </ThemedText>
            <AppIcon name="chevronRight" size={16} color={colors.accentDeep} />
          </Pressable>
        </View>

        {!academicYear && !yearPending ? (
          <EmptyState icon="calendarOff" title={copy.homework.home.noYearTitle} message={copy.homework.home.noYearBody} />
        ) : home.isPending ? (
          <View style={styles.stack}>
            <Skeleton height={190} />
            <Skeleton height={76} />
            <Skeleton height={120} />
          </View>
        ) : home.isError ? (
          <ErrorCard cause={home.error} onRetry={() => void home.refetch()} testID="homework-error" />
        ) : data ? (
          <>
            {jobs.length ? (
              <View style={styles.now} testID="homework-now">
                <View style={styles.nowTop}>
                  <ThemedText variant="sectionLabel" color="rgba(255,255,255,0.7)">
                    {text.needsYou}
                  </ThemedText>
                  <View style={styles.nowCount}>
                    <ThemedText variant="bodyStrong" color={colors.onAccent}>
                      {String(jobs.length)}
                    </ThemedText>
                  </View>
                </View>
                {jobs.slice(0, 3).map((j) => (
                  <Pressable
                    key={j.key}
                    accessibilityRole="button"
                    onPress={j.go}
                    style={({ pressed }) => [styles.nowRow, pressed ? styles.pressed : null]}
                    testID={`homework-job-${j.key}`}
                  >
                    <View style={[styles.nowBadge, j.warm ? styles.nowBadgeWarm : null]}>
                      <ThemedText variant="bodyStrong" color={colors.onAccent} numberOfLines={1}>
                        {j.badge}
                      </ThemedText>
                    </View>
                    <View style={styles.grow}>
                      <ThemedText variant="bodyStrong" color={colors.onAccent} numberOfLines={1}>
                        {j.title}
                      </ThemedText>
                      <ThemedText variant="caption" color="rgba(255,255,255,0.65)" numberOfLines={1}>
                        {j.meta}
                      </ThemedText>
                    </View>
                    <View style={styles.nowAction}>
                      <ThemedText variant="bodyStrong" color={colors.ink}>
                        {j.action}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}
                {jobs.length > 3 ? (
                  <ThemedText variant="caption" color="rgba(255,255,255,0.55)" style={styles.nowMore}>
                    {text.more(jobs.length - 3, `${jobs[3]!.badge} ${jobs[3]!.title}`)}
                  </ThemedText>
                ) : null}
              </View>
            ) : (
              <View style={styles.calm} testID="homework-all-checked">
                <View style={styles.calmTick}>
                  <AppIcon name="check" size={18} color={colors.onAccent} />
                </View>
                <View style={styles.grow}>
                  <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                    {text.calmTitle}
                  </ThemedText>
                  <ThemedText variant="meta">
                    {nextBack
                      ? text.calmNext(
                          `${nextBack.sections.map((s) => sectionLabel(s.className, s.sectionName)).join(", ")} ${nextBack.title}`,
                          dueLine(nextBack.dueAt).replace(/^Due /, "").toLowerCase(),
                        )
                      : text.calmNone}
                  </ThemedText>
                </View>
              </View>
            )}

            <View style={styles.sectionHead}>
              <SectionLabel>{text.thisWeek}</SectionLabel>
              <ThemedText variant="meta">{weekLabel}</ThemedText>
            </View>
            <View style={styles.week}>
              {weekDays.map((d) => {
                const on = d === day;
                const items = byDay.get(d) ?? [];
                return (
                  <Pressable
                    key={d}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={text.dayA11y(shortDay(d), items.length)}
                    onPress={() => setPicked(d)}
                    style={[styles.day, on ? styles.dayOn : null, d === today && !on ? styles.dayToday : null]}
                    testID={`homework-day-${d}`}
                  >
                    <ThemedText variant="caption" color={on ? "rgba(255,255,255,0.7)" : colors.muted}>
                      {shortDay(d)}
                    </ThemedText>
                    <ThemedText variant="bodyStrong" color={on ? colors.onAccent : colors.ink} style={styles.dayNum}>
                      {String(Number(d.slice(8, 10)))}
                    </ThemedText>
                    <View style={styles.dots}>
                      {items.slice(0, 4).map((h) => (
                        <View key={h.id} style={[styles.dot, { backgroundColor: on ? colors.onAccent : KIND_COLOR[h.kind] }]} />
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.list}>
              {dayList.length === 0 ? (
                <ThemedText variant="meta" style={styles.empty}>
                  {text.nothingThisDay}
                </ThemedText>
              ) : (
                dayList.map((h, i) => <DayRow key={h.id} hw={h} first={i === 0} />)
              )}
            </View>

            <SectionLabel style={styles.label}>{text.myClasses}</SectionLabel>
            {pairs.isPending ? (
              <Skeleton height={90} />
            ) : classes.length === 0 ? (
              <ThemedText variant="meta">{text.noClassesBody}</ThemedText>
            ) : (
              <View style={styles.grid}>
                {classes.map((c) => (
                  <Pressable
                    key={c.key}
                    accessibilityRole="button"
                    onPress={() => open("/homework/class", { sectionId: c.sectionId, subjectId: c.subjectId })}
                    style={({ pressed }) => [styles.classCard, pressed ? styles.pressed : null]}
                    testID={`homework-class-${c.key}`}
                  >
                    <View style={styles.classHead}>
                      <ThemedText variant="title" style={styles.classLabel}>
                        {c.label}
                      </ThemedText>
                      <ThemedText variant="meta" numberOfLines={1} style={styles.grow}>
                        {c.subject}
                      </ThemedText>
                    </View>
                    <ThemedText variant="caption" numberOfLines={1}>
                      {text.classOut(c.out)}
                      {c.toCheck ? (
                        <ThemedText variant="caption" color={colors.tone.caution.fg}>
                          {` · ${text.classToCheck(c.toCheck)}`}
                        </ThemedText>
                      ) : null}
                      {c.toMark ? (
                        <ThemedText variant="caption" color={colors.tone.caution.fg}>
                          {` · ${text.classToMark(c.toMark)}`}
                        </ThemedText>
                      ) : null}
                    </ThemedText>
                    <View style={styles.classBar}>
                      <View style={[styles.classFill, { width: `${Math.round(c.pct * 100)}%` }]} />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}

            {data.drafts.length ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDrafts }}
                  onPress={() => setShowDrafts((v) => !v)}
                  style={styles.draftLine}
                  testID="homework-drafts"
                >
                  <ThemedText variant="bodyStrong" color={colors.muted} style={styles.grow}>
                    {text.drafts(data.drafts.length)}
                  </ThemedText>
                  <AppIcon name={showDrafts ? "chevronUp" : "chevronDown"} size={18} color={colors.chevron} />
                </Pressable>
                {showDrafts ? (
                  <View style={styles.list}>
                    {data.drafts.map((h, i) => (
                      <DayRow key={h.id} hw={h} first={i === 0} />
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {canGive && academicYear ? (
        <View style={[styles.fab, { bottom: tabSpace + spacing.md }]} pointerEvents="box-none">
          {toast ? (
            <GivenToast
              key={toast.id}
              homeworkId={toast.id}
              labels={toast.labels}
              draft={toast.draft}
              sectionId={toast.sectionId}
              subjectId={toast.subjectId}
              onDone={() => showGivenToast(null)}
            />
          ) : null}
          <CapsuleButton
            title={copy.homework.give.button}
            icon="add"
            onPress={() => router.push("/homework/give" as Href)}
            testID="homework-give"
            style={styles.fabButton}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** One homework in one line: a type colour, title, classes, and its progress number. */
export function DayRow({ hw, first, hideClasses }: { hw: HomeworkSummary; first: boolean; hideClasses?: boolean }) {
  const total = hw.sections.reduce((n, s) => n + s.total, 0);
  const back = hw.sections.reduce((n, s) => n + s.submitted + s.checked + s.redo, 0);
  const meta = [
    hideClasses ? null : hw.sections.map((s) => sectionLabel(s.className, s.sectionName)).join(", "),
    hideClasses ? dueLine(hw.dueAt) : hw.subjectName,
    copy.homework.comesBackShort[hw.comesBack],
  ]
    .filter(Boolean)
    .join(" · ");
  const showCount = hw.comesBack !== "none" && total > 0 && hw.status !== "draft" && hw.status !== "scheduled";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => open("/homework/[id]", { id: hw.id })}
      style={({ pressed }) => [styles.dayRow, first ? null : styles.divider, pressed ? styles.pressed : null]}
      testID={`homework-row-${hw.id}`}
    >
      <View style={[styles.kindBar, { backgroundColor: KIND_COLOR[hw.kind] }]} />
      <View style={styles.grow}>
        <ThemedText variant="bodyStrong" numberOfLines={1}>
          {hw.book ? `${hw.book} · ${hw.title}` : hw.title}
        </ThemedText>
        <ThemedText variant="caption" numberOfLines={1}>
          {meta}
        </ThemedText>
      </View>
      {showCount ? (
        <ThemedText variant="bodyStrong" color={back === total ? colors.accentDeep : colors.muted}>
          {`${back}/${total}`}
        </ThemedText>
      ) : (
        <AppIcon name="chevronRight" size={16} color={colors.chevron} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: gutter, paddingTop: spacing.lg },
  grow: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.85 },
  titleRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  link: { flexDirection: "row", alignItems: "center", gap: spacing.xxs, minHeight: 44 },
  stack: { gap: spacing.md },
  now: {
    backgroundColor: colors.ink,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  nowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
  nowCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  nowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.15)",
  },
  nowBadge: {
    minWidth: 42,
    height: 42,
    paddingHorizontal: spacing.xs,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  nowBadgeWarm: { backgroundColor: "rgba(181,71,8,0.45)" },
  nowAction: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  nowMore: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.15)",
  },
  calm: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  calmTick: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  week: { flexDirection: "row", gap: spacing.xs },
  day: {
    flex: 1,
    minHeight: 72,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: colors.surface,
  },
  dayOn: { backgroundColor: colors.ink },
  dayToday: { borderWidth: 1.5, borderColor: colors.accent },
  dayNum: { fontSize: 18 },
  dots: { flexDirection: "row", gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  list: { marginTop: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.surface, overflow: "hidden" },
  empty: { padding: spacing.lg },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  kindBar: { width: 6, height: 32, borderRadius: 3 },
  label: { marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  classCard: {
    width: "48%",
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.xxs,
  },
  classHead: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  classLabel: { fontSize: 22 },
  classBar: { height: 4, borderRadius: 2, marginTop: spacing.sm, overflow: "hidden", backgroundColor: colors.field },
  classFill: { height: "100%", backgroundColor: colors.accent },
  draftLine: { flexDirection: "row", alignItems: "center", minHeight: 48, marginTop: spacing.lg, paddingHorizontal: spacing.xs },
  fab: { position: "absolute", left: gutter, right: gutter, alignItems: "flex-end", gap: spacing.sm },
  fabButton: { minWidth: 120, alignSelf: "flex-end" },
});

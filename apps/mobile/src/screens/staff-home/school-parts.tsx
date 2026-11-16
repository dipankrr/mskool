import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import type { FeeDashboardOutput, HomeAttendanceToday, HomeMyPapers, TeachingOverview } from "@repo/contracts";

import { AppIcon, type AppIconName } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatMoney } from "../../lib/money";
import { colors, type Area } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { percent, sectionShort, shortMoney, showWaitingTags, type Urgency, type WaitingItem } from "./home-logic";
import { AreaIcon, Badge, CapsuleAction, Figure, HomeCard, Progress, Ring, SectionHead, Tag, Tile, homeStyles } from "./ui";

const c = copy.home;
const go = (href: string) => router.push(href as Href);

// ---------------------------------------------------------------------------
// Waiting on you
// ---------------------------------------------------------------------------

export type Waiting = WaitingItem & {
  icon: AppIconName;
  area: Area | "red" | "amber";
  title: string;
  meta: string;
  count?: number;
  action?: { label: string; onPress: () => void; tone?: Area | "ink" };
  onPress?: () => void;
};

export function buildWaiting(input: {
  papersLeft: { label: string; first: { examId: string; scheduleId: string } | null; count: number } | null;
  homeworkToCheck: { count: number; pieces: number } | null;
  chequesPending: { count: number; amount: string } | null;
  gaps: { count: number; where: string } | null;
  needSection: number | null;
}): Waiting[] {
  const out: Waiting[] = [];
  if (input.chequesPending && input.chequesPending.count > 0) {
    out.push({
      key: "cheques",
      kind: "admin",
      urgency: 1 as Urgency,
      icon: "modeCheque",
      area: "amber",
      title: c.chequesPending(input.chequesPending.count),
      meta: formatMoney(input.chequesPending.amount),
      onPress: () => go("/fees/payments"),
    });
  }
  if (input.papersLeft && input.papersLeft.count > 0) {
    const first = input.papersLeft.first;
    out.push({
      key: "marks",
      kind: "teaching",
      urgency: 1 as Urgency,
      icon: "marks",
      area: "exams",
      title: c.marksToEnter,
      meta: input.papersLeft.label,
      action: first
        ? {
            label: c.enter,
            tone: "exams",
            onPress: () => router.push({ pathname: "/exams/[examId]/paper/[scheduleId]", params: first }),
          }
        : undefined,
    });
  }
  if (input.homeworkToCheck && input.homeworkToCheck.count > 0) {
    out.push({
      key: "homework",
      kind: "teaching",
      urgency: 2 as Urgency,
      icon: "homework",
      area: "homework",
      title: c.homeworkToCheck,
      meta: c.toCheckCap(input.homeworkToCheck.pieces),
      count: input.homeworkToCheck.count,
      onPress: () => go("/homework"),
    });
  }
  if (input.gaps && input.gaps.count > 0) {
    out.push({
      key: "gaps",
      kind: "admin",
      urgency: 2 as Urgency,
      icon: "teaching",
      area: "teaching",
      title: c.teachingGaps(input.gaps.count),
      meta: input.gaps.where,
      action: { label: c.fill, tone: "teaching", onPress: () => go("/teaching") },
    });
  }
  if (input.needSection && input.needSection > 0) {
    out.push({
      key: "section",
      kind: "admin",
      urgency: 2 as Urgency,
      icon: "personAdd",
      area: "students",
      title: c.needSection(input.needSection),
      meta: c.needSectionMeta,
      action: { label: c.assign, tone: "students", onPress: () => go("/students") },
    });
  }
  return out;
}

/** Only-teaching work shows as tiles (the teacher frames); mixed work as rows with tags. */
export function WaitingOnYou({ items, tiles }: { items: Waiting[]; tiles?: { marks?: { done: number; total: number } } }) {
  if (items.length === 0) return null;
  const tags = showWaitingTags(items);
  return (
    <View>
      <SectionHead title={c.waitingTitle} count={items.length} />
      <HomeCard padless>
        {items.map((item, index) => (
          <View key={item.key}>
            {index > 0 ? <View style={homeStyles.divider} /> : null}
            <WaitingRow item={item} tag={tags} marks={item.key === "marks" ? tiles?.marks : undefined} />
          </View>
        ))}
      </HomeCard>
    </View>
  );
}

function WaitingRow({ item, tag, marks }: { item: Waiting; tag: boolean; marks?: { done: number; total: number } }) {
  const body = (
    <View style={homeStyles.rowLine}>
      <AreaIcon area={item.area} icon={item.icon} size={40} />
      <View style={styles.grow}>
        <View style={styles.titleLine}>
          <ThemedText style={homeStyles.rowTitle} numberOfLines={1}>
            {item.title}
          </ThemedText>
          {tag ? <Tag kind={item.kind} /> : null}
        </View>
        <ThemedText variant="meta" numberOfLines={1}>
          {marks ? `${c.papersDone(marks.done, marks.total)} ${c.papersDoneCap} · ${item.meta}` : item.meta}
        </ThemedText>
      </View>
      {item.action ? (
        <CapsuleAction label={item.action.label} tone={item.action.tone ?? "ink"} onPress={item.action.onPress} />
      ) : item.count != null ? (
        <ThemedText style={styles.count}>{item.count}</ThemedText>
      ) : (
        <AppIcon name="chevronRight" size={16} color={colors.chevron} />
      )}
    </View>
  );
  return item.onPress ? (
    <HomeCard padless style={styles.flat} onPress={item.onPress} accessibilityLabel={`${item.title}, ${item.meta}`}>
      {body}
    </HomeCard>
  ) : (
    body
  );
}

// ---------------------------------------------------------------------------
// Day card (holiday or weekend)
// ---------------------------------------------------------------------------

export function DayOffCard({ kind, reason, next }: { kind: "holiday" | "weekend"; reason: string | null; next: string | null }) {
  return (
    <HomeCard style={styles.dayOff} testID="home-day-off">
      <View style={styles.titleLine}>
        <View style={styles.dayOffIcon}>
          <AppIcon name="shiftDay" size={16} color={colors.onAccent} />
        </View>
        <ThemedText style={[styles.label, { color: colors.area.calendar.fg }]}>{c.schoolCalendar}</ThemedText>
      </View>
      <ThemedText style={styles.dayOffTitle}>{c.dayOffTitle}</ThemedText>
      <ThemedText variant="meta" style={homeStyles.meta}>
        {c.dayOffBody(kind, reason)}
        {next ? ` ${next}` : ""}
      </ThemedText>
    </HomeCard>
  );
}

// ---------------------------------------------------------------------------
// School today
// ---------------------------------------------------------------------------

export function SchoolToday({ data }: { data: HomeAttendanceToday }) {
  const sections = data.sections;
  const marked = sections.filter((s) => s.marked > 0);
  const present = marked.reduce((n, s) => n + s.present, 0);
  const total = marked.reduce((n, s) => n + s.marked, 0);
  const missing = sections.filter((s) => s.marked === 0).map(sectionShort);
  const pct = percent(present, total);
  const names = missing.length > 3 ? `${missing.slice(0, 3).join(", ")} +${missing.length - 3}` : missing.join(", ");
  return (
    <View>
      <SectionHead title={c.schoolToday} area="attendance" icon="attendance" link={c.attendance} onLink={() => go("/attendance")} />
      <HomeCard testID="home-school-today">
        <View style={styles.baseline}>
          <Figure value={pct == null ? "—" : String(pct)} small={pct == null ? undefined : "%"} size={40} />
          <ThemedText variant="meta">{c.presentOf(present, total)}</ThemedText>
        </View>
        <View style={styles.dots} accessibilityLabel={`${marked.length} of ${sections.length} sections marked`}>
          {sections.map((s) => (
            <View key={s.sectionId} style={[styles.dot, { backgroundColor: s.marked > 0 ? colors.accent : colors.tone.caution.fg, opacity: s.marked > 0 ? 0.85 : 1 }]} />
          ))}
        </View>
        <View style={styles.key}>
          <Key color={colors.accent} text={c.sectionsMarked(marked.length)} />
          <Key color={colors.tone.caution.fg} text={missing.length ? c.notYet(names) : c.allSectionsMarked} />
        </View>
      </HomeCard>
    </View>
  );
}

function Key({ color, text }: { color: string; text: string }) {
  return (
    <View style={styles.keyItem}>
      <View style={[styles.keyDot, { backgroundColor: color }]} />
      <ThemedText variant="meta" style={styles.keyText} numberOfLines={1}>
        {text}
      </ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export function FeesCard({ fees, canCollect }: { fees: FeeDashboardOutput; canCollect: boolean }) {
  const pct = percent(Number(fees.paidOnThisMonth), Number(fees.billedThisMonth));
  return (
    <View>
      <SectionHead title={c.fees} area="fees" icon="fees" link={c.feesLink} onLink={() => go("/fees")} />
      <HomeCard testID="home-fees">
        <View style={styles.titleLine}>
          <ThemedText variant="meta" style={styles.label}>
            {c.collectedToday}
          </ThemedText>
          <View style={styles.grow} />
          <View style={[styles.softPill, { backgroundColor: colors.area.fees.bg }]}>
            <ThemedText style={[styles.softPillText, { color: colors.area.fees.fg }]}>{c.receipts(fees.receiptsToday)}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.money}>{formatMoney(fees.collectedToday)}</ThemedText>
        {fees.pending.count > 0 ? (
          <ThemedText variant="meta" style={homeStyles.meta}>
            {c.pendingCheques(fees.pending.count, formatMoney(fees.pending.amount))}
          </ThemedText>
        ) : null}
        <View style={styles.monthBlock}>
          <View style={styles.titleLine}>
            <ThemedText variant="meta" style={styles.label}>
              {`${c.collectedOfDue} · ${fees.monthLabel}`}
            </ThemedText>
            <View style={styles.grow} />
            <ThemedText style={styles.pct}>{pct == null ? "—" : `${pct}%`}</ThemedText>
          </View>
          <Progress value={pct ?? 0} color={colors.area.fees.fg} height={8} />
          <ThemedText variant="meta" style={homeStyles.meta}>
            {`${shortMoney(fees.paidOnThisMonth)} ${c.ofAmount(shortMoney(fees.billedThisMonth))}`}
          </ThemedText>
        </View>
        {canCollect ? (
          <View style={styles.actions}>
            <View style={styles.grow}>
              <CapsuleAction wide tone="fees" icon="add" label={c.collectFee} onPress={() => go("/fees/collect")} testID="home-collect" />
            </View>
            <CapsuleAction label={c.payments} tone="ink" onPress={() => go("/fees/payments")} />
          </View>
        ) : null}
      </HomeCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export function StaffCard({
  total,
  notJoined,
  teaching,
}: {
  total: number | null;
  notJoined: number | null;
  teaching: TeachingOverview | null;
}) {
  const filled = teaching ? percent(teaching.totals.filled, teaching.totals.slots) : null;
  if (total == null && filled == null) return null;
  return (
    <View>
      <SectionHead title={c.staff} area="teaching" icon="students" link={c.staffLink} onLink={() => go("/staff-list")} />
      <View style={homeStyles.row2}>
        {notJoined != null && notJoined > 0 ? (
          <Tile area="amber" icon="key" label={c.notJoined} onPress={() => go("/staff-list")}>
            <Figure value={String(notJoined)} color={colors.tone.caution.fg} />
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.notJoinedCap}
            </ThemedText>
          </Tile>
        ) : total != null ? (
          <Tile area="teaching" icon="students" label={c.staffTotal} onPress={() => go("/staff-list")}>
            <Figure value={String(total)} />
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.staffTotalCap}
            </ThemedText>
          </Tile>
        ) : null}
        {filled != null ? (
          <Tile area="teaching" icon="teaching" label={c.teachingFilled} onPress={() => go("/teaching")}>
            <Figure value={String(filled)} small="%" />
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.teachingFilledCap}
            </ThemedText>
            <Progress value={filled} color={colors.area.teaching.fg} />
          </Tile>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Exams (your marks)
// ---------------------------------------------------------------------------

const MARKS_FOLD = 4;

export function MarksCard({ papers, today }: { papers: HomeMyPapers["open"]; today: string }) {
  const [open, setOpen] = useState(false);
  if (papers.length === 0) return null;
  const done = papers.filter((p) => p.students > 0 && p.entered >= p.students);
  const left = papers.filter((p) => !done.includes(p)).sort((a, b) => a.examDate.localeCompare(b.examDate));
  const oneExam = new Set(papers.map((p) => p.examId)).size === 1;
  const shown = open ? left : left.slice(0, MARKS_FOLD);
  return (
    <View>
      <SectionHead title={oneExam ? papers[0]!.examName : c.marksTitle} area="exams" icon="marks" link={c.examsLink} onLink={() => go("/exams")} />
      <HomeCard testID="home-marks">
        <View style={styles.ringRow}>
          <Ring value={percent(done.length, papers.length) ?? 0} size={84} stroke={8} color={colors.area.exams.fg}>
            <ThemedText style={styles.ringText}>{`${done.length}/${papers.length}`}</ThemedText>
          </Ring>
          <View style={styles.grow}>
            <ThemedText style={styles.bigLine}>{c.marksLeft(left.length)}</ThemedText>
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.marksEntered}
            </ThemedText>
          </View>
        </View>
        {shown.map((p) => {
          const notSat = p.examDate > today;
          return (
            <View key={`${p.scheduleId}:${p.sectionId}`} style={styles.paperRow}>
              <View style={styles.paperBadge}>
                <ThemedText style={styles.paperBadgeText}>{sectionShort(p)}</ThemedText>
              </View>
              <View style={styles.grow}>
                <ThemedText style={homeStyles.rowTitle}>{p.subjectName}</ThemedText>
                <ThemedText variant="meta" numberOfLines={1}>{`${oneExam ? "" : `${p.examName} · `}${notSat ? `Paper on ${p.examDate.slice(8)}/${p.examDate.slice(5, 7)}` : `${p.entered} of ${p.students} in`}`}</ThemedText>
                {notSat ? null : <Progress value={percent(p.entered, p.students) ?? 0} color={colors.area.exams.fg} />}
              </View>
              {notSat ? null : (
                <CapsuleAction
                  label={c.enter}
                  tone="exams"
                  onPress={() => router.push({ pathname: "/exams/[examId]/paper/[scheduleId]", params: { examId: p.examId, scheduleId: p.scheduleId } })}
                />
              )}
            </View>
          );
        })}
        {left.length > MARKS_FOLD && !open ? (
          <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={styles.moreRow} testID="home-marks-more">
            <ThemedText style={styles.moreText}>{c.morePapers(left.length - MARKS_FOLD)}</ThemedText>
          </Pressable>
        ) : null}
      </HomeCard>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export function StudentsCard({ current, noSection }: { current: number; noSection: number }) {
  return (
    <View>
      <SectionHead title={c.studentsTitle} area="students" icon="students" link={c.studentsLink} onLink={() => go("/students")} />
      <View style={homeStyles.row2}>
        <Tile area="students" icon="students" label={c.enrolled} onPress={() => go("/students")}>
          <Figure value={String(current)} />
          <ThemedText variant="meta" style={homeStyles.meta}>
            {c.enrolledCap}
          </ThemedText>
        </Tile>
        <Tile area={noSection > 0 ? "amber" : "students"} icon="personAdd" label={c.needSectionTile} onPress={() => go("/students")}>
          <Figure value={String(noSection)} color={noSection > 0 ? colors.tone.caution.fg : undefined} />
          <ThemedText variant="meta" style={homeStyles.meta}>
            {c.needSectionCap}
          </ThemedText>
        </Tile>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Coming up
// ---------------------------------------------------------------------------

type Upcoming = { date: string; kind: "holiday" | "half_day" | "exam_day" | "paper"; title: string; meta: string };

export function ComingUp({ items }: { items: Upcoming[] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHead title={c.comingUp} area="calendar" icon="calendar" link={c.calendarLink} onLink={() => go("/attendance/manage/calendar")} />
      <HomeCard padless>
        {items.slice(0, 5).map((item, index) => {
          const d = new Date(`${item.date}T00:00:00Z`);
          const tone = item.kind === "holiday" || item.kind === "half_day" ? colors.area.calendar : colors.area.exams;
          return (
            <View key={`${item.date}:${item.title}:${index}`}>
              {index > 0 ? <View style={homeStyles.divider} /> : null}
              <View style={homeStyles.rowLine}>
                <View style={[styles.date, { backgroundColor: tone.bg }]}>
                  <ThemedText style={[styles.dateDay, { color: tone.fg }]}>{d.getUTCDate()}</ThemedText>
                  <ThemedText style={[styles.dateWeek, { color: tone.fg }]}>{WEEK[d.getUTCDay()]}</ThemedText>
                </View>
                <View style={styles.grow}>
                  <ThemedText style={homeStyles.rowTitle}>{item.title}</ThemedText>
                  <ThemedText variant="meta" numberOfLines={1}>
                    {item.meta}
                  </ThemedText>
                </View>
              </View>
            </View>
          );
        })}
      </HomeCard>
    </View>
  );
}
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function comingUpItems(att: HomeAttendanceToday | undefined, papers: HomeMyPapers | undefined): Upcoming[] {
  const out: Upcoming[] = [];
  for (const day of att?.upcoming ?? []) {
    if (day.kind === "holiday") out.push({ date: day.date, kind: "holiday", title: c.holiday, meta: day.reason ?? c.fromCalendar });
    else if (day.kind === "half_day" && day.reason) out.push({ date: day.date, kind: "half_day", title: c.halfDay, meta: day.reason ?? c.fromCalendar });
    else if (day.kind === "exam_day") out.push({ date: day.date, kind: "exam_day", title: c.examDay, meta: day.reason ?? c.fromCalendar });
  }
  for (const p of papers?.upcoming ?? []) {
    out.push({ date: p.examDate, kind: "paper", title: p.examName, meta: c.paperOn(p.subjectName, sectionShort(p)) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function SectionError({ onRetry }: { onRetry: () => void }) {
  return (
    <HomeCard style={styles.err}>
      <AreaIcon area="red" icon="warningCircle" size={36} />
      <ThemedText style={[homeStyles.rowTitle, styles.grow]}>{c.loadFailed}</ThemedText>
      <CapsuleAction label="Retry" tone="ink" icon="refresh" onPress={onRetry} />
    </HomeCard>
  );
}

export { Badge };

const styles = StyleSheet.create({
  moreRow: { paddingTop: spacing.md, alignItems: "center" },
  moreText: { fontFamily: fontFamily.semibold, fontSize: fontSize.small, color: colors.area.exams.fg },
  grow: { flex: 1, minWidth: 0 },
  flat: { boxShadow: "none", borderRadius: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  count: { fontFamily: fontFamily.bold, fontSize: fontSize.callout, color: colors.ink, fontVariant: ["tabular-nums"] },
  label: { fontFamily: fontFamily.semibold },
  dayOff: { backgroundColor: colors.area.calendar.bg, padding: 20 },
  dayOffIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: colors.area.calendar.fg, alignItems: "center", justifyContent: "center" },
  dayOffTitle: { marginTop: spacing.md, fontFamily: fontFamily.bold, fontSize: 24, letterSpacing: -0.5, color: colors.ink },
  baseline: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  dots: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 14 },
  dot: { width: 14, height: 14, borderRadius: 3 },
  key: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  keyItem: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  keyDot: { width: 8, height: 8, borderRadius: 2 },
  keyText: { fontSize: fontSize.caption, flexShrink: 1 },
  softPill: { height: 24, paddingHorizontal: 9, borderRadius: radius.full, justifyContent: "center" },
  softPillText: { fontFamily: fontFamily.semibold, fontSize: fontSize.caption },
  money: { marginTop: 10, fontFamily: fontFamily.bold, fontSize: 40, letterSpacing: -1.5, color: colors.ink, fontVariant: ["tabular-nums"] },
  monthBlock: { marginTop: 18 },
  pct: { fontFamily: fontFamily.bold, fontSize: 17, color: colors.ink, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 16 },
  ringRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  ringText: { fontFamily: fontFamily.bold, fontSize: 19, color: colors.ink, fontVariant: ["tabular-nums"] },
  bigLine: { fontFamily: fontFamily.bold, fontSize: 20, letterSpacing: -0.4, color: colors.ink },
  paperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.hairline,
  },
  paperBadge: { width: 44, height: 40, borderRadius: radius.sm, backgroundColor: colors.area.exams.bg, alignItems: "center", justifyContent: "center" },
  paperBadgeText: { fontFamily: fontFamily.bold, fontSize: 13, color: colors.area.exams.fg },
  date: { width: 44, height: 48, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  dateDay: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 19 },
  dateWeek: { fontFamily: fontFamily.bold, fontSize: 10, textTransform: "uppercase" },
  err: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});

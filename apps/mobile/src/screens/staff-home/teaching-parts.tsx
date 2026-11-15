import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { HomePaper, HomeSectionDay } from "@repo/contracts";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatReadableDate } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import {
  attendanceList,
  byClass,
  bySubject,
  pairState,
  sectionShort,
  type AttendanceMode,
  type Pair,
  type PairState,
} from "./home-logic";
import { AreaIcon, CapsuleAction, HomeCard, Pill, Ring, SectionHead, homeStyles } from "./ui";

const c = copy.home;

/** "8:47" in IST from a timestamp. */
export function clockIst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

const openMarking = (sectionId: string) => router.push({ pathname: "/attendance", params: { sectionId } });

// ---------------------------------------------------------------------------
// Your attendance
// ---------------------------------------------------------------------------

export function MyAttendance({
  mode,
  own,
  classTeacherSections,
  covers,
}: {
  mode: AttendanceMode;
  own: HomeSectionDay[];
  classTeacherSections: Set<string>;
  covers: Map<string, string>;
}) {
  if (mode === "none" || mode === "dayOff") return null;

  if (mode === "done") {
    const present = own.reduce((s, d) => s + d.present, 0);
    const total = own.reduce((s, d) => s + d.marked, 0);
    return <DoneLine title={c.allMarked(own.length)} sub={c.allMarkedSub(present, total)} />;
  }

  if (mode === "single") {
    const day = own[0]!;
    const label = sectionShort(day);
    return (
      <HomeCard testID="home-mark-single" style={styles.lead}>
        <View style={styles.head}>
          <AreaIcon area="attendance" icon="attendance" />
          <ThemedText variant="meta" style={styles.headText} numberOfLines={1}>
            {classTeacherSections.has(day.sectionId) ? c.yourClass(label) : `${c.attendance} · ${label}`}
          </ThemedText>
          <Pill text={c.notMarkedPill} tone="caution" />
        </View>
        <View style={styles.bigRow}>
          <Ring value={0}>
            <ThemedText style={styles.ringNum}>{day.students}</ThemedText>
            <ThemedText style={styles.ringCap}>{c.students}</ThemedText>
          </Ring>
          <View style={styles.grow}>
            <ThemedText style={styles.bigTitle}>{c.markToday}</ThemedText>
            <ThemedText variant="meta" style={homeStyles.meta}>
              {c.markHint}
            </ThemedText>
          </View>
        </View>
        <View style={styles.ctaWrap}>
          <CapsuleAction wide tone="accent" label={c.startMarking} icon="chevronRight" onPress={() => openMarking(day.sectionId)} testID="home-start-marking" />
        </View>
      </HomeCard>
    );
  }

  const list = attendanceList(own);
  return (
    <HomeCard testID="home-mark-list" style={styles.lead}>
      <View style={styles.head}>
        <AreaIcon area="attendance" icon="attendance" />
        <ThemedText variant="meta" style={styles.headText}>
          {c.attendanceToday}
        </ThemedText>
        <Pill text={c.waitingCount(list.waiting.length)} tone="caution" />
      </View>
      <View style={styles.list}>
        {list.waiting.map((day) => (
          <SectionLine key={day.sectionId} day={day} cover={covers.get(day.sectionId) ?? null} waiting />
        ))}
        {list.marked.map((day) => (
          <SectionLine key={day.sectionId} day={day} cover={covers.get(day.sectionId) ?? null} />
        ))}
        {list.folded > 0 ? <FoldedMarked days={list.allMarked} covers={covers} /> : null}
      </View>
    </HomeCard>
  );
}

function FoldedMarked({ days, covers }: { days: HomeSectionDay[]; covers: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={styles.foldRow} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <AppIcon name="check" size={18} color={colors.accentDeep} />
        <ThemedText style={styles.foldText}>{c.moreMarked(days.length)}</ThemedText>
        <AppIcon name={open ? "chevronUp" : "chevronDown"} size={18} color={colors.accentDeep} />
      </Pressable>
      {open ? days.map((day) => <SectionLine key={day.sectionId} day={day} cover={covers.get(day.sectionId) ?? null} />) : null}
    </>
  );
}

function SectionLine({ day, cover, waiting }: { day: HomeSectionDay; cover: string | null; waiting?: boolean }) {
  const subject = cover ? c.covering(formatReadableDate(cover)) : null;
  return (
    <View style={styles.secRow}>
      <View style={[styles.secName, waiting ? styles.secNameDue : null]}>
        <ThemedText style={[styles.secNameText, waiting ? { color: colors.tone.caution.fg } : null]}>{sectionShort(day)}</ThemedText>
      </View>
      <View style={styles.grow}>
        <ThemedText style={styles.secTitle} numberOfLines={1}>
          {`${day.students} ${c.students}`}
          {subject ? ` · ${subject}` : ""}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {day.markedBy ? c.markedBy(day.markedBy.name, clockIst(day.markedBy.at)) : c.nobodyYet}
        </ThemedText>
      </View>
      {waiting ? (
        <CapsuleAction label={c.mark} tone="accent" onPress={() => openMarking(day.sectionId)} testID={`home-mark-${day.sectionId}`} />
      ) : (
        <Pill text={c.marked} tone="positive" icon="check" />
      )}
    </View>
  );
}

export function DoneLine({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.done} testID="home-mark-done">
      <View style={styles.doneOk}>
        <AppIcon name="check" size={18} color={colors.onAccent} />
      </View>
      <View style={styles.grow}>
        <ThemedText style={styles.doneTitle}>{title}</ThemedText>
        <ThemedText style={styles.doneSub}>{sub}</ThemedText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// You teach
// ---------------------------------------------------------------------------

export function YouTeach({
  pairs,
  papers,
  today,
  classTeacherLabels,
}: {
  pairs: Pair[];
  papers: HomePaper[];
  today: string;
  classTeacherLabels: string[];
}) {
  const [view, setView] = useState<"subject" | "class">(pairs.length > 8 ? "class" : "subject");
  if (pairs.length === 0 && classTeacherLabels.length === 0) return null;

  const showSwitch = pairs.length > 2;
  return (
    <View>
      <SectionHead
        title={c.youTeach}
        area="teaching"
        icon="teaching"
        right={showSwitch ? <ViewSwitch value={view} onChange={setView} /> : null}
        link={showSwitch ? undefined : c.teachingLink}
        onLink={() => router.push("/teaching")}
      />
      <HomeCard padless>
        {classTeacherLabels.length > 0 ? (
          <View style={styles.ctLine}>
            <Pill text={c.classTeacherOf(classTeacherLabels.join(", "))} tone="teaching" />
          </View>
        ) : null}
        {view === "subject" || pairs.length <= 2 ? (
          bySubject(pairs).map((group, index) => (
            <View key={group.subjectId} style={[styles.subj, index > 0 || classTeacherLabels.length > 0 ? styles.subjLine : null]}>
              <View style={styles.subjHead}>
                <View style={[styles.subjDot, { backgroundColor: SUBJECT_HUES[index % SUBJECT_HUES.length] }]} />
                <ThemedText style={styles.subjName}>{group.subjectName}</ThemedText>
                <ThemedText variant="meta" style={styles.subjCount}>
                  {c.sectionsCount(group.pairs.length)}
                </ThemedText>
              </View>
              <View style={styles.chips}>
                {group.pairs.map((pair) => (
                  <PairChip key={`${pair.sectionId}:${pair.subjectId}`} pair={pair} state={pairState(pair, papers, today)} />
                ))}
              </View>
            </View>
          ))
        ) : (
          <ClassGrid pairs={pairs} papers={papers} today={today} />
        )}
      </HomeCard>
    </View>
  );
}

const SUBJECT_HUES = [colors.area.fees.fg, colors.area.attendance.fg, colors.area.exams.fg, colors.area.homework.fg, colors.area.students.fg, colors.area.teaching.fg];

function ViewSwitch({ value, onChange }: { value: "subject" | "class"; onChange: (v: "subject" | "class") => void }) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {(["subject", "class"] as const).map((v) => (
        <Pressable
          key={v}
          onPress={() => onChange(v)}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === v }}
          style={[styles.segItem, value === v ? styles.segOn : null]}
          hitSlop={4}
        >
          <ThemedText style={[styles.segText, value === v ? styles.segTextOn : null]}>{v === "subject" ? c.bySubject : c.byClass}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const stateTone = (state: PairState) =>
  state.kind === "done"
    ? colors.tone.positive
    : state.kind === "due"
      ? colors.tone.caution
      : colors.tone.neutral;

function PairChip({ pair, state }: { pair: Pair; state: PairState }) {
  const tone = stateTone(state);
  return (
    <View style={styles.chip} accessibilityLabel={`${pair.label} ${pair.subjectName}${state.text ? `, ${state.text}` : ""}`}>
      <ThemedText style={styles.chipName}>{pair.label}</ThemedText>
      {pair.cover ? <AppIcon name="swap" size={13} color={colors.area.teaching.fg} /> : null}
      {state.text ? (
        <View style={[styles.chipState, { backgroundColor: tone.bg }]}>
          <ThemedText style={[styles.chipStateText, { color: tone.fg }]}>{state.text}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function ClassGrid({ pairs, papers, today }: { pairs: Pair[]; papers: HomePaper[]; today: string }) {
  const grid = byClass(pairs);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.gridWrap}>
      <View>
        <View style={styles.gridRow}>
          <View style={styles.gridLabel} />
          {grid.subjects.map((s) => (
            <ThemedText key={s.subjectId} style={styles.gridHead} numberOfLines={1}>
              {s.subjectName}
            </ThemedText>
          ))}
        </View>
        {grid.rows.map((row) => (
          <View key={row.sectionId} style={styles.gridRow}>
            <ThemedText style={styles.gridLabelText}>{row.label}</ThemedText>
            {grid.subjects.map((s) => {
              const pair = row.cells.get(s.subjectId);
              if (!pair) return <View key={s.subjectId} style={[styles.cell, styles.cellEmpty]} />;
              const state = pairState(pair, papers, today);
              const tone = stateTone(state);
              return (
                <View key={s.subjectId} style={[styles.cell, { backgroundColor: state.text ? tone.bg : colors.canvas }]}>
                  <ThemedText style={[styles.cellText, { color: state.text ? tone.fg : colors.muted }]}>{state.text ?? "·"}</ThemedText>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headText: { flex: 1, fontFamily: fontFamily.semibold },
  bigRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: 14 },
  ringNum: { fontFamily: fontFamily.bold, fontSize: 22, letterSpacing: -0.5, color: colors.ink, fontVariant: ["tabular-nums"] },
  ringCap: { fontFamily: fontFamily.semibold, fontSize: 11, color: colors.muted },
  bigTitle: { fontFamily: fontFamily.bold, fontSize: 21, letterSpacing: -0.4, color: colors.ink },
  ctaWrap: { marginTop: 14 },
  list: { marginTop: 6 },
  secRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.hairline,
  },
  secName: { width: 48, height: 40, borderRadius: radius.sm, backgroundColor: colors.canvas, alignItems: "center", justifyContent: "center" },
  secNameDue: { backgroundColor: colors.tone.caution.bg },
  secNameText: { fontFamily: fontFamily.bold, fontSize: 15, color: colors.ink },
  secTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.small, color: colors.ink },
  foldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: spacing.md,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.hairline,
    minHeight: 44,
  },
  foldText: { flex: 1, fontFamily: fontFamily.semibold, fontSize: fontSize.small, color: colors.accentDeep },
  lead: { marginBottom: spacing.md },
  done: {
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.accentTint,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  doneOk: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  doneTitle: { fontFamily: fontFamily.semibold, fontSize: fontSize.body, color: colors.accentDeep },
  doneSub: { fontSize: fontSize.fine, color: colors.accentDeep, opacity: 0.85, fontVariant: ["tabular-nums"] },
  ctLine: { paddingHorizontal: spacing.lg, paddingTop: 14 },
  subj: { paddingHorizontal: spacing.lg, paddingVertical: 14 },
  subjLine: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors.hairline },
  subjHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  subjDot: { width: 10, height: 10, borderRadius: 3 },
  subjName: { fontFamily: fontFamily.bold, fontSize: fontSize.body, color: colors.ink },
  subjCount: { marginLeft: "auto", fontFamily: fontFamily.semibold, fontSize: fontSize.caption },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 36,
    paddingLeft: spacing.md,
    paddingRight: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.canvas,
  },
  chipName: { fontFamily: fontFamily.bold, fontSize: fontSize.small, color: colors.ink },
  chipState: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  chipStateText: { fontFamily: fontFamily.semibold, fontSize: 11.5, fontVariant: ["tabular-nums"] },
  seg: { flexDirection: "row", padding: 3, borderRadius: 10, backgroundColor: colors.field },
  segItem: { height: 28, paddingHorizontal: 10, borderRadius: 8, justifyContent: "center" },
  segOn: { backgroundColor: colors.surface, boxShadow: "0 1px 2px rgba(16,24,40,0.12)" },
  segText: { fontFamily: fontFamily.semibold, fontSize: fontSize.caption, color: colors.muted },
  segTextOn: { color: colors.ink },
  gridWrap: { padding: spacing.lg },
  gridRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  gridLabel: { width: 48 },
  gridLabelText: { width: 48, fontFamily: fontFamily.bold, fontSize: fontSize.small, color: colors.ink },
  gridHead: { width: 78, textAlign: "center", fontFamily: fontFamily.bold, fontSize: 11.5, color: colors.muted },
  cell: { width: 78, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cellEmpty: { borderWidth: 1, borderStyle: "dashed", borderColor: colors.field },
  cellText: { fontFamily: fontFamily.semibold, fontSize: 11.5, fontVariant: ["tabular-nums"] },
});

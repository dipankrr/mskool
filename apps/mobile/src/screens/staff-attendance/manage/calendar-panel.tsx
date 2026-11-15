import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../../components/app-icon";
import { CapsuleButton } from "../../../components/capsule-button";
import { Card } from "../../../components/card";
import { ErrorCard } from "../../../components/error-card";
import { SegmentBar } from "../../../components/segment-bar";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../../hooks/use-active-context";
import { usePermissions } from "../../../hooks/use-permissions";
import { copy } from "../../../lib/copy";
import { formatMonthLong, todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { colors } from "../../../theme/brand-admin";
import { radius, spacing } from "../../../theme/tokens";
import { clampMonth, daysInMonth, isoOf, monthIndex, shiftMonth } from "../calendar-month";
import { datesBetween, entryLength, groupEntries } from "./calendar-lib";
import type { DayType, Entry, PatternDay } from "./calendar-lib";
import { EntrySheet, SetDaysSheet, useCalendarWrites } from "./calendar-sheets";
import {
  EntryRow,
  MonthBreakdown,
  MonthGrid,
  SessionMix,
  YearGrid,
  countDays,
  rangeLabel,
  sessionRange,
  typeName,
} from "./calendar-ui";
import { ManageFrame } from "./frame";
import { PatternSheet, patternSummary } from "./pattern-sheet";

type View_ = "month" | "year" | "list";

/**
 * The calendar, rebuilt (ADR-069, mockup frames B1–B5, C3). Month view with
 * the counts first and days readable at a glance; a holiday list of named
 * ranges; tap a day to change it, hold to pick several; a banner when days
 * have no entry; set-up when the session has none. A teacher sees it all
 * read-only.
 */
export function ManageCalendar() {
  const { has } = usePermissions();
  const canManage = has("attendance:update");
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const branchMeta = useBranchMeta();
  const utils = trpc.useUtils();
  const words = copy.attendance.manage.cal;

  const [view, setView] = useState<View_>("month");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [setting, setSetting] = useState<string[] | null>(null);
  const [patternOpen, setPatternOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState<{ entry: Entry | null } | null>(null);

  const ready = Boolean(organizationId && schoolId && academicYear);
  const start = academicYear?.startDate ?? "";
  const end = academicYear?.endDate ?? "";
  const today = todayIso();
  const monthAnchor = useMemo(
    () => anchor ?? (start && end ? clampMonth(today, start, end) : null),
    [anchor, start, end, today],
  );

  const base = {
    organizationId: organizationId ?? "",
    schoolId: schoolId ?? "",
    academicYearId: academicYear?.id ?? "",
  };
  const overview = trpc.attendance.calendar.overview.useQuery(base, {
    enabled: ready,
    staleTime: 60_000,
  });
  const yearList = trpc.attendance.calendar.list.useQuery(base, {
    enabled: ready,
    staleTime: 60_000,
  });

  const monthDates = useMemo(() => {
    if (!monthAnchor) return [];
    const y = Number(monthAnchor.slice(0, 4));
    const m = Number(monthAnchor.slice(5, 7));
    return Array.from({ length: daysInMonth(y, m) }, (_, i) => isoOf(y, m, i + 1));
  }, [monthAnchor]);
  const usage = trpc.attendance.calendar.usage.useQuery(
    { ...base, dates: monthDates },
    { enabled: ready && monthDates.length > 0, staleTime: 60_000 },
  );

  const rows = useMemo(() => yearList.data ?? [], [yearList.data]);
  const typeOf = useMemo(() => new Map(rows.map((r) => [r.date, r.dayType as DayType])), [rows]);
  const reasonOf = useMemo(() => new Map(rows.map((r) => [r.date, r.reason])), [rows]);
  const entries = useMemo(
    () =>
      groupEntries(
        rows.map((r) => ({ date: r.date, dayType: r.dayType as DayType, reason: r.reason })),
      ),
    [rows],
  );
  const marked = useMemo(() => new Set((usage.data ?? []).map((u) => u.date)), [usage.data]);
  const pattern = (overview.data?.weekdays ?? null) as PatternDay[] | null;
  const writes = useCalendarWrites(pattern);


  const canPrev = Boolean(monthAnchor && start && monthIndex(monthAnchor) > monthIndex(start));
  const canNext = Boolean(monthAnchor && end && monthIndex(monthAnchor) < monthIndex(end));
  const selecting = selected.size > 0;

  const fillGaps = trpc.attendance.calendar.fillGaps.useMutation({
    onSuccess: () => void utils.attendance.invalidate(),
  });

  const toggle = (iso: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });

  if (!ready || !monthAnchor) {
    return (
      <ManageFrame title={copy.attendance.manage.rows.calendar} meta={branchMeta}>
        <Card>
          <ThemedText variant="bodyStrong">{copy.session.noYearTitle}</ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      </ManageFrame>
    );
  }

  const loading = overview.isPending || yearList.isPending;
  const failed = overview.isError || yearList.isError;
  const empty = overview.data?.entries === 0;
  const missing = overview.data?.missing ?? [];

  const selectionBar = selecting ? (
    <View style={styles.selBar} testID="cal-selection">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={words.clearSelection}
        hitSlop={8}
        onPress={() => setSelected(new Set())}
        style={styles.selClose}
      >
        <AppIcon name="close" size={20} color={colors.onAccent} />
      </Pressable>
      <ThemedText variant="bodyStrong" color={colors.onAccent} style={styles.flex}>
        {words.selected(selected.size)}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={() => setSetting([...selected].sort())}
        style={styles.selSet}
        testID="cal-selection-set"
      >
        <ThemedText variant="bodyStrong" color={colors.ink}>
          {words.setSelected}
        </ThemedText>
      </Pressable>
    </View>
  ) : null;

  return (
    <ManageFrame
      title={copy.attendance.manage.rows.calendar}
      meta={[academicYear?.name, branchMeta].filter(Boolean).join(" · ")}
      action={
        canManage && !empty && !loading && !failed
          ? { label: words.addHoliday, icon: "add", onPress: () => setEntryOpen({ entry: null }) }
          : undefined
      }
    >
      {loading ? (
        <View style={styles.gapTop}>
          <Skeleton height={44} />
          <Skeleton height={72} style={styles.gapTop} />
          <Skeleton height={320} style={styles.gapTop} />
        </View>
      ) : failed ? (
        <ErrorCard
          cause={overview.error ?? yearList.error}
          onRetry={() => {
            void overview.refetch();
            void yearList.refetch();
          }}
          testID="calendar-error"
        />
      ) : empty ? (
        <SetupPrompt canManage={canManage} sessionName={academicYear?.name ?? ""} />
      ) : (
        <>
          {missing.length > 0 ? (
            <View style={styles.gapBanner} testID="cal-gaps">
              <AppIcon name="warning" size={20} color={colors.tone.caution.fg} />
              <View style={styles.flex}>
                <ThemedText variant="bodyStrong" color="#7A2E0E">
                  {words.gapTitle(missing.length)}
                </ThemedText>
                <ThemedText variant="meta" color="#93370D">
                  {words.gapBody(rangeLabel(missing[0]!, missing[missing.length - 1]!))}
                </ThemedText>
                {canManage ? (
                  pattern ? (
                    <CapsuleButton
                      title={words.gapFill}
                      size="compact"
                      variant="secondary"
                      loading={fillGaps.isPending}
                      onPress={() =>
                        fillGaps.mutate({
                          organizationId: base.organizationId,
                          schoolId: base.schoolId,
                          data: { academicYearId: base.academicYearId },
                        })
                      }
                      style={styles.gapButton}
                      testID="cal-gaps-fill"
                    />
                  ) : (
                    <ThemedText variant="caption" color="#93370D" style={styles.gapTopSmall}>
                      {words.gapNoPattern}
                    </ThemedText>
                  )
                ) : null}
              </View>
            </View>
          ) : null}

          {/* The selection bar takes the toggle's place, same height, so the
              grid does not move under the finger when picking starts. */}
          {selecting ? (
            selectionBar
          ) : (
            <SegmentBar
              label={copy.attendance.manage.rows.calendar}
              value={view}
              onChange={(next) => {
                setView(next);
                setSelected(new Set());
              }}
              options={[
                { value: "month", label: words.month, testID: "cal-view-month" },
                { value: "year", label: words.year, testID: "cal-view-year" },
                { value: "list", label: words.list, testID: "cal-view-list" },
              ]}
            />
          )}

          {view === "month" ? (
            <>
              <Card style={styles.gapTop}>
                <SessionMix
                  counts={countDays(
                    monthDates[0]!,
                    monthDates[monthDates.length - 1]!,
                    (iso) => typeOf.get(iso) ?? null,
                  )}
                  caption={formatMonthLong(monthAnchor)}
                />
              </Card>
              <View style={styles.monthRow}>
                <ThemedText variant="bodyStrong" style={[styles.flex, styles.monthTitle]}>
                  {formatMonthLong(monthAnchor)}
                </ThemedText>
                <MonthButton
                  icon="chevronLeft"
                  label={copy.attendance.marking.prevMonth}
                  enabled={canPrev}
                  onPress={() => setAnchor(shiftMonth(monthAnchor, -1))}
                  testID="calendar-prev"
                />
                <MonthButton
                  icon="chevronRight"
                  label={copy.attendance.marking.nextMonth}
                  enabled={canNext}
                  onPress={() => setAnchor(shiftMonth(monthAnchor, 1))}
                  testID="calendar-next"
                />
              </View>
              <Card style={styles.gridCard}>
                <MonthGrid
                  anchor={monthAnchor}
                  typeOf={typeOf}
                  marked={marked}
                  today={today}
                  selected={selected}
                  start={start}
                  end={end}
                  onPress={
                    canManage ? (iso) => (selecting ? toggle(iso) : setSetting([iso])) : undefined
                  }
                  onLongPress={canManage ? toggle : undefined}
                />
              </Card>
              <ThemedText variant="meta" style={styles.hint}>
                {canManage ? words.tapHint : words.readOnlyHint}
              </ThemedText>
            </>
          ) : view === "year" ? (
            <>
              <Pressable
                accessibilityRole={canManage ? "button" : undefined}
                disabled={!canManage}
                onPress={() => setPatternOpen(true)}
                style={({ pressed }) => [styles.patternRow, pressed ? styles.pressedRow : null]}
                testID="cal-pattern-row"
              >
                <View style={styles.flex}>
                  <ThemedText variant="caption" color={colors.muted}>
                    {words.patternRow}
                  </ThemedText>
                  <ThemedText variant="bodyStrong" numberOfLines={2}>
                    {patternSummary(pattern)}
                  </ThemedText>
                </View>
                {canManage ? (
                  <ThemedText variant="chip" color={colors.accentDeep}>
                    {words.patternChange}
                  </ThemedText>
                ) : null}
              </Pressable>
              <Card style={styles.gapTop}>
                <SessionMix
                  counts={countDays(start, end, (iso) => typeOf.get(iso) ?? null)}
                  caption={words.reviewBody(sessionRange(start, end))}
                />
              </Card>
              <Card style={styles.yearCard}>
                <YearGrid
                  from={start}
                  end={end}
                  typeAt={(iso) => typeOf.get(iso) ?? null}
                  onPickMonth={(iso) => {
                    setAnchor(iso);
                    setView("month");
                  }}
                />
              </Card>
              <ThemedText variant="meta" style={styles.hint}>
                {words.yearHint}
              </ThemedText>
              <ThemedText variant="sectionLabel" style={styles.byMonth}>
                {words.byMonth}
              </ThemedText>
              <Card padless>
                <MonthBreakdown
                  from={start}
                  end={end}
                  typeAt={(iso) => typeOf.get(iso) ?? null}
                  onPickMonth={(iso) => {
                    setAnchor(iso);
                    setView("month");
                  }}
                />
              </Card>
            </>
          ) : (
            <HolidayList
              entries={entries}
              typeOf={typeOf}
              onOpen={canManage ? (entry) => setEntryOpen({ entry }) : undefined}
            />
          )}
        </>
      )}

      {setting ? (
        <SetDaysSheet
          dates={setting}
          initialType={sharedType(setting, typeOf)}
          initialReason={setting.length === 1 ? (reasonOf.get(setting[0]!) ?? null) : null}
          pending={writes.pending}
          error={writes.error}
          onClose={() => setSetting(null)}
          onSave={(dayType, reason) =>
            void writes.submit([{ dates: setting, dayType, reason }], () => {
              setSetting(null);
              setSelected(new Set());
            })
          }
        />
      ) : null}
      {entryOpen ? (
        <EntrySheet
          entry={entryOpen.entry}
          start={start}
          end={end}
          others={entries}
          pending={writes.pending}
          error={writes.error}
          onClose={() => setEntryOpen(null)}
          onRemove={
            entryOpen.entry
              ? () =>
                  void writes.submit(
                    writes.revertWrites(datesBetween(entryOpen.entry!.from, entryOpen.entry!.to)),
                    () => setEntryOpen(null),
                  )
              : undefined
          }
          onSave={(next) => {
            const nextDates = datesBetween(next.from, next.to);
            const keep = new Set(nextDates);
            const old = entryOpen.entry
              ? datesBetween(entryOpen.entry.from, entryOpen.entry.to).filter(
                  (iso) => !keep.has(iso),
                )
              : [];
            // A range keeps the days that are off anyway as they are.
            const days = nextDates.filter(
              (iso) => next.from === next.to || typeOf.get(iso) !== "weekend",
            );
            void writes.submit(
              [
                ...writes.revertWrites(old),
                { dates: days, dayType: next.dayType, reason: next.reason },
              ],
              () => setEntryOpen(null),
            );
          }}
        />
      ) : null}
      {writes.confirmSheet}
      {patternOpen ? (
        <PatternSheet
          current={pattern}
          start={start}
          end={end}
          onClose={() => setPatternOpen(false)}
        />
      ) : null}
    </ManageFrame>
  );
}

function sharedType(dates: readonly string[], typeOf: ReadonlyMap<string, DayType>): DayType {
  const types = new Set(dates.map((iso) => typeOf.get(iso) ?? "working"));
  return types.size === 1 ? [...types][0]! : "holiday";
}

function MonthButton({
  icon,
  label,
  enabled,
  onPress,
  testID,
}: {
  icon: "chevronLeft" | "chevronRight";
  label: string;
  enabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.monthButton,
        pressed ? styles.monthButtonPressed : null,
        !enabled ? styles.off : null,
      ]}
    >
      <AppIcon name={icon} size={20} color={colors.ink} />
    </Pressable>
  );
}

/** B3: the school's holiday list, grouped by month. */
function HolidayList({
  entries,
  typeOf,
  onOpen,
}: {
  entries: readonly Entry[];
  typeOf: ReadonlyMap<string, DayType>;
  onOpen?: (entry: Entry) => void;
}) {
  const words = copy.attendance.manage.cal;
  if (entries.length === 0) {
    return (
      <ThemedText variant="meta" style={styles.listEmpty}>
        {words.listEmpty}
      </ThemedText>
    );
  }
  const months = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = entry.from.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), entry]);
  }
  return (
    <View testID="cal-list">
      {[...months].map(([key, list]) => (
        <View key={key}>
          <View style={styles.listHead}>
            <ThemedText variant="sectionLabel">
              {formatMonthLong(`${key}-01`).split(" ")[0]}
            </ThemedText>
            <ThemedText variant="caption" color={colors.muted}>
              {words.entryCount(list.length)}
            </ThemedText>
          </View>
          <Card padless>
            {list.map((entry, index) => {
              const n = entryLength(entry, typeOf);
              const meta =
                entry.from === entry.to
                  ? rangeLabel(entry.from, entry.to)
                  : `${rangeLabel(entry.from, entry.to)} · ${entry.dayType === "exam_day" ? words.examDays(n) : words.days(n)}`;
              return (
                <EntryRow
                  key={entry.key}
                  entry={entry}
                  meta={meta}
                  first={index === 0}
                  onPress={onOpen ? () => onOpen(entry) : undefined}
                />
              );
            })}
          </Card>
        </View>
      ))}
    </View>
  );
}

/** A1, inside the manage screen: an empty session goes to set-up. */
export function SetupPrompt({
  canManage,
  sessionName,
}: {
  canManage: boolean;
  sessionName: string;
}) {
  const words = copy.attendance.manage.cal;
  if (!canManage) {
    return (
      <Card style={styles.locked} testID="cal-locked">
        <View style={styles.lockIcon}>
          <AppIcon name="lock" size={20} color={colors.tone.neutral.fg} />
        </View>
        <View style={styles.flex}>
          <ThemedText variant="bodyStrong">{words.lockedTitle}</ThemedText>
          <ThemedText variant="meta">{words.lockedBody(sessionName)}</ThemedText>
        </View>
      </Card>
    );
  }
  return (
    <Card style={styles.setup} testID="cal-setup-prompt">
      <View style={styles.setupIcon}>
        <AppIcon name="calendar" size={28} color={colors.tone.caution.fg} />
      </View>
      <ThemedText variant="title" style={styles.center}>
        {words.emptyTitle}
      </ThemedText>
      <ThemedText variant="meta" style={styles.center}>
        {words.emptyBody}
      </ThemedText>
      <View style={styles.steps}>
        {words.emptySteps.map((step, index) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepNum}>
              <ThemedText variant="caption" color={colors.muted}>
                {index + 1}
              </ThemedText>
            </View>
            <ThemedText variant="body" style={styles.flex}>
              {step}
            </ThemedText>
          </View>
        ))}
      </View>
      <CapsuleButton
        title={words.emptyCta}
        onPress={() => router.push("/attendance/manage/calendar-setup")}
        testID="cal-setup-start"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  cardBody: { marginTop: spacing.xs },
  gapTop: { marginTop: spacing.md },
  gapTopSmall: { marginTop: spacing.xs },
  gapBanner: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.tone.caution.bg,
    marginBottom: spacing.md,
  },
  gapButton: { alignSelf: "flex-start", marginTop: spacing.sm },
  stats: { flexDirection: "row", marginTop: spacing.md, paddingVertical: spacing.md },
  stat: { flex: 1, gap: 1 },
  statValue: { fontVariant: ["tabular-nums"] },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  monthButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  monthButtonPressed: { backgroundColor: colors.field },
  off: { opacity: 0.35 },
  monthTitle: { fontSize: 20, lineHeight: 26 },
  yearCard: { marginTop: spacing.md },
  patternRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressedRow: { opacity: 0.85 },
  byMonth: { marginTop: spacing.lg, marginBottom: spacing.xs, paddingHorizontal: spacing.xs },
  gridCard: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  hint: { marginTop: spacing.sm, textAlign: "center" },
  listHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  listEmpty: { marginTop: spacing.lg, textAlign: "center" },
  selBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    height: 50,
    paddingHorizontal: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: colors.ink,
  },
  selClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  selSet: {
    height: 42,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  setup: { alignItems: "stretch", gap: spacing.sm, paddingVertical: spacing.lg },
  setupIcon: {
    alignSelf: "center",
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tone.caution.bg,
  },
  steps: { gap: spacing.sm, marginVertical: spacing.sm },
  stepRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.field,
  },
  locked: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  lockIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tone.neutral.bg,
  },
});

export { typeName };

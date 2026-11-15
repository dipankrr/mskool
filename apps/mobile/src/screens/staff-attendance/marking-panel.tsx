import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { ConfirmSheet } from "../../components/confirm-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { StatusMeter } from "../../components/status-meter";
import {
  useFollowTabBarCapped,
  useHideTabBarOnScroll,
  useTabBarSpace,
} from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { formatShortWeekday, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, gutter, motion, radius, shadow, spacing } from "../../theme/tokens";
import { clampIsoDate, clampMonth } from "./calendar-month";
import { DaySheet } from "./day-sheet";
import {
  buildDraft,
  buildEntries,
  bulkDraft,
  changingIds,
  countStatuses,
  deriveClean,
  toggleStatus,
  withStatus,
} from "./draft";
import type { Status, StatusCounts } from "./draft";
import { RollGrid } from "./roll-grid";
import type { SessionMix } from "./roll-ring";
import { RosterRow } from "./roster-row";
import type { RecentMark, RosterRowData } from "./roster-row";
import { StatusSheet } from "./status-sheet";
import type { SheetStudent } from "./status-sheet";
import { MARKABLE_DAY_TYPES, statusLabel, statusTone } from "./status-meta";
import { formatPercent, presentSharePercent, summaryByStudent } from "./summary";
import type { SummaryRow } from "./summary";
import { Tally } from "./tally";
import type { TallyFilter } from "./tally";
import { useRecentAttendance } from "./use-recent-attendance";
import { useSectionRoster } from "./use-section-roster";

type RefusalKind = "holiday" | "weekend" | "noCalendar" | "other";
type Layout = "list" | "grid";

/** Remembered per device: a teacher who calls rolls keeps the grid. */
const LAYOUT_KEY = "attendance.markingLayout";
/** How long "Undo" stays after "Mark all present". */
const UNDO_MS = 5000;
const STATUS_ORDER: readonly Status[] = ["present", "absent", "late", "half_day", "on_leave"];
/** Save bar height used to pad the list's end so the last row clears it. */
const SAVE_HEIGHT = 54;
const REASON_HEIGHT = 150;

function refusalOf(day: { dayType: string } | null): RefusalKind | null {
  if (!day) return "noCalendar";
  if (MARKABLE_DAY_TYPES.includes(day.dayType)) return null;
  if (day.dayType === "holiday") return "holiday";
  if (day.dayType === "weekend") return "weekend";
  return "other";
}

function gateMessage(kind: RefusalKind, date: string): string {
  const label = formatShortWeekday(date);
  if (kind === "holiday") return copy.attendance.marking.gateHoliday(label);
  if (kind === "weekend") return copy.attendance.marking.gateWeekend(label);
  if (kind === "noCalendar") return copy.attendance.marking.gateNoCalendar(label);
  return copy.attendance.marking.gateOther(label);
}

/** `#RRGGBB` → the same colour at `alpha`, for the save button's tinted bands. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** A student's session so far for the ring and the hold sheet. */
function sessionOf(row: SummaryRow | undefined): {
  mix: SessionMix | null;
  percentText: string | null;
} {
  if (!row) return { mix: null, percentText: null };
  const share = presentSharePercent(row);
  return {
    mix: {
      present: row.daysPresent,
      absent: row.daysAbsent,
      late: row.daysLate,
      half_day: row.daysHalfDay,
      on_leave: row.daysOnLeave,
    },
    percentText: share === null ? null : formatPercent(share),
  };
}

type Item =
  | { kind: "top" }
  | { kind: "tally" }
  | { kind: "intro" }
  | { kind: "row"; row: RosterRowData; first: boolean; last: boolean }
  | { kind: "grid" }
  | { kind: "none" };

/**
 * The marking panel, rebuilt to the v2 mockup the owner approved on
 * 2026-11-15 (`docs/design/mobile/prototype/attendance-marking-v2.html`).
 *
 * One scroll: the shell's title and the day row scroll away, the counts card
 * pins to the top (it doubles as the list's filter), and the tab bar slides
 * away with the save button dropping into its place. Rows carry the session
 * ring and the last-5-days strip; a roll-call grid shows the same marks six
 * across. Tap / hold / bulk rules are unchanged (`draft.ts`).
 */
export function MarkingPanel({
  sectionId,
  head,
  viewToggle,
}: {
  sectionId: string;
  /** The shell's section title row; scrolls away with the day row. */
  head: ReactNode;
  /** The compact Mark | Summary switch, placed on the day row. */
  viewToggle: ReactNode;
}) {
  const { has } = usePermissions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const canMark = has("attendance:create");
  const tabSpace = useTabBarSpace();
  const insets = useSafeAreaInsets();
  const hideTabBarOnScroll = useHideTabBarOnScroll();
  const followTabBar = useFollowTabBarCapped(Math.max(0, tabSpace - insets.bottom - spacing.md));
  const utils = trpc.useUtils();
  const words = copy.attendance.marking;

  // Today, kept inside the viewed session (ADR-066): a past session opens on
  // its last day. The panel is keyed by session, so a switch re-runs this.
  const [date, setDate] = useState(() =>
    clampIsoDate(todayIso(), academicYear?.startDate, academicYear?.endDate),
  );
  const [sheetMonth, setSheetMonth] = useState(() => date);
  const [periodId, setPeriodId] = useState("");
  const [draft, setDraft] = useState<Map<string, Status>>(() => new Map());
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [sheetStudentId, setSheetStudentId] = useState<string | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  const [filter, setFilter] = useState<TallyFilter | null>(null);
  const [layout, setLayout] = useState<Layout>("list");
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmAbsent, setConfirmAbsent] = useState(false);
  const [undo, setUndo] = useState<{ previous: Map<string, Status>; count: number } | null>(null);
  /** Any manual mark makes the teacher's entries the truth; no refetch may
   *  overwrite them until the day changes or a submit resets the flag. */
  const editedRef = useRef(false);
  const prefillKeyRef = useRef("");

  const ready = Boolean(organizationId && academicYear);

  useEffect(() => {
    AsyncStorage.getItem(LAYOUT_KEY)
      .then((value) => {
        if (value === "grid" || value === "list") setLayout(value);
      })
      .catch(() => undefined);
  }, []);
  const changeLayout = (next: Layout) => {
    setLayout(next);
    void Haptics.selectionAsync();
    AsyncStorage.setItem(LAYOUT_KEY, next).catch(() => undefined);
  };

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const policyQuery = trpc.attendance.policy.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId), staleTime: 300_000 },
  );
  const periodWise = policyQuery.data?.markingMode === "period_wise";

  const periodsQuery = trpc.attendance.period.list.useQuery(
    { schoolId: schoolId ?? "", organizationId: organizationId ?? "", sectionId },
    { enabled: ready && periodWise, staleTime: 300_000 },
  );
  const periods = periodsQuery.data ?? [];
  // Derived, never stored in an effect: the chosen period while still valid,
  // else the section's first.
  const selectedPeriodId = periodWise
    ? periodId !== "" && periods.some((period) => period.id === periodId)
      ? periodId
      : (periods[0]?.id ?? "")
    : "";

  const statusQuery = trpc.attendance.status.useQuery(
    { schoolId: schoolId ?? "", organizationId: organizationId ?? "", sectionId, date },
    { enabled: ready, staleTime: 30_000 },
  );

  const calendarQuery = trpc.attendance.calendar.list.useQuery(
    {
      schoolId: schoolId ?? "",
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      month: Number(date.slice(5, 7)),
    },
    { enabled: ready, staleTime: 300_000 },
  );

  // The session ring reads the Summary tab's own query (same key), so opening
  // Summary afterwards is instant rather than a second fetch.
  const summaryQuery = trpc.attendance.summary.useQuery(
    {
      schoolId: schoolId ?? "",
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      sectionId,
    },
    { enabled: ready, staleTime: 60_000 },
  );
  const summaryRows = useMemo(
    () => summaryByStudent(summaryQuery.data ?? []),
    [summaryQuery.data],
  );

  const { roster, rosterIds, query: enrollmentsQuery } = useSectionRoster(sectionId, date);
  const { days: recentDays } = useRecentAttendance({ sectionId, date, enabled: ready });

  const recentByStudent = useMemo(() => {
    const map = new Map<string, RecentMark[]>();
    for (const studentId of rosterIds) {
      map.set(
        studentId,
        recentDays.map((day) => ({ date: day.date, status: day.statuses.get(studentId) ?? null })),
      );
    }
    return map;
  }, [recentDays, rosterIds]);

  const storedByStudent = useMemo(() => {
    const map = new Map<string, Status>();
    for (const row of statusQuery.data ?? []) map.set(row.studentId, row.status);
    return map;
  }, [statusQuery.data]);

  // Prefill from the authoritative layer until the teacher edits, then never
  // again until the day changes or a submit resets the flag.
  useEffect(() => {
    const key = `${sectionId}:${date}:${selectedPeriodId}`;
    if (prefillKeyRef.current !== key) {
      prefillKeyRef.current = key;
      editedRef.current = false;
      setEditing(false);
      setFilter(null);
      setUndo(null);
    }
    if (editedRef.current) return;
    setDraft(buildDraft(rosterIds, storedByStudent));
    setReason("");
  }, [sectionId, date, selectedPeriodId, rosterIds, storedByStudent]);

  const counts = useMemo(() => countStatuses(rosterIds, draft), [rosterIds, draft]);
  const changing = useMemo(
    () => changingIds(rosterIds, draft, storedByStudent),
    [rosterIds, draft, storedByStudent],
  );
  const dayIsMarked = (statusQuery.data ?? []).length > 0;
  const isToday = date === todayIso();
  const isPast = date < todayIso();
  const clean = deriveClean({
    dayIsMarked,
    changingCount: changing.length,
    unmarkedCount: counts.unmarked,
    editing,
  });
  const complete = counts.unmarked === 0 && roster.length > 0;
  const editingNoChanges = editing && dayIsMarked && changing.length === 0;
  const showReason = canMark && isPast && dayIsMarked && changing.length > 0;
  const canEditRows = canMark && !clean;
  const showSaveBar = canMark && !clean;
  const showStarter = canEditRows && !dayIsMarked && counts.marked === 0 && roster.length > 0;
  // "Not marked" clears itself once nothing is left in it.
  const activeFilter = filter === "unmarked" && counts.unmarked === 0 ? null : filter;

  const calendarDay = (calendarQuery.data ?? []).find((row) => row.date === date) ?? null;
  const refusal = refusalOf(calendarDay);

  const state: "loading" | "error" | "refused" | "empty" | "ready" =
    calendarQuery.isError || statusQuery.isError || enrollmentsQuery.isError
      ? "error"
      : calendarQuery.isPending || statusQuery.isPending || enrollmentsQuery.isPending
        ? "loading"
        : refusal !== null
          ? "refused"
          : roster.length === 0
            ? "empty"
            : "ready";

  const retryAll = () => {
    if (calendarQuery.isError) void calendarQuery.refetch();
    if (statusQuery.isError) void statusQuery.refetch();
    if (enrollmentsQuery.isError) void enrollmentsQuery.refetch();
  };

  const markSubmit = trpc.attendance.mark.useMutation({
    onSuccess: () => {
      editedRef.current = false;
      setEditing(false);
      setFilter(null);
      setUndo(null);
      void utils.attendance.status.invalidate();
      void utils.attendance.statusHistory.invalidate();
      void utils.attendance.summary.invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Announce on server confirmation only.
      AccessibilityInfo.announceForAccessibility(words.saved);
    },
    onError: (error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(copy.attendance.title, errorMessage(error));
    },
  });

  const toggleRow = (studentId: string) => {
    editedRef.current = true;
    setDraft((current) => withStatus(current, studentId, toggleStatus(current.get(studentId))));
  };
  const markAll = (status: Status) => {
    editedRef.current = true;
    if (status === "present") setUndo({ previous: new Map(draft), count: rosterIds.length });
    setDraft(bulkDraft(rosterIds, status));
  };
  const clearAll = () => {
    editedRef.current = true;
    setDraft(new Map());
  };
  const selectStatus = (status: Status) => {
    if (!sheetStudentId) return;
    editedRef.current = true;
    setDraft((current) => withStatus(current, sheetStudentId, status));
    setSheetStudentId(null);
  };
  const submit = () => {
    if (!canMark || markSubmit.isPending || clean || roster.length === 0) return;
    if (!complete) return;
    markSubmit.mutate({
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? "",
      sectionId,
      date,
      ...(periodWise && selectedPeriodId ? { periodId: selectedPeriodId } : {}),
      entries: buildEntries(rosterIds, draft, storedByStudent, { isPast, reason }),
    });
  };
  const onSavePress = () => {
    if (editingNoChanges) {
      setEditing(false);
      setReason("");
      return;
    }
    if (!complete) {
      // A tap on an unfinished save shows what's missing instead of doing nothing.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setFilter("unmarked");
      return;
    }
    submit();
  };

  const openDaySheet = () => {
    const min = academicYear?.startDate;
    const max = academicYear?.endDate;
    setSheetMonth(min && max ? clampMonth(date, min, max) : date);
    setDaySheetOpen(true);
  };

  const rowData: RosterRowData[] = useMemo(
    () =>
      roster.map((item) => {
        const status = draft.get(item.studentId) ?? null;
        const stored = storedByStudent.get(item.studentId) ?? null;
        return {
          ...item,
          status,
          recent: recentByStudent.get(item.studentId) ?? [],
          ...sessionOf(summaryRows.get(item.studentId)),
          was: dayIsMarked && stored && stored !== status ? stored : null,
        };
      }),
    [roster, draft, storedByStudent, recentByStudent, summaryRows, dayIsMarked],
  );
  const visibleRows = activeFilter
    ? rowData.filter((row) =>
        activeFilter === "unmarked" ? row.status === null : row.status === activeFilter,
      )
    : rowData;

  const sheetRow = sheetStudentId
    ? (rowData.find((entry) => entry.studentId === sheetStudentId) ?? null)
    : null;
  const sheetStudent: SheetStudent | null = sheetRow
    ? {
        studentId: sheetRow.studentId,
        name: sheetRow.name,
        roll: sheetRow.roll,
        recent: sheetRow.recent,
        mix: sheetRow.mix,
        percentText: sheetRow.percentText,
      }
    : null;

  const daySheet = (
    <DaySheet
      sectionId={sectionId}
      visible={daySheetOpen}
      anchor={sheetMonth}
      onAnchorChange={setSheetMonth}
      date={date}
      onSelect={(iso) => {
        setDate(iso);
        setDaySheetOpen(false);
      }}
      onDismiss={() => setDaySheetOpen(false)}
    />
  );

  const top = (
    <View>
      {head}
      <View style={styles.dayRow}>
        <Pressable
          testID="attendance-day"
          accessibilityRole="button"
          accessibilityLabel={formatShortWeekday(date)}
          accessibilityHint={words.dayPickerTitle}
          hitSlop={6}
          onPress={openDaySheet}
          style={({ pressed }) => [styles.dayChip, pressed ? styles.pressed : null]}
        >
          <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {formatShortWeekday(date)}
          </ThemedText>
          {isToday || isPast ? (
            <View style={[styles.dayTag, isPast ? styles.dayTagPast : null]}>
              <ThemedText
                variant="caption"
                color={isPast ? colors.tone.caution.fg : colors.accentDeep}
                numberOfLines={1}
              >
                {isPast ? words.pastDay : words.today}
              </ThemedText>
            </View>
          ) : null}
          <AppIcon name="chevronDown" size={16} color={colors.chevron} />
        </Pressable>
        <View style={styles.flex} />
        {viewToggle}
      </View>
      {periodWise && periods.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.periodScroll}
          contentContainerStyle={styles.periodRow}
        >
          {periods.map((period) => {
            const active = period.id === selectedPeriodId;
            return (
              <Pressable
                key={period.id}
                testID={`period-chip-${period.id}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setPeriodId(period.id)}
                style={[styles.periodChip, active ? styles.periodChipOn : null]}
              >
                <ThemedText variant="chip" color={active ? colors.onAccent : colors.ink}>
                  {period.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {isPast && canEditRows && dayIsMarked ? (
        <View style={styles.banner} testID="attendance-past-banner">
          <AppIcon name="warning" size={16} color={colors.tone.caution.fg} />
          <ThemedText variant="meta" color={colors.tone.caution.fg} style={styles.flex}>
            <ThemedText variant="meta" color={colors.tone.caution.fg} style={styles.bold}>
              {words.pastBannerTitle}
            </ThemedText>{" "}
            {words.pastBannerBody}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );

  if (state !== "ready") {
    return (
      <>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
          {top}
          {state === "loading" ? (
            <>
              <Skeleton height={60} style={styles.gapTop} />
              <View style={styles.skeletonBlock}>
                <Skeleton height={64} />
                <Skeleton height={64} />
                <Skeleton height={64} />
                <Skeleton height={64} />
              </View>
            </>
          ) : state === "error" ? (
            <ErrorCard
              cause={calendarQuery.error ?? statusQuery.error ?? enrollmentsQuery.error}
              onRetry={retryAll}
              style={styles.gapTopLg}
              testID="attendance-error"
            />
          ) : state === "refused" && refusal ? (
            <EmptyState
              icon="calendarOff"
              title={words.gateTitle}
              message={gateMessage(refusal, date)}
              style={styles.gapTopLg}
              testID="attendance-refused"
            />
          ) : (
            <EmptyState
              icon="students"
              title={words.rosterEmptyTitle}
              message={words.rosterEmptyBody}
              style={styles.gapTopLg}
              testID="attendance-empty"
            />
          )}
        </ScrollView>
        {daySheet}
      </>
    );
  }

  const filterLabel = (key: TallyFilter): string =>
    key === "unmarked" ? words.tallyUnmarked : key === "on_leave" ? words.tallyLeave : statusLabel(key);

  const listHeader = (
    <View style={styles.listHead}>
      {activeFilter ? (
        <>
          <ThemedText variant="sectionLabel" style={styles.flex} numberOfLines={1}>
            {words.filterLabel(filterLabel(activeFilter), visibleRows.length)}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setFilter(null)}
            hitSlop={10}
            style={styles.clearFilter}
            testID="attendance-clear-filter"
          >
            <ThemedText variant="chip" color={colors.accentDeep}>
              {words.clearFilter}
            </ThemedText>
          </Pressable>
        </>
      ) : (
        <>
          <ThemedText variant="sectionLabel" numberOfLines={1} style={styles.flex}>
            {layout === "grid" ? words.gridLabel : words.listLabel}
            {layout === "list" && recentDays.length > 0 ? (
              <ThemedText variant="meta">{words.listLast5}</ThemedText>
            ) : null}
          </ThemedText>
          <HeadButton
            icon="viewCompact"
            label={words.viewList}
            on={layout === "list"}
            onPress={() => changeLayout("list")}
            testID="attendance-layout-list"
          />
          <HeadButton
            icon="viewYear"
            label={words.viewGrid}
            on={layout === "grid"}
            onPress={() => changeLayout("grid")}
            testID="attendance-layout-grid"
          />
          {canEditRows && !showStarter ? (
            <HeadButton
              icon="more"
              label={words.moreOpen}
              on
              onPress={() => setMoreOpen(true)}
              testID="attendance-more"
            />
          ) : null}
        </>
      )}
    </View>
  );

  const intro = (
    <View>
      {clean ? (
        <SavedCard
          counts={counts}
          rows={rowData}
          onEdit={() => {
            setEditing(true);
            setReason("");
          }}
        />
      ) : null}
      {showStarter ? (
        <View style={styles.starter} testID="attendance-starter">
          <ThemedText variant="bodyStrong" style={styles.starterText}>
            {words.starterTitle}{" "}
            <ThemedText variant="meta">{words.starterBody}</ThemedText>
          </ThemedText>
          <View style={styles.starterRow}>
            <Pressable
              testID="bulk-present"
              accessibilityRole="button"
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                markAll("present");
              }}
              style={({ pressed }) => [styles.starterGo, pressed ? styles.pressed : null]}
            >
              <AppIcon name="check" size={18} color={colors.onAccent} />
              <ThemedText variant="bodyStrong" color={colors.onAccent} numberOfLines={1}>
                {words.starterAction(roster.length)}
              </ThemedText>
            </Pressable>
            <Pressable
              testID="attendance-more"
              accessibilityRole="button"
              accessibilityLabel={words.moreOpen}
              onPress={() => setMoreOpen(true)}
              style={({ pressed }) => [styles.moreButton, pressed ? styles.pressed : null]}
            >
              <AppIcon name="more" size={20} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      ) : null}
      {!canMark ? (
        <ThemedText variant="meta" style={styles.gapTop}>
          {words.readOnly}
        </ThemedText>
      ) : null}
      {listHeader}
    </View>
  );

  const items: Item[] = [{ kind: "top" }, { kind: "tally" }, { kind: "intro" }];
  if (visibleRows.length === 0) {
    items.push({ kind: "none" });
  } else if (layout === "grid") {
    items.push({ kind: "grid" });
  } else {
    visibleRows.forEach((row, index) =>
      items.push({ kind: "row", row, first: index === 0, last: index === visibleRows.length - 1 }),
    );
  }

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.kind) {
      case "top":
        return top;
      case "tally":
        return (
          <View style={styles.tallyWrap}>
            <Tally counts={counts} filter={activeFilter} onFilter={setFilter} />
          </View>
        );
      case "intro":
        return intro;
      case "grid":
        return (
          <View>
            <RollGrid
              tiles={visibleRows}
              canMark={canEditRows}
              onToggle={toggleRow}
              onOpenSheet={setSheetStudentId}
            />
            {canEditRows ? (
              <ThemedText variant="caption" color={colors.muted} style={styles.gridHint}>
                {words.gridHint}
              </ThemedText>
            ) : null}
          </View>
        );
      case "none":
        return (
          <ThemedText variant="meta" style={styles.noneText}>
            {words.filterEmpty}
          </ThemedText>
        );
      case "row":
        return (
          <View
            style={[
              styles.rowWrap,
              item.first ? styles.rowFirst : styles.rowSeparated,
              item.last ? styles.rowLast : null,
            ]}
          >
            <RosterRow
              row={item.row}
              canMark={canEditRows}
              onToggle={toggleRow}
              onOpenSheet={setSheetStudentId}
            />
          </View>
        );
    }
  };

  const bottomPad =
    tabSpace + (showSaveBar ? SAVE_HEIGHT + spacing.md + (showReason ? REASON_HEIGHT : 0) : 0);

  return (
    <>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          testID="attendance-roster"
          data={items}
          keyExtractor={(item, index) =>
            item.kind === "row" ? item.row.studentId : `${item.kind}-${index}`
          }
          renderItem={renderItem}
          stickyHeaderIndices={[1]}
          onScroll={hideTabBarOnScroll}
          scrollEventThrottle={32}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: spacing.md,
            paddingBottom: bottomPad,
          }}
          keyboardShouldPersistTaps="handled"
        />
        {showSaveBar ? (
          <Animated.View
            style={[styles.bottomBlock, { bottom: tabSpace }, followTabBar]}
            pointerEvents="box-none"
          >
            {undo ? (
              <Animated.View
                entering={FadeIn.duration(motion.quick)}
                exiting={FadeOut.duration(motion.quick)}
                style={styles.toast}
                accessibilityLiveRegion="polite"
              >
                <AppIcon name="check" size={16} color={colors.onAccent} />
                <ThemedText variant="body" color={colors.onAccent} style={styles.flex}>
                  {words.bulkPresentToast(undo.count)}
                </ThemedText>
                <Pressable
                  testID="attendance-undo"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setDraft(undo.previous);
                    setUndo(null);
                  }}
                  style={styles.undo}
                >
                  <ThemedText variant="bodyStrong" color={colors.accentTint}>
                    {words.undo}
                  </ThemedText>
                </Pressable>
              </Animated.View>
            ) : null}
            {showReason ? (
              <View style={styles.reasonBlock}>
                <ThemedText variant="bodyStrong" style={styles.reasonLabel}>
                  {words.reasonTitle(changing.length)}
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.reasonChips}
                  keyboardShouldPersistTaps="handled"
                >
                  {words.reasonChips.map((chip) => {
                    const on = reason === chip;
                    return (
                      <Pressable
                        key={chip}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        onPress={() => setReason(on ? "" : chip)}
                        style={[styles.reasonChip, on ? styles.reasonChipOn : null]}
                      >
                        <ThemedText variant="chip" color={on ? colors.onAccent : colors.ink}>
                          {chip}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <TextInput
                  testID="attendance-reason"
                  style={styles.reasonInput}
                  value={words.reasonChips.includes(reason) ? "" : reason}
                  onChangeText={setReason}
                  placeholder={words.reasonNote}
                  placeholderTextColor={colors.muted}
                  maxLength={500}
                  accessibilityLabel={words.reason}
                  accessibilityHint={words.reasonHelp}
                />
              </View>
            ) : null}
            <SaveButton
              label={
                markSubmit.isPending
                  ? copy.common.saving
                  : editingNoChanges
                    ? words.doneAction
                    : dayIsMarked && changing.length > 0
                      ? words.saveChanges(changing.length)
                      : words.save
              }
              counts={counts}
              total={roster.length}
              showCount={!(dayIsMarked && changing.length > 0) && !editingNoChanges}
              complete={complete}
              loading={markSubmit.isPending}
              onPress={onSavePress}
            />
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
      <StatusSheet
        student={sheetStudent}
        current={sheetStudentId ? (draft.get(sheetStudentId) ?? null) : null}
        onSelect={selectStatus}
        onDismiss={() => setSheetStudentId(null)}
        onOpenProfile={(studentId) => {
          setSheetStudentId(null);
          router.push({ pathname: "/students/[studentId]", params: { studentId } });
        }}
      />
      <ChoiceSheet
        visible={moreOpen}
        title={words.moreTitle}
        currentId=""
        options={[
          layout === "list"
            ? { id: "grid", label: words.moreGrid }
            : { id: "list", label: words.moreList },
          { id: "clear", label: words.moreClear },
          { id: "absent", label: words.moreAllAbsent(roster.length) },
        ]}
        onSelect={(id) => {
          setMoreOpen(false);
          if (id === "grid" || id === "list") changeLayout(id);
          else if (id === "clear") clearAll();
          else if (id === "absent") setConfirmAbsent(true);
        }}
        onDismiss={() => setMoreOpen(false)}
        testIDPrefix="attendance-more-option"
      />
      {confirmAbsent ? (
        <ConfirmSheet
          title={words.allAbsentTitle}
          body={words.allAbsentBody}
          confirmLabel={words.allAbsentConfirm}
          keepLabel={copy.common.cancel}
          tone="destructive"
          submitting={false}
          error={null}
          onConfirm={() => {
            setConfirmAbsent(false);
            markAll("absent");
          }}
          onClose={() => setConfirmAbsent(false)}
          testIDPrefix="attendance-all-absent"
        />
      ) : null}
      {daySheet}
    </>
  );
}

function HeadButton({
  icon,
  label,
  on,
  onPress,
  testID,
}: {
  icon: "viewCompact" | "viewYear" | "more";
  label: string;
  on: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.headButton, pressed ? styles.headButtonPressed : null]}
    >
      <AppIcon name={icon} size={20} color={on ? colors.ink : colors.chevron} />
    </Pressable>
  );
}

/**
 * The saved state (v2 frame 6): it answers "who's missing?" without
 * scrolling. The composition bar lives here, over the names of everyone who
 * was not simply present.
 */
function SavedCard({
  counts,
  rows,
  onEdit,
}: {
  counts: StatusCounts;
  rows: readonly RosterRowData[];
  onEdit: () => void;
}) {
  const words = copy.attendance.marking;
  const groups = (["absent", "late", "half_day", "on_leave"] as const)
    .map((status) => ({
      status,
      names: rows
        .filter((row) => row.status === status)
        .map((row) => (row.roll ? `${row.roll} ${row.name}` : row.name)),
    }))
    .filter((group) => group.names.length > 0);
  const summary = STATUS_ORDER.filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${statusLabel(status).toLowerCase()}`)
    .join(" · ");

  return (
    <View testID="attendance-saved" accessibilityLiveRegion="polite" style={styles.savedCard}>
      <View style={styles.savedTop}>
        <View style={styles.savedIcon}>
          <AppIcon name="check" size={20} color={colors.onAccent} />
        </View>
        <View style={styles.flex}>
          <ThemedText variant="bodyStrong">{words.savedTitle}</ThemedText>
          <ThemedText variant="meta">{words.doneBody(counts.marked)}</ThemedText>
        </View>
        <CapsuleButton
          title={words.doneEdit}
          variant="secondary"
          size="compact"
          onPress={onEdit}
          testID="attendance-edit"
        />
      </View>
      <StatusMeter
        height={10}
        style={styles.savedMeter}
        segments={STATUS_ORDER.map((status) => ({
          key: status,
          value: counts[status],
          tone: statusTone[status],
          ...(status === "half_day" ? { opacity: 0.55 } : {}),
        }))}
      />
      <ThemedText variant="meta" style={styles.savedSummary}>
        {summary}
      </ThemedText>
      {groups.length > 0 ? (
        <View style={styles.who}>
          {groups.map((group) => (
            <View key={group.status} style={styles.whoRow}>
              <ThemedText
                variant="caption"
                color={colors.tone[statusTone[group.status]].fg}
                style={styles.whoKey}
              >
                {words.savedWho[group.status].toUpperCase()}
              </ThemedText>
              <ThemedText variant="body" style={styles.flex}>
                {group.names.join(", ")}
              </ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The save button doubles as the progress bar, split by status (owner,
 * 2026-11-15): green, red, amber and slate bands in a light tint, white for
 * anyone not marked yet. Complete keeps the colours edge to edge and adds a
 * green outline and tick. A tap while incomplete jumps to "Not marked".
 */
function SaveButton({
  label,
  counts,
  total,
  showCount,
  complete,
  loading,
  onPress,
}: {
  label: string;
  counts: StatusCounts;
  total: number;
  showCount: boolean;
  complete: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const progressLabel = copy.attendance.marking.saveProgress(counts.marked, total);
  return (
    <Pressable
      testID="attendance-save"
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${progressLabel}`}
      accessibilityState={{ busy: loading }}
      disabled={loading}
      onPressIn={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.saveButton,
        complete ? styles.saveReady : null,
        pressed ? styles.savePressed : null,
      ]}
    >
      <View pointerEvents="none" style={styles.saveBands}>
        {total > 0
          ? STATUS_ORDER.map((status) =>
              counts[status] > 0 ? (
                <View
                  key={status}
                  style={{
                    width: `${(counts[status] / total) * 100}%`,
                    backgroundColor: withAlpha(colors.tone[statusTone[status]].fg, 0.2),
                  }}
                />
              ) : null,
            )
          : null}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accentDeep} />
      ) : (
        <View style={styles.saveLabelRow}>
          {complete ? <AppIcon name="check" size={18} color={colors.accentDeep} /> : null}
          <ThemedText
            variant="bodyStrong"
            color={colors.accentDeep}
            numberOfLines={1}
            style={styles.saveLabel}
          >
            {label}
          </ThemedText>
          {showCount ? (
            <ThemedText variant="meta" color={colors.accentDeep} style={styles.saveCount}>
              {`${counts.marked}/${total}`}
            </ThemedText>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  bold: { fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.8 },
  content: { paddingHorizontal: gutter, paddingTop: spacing.md },
  dayRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  dayChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    minHeight: 40,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    flexShrink: 1,
  },
  dayTag: {
    minHeight: 22,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  dayTagPast: { backgroundColor: colors.tone.caution.bg },
  periodScroll: { marginTop: spacing.md, marginHorizontal: -gutter },
  periodRow: { gap: spacing.sm, paddingHorizontal: gutter },
  periodChip: {
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  periodChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  banner: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.caution.bg,
  },
  tallyWrap: {
    backgroundColor: colors.canvas,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  starter: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm + 2,
  },
  starterText: { paddingLeft: spacing.xs },
  starterRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  starterGo: {
    flex: 1,
    minHeight: 48,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    alignItems: "center",
    justifyContent: "center",
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    paddingLeft: spacing.xs,
    minHeight: 44,
  },
  clearFilter: { minHeight: 44, justifyContent: "center" },
  headButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  headButtonPressed: { backgroundColor: colors.field },
  rowWrap: { backgroundColor: colors.surface, overflow: "hidden" },
  rowFirst: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  rowSeparated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  gridHint: { textAlign: "center", marginTop: spacing.sm },
  noneText: { textAlign: "center", marginTop: spacing.lg },
  gapTop: { marginTop: spacing.md },
  gapTopLg: { marginTop: spacing.lg },
  skeletonBlock: { marginTop: spacing.lg, gap: spacing.sm },
  bottomBlock: { position: "absolute", left: gutter, right: gutter, gap: spacing.sm },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 48,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    boxShadow: shadow.floating,
  },
  undo: { minHeight: 44, paddingHorizontal: spacing.md, justifyContent: "center" },
  reasonBlock: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    boxShadow: shadow.floating,
  },
  reasonLabel: { fontSize: fontSize.fine },
  reasonChips: { gap: spacing.xs + 2, paddingVertical: spacing.sm },
  reasonChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    justifyContent: "center",
  },
  reasonChipOn: { backgroundColor: colors.ink },
  reasonInput: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.input,
    borderWidth: 1,
    borderColor: colors.inputLine,
    fontFamily: fontFamily.regular,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  savedCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  savedTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  savedIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  savedMeter: { marginTop: spacing.md },
  savedSummary: { marginTop: spacing.xs },
  who: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    gap: spacing.sm,
  },
  whoRow: { flexDirection: "row", gap: spacing.sm, alignItems: "baseline" },
  whoKey: { width: 64, fontFamily: fontFamily.semibold },
  saveButton: {
    minHeight: SAVE_HEIGHT,
    borderRadius: radius.full,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: shadow.floating,
  },
  saveReady: { borderWidth: 2, borderColor: colors.accent },
  savePressed: { transform: [{ scale: motion.pressScale }] },
  saveBands: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, flexDirection: "row" },
  saveLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  saveLabel: { fontSize: fontSize.callout },
  saveCount: { fontFamily: fontFamily.medium },
});

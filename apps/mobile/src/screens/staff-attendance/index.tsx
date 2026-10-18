import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
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
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { BulkPill } from "../../components/bulk-pill";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { StatTile } from "../../components/stat-tile";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { formatShortWeekday, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontSize, gutter, radius, spacing } from "../../theme/tokens";
import { DaySheet } from "./day-sheet";
import {
  DEFAULT_STATUS,
  buildDraft,
  buildEntries,
  bulkDraft,
  changingIds,
  countStatuses,
  deriveClean,
  toggleStatus,
  withStatus,
} from "./draft";
import type { Status } from "./draft";
import { RosterRow } from "./roster-row";
import { StatusSheet } from "./status-sheet";
import { MARKABLE_DAY_TYPES, statusLabel } from "./status-meta";

type RefusalKind = "holiday" | "weekend" | "noCalendar" | "other";

/**
 * Why a day cannot be marked, or null when it can. The lookups mirror the
 * service's gate: markable day types pass, holiday and weekend refuse, a date
 * with no calendar row refuses ("generate the calendar first"), and any
 * unknown type is refused rather than assumed safe.
 */
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

const RosterSeparator = () => <View style={styles.separator} />;

/**
 * Staff attendance — marking (probe frames 02/03, slice plan §4). One
 * section (the tab's own resolution; a home card may name one), one day, one
 * roster. The tap/long-press/bulk interaction, the prefill and done rules and
 * the correction-reason scope are the web page's, ported into `draft.ts`;
 * the ONE divergence is the unmarked-day default (all present — the fact the
 * teacher is confirming on a phone), recorded in the slice plan.
 */
export function AttendanceScreen() {
  const { hasAny } = usePermissions();
  const canSee = hasAny("attendance:read", "attendance:create");
  const params = useLocalSearchParams<{ sectionId?: string }>();
  const { organizationId, schoolId, academicYear, yearPending } =
    useActiveContext();

  const sectionsQuery = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: Boolean(organizationId && academicYear), staleTime: 60_000 },
  );
  const classesQuery = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) },
    { enabled: Boolean(organizationId), staleTime: 300_000 },
  );

  const sections = useMemo(
    () =>
      (sectionsQuery.data ?? []).filter(
        (section) => section.status === "active",
      ),
    [sectionsQuery.data],
  );
  // The tab's default is the caller's first active section; a `sectionId`
  // param (from a home card) wins when it names a section they can see.
  const section = useMemo(() => {
    if (params.sectionId) {
      const wanted = sections.find((row) => row.id === params.sectionId);
      if (wanted) return wanted;
    }
    return sections[0];
  }, [sections, params.sectionId]);

  const yearState = academicYear ? "ready" : yearPending ? "loading" : "none";

  if (!canSee) {
    return (
      <Frame>
        <EmptyState
          icon="attendance"
          title={copy.attendance.noAccessTitle}
          message={copy.attendance.noAccessBody}
          testID="attendance-no-access"
        />
      </Frame>
    );
  }

  if (
    yearState === "loading" ||
    (yearState === "ready" && sectionsQuery.isPending)
  ) {
    return (
      <Frame>
        <Skeleton width={150} height={30} />
        <Skeleton width={220} height={16} style={styles.gapTopSm} />
        <View style={styles.skeletonBlock}>
          <Skeleton height={72} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      </Frame>
    );
  }

  if (yearState === "none") {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <Card style={styles.gapTopLg}>
          <ThemedText variant="bodyStrong">
            {copy.session.noYearTitle}
          </ThemedText>
          <ThemedText variant="meta" style={styles.cardBody}>
            {copy.session.noYearBody}
          </ThemedText>
        </Card>
      </Frame>
    );
  }

  if (sectionsQuery.isError) {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <ErrorCard
          cause={sectionsQuery.error}
          onRetry={() => void sectionsQuery.refetch()}
          style={styles.gapTopLg}
          testID="attendance-sections-error"
        />
      </Frame>
    );
  }

  if (!section) {
    return (
      <Frame>
        <ThemedText variant="title">{copy.attendance.title}</ThemedText>
        <EmptyState
          icon="school"
          title={copy.classes.emptyTitle}
          message={copy.classes.emptyBody}
          testID="attendance-no-sections"
        />
      </Frame>
    );
  }

  const classNameById = new Map(
    (classesQuery.data ?? []).map((cls) => [cls.id, cls.name]),
  );
  const className = classNameById.get(section.classId) ?? null;

  return (
    <MarkingPanel
      key={section.id}
      sectionId={section.id}
      sectionTitle={className ? `${className} · ${section.name}` : section.name}
    />
  );
}

/**
 * The marking panel, keyed by section so a section change is a clean mount:
 * draft, reason and sheet state all belong to one section's day.
 */
function MarkingPanel({
  sectionId,
  sectionTitle,
}: {
  sectionId: string;
  sectionTitle: string;
}) {
  const { has } = usePermissions();
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const canMark = has("attendance:create");
  const tabSpace = useTabBarSpace();
  const utils = trpc.useUtils();

  const [date, setDate] = useState(todayIso);
  const [sheetMonth, setSheetMonth] = useState(todayIso);
  const [periodId, setPeriodId] = useState("");
  const [draft, setDraft] = useState<Map<string, Status>>(() => new Map());
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [sheetStudentId, setSheetStudentId] = useState<string | null>(null);
  const [daySheetOpen, setDaySheetOpen] = useState(false);
  /** Any manual mark makes the teacher's entries the truth; no refetch may
   *  overwrite them until the day changes or a submit resets the flag. */
  const editedRef = useRef(false);
  const prefillKeyRef = useRef("");
  const wasCleanRef = useRef(false);

  const ready = Boolean(organizationId && academicYear);

  const policyQuery = trpc.attendance.policy.get.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? "" },
    { enabled: Boolean(organizationId && schoolId), staleTime: 300_000 },
  );
  const periodWise = policyQuery.data?.markingMode === "period_wise";

  const periodsQuery = trpc.attendance.period.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      sectionId,
    },
    { enabled: ready && periodWise, staleTime: 300_000 },
  );
  const periods = periodsQuery.data ?? [];
  // Derived, never stored in an effect: the chosen period while it is still
  // valid, else the section's first. A bare effect setting state would
  // cascade renders and could prefill the draft against the wrong key.
  const selectedPeriodId = periodWise
    ? periodId !== "" && periods.some((period) => period.id === periodId)
      ? periodId
      : (periods[0]?.id ?? "")
    : "";

  const statusQuery = trpc.attendance.status.useQuery(
    { organizationId: organizationId ?? "", sectionId, date },
    { enabled: ready, staleTime: 30_000 },
  );

  const calendarQuery = trpc.attendance.calendar.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      month: Number(date.slice(5, 7)),
    },
    { enabled: ready, staleTime: 300_000 },
  );

  const enrollmentsQuery = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      sectionId,
    },
    { enabled: ready, staleTime: 60_000 },
  );

  // The roster, in roll order — the web page's re-sort: numbered rolls keep
  // their numeric order, un-numbered admissions sort after them by name.
  const roster = useMemo(() => {
    const rows = (enrollmentsQuery.data ?? [])
      .filter((pair) => pair.enrollment.sectionId === sectionId)
      .map((pair) => ({
        studentId: pair.student.id,
        name: [
          pair.student.firstName,
          pair.student.middleName,
          pair.student.lastName,
        ]
          .filter(Boolean)
          .join(" "),
        roll: pair.enrollment.rollNumber,
      }));
    rows.sort((a, b) => {
      if (a.roll === null && b.roll === null) return a.name.localeCompare(b.name);
      if (a.roll === null) return 1;
      if (b.roll === null) return -1;
      return a.roll.localeCompare(b.roll, undefined, { numeric: true });
    });
    return rows;
  }, [enrollmentsQuery.data, sectionId]);

  const rosterIds = useMemo(() => roster.map((row) => row.studentId), [roster]);

  /** The stored marks as a lookup — the baseline for the changed-set. */
  const storedByStudent = useMemo(() => {
    const map = new Map<string, Status>();
    for (const row of statusQuery.data ?? []) {
      map.set(row.studentId, row.status);
    }
    return map;
  }, [statusQuery.data]);

  // Prefill, ported from the web page: refill from the authoritative layer
  // until the teacher edits, then never again until the day changes or a
  // submit (server-confirmed) resets the flag.
  useEffect(() => {
    const key = `${sectionId}:${date}:${selectedPeriodId}`;
    if (prefillKeyRef.current !== key) {
      prefillKeyRef.current = key;
      editedRef.current = false;
      setEditing(false);
    }
    if (editedRef.current) return;
    setDraft(buildDraft(rosterIds, storedByStudent));
    setReason("");
  }, [sectionId, date, selectedPeriodId, rosterIds, storedByStudent]);

  const counts = useMemo(
    () => countStatuses(rosterIds, draft),
    [rosterIds, draft],
  );
  const changing = useMemo(
    () => changingIds(rosterIds, draft, storedByStudent),
    [rosterIds, draft, storedByStudent],
  );
  const dayIsMarked = (statusQuery.data ?? []).length > 0;
  const isPast = date < todayIso();
  const clean = deriveClean({
    dayIsMarked,
    changingCount: changing.length,
    editing,
  });
  const showReason = canMark && isPast && dayIsMarked && changing.length > 0;

  const calendarDay =
    (calendarQuery.data ?? []).find((row) => row.date === date) ?? null;
  const refusal = refusalOf(calendarDay);

  const state: "loading" | "error" | "refused" | "empty" | "ready" =
    calendarQuery.isError || statusQuery.isError || enrollmentsQuery.isError
      ? "error"
      : calendarQuery.isPending ||
          statusQuery.isPending ||
          enrollmentsQuery.isPending
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
      void utils.attendance.status.invalidate();
    },
    onError: (error) => {
      Alert.alert(copy.attendance.title, errorMessage(error));
    },
  });

  const toggleRow = (studentId: string) => {
    editedRef.current = true;
    setDraft((current) =>
      withStatus(current, studentId, toggleStatus(current.get(studentId) ?? DEFAULT_STATUS)),
    );
  };
  const markAll = (status: Status) => {
    editedRef.current = true;
    setDraft(bulkDraft(rosterIds, status));
  };
  const selectStatus = (status: Status) => {
    if (!sheetStudentId) return;
    editedRef.current = true;
    setDraft((current) => withStatus(current, sheetStudentId, status));
    setSheetStudentId(null);
  };
  const submit = () => {
    if (!canMark || markSubmit.isPending || clean || roster.length === 0) return;
    markSubmit.mutate({
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      sectionId,
      date,
      ...(periodWise && selectedPeriodId ? { periodId: selectedPeriodId } : {}),
      entries: buildEntries(rosterIds, draft, storedByStudent, {
        isPast,
        reason,
      }),
    });
  };

  // The saved bar is announced, not just shown (plan §8).
  useEffect(() => {
    if (clean && !wasCleanRef.current) {
      AccessibilityInfo.announceForAccessibility(copy.attendance.marking.saved);
    }
    wasCleanRef.current = clean;
  }, [clean]);

  const sheetStudent = sheetStudentId
    ? (roster.find((row) => row.studentId === sheetStudentId) ?? null)
    : null;

  const header = (
    <View>
      <ThemedText variant="title" numberOfLines={1}>
        {sectionTitle}
      </ThemedText>
      <View style={styles.subRow}>
        <Pressable
          testID="attendance-day"
          accessibilityRole="button"
          accessibilityLabel={formatShortWeekday(date)}
          accessibilityHint={copy.attendance.marking.dayPickerTitle}
          hitSlop={8}
          onPress={() => {
            setSheetMonth(date);
            setDaySheetOpen(true);
          }}
          style={styles.dayButton}
        >
          <ThemedText variant="subtitle">{formatShortWeekday(date)}</ThemedText>
          <AppIcon name="chevronDown" size={14} color={colors.chevron} />
        </Pressable>
        {enrollmentsQuery.isSuccess ? (
          <ThemedText variant="subtitle">
            {" · "}
            {copy.attendance.marking.studentsCount(roster.length)}
          </ThemedText>
        ) : null}
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
                <ThemedText
                  variant="caption"
                  color={active ? colors.accentDeep : colors.ink}
                >
                  {period.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const tiles = (
    <View style={styles.tiles}>
      <StatTile
        value={counts.present}
        label={statusLabel("present")}
        tone="positive"
        style={styles.tile}
        testID="tile-present"
      />
      <StatTile
        value={counts.absent}
        label={statusLabel("absent")}
        tone="critical"
        style={styles.tile}
        testID="tile-absent"
      />
      <StatTile
        value={counts.late}
        label={statusLabel("late")}
        tone="caution"
        style={styles.tile}
        testID="tile-late"
      />
      <StatTile
        value={counts.on_leave}
        label={statusLabel("on_leave")}
        tone="neutral"
        style={styles.tile}
        testID="tile-on-leave"
      />
      {counts.half_day > 0 ? (
        <StatTile
          value={counts.half_day}
          label={statusLabel("half_day")}
          tone="caution"
          style={styles.tile}
          testID="tile-half-day"
        />
      ) : null}
    </View>
  );

  const controls = canMark ? (
    <>
      <View style={styles.bulkRow}>
        <BulkPill
          title={copy.attendance.marking.allPresent}
          tone="positive"
          onPress={() => markAll("present")}
          disabled={markSubmit.isPending}
          testID="bulk-present"
        />
        <BulkPill
          title={copy.attendance.marking.allAbsent}
          tone="critical"
          onPress={() => markAll("absent")}
          disabled={markSubmit.isPending}
          testID="bulk-absent"
        />
      </View>
      <ThemedText variant="meta" style={styles.hint}>
        {copy.attendance.marking.tapHint}
      </ThemedText>
    </>
  ) : (
    <ThemedText variant="meta" style={styles.hint}>
      {copy.attendance.marking.readOnly}
    </ThemedText>
  );

  if (state !== "ready") {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
        >
          {header}
          {state === "loading" ? (
            <>
              {tiles}
              <View style={styles.skeletonBlock}>
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
              </View>
            </>
          ) : state === "error" ? (
            <ErrorCard
              cause={
                calendarQuery.error ??
                statusQuery.error ??
                enrollmentsQuery.error
              }
              onRetry={retryAll}
              style={styles.gapTopLg}
              testID="attendance-error"
            />
          ) : state === "refused" && refusal ? (
            <EmptyState
              icon="calendarOff"
              title={copy.attendance.marking.gateTitle}
              message={gateMessage(refusal, date)}
              style={styles.gapTopLg}
              testID="attendance-refused"
            />
          ) : (
            <EmptyState
              icon="students"
              title={copy.attendance.marking.rosterEmptyTitle}
              message={copy.attendance.marking.rosterEmptyBody}
              style={styles.gapTopLg}
              testID="attendance-empty"
            />
          )}
        </ScrollView>
        <DaySheet
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          testID="attendance-roster"
          data={roster}
          keyExtractor={(row) => row.studentId}
          renderItem={({ item, index }) => (
            <RosterRow
              row={{ ...item, status: draft.get(item.studentId) ?? DEFAULT_STATUS }}
              canMark={canMark}
              onToggle={toggleRow}
              onOpenSheet={(studentId) => setSheetStudentId(studentId)}
              style={[
                index === 0 ? styles.rowFirst : null,
                index === roster.length - 1 ? styles.rowLast : null,
              ]}
            />
          )}
          ItemSeparatorComponent={RosterSeparator}
          ListHeaderComponent={
            <View>
              {header}
              {tiles}
              {controls}
            </View>
          }
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: spacing.md,
            paddingBottom: canMark ? spacing.md : tabSpace,
          }}
          keyboardShouldPersistTaps="handled"
        />
        {canMark ? (
          <View style={[styles.bottomBlock, { marginBottom: tabSpace }]}>
            {showReason ? (
              <View style={styles.reasonBlock}>
                <ThemedText variant="caption" style={styles.reasonLabel}>
                  {copy.attendance.marking.changedCount(changing.length)}
                </ThemedText>
                <TextInput
                  testID="attendance-reason"
                  style={styles.reasonInput}
                  value={reason}
                  onChangeText={setReason}
                  placeholder={copy.attendance.marking.reasonPlaceholder}
                  placeholderTextColor={colors.muted}
                  maxLength={500}
                  accessibilityLabel={copy.attendance.marking.reason}
                  accessibilityHint={copy.attendance.marking.reasonHelp}
                />
              </View>
            ) : null}
            {clean ? (
              <View
                testID="attendance-saved"
                accessibilityLiveRegion="polite"
                style={styles.savedBar}
              >
                <AppIcon name="check" size={18} color={colors.onAccent} />
                <ThemedText
                  variant="bodyStrong"
                  color={colors.onAccent}
                  style={styles.savedLabel}
                >
                  {copy.attendance.marking.saved}
                </ThemedText>
                <CapsuleButton
                  title={copy.attendance.marking.edit}
                  variant="onAccent"
                  size="mini"
                  onPress={() => setEditing(true)}
                  testID="attendance-edit"
                />
              </View>
            ) : (
              <CapsuleButton
                title={
                  markSubmit.isPending
                    ? copy.common.saving
                    : copy.attendance.marking.save
                }
                onPress={submit}
                loading={markSubmit.isPending}
                testID="attendance-save"
              />
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <StatusSheet
        student={sheetStudent}
        current={
          sheetStudent
            ? (draft.get(sheetStudent.studentId) ?? DEFAULT_STATUS)
            : null
        }
        onSelect={selectStatus}
        onDismiss={() => setSheetStudentId(null)}
      />
      <DaySheet
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
    </SafeAreaView>
  );
}

/** The outer Frame: the plain scroller every non-roster state lives in. */
function Frame({ children }: { children: ReactNode }) {
  const tabSpace = useTabBarSpace();
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.xs,
  },
  dayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  periodScroll: {
    marginTop: spacing.md,
  },
  periodRow: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
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
  periodChipOn: {
    backgroundColor: colors.accentTint,
    borderColor: colors.accentTint,
  },
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  tile: {
    flexGrow: 1,
    flexBasis: 62,
    minWidth: 62,
  },
  bulkRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  hint: {
    marginTop: spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: 68,
  },
  rowFirst: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  rowLast: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  bottomBlock: {
    paddingHorizontal: gutter,
  },
  reasonBlock: {
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  reasonLabel: {
    marginBottom: spacing.xs,
  },
  reasonInput: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.field,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  savedBar: {
    minHeight: 54,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  savedLabel: {
    flex: 1,
  },
  skeletonBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  gapTopSm: {
    marginTop: spacing.sm,
  },
  gapTopLg: {
    marginTop: spacing.lg,
  },
  cardBody: {
    marginTop: spacing.xs,
  },
});

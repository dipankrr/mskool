import { useEffect, useMemo, useRef, useState } from "react";
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
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { BulkPill } from "../../components/bulk-pill";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Skeleton } from "../../components/skeleton";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { errorMessage } from "../../lib/errors";
import { formatShortWeekday, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, gutter, motion, radius, shadow, spacing } from "../../theme/tokens";
import { clampMonth } from "./calendar-month";
import { DayPulse } from "./day-pulse";
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
import type { Status } from "./draft";
import { RosterRow } from "./roster-row";
import type { RecentMark } from "./roster-row";
import { StatusSheet } from "./status-sheet";
import { MARKABLE_DAY_TYPES, dayTypeLabel } from "./status-meta";
import { useRecentAttendance } from "./use-recent-attendance";
import { useSectionRoster } from "./use-section-roster";

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
 * The marking panel — chunk 1's screen body (probe frames 02/03, slice plan
 * §4), now mounted under the shell's section header. One section, one day,
 * one roster. The tap/long-press/bulk interaction and the correction-reason
 * scope are the web page's, ported into `draft.ts`; the owner-approved
 * divergence is the blank draft: an unmarked day shows no statuses until the
 * teacher acts, and the save CTA carries the marking progress.
 *
 * The section id comes from the shell (route params + switcher); a section
 * change remounts this panel via `key`, so draft, reason and sheet state all
 * belong to one section's day.
 */
export function MarkingPanel({ sectionId }: { sectionId: string }) {
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

  // The roster, in roll order, through the shared hook — the summary panel
  // reads the same query and the same order.
  const { roster, rosterIds, query: enrollmentsQuery } = useSectionRoster(sectionId);

  const { days: recentDays } = useRecentAttendance({
    sectionId,
    date,
    enabled: ready,
  });

  /** One array per student, oldest-to-newest, for the row's history strip. */
  const recentByStudent = useMemo(() => {
    const map = new Map<string, RecentMark[]>();
    for (const studentId of rosterIds) {
      map.set(
        studentId,
        recentDays.map((day) => ({
          date: day.date,
          status: day.statuses.get(studentId) ?? null,
        })),
      );
    }
    return map;
  }, [recentDays, rosterIds]);

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

  const counts = useMemo(() => countStatuses(rosterIds, draft), [rosterIds, draft]);
  const changing = useMemo(
    () => changingIds(rosterIds, draft, storedByStudent),
    [rosterIds, draft, storedByStudent],
  );
  const dayIsMarked = (statusQuery.data ?? []).length > 0;
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

  const calendarDay = (calendarQuery.data ?? []).find((row) => row.date === date) ?? null;
  const isToday = date === todayIso();
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
      // The summary panel reads the same model this mark rewrote — refresh it
      // in the background so a panel switch shows the new day, not a stale one.
      void utils.attendance.status.invalidate();
      void utils.attendance.statusHistory.invalidate();
      void utils.attendance.summary.invalidate();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Announce on server confirmation, not when a previously saved day
      // happens to render clean on open.
      AccessibilityInfo.announceForAccessibility(copy.attendance.marking.saved);
    },
    onError: (error) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(copy.attendance.title, errorMessage(error));
    },
  });

  const toggleRow = (studentId: string) => {
    editedRef.current = true;
    setDraft((current) =>
      withStatus(current, studentId, toggleStatus(current.get(studentId))),
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
    if (!complete) return;
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

  const finishEditing = () => {
    setEditing(false);
    setReason("");
  };

  const openDaySheet = () => {
    const min = academicYear?.startDate;
    const max = academicYear?.endDate;
    setSheetMonth(min && max ? clampMonth(date, min, max) : date);
    setDaySheetOpen(true);
  };

  const sheetStudent = sheetStudentId
    ? (roster.find((row) => row.studentId === sheetStudentId) ?? null)
    : null;

  const header = (
    <View>
      <View style={styles.subRow}>
        <Pressable
          testID="attendance-day"
          accessibilityRole="button"
          accessibilityLabel={formatShortWeekday(date)}
          accessibilityHint={copy.attendance.marking.dayPickerTitle}
          hitSlop={8}
          onPress={openDaySheet}
          style={styles.dayButton}
        >
          <ThemedText variant="subtitle">{formatShortWeekday(date)}</ThemedText>
          <AppIcon name="chevronDown" size={14} color={colors.chevron} />
        </Pressable>
        {isToday ? (
          <View style={styles.todayChip}>
            <ThemedText variant="caption" color={colors.accentDeep}>
              {copy.attendance.marking.today}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {enrollmentsQuery.isSuccess ? (
        <ThemedText variant="meta" numberOfLines={1} style={styles.headerContext}>
          {calendarDay ? `${dayTypeLabel(calendarDay.dayType)} · ` : ""}
          {copy.attendance.studentsCount(roster.length)}
        </ThemedText>
      ) : null}
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
                <ThemedText variant="caption" color={active ? colors.accentDeep : colors.ink}>
                  {period.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  const pulse = <DayPulse counts={counts} />;

  const doneCard = clean ? (
    <DoneCard
      marked={counts.marked}
      onEdit={() => {
        setEditing(true);
        setReason("");
      }}
    />
  ) : null;

  const controls =
    canMark && !clean ? (
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
    ) : canMark ? null : (
      <ThemedText variant="meta" style={styles.hint}>
        {copy.attendance.marking.readOnly}
      </ThemedText>
    );

  const recentLegend =
    recentDays.length > 0 ? (
      <View style={styles.recentLegend} testID="attendance-recent-legend">
        <AppIcon name="history" size={15} color={colors.muted} />
        <ThemedText variant="meta">{copy.attendance.marking.recentHint(recentDays.length)}</ThemedText>
      </View>
    ) : null;

  if (state !== "ready") {
    return (
      <>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
          {header}
          {state === "loading" ? (
            <>
              <Skeleton height={146} style={styles.pulseSkeleton} />
              <View style={styles.skeletonBlock}>
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
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
      </>
    );
  }

  return (
    <>
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
              row={{
                ...item,
                status: draft.get(item.studentId) ?? null,
                recent: recentByStudent.get(item.studentId) ?? [],
              }}
              canMark={canEditRows}
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
              {doneCard}
              {pulse}
              {controls}
              {recentLegend}
            </View>
          }
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: spacing.md,
            paddingBottom: showSaveBar ? spacing.md : tabSpace,
          }}
          keyboardShouldPersistTaps="handled"
        />
        {showSaveBar ? (
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
            <SaveAttendanceButton
              label={
                markSubmit.isPending
                  ? copy.common.saving
                  : editingNoChanges
                    ? copy.attendance.marking.doneAction
                    : dayIsMarked && changing.length > 0
                      ? copy.attendance.marking.saveChanges(changing.length)
                      : copy.attendance.marking.save
              }
              marked={counts.marked}
              total={roster.length}
              loading={markSubmit.isPending}
              disabled={
                markSubmit.isPending ||
                (!editingNoChanges && (!complete || clean))
              }
              onPress={() => {
                if (editingNoChanges) {
                  finishEditing();
                } else {
                  submit();
                }
              }}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <StatusSheet
        student={sheetStudent}
        current={sheetStudent ? (draft.get(sheetStudent.studentId) ?? null) : null}
        onSelect={selectStatus}
        onDismiss={() => setSheetStudentId(null)}
      />
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
    </>
  );
}

function DoneCard({ marked, onEdit }: { marked: number; onEdit: () => void }) {
  return (
    <View
      testID="attendance-saved"
      accessibilityLiveRegion="polite"
      style={styles.doneCard}
    >
      <View style={styles.doneIcon}>
        <AppIcon name="checkCircle" size={24} color={colors.accentDeep} />
      </View>
      <View style={styles.doneCopy}>
        <ThemedText variant="bodyStrong" color={colors.accentDeep}>
          {copy.attendance.marking.doneTitle}
        </ThemedText>
        <ThemedText variant="meta">{copy.attendance.marking.doneBody(marked)}</ThemedText>
      </View>
      <CapsuleButton
        title={copy.attendance.marking.doneEdit}
        variant="secondary"
        size="compact"
        onPress={onEdit}
        testID="attendance-edit"
      />
    </View>
  );
}

function SaveAttendanceButton({
  label,
  marked,
  total,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  marked: number;
  total: number;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const [buttonWidth, setButtonWidth] = useState(0);
  const progress = total > 0 ? Math.min(100, (marked / total) * 100) : 0;
  const complete = progress >= 100;
  const filledWidth = Math.round((buttonWidth * progress) / 100);
  const progressLabel = copy.attendance.marking.saveProgress(marked, total);

  return (
    <Pressable
      testID="attendance-save"
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${progressLabel}`}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        if (nextWidth !== buttonWidth) setButtonWidth(nextWidth);
      }}
      onPressIn={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.saveButton,
        complete ? styles.saveButtonComplete : styles.saveButtonGhost,
        pressed ? styles.savePressed : null,
        disabled ? styles.saveDisabled : null,
      ]}
    >
      {/* The button itself is the progress bar: no separate track or count.
          Use the measured pixel width so the fill edge and the two clipped
          labels stay on the same coordinate, inside the button's padding. */}
      <View pointerEvents="none" style={[styles.saveFill, { width: filledWidth }]} />
      {loading ? (
        <ActivityIndicator color={complete ? colors.onAccent : colors.accentDeep} />
      ) : buttonWidth === 0 ? (
        <ThemedText
          variant="bodyStrong"
          color={complete ? colors.onAccent : colors.accentDeep}
          numberOfLines={1}
          style={styles.saveLabel}
        >
          {label}
        </ThemedText>
      ) : (
        <>
          {/* The label switches ink at the fill edge, like a download bar. */}
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.saveLabelClip, { left: filledWidth, right: 0 }]}
          >
            <View style={[styles.saveLabelInner, { width: buttonWidth, marginLeft: -filledWidth }]}>
              <ThemedText
                variant="bodyStrong"
                color={colors.accentDeep}
                numberOfLines={1}
                style={styles.saveLabel}
              >
                {label}
              </ThemedText>
            </View>
          </View>
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.saveLabelClip, { left: 0, width: filledWidth }]}
          >
            <View style={[styles.saveLabelInner, { width: buttonWidth }]}>
              <ThemedText
                variant="bodyStrong"
                color={colors.onAccent}
                numberOfLines={1}
                style={styles.saveLabel}
              >
                {label}
              </ThemedText>
            </View>
          </View>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  },
  dayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.xs,
    marginLeft: -spacing.xs,
  },
  todayChip: {
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.accentStrong,
  },
  headerContext: {
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.xs,
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
  bulkRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  hint: {
    marginTop: spacing.sm,
  },
  recentLegend: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
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
    fontFamily: fontFamily.regular,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.ink,
    fontSize: fontSize.body,
  },
  doneCard: {
    marginTop: spacing.md,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentTint,
  },
  doneIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  doneCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  saveButton: {
    alignSelf: "stretch",
    minHeight: 56,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    boxShadow: shadow.floating,
  },
  saveButtonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.hairline,
  },
  saveButtonComplete: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  saveFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.accent,
  },
  saveLabelClip: {
    position: "absolute",
    top: 0,
    bottom: 0,
    overflow: "hidden",
    justifyContent: "center",
  },
  saveLabelInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  savePressed: {
    transform: [{ scale: motion.pressScale }],
  },
  saveDisabled: {
    opacity: 0.55,
  },
  saveLabel: {
    fontSize: fontSize.callout,
  },
  skeletonBlock: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  pulseSkeleton: {
    marginTop: spacing.lg,
  },
  gapTopLg: {
    marginTop: spacing.lg,
  },
});

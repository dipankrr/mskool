import { useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { todayIso } from "../../lib/format";
import {
  countsAsDue,
  dayKeyOf,
  dayLabel,
  dueLoadsByDay,
  groupByDay,
  isPastDue,
  matchesSegment,
  nextDayWithWork,
  sortByDue,
} from "../../lib/homework";
import type { HomeworkSegment } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontSize, radius, spacing } from "../../theme/tokens";
import { AssignmentCard } from "./assignment-card";
import { SegmentBar } from "./segments";
import type { SegmentOption } from "./segments";
import type { HomeworkRow } from "./types";
import { WeekRail } from "./week-rail";

type HomeworkView = "agenda" | "all";

const VIEW_OPTIONS: readonly SegmentOption<HomeworkView>[] = [
  {
    value: "agenda",
    label: copy.homework.views.agenda,
    accessibilityLabel: copy.homework.viewsA11y.agenda,
    testID: "homework-view-agenda",
  },
  {
    value: "all",
    label: copy.homework.views.all,
    accessibilityLabel: copy.homework.viewsA11y.all,
    testID: "homework-view-all",
  },
];

const SEGMENT_OPTIONS: readonly SegmentOption<HomeworkSegment>[] = [
  {
    value: "live",
    label: copy.homework.segments.live,
    testID: "homework-segment-live",
  },
  {
    value: "drafts",
    label: copy.homework.segments.drafts,
    testID: "homework-segment-drafts",
  },
  {
    value: "closed",
    label: copy.homework.segments.closed,
    testID: "homework-segment-closed",
  },
  {
    value: "all",
    label: copy.homework.segments.all,
    testID: "homework-segment-all",
  },
];

/**
 * The Homework tab root — the staff diary.
 *
 * Agenda is the default because the teacher's first question is "what is due
 * today / this week", not "show me every assignment". The week rail drives the
 * day; the All view is the ledger for finding an older row, with the four
 * segments that matter (live, drafts, closed, everything) plus search and a
 * subject chip. All filtering is client-side: `homework.list` returns the
 * session once, and the year's list is small.
 *
 * Every state is honest: denial, no branch, no session, first load, error,
 * an empty session, an empty day, and a filtered-empty list are six different
 * screens, not one spinner.
 */
export function HomeworkScreen({ variant = "pushed" }: { variant?: "pushed" | "tab" }) {
  const { organizationId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canCreate = has("homework:create");

  const [view, setView] = useState<HomeworkView>("agenda");
  const [selectedDay, setSelectedDay] = useState(() => todayIso());
  const [segment, setSegment] = useState<HomeworkSegment>("all");
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [subjectSheetOpen, setSubjectSheetOpen] = useState(false);
  const [pastDueOnly, setPastDueOnly] = useState(false);

  const list = trpc.homework.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
      placeholderData: keepPreviousData,
    },
  );

  const rows = useMemo<HomeworkRow[]>(() => list.data ?? [], [list.data]);

  const loads = useMemo(() => dueLoadsByDay(rows), [rows]);

  const pastDue = useMemo(
    () => rows.filter((row) => isPastDue(row)),
    [rows],
  );

  const subjectOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (!byId.has(row.subjectId)) byId.set(row.subjectId, row.subjectName);
    }
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const term = query.trim().toLowerCase();
  const matchesSearch = (row: (typeof rows)[number]) => {
    if (!term) return true;
    return [row.title, row.subjectName, row.topic ?? "", row.description ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(term);
  };

  const allRows = useMemo(
    () =>
      sortByDue(
        rows.filter(
          (row) =>
            matchesSegment(row.status, segment) &&
            (!subjectFilter || row.subjectId === subjectFilter) &&
            (!pastDueOnly || isPastDue(row)) &&
            matchesSearch(row),
        ),
      ),
    // `matchesSearch` is a pure closure over `term`; listing `query` keeps the
    // memo honest without re-creating a callback dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, segment, subjectFilter, pastDueOnly, query],
  );

  const agendaRows = useMemo(
    () => sortByDue(rows.filter((row) => dayKeyOf(row.dueAt) === selectedDay)),
    [rows, selectedDay],
  );

  const nextDay = useMemo(
    () => nextDayWithWork(rows, selectedDay),
    [rows, selectedDay],
  );

  const filtered = Boolean(term || subjectFilter || pastDueOnly);
  const yearState = academicYear ? "ready" : yearPending ? "loading" : "none";

  const addAction =
    canRead && canCreate
      ? {
          label: copy.homework.newShort,
          icon: "add" as const,
          onPress: () => router.push("/homework/new"),
          accessibilityHint: copy.homework.form.createTitle,
          testID: "homework-new",
        }
      : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.homework.title}
      meta={branchName}
      backAccessibilityLabel={variant === "pushed" ? copy.common.back : undefined}
      action={addAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="homework-title"
      padForTabBar={variant === "tab"}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.noAccessTitle}
        message={copy.homework.noAccessBody}
        testID="homework-no-access"
      />,
    );
  }

  if (
    !ready ||
    yearState === "loading" ||
    (yearState === "ready" && list.isPending && !list.data)
  ) {
    return frame(
      <View
        style={styles.skeletonWrap}
        accessibilityLabel={copy.homework.title}
        accessibilityLiveRegion="polite"
      >
        <Skeleton height={168} />
        <View style={styles.skeletonList}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={88} />
          ))}
        </View>
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.homework.noBranchTitle}
        message={copy.homework.noBranchBody}
        testID="homework-no-branch"
      />,
    );
  }

  if (yearState === "none") {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.homework.noYearTitle}
        message={copy.homework.noYearBody}
        testID="homework-no-year"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="homework-error"
      />,
    );
  }

  if (rows.length === 0) {
    return frame(
      <EmptyState
        icon="homework"
        title={copy.homework.emptyTitle}
        message={copy.homework.emptyBody}
        testID="homework-empty"
      >
        {canCreate ? (
          <CapsuleButton
            title={copy.homework.emptyAction}
            icon="add"
            onPress={() => router.push("/homework/new")}
            testID="homework-empty-add"
          />
        ) : null}
      </EmptyState>,
    );
  }

  return frame(
    <View style={styles.body}>
      <SegmentBar
        label={copy.homework.title}
        value={view}
        options={VIEW_OPTIONS}
        onChange={setView}
      />

      {view === "agenda" ? (
        <>
          <WeekRail
            selected={selectedDay}
            onSelect={setSelectedDay}
            loads={loads}
          />

          {pastDue.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.homework.agenda.pastDue(pastDue.length)}
              accessibilityHint={copy.homework.agenda.pastDueHint}
              onPress={() => {
                setView("all");
                setSegment("live");
                setPastDueOnly(true);
                setSubjectFilter(null);
                setQuery("");
              }}
              style={({ pressed }) => [
                styles.pastDue,
                pressed ? styles.pastDuePressed : null,
              ]}
              testID="homework-past-due"
            >
              <AppIcon
                name="clock"
                size={18}
                color={colors.tone.critical.fg}
              />
              <View style={styles.pastDueText}>
                <ThemedText
                  variant="bodyStrong"
                  color={colors.tone.critical.fg}
                >
                  {copy.homework.agenda.pastDue(pastDue.length)}
                </ThemedText>
                <ThemedText variant="meta">
                  {copy.homework.agenda.pastDueHint}
                </ThemedText>
              </View>
              <AppIcon name="chevronRight" size={18} color={colors.chevron} />
            </Pressable>
          ) : null}

          <View style={styles.dayHead}>
            <ThemedText variant="sectionLabel">
              {dayLabel(selectedDay)}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.homework.agenda.dueCount(agendaRows.length)}
            </ThemedText>
          </View>

          {agendaRows.length > 0 ? (
            <View style={styles.cards}>
              {agendaRows.map((row) => (
                <AssignmentCard
                  key={row.id}
                  row={row}
                  onPress={() =>
                    router.push({
                      pathname: "/homework/[id]",
                      params: { id: row.id },
                    })
                  }
                />
              ))}
            </View>
          ) : (
            <>
              <EmptyState
                icon="calendar"
                title={copy.homework.dayEmptyTitle}
                message={copy.homework.dayEmptyBody}
                testID="homework-day-empty"
              />
              {nextDay ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${copy.homework.agenda.nextUpLabel}, ${copy.homework.agenda.nextUp(
                    dayLabel(nextDay),
                    rows.filter(
                      (row) =>
                        countsAsDue(row.status) &&
                        dayKeyOf(row.dueAt) === nextDay,
                    ).length,
                  )}`}
                  accessibilityHint={copy.homework.agenda.nextUpCta}
                  onPress={() => setSelectedDay(nextDay)}
                  style={({ pressed }) => [
                    styles.nextUp,
                    pressed ? styles.nextUpPressed : null,
                  ]}
                  testID="homework-next-up"
                >
                  <View style={styles.nextUpBody}>
                    <ThemedText variant="sectionLabel">
                      {copy.homework.agenda.nextUpLabel}
                    </ThemedText>
                    <ThemedText variant="bodyStrong">
                      {copy.homework.agenda.nextUp(
                        dayLabel(nextDay),
                        rows.filter(
                          (row) =>
                            countsAsDue(row.status) &&
                            dayKeyOf(row.dueAt) === nextDay,
                        ).length,
                      )}
                    </ThemedText>
                  </View>
                  <AppIcon
                    name="chevronRight"
                    size={18}
                    color={colors.chevron}
                  />
                </Pressable>
              ) : null}
            </>
          )}
        </>
      ) : (
        <>
          <SegmentBar
            label={copy.homework.views.all}
            value={segment}
            options={SEGMENT_OPTIONS}
            onChange={(next) => {
              setSegment(next);
              if (next !== "live") setPastDueOnly(false);
            }}
          />

          <View style={styles.searchWrap}>
            <AppIcon
              name="search"
              size={18}
              color={colors.muted}
              style={styles.searchIcon}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={copy.homework.searchPlaceholder}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              accessibilityLabel={copy.homework.searchPlaceholder}
              accessibilityHint={copy.homework.searchHint}
              style={styles.searchInput}
              testID="homework-search"
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.homework.clearSearch}
                hitSlop={8}
                onPress={() => setQuery("")}
                style={({ pressed }) => [pressed ? styles.pressed : null]}
                testID="homework-search-clear"
              >
                <AppIcon name="closeCircle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.chips}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${copy.homework.allSubjects}: ${
                subjectOptions.find((option) => option.id === subjectFilter)
                  ?.label ?? copy.homework.allSubjects
              }`}
              onPress={() => setSubjectSheetOpen(true)}
              style={({ pressed }) => [
                styles.chip,
                pressed ? styles.chipPressed : null,
              ]}
              testID="homework-subject-filter"
            >
              <ThemedText variant="meta" numberOfLines={1}>
                {subjectOptions.find((option) => option.id === subjectFilter)
                  ?.label ?? copy.homework.allSubjects}
              </ThemedText>
              <AppIcon name="chevronDown" size={14} color={colors.muted} />
            </Pressable>

            {pastDueOnly ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.homework.agenda.clearPastDue}
                onPress={() => setPastDueOnly(false)}
                style={({ pressed }) => [
                  styles.chip,
                  styles.chipAlert,
                  pressed ? styles.chipPressed : null,
                ]}
                testID="homework-past-due-clear"
              >
                <ThemedText
                  variant="meta"
                  color={colors.tone.critical.fg}
                  numberOfLines={1}
                >
                  {copy.homework.agenda.pastDueFilter}
                </ThemedText>
                <AppIcon
                  name="close"
                  size={14}
                  color={colors.tone.critical.fg}
                />
              </Pressable>
            ) : null}
          </View>

          {pastDueOnly ? (
            <ThemedText variant="meta">
              {copy.homework.agenda.showingPastDue}
            </ThemedText>
          ) : null}

          {allRows.length > 0 ? (
            <View style={styles.cards}>
              {groupByDay(allRows).map((group) => (
                <View key={group.day} style={styles.group}>
                  <ThemedText variant="sectionLabel">
                    {dayLabel(group.day)}
                  </ThemedText>
                  {group.rows.map((row) => (
                    <AssignmentCard
                      key={row.id}
                      row={row}
                      showDay={false}
                      dense
                      onPress={() =>
                        router.push({
                          pathname: "/homework/[id]",
                          params: { id: row.id },
                        })
                      }
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="search"
              title={copy.homework.filteredEmptyTitle}
              message={copy.homework.filteredEmptyBody}
              testID="homework-filtered-empty"
            >
              {filtered ? (
                <CapsuleButton
                  title={copy.homework.clearFilters}
                  variant="secondary"
                  size="compact"
                  onPress={() => {
                    setQuery("");
                    setSubjectFilter(null);
                    setPastDueOnly(false);
                  }}
                  testID="homework-clear-filters"
                />
              ) : null}
            </EmptyState>
          )}
        </>
      )}

      <ChoiceSheet
        visible={subjectSheetOpen}
        title={copy.homework.allSubjects}
        options={[
          { id: "", label: copy.homework.allSubjects },
          ...subjectOptions,
        ]}
        currentId={subjectFilter ?? ""}
        onSelect={(id) => {
          setSubjectFilter(id || null);
          setSubjectSheetOpen(false);
        }}
        onDismiss={() => setSubjectSheetOpen(false)}
        testIDPrefix="homework-subject"
      />
    </View>,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeletonWrap: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeletonList: {
    gap: spacing.sm,
  },
  pastDue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.tone.critical.bg,
  },
  pastDuePressed: {
    opacity: 0.75,
  },
  pastDueText: {
    flex: 1,
    gap: spacing.xxs,
  },
  dayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  cards: {
    gap: spacing.sm,
  },
  group: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  nextUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  nextUpPressed: {
    backgroundColor: colors.field,
  },
  nextUpBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  searchWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  searchIcon: {
    marginTop: 1,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: fontSize.callout,
  },
  pressed: {
    opacity: 0.6,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipAlert: {
    borderColor: colors.tone.critical.fg,
    backgroundColor: colors.tone.critical.bg,
  },
  chipPressed: {
    backgroundColor: colors.field,
  },
});

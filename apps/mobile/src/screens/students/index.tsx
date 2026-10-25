import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { PersonRow } from "../../components/person-row";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { useTabBarSpace } from "../../components/tab-bar";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, spacing } from "../../theme/tokens";

type SortKey = "name" | "nameDesc" | "roll";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "name", label: copy.roster.sortName },
  { id: "nameDesc", label: copy.roster.sortNameDesc },
  { id: "roll", label: copy.roster.sortRoll },
];

/**
 * The student roster (Step 2, reworked): a daily surface with its own bottom
 * tab AND its More entry — the same screen, `variant` deciding the chrome
 * (a tab never shows a back control and pads for the floating bar).
 *
 * Search is server-side (`q`, debounced). Filtering and sorting ride the
 * session's enrollments (`enrollment:read`): a class filter narrows to the
 * students enrolled there, and sorting is name or roll order. A caller
 * without the enrollment read keeps search alone — honest degradation, not a
 * broken control.
 */
export function StudentsScreen({
  variant = "pushed",
}: {
  variant?: "pushed" | "tab";
}) {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useActiveBranchName();
  const tabSpace = useTabBarSpace();
  const { has } = usePermissions();

  const canRead = has("student:read");
  const canCreate = has("student:create");
  const canFilter = has("enrollment:read");

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [filterClassId, setFilterClassId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const list = trpc.student.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      q: search.length > 0 ? search : undefined,
    },
    {
      enabled: ready && Boolean(organizationId) && canRead,
      placeholderData: keepPreviousData,
    },
  );

  // The session's enrollments give the filter its classes and every student's
  // class placement. One fetch, reused by the chips and the filter.
  const enrollments = trpc.enrollment.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready &&
        Boolean(organizationId) &&
        canRead &&
        canFilter &&
        Boolean(academicYear?.id),
    },
  );

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: ready && Boolean(organizationId) && canFilter },
  );

  const classByStudent = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of enrollments.data ?? []) {
      if (!map.has(row.student.id)) map.set(row.student.id, row.enrollment.classId);
    }
    return map;
  }, [enrollments.data]);

  const filterOptions = useMemo(() => {
    const classIds = new Set<string>();
    for (const row of enrollments.data ?? []) {
      classIds.add(row.enrollment.classId);
    }
    return (classes.data ?? [])
      .filter((candidate) => classIds.has(candidate.id))
      .map((candidate) => ({ id: candidate.id, label: candidate.name }));
  }, [enrollments.data, classes.data]);

  const students = useMemo(() => {
    const rows = list.data ?? [];
    const filtered = filterClassId
      ? rows.filter((row) => classByStudent.get(row.id) === filterClassId)
      : rows;
    const name = (row: (typeof rows)[number]) =>
      [row.firstName, row.lastName].filter(Boolean).join(" ").toLowerCase();
    const sorted = [...filtered];
    if (sort === "name") sorted.sort((a, b) => name(a).localeCompare(name(b)));
    if (sort === "nameDesc") sorted.sort((a, b) => name(b).localeCompare(name(a)));
    return sorted;
  }, [list.data, filterClassId, classByStudent, sort]);

  const addAction =
    canRead && canCreate
      ? {
          label: copy.students.add,
          icon: "add" as const,
          onPress: () => router.push("/student-form"),
          accessibilityHint: copy.students.addHint,
          testID: "students-add",
        }
      : undefined;

  const sortLabel = SORTS.find((option) => option.id === sort)?.label ?? "";
  const filterLabel = filterClassId
    ? (classes.data ?? []).find((candidate) => candidate.id === filterClassId)
        ?.name ?? copy.roster.filterAll
    : copy.roster.filterAll;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.students.title}
      meta={branchName}
      backAccessibilityLabel={variant === "pushed" ? copy.common.back : undefined}
      action={addAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="students-title"
      padForTabBar={variant === "tab"}
    >
      {variant === "tab" ? (
        <View style={{ paddingBottom: 0 }}>{children}</View>
      ) : (
        children
      )}
      {variant === "tab" ? <View style={{ height: tabSpace * 0 }} /> : null}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.studentsReadTitle}
        message={copy.denied.studentsReadBody}
        testID="students-denied"
      />,
    );
  }

  if (!ready || (organizationId && list.isPending && !list.data)) {
    return frame(
      <View
        style={styles.list}
        accessibilityLabel={copy.students.loading}
        accessibilityLiveRegion="polite"
      >
        <Skeleton height={48} />
        {[0, 1, 2, 3].map((key) => (
          <Card key={key} style={styles.skeletonCard}>
            <View style={styles.skeletonRow}>
              <Skeleton width={40} height={40} />
              <View style={styles.skeletonText}>
                <Skeleton width="52%" height={16} />
                <Skeleton width="34%" height={12} />
              </View>
            </View>
          </Card>
        ))}
      </View>,
    );
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="students"
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
        testID="students-no-org"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="students-error"
      />,
    );
  }

  const searching = search.length > 0;

  return frame(
    <View style={styles.list}>
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
          placeholder={copy.students.searchPlaceholder}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="search"
          accessibilityLabel={copy.students.searchPlaceholder}
          accessibilityHint={copy.students.searchHint}
          style={styles.searchInput}
          testID="students-search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.students.clearSearch}
            hitSlop={8}
            onPress={() => setQuery("")}
            style={({ pressed }) => [pressed ? styles.pressed : null]}
            testID="students-search-clear"
          >
            <AppIcon name="closeCircle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {canFilter && (enrollments.data ?? []).length > 0 ? (
        <View style={styles.chips}>
          <Chip
            label={`${copy.roster.filterLabel}: ${filterLabel}`}
            icon="chevronDown"
            onPress={() => setFilterOpen(true)}
            testID="students-filter"
          />
          <Chip
            label={`${copy.roster.sortLabel}: ${sortLabel}`}
            icon="sort"
            onPress={() => setSortOpen(true)}
            testID="students-sort"
          />
        </View>
      ) : null}

      {students.length > 0 ? (
        <Card padless>
          {students.map((student, index) => (
            <PersonRow
              key={student.id}
              name={[student.firstName, student.lastName]
                .filter(Boolean)
                .join(" ")}
              meta={copy.students.meta(student.admissionNumber)}
              trailing={
                <AppIcon
                  name="chevronRight"
                  size={18}
                  color={colors.chevron}
                />
              }
              first={index === 0}
              onPress={() =>
                router.push({
                  pathname: "/students/[studentId]",
                  params: { studentId: student.id },
                })
              }
              accessibilityHint={copy.students.openHint}
              testID={`student-row-${student.id}`}
            />
          ))}
        </Card>
      ) : searching ? (
        <EmptyState
          icon="search"
          title={copy.students.noResultsTitle}
          message={copy.students.noResultsBody}
          testID="students-no-results"
        />
      ) : (
        <EmptyState
          icon="students"
          title={copy.students.emptyTitle}
          message={copy.students.emptyBody}
          testID="students-empty"
        >
          {canCreate ? (
            <CapsuleButton
              title={copy.students.add}
              icon="add"
              onPress={() => router.push("/student-form")}
              testID="students-empty-add"
            />
          ) : null}
        </EmptyState>
      )}

      <ChoiceSheet
        visible={filterOpen}
        title={copy.roster.filterLabel}
        options={[
          { id: "", label: copy.roster.filterAll },
          ...filterOptions,
        ]}
        currentId={filterClassId ?? ""}
        onSelect={(id) => {
          setFilterClassId(id || null);
          setFilterOpen(false);
        }}
        onDismiss={() => setFilterOpen(false)}
        testIDPrefix="students-filter-option"
      />
      <ChoiceSheet
        visible={sortOpen}
        title={copy.roster.sortLabel}
        options={SORTS}
        currentId={sort}
        onSelect={(id) => {
          setSort(id as SortKey);
          setSortOpen(false);
        }}
        onDismiss={() => setSortOpen(false)}
        testIDPrefix="students-sort-option"
      />
    </View>,
  );
}

function Chip({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: "chevronDown" | "sort";
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, pressed ? styles.chipPressed : null]}
      testID={testID}
    >
      <ThemedText variant="meta" numberOfLines={1}>
        {label}
      </ThemedText>
      <AppIcon name={icon} size={14} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  searchWrap: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.field,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: 16,
    fontFamily: fontFamily.regular,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  chipPressed: {
    backgroundColor: colors.field,
  },
  skeletonCard: {
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  skeletonText: {
    flex: 1,
    gap: spacing.sm,
  },
});

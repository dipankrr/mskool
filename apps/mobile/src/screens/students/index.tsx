import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../components/app-icon";
import { initials } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { HeaderActionButton } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext, useBranchMeta } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { env } from "../../env";
import { authClient } from "../../lib/auth";
import { copy } from "../../lib/copy";
import { formatReadableDate } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, gutter, radius, spacing } from "../../theme/tokens";
import { hasLeft, type EnrollmentStatus } from "./people-logic";
import {
  activeFilterCount,
  emptyFilters,
  rosterItems,
  rosterVisibleViews,
  type RosterFilters,
  type RosterItem,
  type RosterSort,
  type RosterView,
} from "./roster-logic";

type RosterRow = inferRouterOutputs<AppRouter>["student"]["roster"]["rows"][number];

const SORTS: { id: RosterSort; label: string }[] = [
  { id: "class", label: copy.students.list.sorts.class },
  { id: "name", label: copy.students.list.sorts.name },
  { id: "newest", label: copy.students.list.sorts.newest },
];

/**
 * The Students tab (ADR-057): the school's register, opening on the students
 * studying now, with one tap to anyone else. It has its own bottom tab and a More
 * entry, the same screen with `variant` deciding the chrome.
 *
 * Search, tabs and filters stay pinned while the list scrolls, because moving
 * between them is what this screen is for. Rows load a page at a time, and photos
 * only as they come on screen, so a large school stays quick. Photos in rows are
 * a deliberate exception to the initials-only rule for lists, for this tab only.
 */
export function StudentsScreen({
  variant = "pushed",
}: {
  variant?: "pushed" | "tab";
}) {
  const { organizationId, schoolId, academicYear, ready } = useActiveContext();
  const branchName = useBranchMeta();
  const tabSpace = useTabBarSpace();
  const { has } = usePermissions();

  const canRead = has("student:read");
  const canCreate = has("student:create");
  const canFilterClasses = has("class:read");

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const [view, setView] = useState<RosterView>("current");
  const [sort, setSort] = useState<RosterSort>("class");
  const [filters, setFilters] = useState<RosterFilters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // A different list starts from its top, not where the last one was left.
  const listRef = useRef<FlatList<RosterItem<RosterRow>>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [view, sort, filters, search]);

  // The photo route needs the session cookie, which lives in SecureStore.
  const [cookie, setCookie] = useState<string | null>(null);
  useEffect(() => {
    void Promise.resolve(authClient.getCookie()).then((value) => setCookie(value || null));
  }, []);

  const base = {
    organizationId: organizationId ?? "",
    schoolId: schoolId ?? undefined,
    academicYearId: academicYear?.id ?? "",
  };
  const enabled = ready && Boolean(organizationId) && canRead && Boolean(academicYear?.id);

  const roster = trpc.student.roster.useInfiniteQuery(
    {
      ...base,
      view,
      sort,
      ...(search ? { q: search } : {}),
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.sectionId ? { sectionId: filters.sectionId } : {}),
      ...(filters.gender ? { gender: filters.gender } : {}),
      ...(filters.admissionYear ? { admissionYear: Number(filters.admissionYear) } : {}),
      ...(filters.noSection ? { noSection: true } : {}),
      ...(filters.noGuardian ? { noGuardian: true } : {}),
      ...(filters.noPhoto ? { noPhoto: true } : {}),
    },
    {
      enabled,
      getNextPageParam: (page) => page.nextCursor,
      placeholderData: keepPreviousData,
    },
  );
  const summary = trpc.student.rosterSummary.useQuery(base, { enabled });
  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enabled && canFilterClasses },
  );
  const sections = trpc.academic.section.list.useQuery(base, {
    enabled: enabled && has("section:read"),
  });

  // A record changed on another screen (admitted, edited, left) shows on return.
  const utils = trpc.useUtils();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void utils.student.roster.invalidate();
      void utils.student.rosterSummary.invalidate();
    }, [utils]),
  );

  const rows = useMemo(
    () => roster.data?.pages.flatMap((page) => page.rows) ?? [],
    [roster.data],
  );
  const items = useMemo(() => rosterItems(rows, sort), [rows, sort]);
  const counts = summary.data?.counts;
  const attention = summary.data?.attention;
  const filterCount = activeFilterCount(filters);
  const sortLabel = SORTS.find((option) => option.id === sort)?.label ?? "";
  const sectionOptions = (sections.data ?? []).filter(
    (section) => section.classId === filters.classId,
  );

  const toggle = (key: "noSection" | "noGuardian" | "noPhoto") =>
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  const refresh = () => {
    void roster.refetch();
    void summary.refetch();
  };

  const renderItem = useCallback(
    ({ item }: { item: RosterItem<RosterRow> }) =>
      item.kind === "group" ? (
        <ThemedText variant="caption" color={colors.muted} style={styles.group}>
          {item.label ?? copy.students.list.noClass}
        </ThemedText>
      ) : (
        <StudentRow row={item.row} cookie={cookie} />
      ),
    [cookie],
  );

  const addAction = canCreate
    ? {
        label: copy.students.add,
        icon: "add" as const,
        onPress: () => router.push("/admit-student"),
        accessibilityHint: copy.students.addHint,
        testID: "students-add",
      }
    : undefined;

  const head = (
    <View style={styles.head}>
      {variant === "pushed" || addAction ? (
        <View style={styles.topRow}>
          {variant === "pushed" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.common.back}
              hitSlop={8}
              onPress={() => router.back()}
              style={styles.back}
              testID="screen-back"
            >
              <AppIcon name="chevronLeft" size={22} color={colors.ink} />
            </Pressable>
          ) : (
            <View />
          )}
          {addAction ? <HeaderActionButton action={addAction} /> : null}
        </View>
      ) : null}
      <ThemedText variant="title" testID="students-title">
        {copy.students.title}
      </ThemedText>
      {branchName ? (
        <ThemedText variant="meta" style={styles.meta}>
          {branchName}
        </ThemedText>
      ) : null}
    </View>
  );

  const fullState = (body: React.ReactNode) => (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {head}
      <View style={styles.state}>{body}</View>
    </SafeAreaView>
  );

  if (!canRead) {
    return fullState(
      <EmptyState
        icon="shield"
        title={copy.denied.studentsReadTitle}
        message={copy.denied.studentsReadBody}
        testID="students-denied"
      />,
    );
  }
  if (!ready) {
    return fullState(<Skeleton height={220} />);
  }
  if (!organizationId) {
    return fullState(
      <EmptyState
        icon="students"
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
        testID="students-no-org"
      />,
    );
  }
  if (!academicYear) {
    return fullState(
      <EmptyState
        icon="sessions"
        title={copy.students.list.noSessionTitle}
        message={copy.students.list.noSessionBody}
        testID="students-no-session"
      />,
    );
  }

  const searching = search.length > 0 || filterCount > 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      {head}
      <View style={styles.controls}>
        <View style={styles.searchWrap}>
          <AppIcon name="search" size={18} color={colors.muted} />
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
              testID="students-search-clear"
            >
              <AppIcon name="closeCircle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.tabsScroll}
          contentContainerStyle={styles.tabs}
        >
          {rosterVisibleViews(view, counts).map((option) => {
            const selected = option === view;
            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setView(option)}
                style={[styles.tab, selected ? styles.tabOn : null]}
                testID={`students-view-${option}`}
              >
                <ThemedText
                  variant="caption"
                  color={selected ? colors.surface : colors.ink}
                  numberOfLines={1}
                >
                  {copy.students.list.views[option]}
                  {counts ? ` ${counts[option]}` : ""}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.tools}>
          <Tool
            label={
              filterCount > 0
                ? copy.students.list.filtersOn(filterCount)
                : copy.students.list.filters
            }
            icon="filter"
            active={filterCount > 0}
            onPress={() => setFiltersOpen(true)}
            testID="students-filter"
          />
          <Tool
            label={sortLabel}
            icon="sort"
            onPress={() => setSortOpen(true)}
            testID="students-sort"
          />
        </View>
      </View>

      {roster.isError && rows.length === 0 ? (
        <View style={styles.state}>
          <ErrorCard
            cause={roster.error}
            onRetry={() => void roster.refetch()}
            testID="students-error"
          />
        </View>
      ) : roster.isPending ? (
        <View style={styles.state} accessibilityLabel={copy.students.loading}>
          {[0, 1, 2, 3, 4].map((key) => (
            <View key={key} style={styles.skeletonRow}>
              <Skeleton width={52} height={52} />
              <View style={styles.skeletonText}>
                <Skeleton width="56%" height={16} />
                <Skeleton width="38%" height={12} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          extraData={cookie}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: variant === "tab" ? tabSpace : spacing.huge },
          ]}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (roster.hasNextPage && !roster.isFetchingNextPage) {
              void roster.fetchNextPage();
            }
          }}
          refreshing={roster.isRefetching && !roster.isFetchingNextPage}
          onRefresh={refresh}
          ListHeaderComponent={
            view === "current" ? (
              <Attention attention={attention} filters={filters} onToggle={toggle} />
            ) : null
          }
          ListFooterComponent={
            roster.isFetchingNextPage ? (
              <ActivityIndicator color={colors.accent} style={styles.more} />
            ) : null
          }
          ListEmptyComponent={
            searching ? (
              <EmptyState
                icon="search"
                title={copy.students.noResultsTitle}
                message={copy.students.list.noResultsBody}
                testID="students-no-results"
              />
            ) : (
              <EmptyState
                icon="students"
                title={copy.students.list.emptyTitles[view]}
                message={copy.students.list.emptyBodies[view]}
                testID="students-empty"
              >
                {canCreate && view === "current" ? (
                  <CapsuleButton
                    title={copy.students.add}
                    icon="add"
                    onPress={() => router.push("/admit-student")}
                    testID="students-empty-add"
                  />
                ) : null}
              </EmptyState>
            )
          }
        />
      )}

      <ChoiceSheet
        visible={sortOpen}
        title={copy.students.list.sortTitle}
        options={SORTS}
        currentId={sort}
        onSelect={(id) => {
          setSort(id as RosterSort);
          setSortOpen(false);
        }}
        onDismiss={() => setSortOpen(false)}
        testIDPrefix="students-sort-option"
      />

      {filtersOpen ? (
        <FormSheet
          title={copy.students.list.filters}
          onClose={() => setFiltersOpen(false)}
          testIDPrefix="students-filters"
          footer={
            <View style={styles.filterActions}>
              <CapsuleButton
                title={copy.students.list.clear}
                variant="secondary"
                size="compact"
                onPress={() => setFilters(emptyFilters)}
                disabled={filterCount === 0}
                testID="students-filters-clear"
                style={styles.filterAction}
              />
              <CapsuleButton
                title={copy.students.list.done}
                size="compact"
                onPress={() => setFiltersOpen(false)}
                testID="students-filters-done"
                style={styles.filterAction}
              />
            </View>
          }
        >
          {(classes.data ?? []).length > 0 ? (
            <ChoicePills
              label={copy.people.enrollment.classLabel}
              value={filters.classId}
              options={(classes.data ?? []).map((option) => ({
                value: option.id,
                label: option.name,
              }))}
              onChange={(classId) =>
                setFilters((current) => ({
                  ...current,
                  classId: current.classId === classId ? null : classId,
                  sectionId: null,
                }))
              }
              testIDPrefix="students-filter-class"
            />
          ) : null}
          {sectionOptions.length > 0 ? (
            <ChoicePills
              label={copy.people.enrollment.sectionLabel}
              value={filters.sectionId}
              options={sectionOptions.map((option) => ({
                value: option.id,
                label: option.name,
              }))}
              onChange={(sectionId) =>
                setFilters((current) => ({
                  ...current,
                  sectionId: current.sectionId === sectionId ? null : sectionId,
                }))
              }
              testIDPrefix="students-filter-section"
            />
          ) : null}
          <ChoicePills
            label={copy.studentForm.fields.gender}
            value={filters.gender}
            options={(["male", "female", "other"] as const).map((gender) => ({
              value: gender,
              label: copy.studentForm.genders[gender],
            }))}
            onChange={(gender) =>
              setFilters((current) => ({
                ...current,
                gender: current.gender === gender ? null : gender,
              }))
            }
            testIDPrefix="students-filter-gender"
          />
          <FormField
            label={copy.students.list.admissionYear}
            value={filters.admissionYear}
            onChangeText={(value) =>
              setFilters((current) => ({
                ...current,
                admissionYear: value.replace(/\D/g, "").slice(0, 4),
              }))
            }
            keyboardType="number-pad"
            maxLength={4}
            testID="students-filter-year"
          />
          <ChoicePills
            label={copy.students.list.missing}
            value={
              filters.noSection
                ? "noSection"
                : filters.noGuardian
                  ? "noGuardian"
                  : filters.noPhoto
                    ? "noPhoto"
                    : null
            }
            options={(["noSection", "noGuardian", "noPhoto"] as const).map((key) => ({
              value: key,
              label: copy.students.list.missingOptions[key],
            }))}
            onChange={(key) =>
              setFilters((current) => ({
                ...current,
                noSection: key === "noSection" ? !current.noSection : false,
                noGuardian: key === "noGuardian" ? !current.noGuardian : false,
                noPhoto: key === "noPhoto" ? !current.noPhoto : false,
              }))
            }
            testIDPrefix="students-filter-missing"
          />
        </FormSheet>
      ) : null}
    </SafeAreaView>
  );
}

function Tool({
  label,
  icon,
  active = false,
  onPress,
  testID,
}: {
  label: string;
  icon: "filter" | "sort";
  active?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        active ? styles.toolOn : null,
        pressed ? styles.toolPressed : null,
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={14} color={active ? colors.accentDeep : colors.muted} />
      <ThemedText
        variant="caption"
        color={active ? colors.accentDeep : colors.muted}
        numberOfLines={1}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Who needs something done; a tap narrows the list to them. */
function Attention({
  attention,
  filters,
  onToggle,
}: {
  attention: { noSection: number; noGuardian: number; noPhoto: number } | undefined;
  filters: RosterFilters;
  onToggle: (key: "noSection" | "noGuardian" | "noPhoto") => void;
}) {
  const items = (["noSection", "noGuardian", "noPhoto"] as const).filter(
    (key) => filters[key] || (attention?.[key] ?? 0) > 0,
  );
  if (items.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.attention}
      testID="students-attention"
    >
      {items.map((key) => {
        const on = filters[key];
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onToggle(key)}
            style={[styles.attentionChip, on ? styles.attentionOn : null]}
            testID={`students-attention-${key}`}
          >
            <AppIcon
              name={on ? "closeCircle" : "warningCircle"}
              size={14}
              color={colors.tone.caution.fg}
            />
            <ThemedText variant="caption" color={colors.tone.caution.fg} numberOfLines={1}>
              {copy.students.list.attention[key](attention?.[key] ?? 0)}
            </ThemedText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function RowPhoto({
  objectId,
  name,
  cookie,
}: {
  objectId: string | null;
  name: string;
  cookie: string | null;
}) {
  const [failed, setFailed] = useState(false);
  if (objectId && cookie && !failed) {
    return (
      <Image
        source={{
          uri: `${env.EXPO_PUBLIC_API_URL}/api/storage/${objectId}`,
          headers: { Cookie: cookie },
          // A replaced photo gets a new object, so the id is a safe cache key.
          cacheKey: objectId,
        }}
        cachePolicy="disk"
        recyclingKey={objectId}
        contentFit="cover"
        transition={120}
        onError={() => setFailed(true)}
        style={styles.photo}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.photo, styles.photoEmpty]}>
      <ThemedText variant="bodyStrong" color={colors.muted} allowFontScaling={false}>
        {initials(name)}
      </ThemedText>
    </View>
  );
}

function StudentRow({ row, cookie }: { row: RosterRow; cookie: string | null }) {
  const name = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");
  const status = row.enrollmentStatus as EnrollmentStatus | null;
  const gone = row.status === "inactive";
  const needsSection = status === "admitted";
  const place = [
    row.className,
    row.sectionName,
    row.rollNumber ? copy.students.list.roll(row.rollNumber) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const line = gone
    ? [place || null, row.leftOn ? formatReadableDate(row.leftOn) : null]
        .filter(Boolean)
        .join(" · ") || copy.students.list.notPlaced
    : place || copy.students.list.notPlaced;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${line}, ${copy.students.meta(row.admissionNumber)}`}
      accessibilityHint={copy.students.openHint}
      onPress={() =>
        router.push({ pathname: "/students/[studentId]", params: { studentId: row.id } })
      }
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
      testID={`student-row-${row.id}`}
    >
      <RowPhoto objectId={row.photoObjectId} name={name} cookie={cookie} />
      <View style={styles.rowText}>
        <ThemedText variant="name" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={1}>
          {line}
        </ThemedText>
        <ThemedText variant="caption" color={colors.muted} numberOfLines={1}>
          {copy.students.meta(row.admissionNumber)}
        </ThemedText>
      </View>
      {status && hasLeft(status) ? (
        <StatusPill
          label={copy.people.enrollment.statuses[status]}
          tone={status === "graduated" ? "positive" : "critical"}
        />
      ) : gone ? (
        <StatusPill label={copy.students.list.inactive} tone="critical" />
      ) : needsSection ? (
        <StatusPill label={copy.students.list.noSection} tone="caution" />
      ) : (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  head: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  topRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: {
    width: 48,
    height: 48,
    marginLeft: -spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  meta: {
    marginTop: spacing.xs,
  },
  state: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  controls: {
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  searchWrap: {
    minHeight: 48,
    marginHorizontal: gutter,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: 16,
    fontFamily: fontFamily.regular,
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabs: {
    paddingHorizontal: gutter,
    gap: spacing.xs,
  },
  tab: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  tabOn: {
    backgroundColor: colors.accent,
  },
  tools: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: gutter,
  },
  tool: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  toolOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  toolPressed: {
    backgroundColor: colors.field,
  },
  listContent: {
    paddingHorizontal: gutter,
    paddingTop: spacing.sm,
  },
  attention: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  attentionChip: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.tone.caution.bg,
  },
  attentionOn: {
    borderWidth: 1,
    borderColor: colors.tone.caution.fg,
  },
  group: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  photo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.field,
  },
  photoEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  more: {
    marginVertical: spacing.lg,
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
  filterActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  filterAction: {
    flex: 1,
  },
});

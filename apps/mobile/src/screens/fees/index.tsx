import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import Animated from "react-native-reanimated";
import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import {
  useFollowTabBar,
  useHideTabBarOnScroll,
  useTabBarSpace,
} from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useSessionOpen } from "../../hooks/use-session-open";
import { copy } from "../../lib/copy";
import { feesCopy } from "../../lib/fees-copy";
import { formatMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, gutter, radius, spacing } from "../../theme/tokens";
import {
  AttentionCards,
  SmallStat,
  TotalDueCard,
  type AttentionCard,
} from "./dashboard-cards";
import { DashboardRow } from "./dashboard-row";
import { DuesSheet } from "./dues-sheet";

type Show = "owes" | "paid" | "not_billed" | "all";
type Sort = "oldest" | "highest" | "name";

const PAGE_SIZE = 25;
const words = feesCopy.dashboard;
const STATUS_CHIPS = ["owes", "paid", "not_billed"] as const;

/**
 * The Fees tab: the owner's sketch (`docs/design/mobile/fees-dashboard-sketch.png`).
 * Attention cards, this month's total, two small figures, then the students.
 * The summary folds away so the list can have the whole screen, and Collect
 * floats above everything because taking money is the daily job.
 *
 * Every figure comes from the server, so no two screens can add up differently.
 */
export function FeesScreen({
  variant = "pushed",
}: {
  variant?: "pushed" | "tab";
}) {
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useBranchMeta();
  const { has, hasAny } = usePermissions();
  const sessionOpen = useSessionOpen();
  const tabBarSpace = useTabBarSpace();
  const hideTabBarOnScroll = useHideTabBarOnScroll();
  const followTabBar = useFollowTabBar();

  const canReadDesk = hasAny("fee_report:read", "student_fee_assignment:read");
  const canReadReport = has("fee_report:read");
  const canReadPayments = has("fee_payment:read");
  const canSetup = hasAny("fee_structure:read", "fee_head:read");
  const canFilter = has("class:read") && has("section:read");
  const canCollect = has("fee_payment:create") && sessionOpen;
  const canCreateDues = has("student_fee_assignment:update") && sessionOpen;

  const [summaryOpen, setSummaryOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<Show>("owes");
  const [sort, setSort] = useState<Sort>("oldest");
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState<"class" | "section" | "sort" | "dues" | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const enabled =
    ready && canReadReport && Boolean(organizationId) && Boolean(academicYear?.id);

  const overview = trpc.fees.dashboard.overview.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
    },
    { enabled },
  );

  const list = trpc.fees.dashboard.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      search: search.length > 0 ? search : undefined,
      classId: classId ?? undefined,
      sectionId: sectionId ?? undefined,
      show,
      sort,
      page,
      pageSize: PAGE_SIZE,
    },
    { enabled, placeholderData: keepPreviousData },
  );

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    { enabled: enabled && canFilter, staleTime: 5 * 60_000 },
  );
  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    { enabled: enabled && canFilter, staleTime: 5 * 60_000 },
  );

  const sectionOptions = useMemo(
    () =>
      (sections.data ?? [])
        .filter((row) => (classId ? row.classId === classId : true))
        .map((row) => ({
          id: row.id,
          label: row.name,
        })),
    [sections.data, classId],
  );

  const data = overview.data;

  const cards: AttentionCard[] = useMemo(() => {
    if (!data) return [];
    const out: AttentionCard[] = [];
    const steps = [
      data.setup.hasFeeTypes,
      data.setup.structures > 0,
      data.setup.structures > 0 && data.setup.structuresNotStarted === 0,
    ];
    const done = steps.filter(Boolean).length;
    if (canSetup && done < steps.length) {
      out.push({
        key: "setup",
        icon: "settings",
        tone: "positive",
        title: words.setupCardTitle,
        body: words.setupCardBody(done, steps.length),
        onPress: () => router.push("/fees/setup"),
      });
    }
    // Automatic is paused, so nobody else will add these. This must not be missable.
    if (data.paused && data.paused.missingDues > 0 && canCreateDues) {
      out.push({
        key: "paused",
        icon: "warning",
        tone: "caution",
        title: words.pausedCardTitle(data.monthLabel),
        body: words.pausedCardBody(data.paused.missingDues),
        onPress: () => setSheet("dues"),
      });
    }
    if (data.pending.count > 0 && canReadPayments) {
      out.push({
        key: "pending",
        icon: "clock",
        tone: "caution",
        title: words.pendingCardTitle(data.pending.count),
        body: words.pendingCardBody(formatMoney(data.pending.amount)),
        onPress: () => router.push("/fees/payments"),
      });
    }
    if (data.studentsNotBilled > 0 && data.setup.structures > 0) {
      out.push({
        key: "not-billed",
        icon: "warningCircle",
        tone: "neutral",
        title: words.notBilledCardTitle(data.studentsNotBilled),
        body: words.notBilledCardBody,
        onPress: () => {
          setShow("not_billed");
          setPage(1);
          setSummaryOpen(false);
        },
      });
    }
    return out;
  }, [data, canSetup, canReadPayments, canCreateDues]);

  const refresh = () => {
    void overview.refetch();
    void list.refetch();
  };

  const resetFilters = () => {
    setQuery("");
    setSearch("");
    setClassId(null);
    setSectionId(null);
    setShow("owes");
    setPage(1);
  };

  const frame = (children: ReactNode) => (
    <View style={styles.root}>
      <ScreenFrame
        title={words.title}
        meta={branchName}
        backAccessibilityLabel={
          variant === "pushed" ? copy.common.back : undefined
        }
        action={
          canReadPayments
            ? {
                label: copy.fees.payments.title,
                icon: "receipt",
                onPress: () => router.push("/fees/payments"),
                testID: "fees-payments",
              }
            : undefined
        }
        secondaryAction={
          canSetup
            ? {
                label: copy.fees.setup.title,
                icon: "settings",
                iconOnly: true,
                onPress: () => router.push("/fees/setup"),
                testID: "fees-setup",
              }
            : undefined
        }
        onRefresh={canReadReport ? refresh : undefined}
        refreshing={overview.isRefetching || list.isRefetching}
        titleTestID="fees-title"
        padForTabBar={variant === "tab"}
        onScroll={variant === "tab" ? hideTabBarOnScroll : undefined}
      >
        {children}
      </ScreenFrame>
      {canCollect && enabled ? (
        <Animated.View
          style={[
            styles.fabSpot,
            { bottom: (variant === "tab" ? tabBarSpace : 0) + spacing.md },
            variant === "tab" ? followTabBar : null,
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.collect}
            accessibilityHint={words.collectHint}
            onPress={() => router.push("/fees/collect" as Href)}
            style={({ pressed }) => [styles.fab, pressed ? styles.fabPressed : null]}
            testID="fees-collect-fab"
          >
            <AppIcon name="collect" size={20} color={colors.onAccent} />
            <ThemedText variant="bodyStrong" color={colors.onAccent}>
              {words.collect}
            </ThemedText>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );

  if (!canReadDesk) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.fees.noAccessTitle}
        message={copy.fees.noAccessBody}
        testID="fees-no-access"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(<LoadingBody />);
  }

  if (!organizationId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.fees.noBranchTitle}
        message={copy.fees.noBranchBody}
        testID="fees-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.noYearTitle}
        message={copy.fees.noYearBody}
        testID="fees-no-year"
      />,
    );
  }

  if (!canReadReport) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.noReportTitle}
        message={copy.fees.noReportBody}
        testID="fees-no-report"
      >
        {canReadPayments ? (
          <CapsuleButton
            title={copy.fees.openPayments}
            variant="secondary"
            size="compact"
            onPress={() => router.push("/fees/payments")}
            testID="fees-open-payments"
          />
        ) : null}
      </EmptyState>,
    );
  }

  if (overview.isError) {
    return frame(
      <ErrorCard
        cause={overview.error}
        onRetry={() => void overview.refetch()}
        testID="fees-error"
      />,
    );
  }

  if (!data) {
    return frame(<LoadingBody />);
  }

  const rows = list.data?.rows ?? [];
  const noSetup = !data.setup.hasFeeTypes || data.setup.structures === 0;

  return frame(
    <View style={styles.body}>
      {!sessionOpen ? (
        <Notice
          tone="caution"
          message={copy.fees.sessionClosed}
          testID="fees-session-closed"
        />
      ) : null}

      {summaryOpen ? (
        <>
          <AttentionCards cards={cards} />
          <TotalDueCard
            monthLabel={data.monthLabel}
            due={data.dueThisMonth}
            billed={data.billedThisMonth}
            paid={data.paidOnThisMonth}
            collected={data.collectedThisMonth}
            trend={data.trend.map((point) => point.balance)}
          />
          <View style={styles.stats}>
            <SmallStat
              label={words.allTimeDue}
              value={formatMoney(data.allTimeDue)}
              testID="fees-all-time-due"
            />
            <SmallStat
              label={words.studentsWithDue}
              value={words.studentsOf(data.studentsWithDue, data.studentsBilled)}
              testID="fees-students-with-due"
            />
          </View>
          {canReadPayments ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push("/fees/payments")}
              style={styles.reportLink}
              testID="fees-report-link"
            >
              <ThemedText variant="meta" color={colors.accentDeep}>
                {words.report}
              </ThemedText>
              <AppIcon name="chevronRight" size={16} color={colors.accentDeep} />
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summaryOpen ? words.collapse : words.expand}
        accessibilityState={{ expanded: summaryOpen }}
        onPress={() => setSummaryOpen((value) => !value)}
        style={styles.collapse}
        hitSlop={8}
        testID="fees-summary-toggle"
      >
        <AppIcon
          name={summaryOpen ? "chevronUp" : "chevronDown"}
          size={22}
          color={colors.muted}
        />
      </Pressable>

      <View style={styles.searchWrap}>
        <AppIcon name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={words.search}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={words.search}
          style={styles.searchInput}
          testID="fees-search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={words.clearSearch}
            hitSlop={8}
            onPress={() => setQuery("")}
            testID="fees-search-clear"
          >
            <AppIcon name="closeCircle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.filterRow}
        testID="fees-filters"
      >
        {canFilter ? (
          <FilterPill
            label={classes.data?.find((row) => row.id === classId)?.name ?? words.classLabel}
            accessibilityLabel={words.classLabel}
            selected={Boolean(classId)}
            dropdown
            onPress={() => setSheet("class")}
            testID="fees-filter-class"
          />
        ) : null}
        {canFilter && classId && sectionOptions.length > 0 ? (
          <FilterPill
            label={sectionOptions.find((row) => row.id === sectionId)?.label ?? words.sectionShort}
            accessibilityLabel={words.sectionLabel}
            selected={Boolean(sectionId)}
            dropdown
            onPress={() => setSheet("section")}
            testID="fees-filter-section"
          />
        ) : null}
        {STATUS_CHIPS.map((id) => (
          <FilterPill
            key={id}
            label={words.show[id]}
            selected={show === id}
            // Tapping the chip that's on turns it off, which shows everyone.
            onPress={() => {
              setShow(show === id ? "all" : id);
              setPage(1);
            }}
            testID={`fees-filter-${id}`}
          />
        ))}
      </ScrollView>

      {list.data ? (
        <View style={styles.listHead}>
          <ThemedText
            variant="meta"
            numberOfLines={1}
            style={styles.count}
            testID="fees-count"
          >
            {show === "paid" || show === "not_billed"
              ? words.countNoTotal(list.data.total)
              : words.count(list.data.total, formatMoney(list.data.totalDue))}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${words.sort}: ${words.sorts[sort]}`}
            hitSlop={8}
            onPress={() => setSheet("sort")}
            style={styles.sort}
            testID="fees-sort"
          >
            <AppIcon name="sort" size={16} color={colors.accentDeep} />
            <ThemedText variant="meta" numberOfLines={1} color={colors.accentDeep}>
              {words.sorts[sort]}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      {list.isError ? (
        <ErrorCard
          cause={list.error}
          onRetry={() => void list.refetch()}
          testID="fees-list-error"
        />
      ) : list.isPending && !list.data ? (
        <View style={styles.rows}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} height={96} />
          ))}
        </View>
      ) : rows.length > 0 ? (
        <View style={styles.rows}>
          {rows.map((row) => (
            <DashboardRow
              key={row.studentId}
              row={row}
              onPress={() =>
                router.push({
                  pathname: "/fees/student/[studentId]",
                  params: {
                    studentId: row.studentId,
                    admissionNumber: row.admissionNumber,
                    studentName: row.studentName,
                  },
                })
              }
            />
          ))}
        </View>
      ) : noSetup ? (
        <EmptyState
          icon="fees"
          title={words.emptySetupTitle}
          message={words.emptySetupBody}
          testID="fees-empty-setup"
        >
          {canSetup ? (
            <CapsuleButton
              title={words.emptySetupAction}
              icon="settings"
              variant="secondary"
              size="compact"
              onPress={() => router.push("/fees/setup")}
              testID="fees-empty-setup-action"
            />
          ) : null}
        </EmptyState>
      ) : search || classId || sectionId || show !== "owes" ? (
        <EmptyState
          icon="search"
          title={words.emptyFilteredTitle}
          message={words.emptyFilteredBody}
          testID="fees-filtered-empty"
        >
          <CapsuleButton
            title={words.clearFilters}
            variant="secondary"
            size="compact"
            onPress={resetFilters}
            testID="fees-clear-filters"
          />
        </EmptyState>
      ) : (
        <EmptyState
          icon="check"
          title={words.emptyOwesTitle}
          message={words.emptyOwesBody}
          testID="fees-empty"
        />
      )}

      {list.data && list.data.totalPages > 1 ? (
        <View style={styles.pager}>
          <CapsuleButton
            title={words.previousPage}
            variant="secondary"
            size="mini"
            disabled={page <= 1}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
            testID="fees-prev-page"
          />
          <ThemedText variant="meta">{`${list.data.page} / ${list.data.totalPages}`}</ThemedText>
          <CapsuleButton
            title={words.nextPage}
            variant="secondary"
            size="mini"
            disabled={page >= list.data.totalPages}
            onPress={() => setPage((current) => current + 1)}
            testID="fees-next-page"
          />
        </View>
      ) : null}

      <View style={styles.fabSpace} />

      <ChoiceSheet
        visible={sheet === "class"}
        title={words.classLabel}
        options={[
          { id: "", label: words.allClasses },
          ...(classes.data ?? []).map((row) => ({ id: row.id, label: row.name })),
        ]}
        currentId={classId ?? ""}
        onSelect={(id) => {
          setClassId(id || null);
          setSectionId(null);
          setPage(1);
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
        testIDPrefix="fees-class"
      />
      <ChoiceSheet
        visible={sheet === "section"}
        title={words.sectionLabel}
        options={[{ id: "", label: words.allSections }, ...sectionOptions]}
        currentId={sectionId ?? ""}
        onSelect={(id) => {
          setSectionId(id || null);
          setPage(1);
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
        testIDPrefix="fees-section"
      />
      <ChoiceSheet
        visible={sheet === "sort"}
        title={words.sort}
        options={(["oldest", "highest", "name"] as const).map((id) => ({
          id,
          label: words.sorts[id],
        }))}
        currentId={sort}
        onSelect={(id) => {
          setSort(id as Sort);
          setPage(1);
          setSheet(null);
        }}
        onDismiss={() => setSheet(null)}
        testIDPrefix="fees-sort"
      />
      {sheet === "dues" && organizationId && schoolId && academicYear ? (
        <DuesSheet
          organizationId={organizationId}
          schoolId={schoolId}
          academicYearId={academicYear.id}
          sessionEnd={academicYear.endDate}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>,
  );
}

function LoadingBody() {
  return (
    <View style={styles.body}>
      <Skeleton height={140} />
      <Skeleton height={72} />
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} height={96} />
      ))}
    </View>
  );
}

function FilterPill({
  label,
  accessibilityLabel,
  selected,
  dropdown = false,
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  dropdown?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}: ${label}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        selected ? styles.pillSelected : null,
        pressed ? styles.pillPressed : null,
      ]}
      testID={testID}
    >
      <ThemedText
        variant="meta"
        numberOfLines={1}
        color={selected ? colors.accentDeep : colors.ink}
      >
        {label}
      </ThemedText>
      {dropdown ? (
        <AppIcon
          name="chevronDown"
          size={14}
          color={selected ? colors.accentDeep : colors.muted}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stats: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  reportLink: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
  },
  collapse: {
    alignSelf: "center",
    minHeight: 32,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
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
  searchInput: {
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.sm,
    fontSize: fontSize.callout,
    fontFamily: fontFamily.regular,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  pill: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  pillSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  pillPressed: {
    backgroundColor: colors.field,
  },
  listHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  sort: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  count: {
    flex: 1,
  },
  rows: {
    gap: spacing.sm,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  fabSpace: {
    height: 64,
  },
  fabSpot: {
    position: "absolute",
    right: gutter,
  },
  fab: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    elevation: 4,
    shadowColor: colors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabPressed: {
    backgroundColor: colors.accentDeep,
  },
});

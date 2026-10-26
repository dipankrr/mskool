import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import { keepPreviousData } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { SegmentBar } from "../../components/segment-bar";
import type { SegmentOption } from "../../components/segment-bar";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useActiveBranchName,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import {
  formatMoney,
  isPositiveMoney,
  paidPercent,
  sumMoney,
} from "../../lib/money";
import { todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { fontFamily, fontSize, radius, spacing } from "../../theme/tokens";
import { DuesRow } from "./dues-row";
import { SectionHead } from "./status";

type FeeView = "attention" | "overdue" | "paid" | "all";

const VIEW_OPTIONS: readonly SegmentOption<FeeView>[] = [
  { value: "attention", label: "Attention", testID: "fees-view-attention" },
  { value: "overdue", label: "Overdue", testID: "fees-view-overdue" },
  { value: "paid", label: "Settled", testID: "fees-view-paid" },
  { value: "all", label: "All", testID: "fees-view-all" },
];

const PAGE_SIZE = 25;

/**
 * The Fees tab root — the accountant's working list.
 *
 * It reads `fees.matrix.list` rather than `installment.dues` because the
 * matrix is the only fee read that returns student identity, class placement,
 * assignment/generation state, the totals, the oldest due date and pagination
 * in one call. The default view is Attention: an overdue balance, a carried
 * forward balance, or an assignment that has not been generated yet. The
 * other views are refinements of the same list, never a different screen.
 *
 * The wide matrix is not rendered here — a 12-month table on a phone is a
 * squeeze, not a feature. The month strip lives on the student desk, where
 * one student's year has room to breathe.
 */
export function FeesScreen({
  variant = "pushed",
}: {
  variant?: "pushed" | "tab";
}) {
  const { organizationId, schoolId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useActiveBranchName();
  const { has, hasAny } = usePermissions();

  const canReadDesk = hasAny("fee_report:read", "student_fee_assignment:read");
  const canReadMatrix = has("fee_report:read");
  const canReadPayments = has("fee_payment:read");
  const canSetup = hasAny("fee_structure:read", "fee_head:read");
  const canFilter = has("class:read") && has("section:read");

  const [view, setView] = useState<FeeView>("attention");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [classSheet, setClassSheet] = useState(false);
  const [sectionSheet, setSectionSheet] = useState(false);

  const today = todayIso();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const classes = trpc.academic.class.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled: ready && Boolean(organizationId) && canFilter,
      staleTime: 5 * 60_000,
    },
  );
  const sections = trpc.academic.section.list.useQuery(
    {
      organizationId: organizationId ?? "",
      schoolId: schoolId ?? undefined,
      academicYearId: academicYear?.id ?? "",
    },
    {
      enabled:
        ready &&
        canFilter &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
      staleTime: 5 * 60_000,
    },
  );

  const list = trpc.fees.matrix.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      search: search.length > 0 ? search : undefined,
      classId: classId ?? undefined,
      sectionId: sectionId ?? undefined,
      page,
      pageSize: PAGE_SIZE,
      sort: "oldestDue",
      view,
    },
    {
      enabled:
        ready &&
        canReadMatrix &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
      placeholderData: keepPreviousData,
    },
  );

  const rows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const totals = list.data?.cohortTotals;
  const pageInfo = list.data?.pageInfo;

  const sectionOptions = useMemo(() => {
    const all = sections.data ?? [];
    return (classId ? all.filter((row) => row.classId === classId) : all).map(
      (row) => ({
        id: row.id,
        label: row.name,
        detail:
          classes.data?.find((cls) => cls.id === row.classId)?.name ?? null,
      }),
    );
  }, [sections.data, classes.data, classId]);

  const classLabel =
    classes.data?.find((row) => row.id === classId)?.name ??
    copy.fees.dues.allClasses;
  const sectionLabel =
    sectionOptions.find((row) => row.id === sectionId)?.label ??
    copy.fees.dues.allSections;

  const filtered = Boolean(search || classId || sectionId);
  const outstanding = sumMoney([
    totals?.balanceAmount,
    totals?.openingBalance.balance,
  ]);
  const carriedForward = totals?.openingBalance.balance ?? "0.00";
  const percent = totals ? paidPercent(totals.paidAmount, totals.netAmount) : 0;

  const resetFilters = () => {
    setQuery("");
    setSearch("");
    setClassId(null);
    setSectionId(null);
    setPage(1);
  };

  const paymentsAction = canReadPayments
    ? {
        label: "Payments",
        icon: "receipt" as const,
        onPress: () => router.push("/fees/payments"),
        accessibilityHint: "Opens every receipt recorded this session",
        testID: "fees-payments",
      }
    : undefined;

  const setupAction = canSetup
    ? {
        label: "Fee setup",
        icon: "settings" as const,
        iconOnly: true,
        onPress: () => router.push("/fees/setup"),
        accessibilityHint: "Opens fee heads, structures and late fees",
        testID: "fees-setup",
      }
    : undefined;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.title}
      meta={
        list.data ? copy.fees.dues.meta(formatMoney(outstanding)) : branchName
      }
      backAccessibilityLabel={
        variant === "pushed" ? copy.common.back : undefined
      }
      action={paymentsAction}
      secondaryAction={setupAction}
      onRefresh={canReadMatrix ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="fees-title"
      padForTabBar={variant === "tab"}
    >
      {children}
    </ScreenFrame>
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
    return frame(
      <View style={styles.skeletonWrap}>
        <Skeleton height={140} />
        <Skeleton height={48} />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={104} />
        ))}
      </View>,
    );
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

  if (!canReadMatrix) {
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

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="fees-error"
      />,
    );
  }

  if (list.isPending && !list.data) {
    return frame(
      <View style={styles.skeletonWrap}>
        <Skeleton height={140} />
        <Skeleton height={48} />
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={104} />
        ))}
      </View>,
    );
  }

  return frame(
    <View style={styles.body}>
      <Card style={styles.summary}>
        <ThemedText variant="sectionLabel">
          {copy.fees.dues.summaryLabel} ·{" "}
          {copy.fees.dues.students(totals?.studentCount ?? 0)}
        </ThemedText>
        <ThemedText
          variant="hero"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
          testID="fees-outstanding"
        >
          {formatMoney(outstanding)}
        </ThemedText>
        <View style={styles.summaryFacts}>
          <ThemedText variant="meta">
            {copy.fees.dues.assessed} {formatMoney(totals?.netAmount)}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.fees.dues.collected} {formatMoney(totals?.paidAmount)}
          </ThemedText>
        </View>
        {isPositiveMoney(carriedForward) ? (
          <ThemedText variant="meta">
            {copy.fees.desk.includesOpening(formatMoney(carriedForward))}
          </ThemedText>
        ) : null}
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          accessibilityLabel={copy.fees.desk.progress(percent)}
        >
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <ThemedText variant="meta">
          {copy.fees.desk.progress(percent)}
        </ThemedText>
      </Card>

      <SegmentBar
        label={copy.fees.title}
        value={view}
        options={VIEW_OPTIONS}
        onChange={(next) => {
          setView(next);
          setPage(1);
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
          placeholder={copy.fees.dues.searchPlaceholder}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={copy.fees.dues.searchPlaceholder}
          accessibilityHint={copy.fees.dues.searchHint}
          style={styles.searchInput}
          testID="fees-search"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.fees.dues.clearSearch}
            hitSlop={8}
            onPress={() => setQuery("")}
            testID="fees-search-clear"
          >
            <AppIcon name="closeCircle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {canFilter ? (
        <View style={styles.chips}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${copy.fees.dues.allClasses}: ${classLabel}`}
            accessibilityHint={copy.fees.dues.filterHint}
            onPress={() => setClassSheet(true)}
            style={({ pressed }) => [
              styles.chip,
              pressed ? styles.chipPressed : null,
            ]}
            testID="fees-class-filter"
          >
            <ThemedText variant="meta" numberOfLines={1}>
              {classLabel}
            </ThemedText>
            <AppIcon name="chevronDown" size={14} color={colors.muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${copy.fees.dues.allSections}: ${sectionLabel}`}
            accessibilityHint={copy.fees.dues.sectionHint}
            onPress={() => setSectionSheet(true)}
            style={({ pressed }) => [
              styles.chip,
              pressed ? styles.chipPressed : null,
            ]}
            testID="fees-section-filter"
          >
            <ThemedText variant="meta" numberOfLines={1}>
              {sectionLabel}
            </ThemedText>
            <AppIcon name="chevronDown" size={14} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {rows.length > 0 ? (
        <>
          <SectionHead
            title={copy.fees.title}
            hint={
              pageInfo
                ? copy.fees.dues.count(rows.length, pageInfo.total)
                : undefined
            }
          />
          <View style={styles.rows}>
            {rows.map((row) => (
              <DuesRow
                key={row.studentId}
                row={row}
                today={today}
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
        </>
      ) : filtered ? (
        <EmptyState
          icon="search"
          title={copy.fees.dues.filteredEmptyTitle}
          message={copy.fees.dues.filteredEmptyBody}
          testID="fees-filtered-empty"
        >
          <CapsuleButton
            title={copy.fees.dues.clearFilters}
            variant="secondary"
            size="compact"
            onPress={resetFilters}
            testID="fees-clear-filters"
          />
        </EmptyState>
      ) : (
        <EmptyState
          icon="fees"
          title={copy.fees.dues.emptyTitle}
          message={copy.fees.dues.emptyBody}
          testID="fees-empty"
        >
          {canSetup ? (
            <CapsuleButton
              title={copy.fees.dues.emptyAction}
              icon="settings"
              variant="secondary"
              size="compact"
              onPress={() => router.push("/fees/setup")}
              testID="fees-empty-setup"
            />
          ) : null}
        </EmptyState>
      )}

      {pageInfo && pageInfo.totalPages > 1 ? (
        <View style={styles.pager}>
          <CapsuleButton
            title="Previous"
            variant="secondary"
            size="mini"
            disabled={!pageInfo.hasPreviousPage}
            onPress={() => setPage((current) => Math.max(1, current - 1))}
            testID="fees-prev-page"
          />
          <ThemedText variant="meta">{`${pageInfo.page} / ${pageInfo.totalPages}`}</ThemedText>
          <CapsuleButton
            title="Next"
            variant="secondary"
            size="mini"
            disabled={!pageInfo.hasNextPage}
            onPress={() => setPage((current) => current + 1)}
            testID="fees-next-page"
          />
        </View>
      ) : null}

      <ChoiceSheet
        visible={classSheet}
        title={copy.fees.dues.allClasses}
        options={[
          { id: "", label: copy.fees.dues.allClasses },
          ...(classes.data ?? []).map((row) => ({
            id: row.id,
            label: row.name,
          })),
        ]}
        currentId={classId ?? ""}
        onSelect={(id) => {
          setClassId(id || null);
          setSectionId(null);
          setPage(1);
          setClassSheet(false);
        }}
        onDismiss={() => setClassSheet(false)}
        testIDPrefix="fees-class"
      />

      <ChoiceSheet
        visible={sectionSheet}
        title={copy.fees.dues.allSections}
        options={[
          { id: "", label: copy.fees.dues.allSections },
          ...sectionOptions,
        ]}
        currentId={sectionId ?? ""}
        onSelect={(id) => {
          setSectionId(id || null);
          setPage(1);
          setSectionSheet(false);
        }}
        onDismiss={() => setSectionSheet(false)}
        testIDPrefix="fees-section"
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
  summary: {
    gap: spacing.xs,
  },
  summaryFacts: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  track: {
    height: 8,
    marginTop: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
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
    fontFamily: fontFamily.regular,
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
  chipPressed: {
    backgroundColor: colors.field,
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
});

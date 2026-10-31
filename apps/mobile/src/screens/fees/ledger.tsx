import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { ChoiceSheet } from "../../components/choice-sheet";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import {
  useBranchMeta,
  useActiveContext,
} from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import {
  LEDGER_TYPE_LABEL,
  ledgerTotals,
  ledgerTypeLabel,
} from "../../lib/fees";
import { formatMoney, parseMoney } from "../../lib/money";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { LedgerRow } from "./ledger-row";
import { SectionHead } from "./status";

const ALL_TYPES = "all";

/**
 * The session's financial ledger (Step 5D), optionally scoped to one student.
 *
 * Append-only server truth: this screen offers no edit, no delete and no
 * retry-a-transition — corrections arrive as offsetting rows. Credits read as
 * money in and debits as money out, matching the web console's vocabulary.
 * The summary describes the rows currently shown, so filtering the type
 * re-reads the same three figures over a smaller set.
 *
 * `ledger.list` joins no student names (documented gap), so the session view
 * identifies a row by its type, description and receipt number. The student
 * view is opened from the desk with the name in the route.
 */
export function LedgerScreen() {
  const { organizationId, academicYear, yearPending, ready } =
    useActiveContext();
  const branchName = useBranchMeta();
  const params = useLocalSearchParams<{
    studentId?: string;
    studentName?: string;
  }>();
  const { has } = usePermissions();

  const canRead = has("fee_report:read");
  const studentId =
    typeof params.studentId === "string" && params.studentId.length > 0
      ? params.studentId
      : undefined;
  const studentName =
    typeof params.studentName === "string" && params.studentName.length > 0
      ? params.studentName
      : null;

  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [sheetOpen, setSheetOpen] = useState(false);

  const list = trpc.fees.ledger.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      studentId,
    },
    {
      enabled:
        ready &&
        canRead &&
        Boolean(organizationId) &&
        Boolean(academicYear?.id),
    },
  );

  const all = useMemo(
    () =>
      [...(list.data ?? [])].sort(
        (left, right) =>
          right.transactionDate.localeCompare(left.transactionDate) ||
          right.id.localeCompare(left.id),
      ),
    [list.data],
  );

  const typeOptions = useMemo(() => {
    const present = new Set<string>(all.map((row) => row.transactionType));
    return Object.keys(LEDGER_TYPE_LABEL)
      .filter((type) => present.has(type))
      .map((type) => ({ id: type, label: ledgerTypeLabel(type) }));
  }, [all]);

  const rows = useMemo(
    () =>
      typeFilter === ALL_TYPES
        ? all
        : all.filter((row) => row.transactionType === typeFilter),
    [all, typeFilter],
  );

  const totals = useMemo(() => ledgerTotals(rows), [rows]);
  const filtered = typeFilter !== ALL_TYPES;
  const netNegative = (parseMoney(totals.net) ?? 0n) < 0n;

  const filterLabel = filtered
    ? ledgerTypeLabel(typeFilter)
    : copy.fees.ledger.filterAll;

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.fees.ledger.title}
      meta={
        studentName
          ? copy.fees.ledger.studentMeta(studentName)
          : list.data
            ? copy.fees.ledger.meta(all.length)
            : branchName
      }
      backAccessibilityLabel={copy.common.back}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
      titleTestID="fee-ledger-title"
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.fees.ledger.deniedTitle}
        message={copy.fees.ledger.deniedBody}
        testID="fee-ledger-denied"
      />,
    );
  }

  if (!ready || yearPending) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={132} />
        <Skeleton height={44} />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={84} />
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
        testID="fee-ledger-no-branch"
      />,
    );
  }

  if (!academicYear) {
    return frame(
      <EmptyState
        icon="calendar"
        title={copy.fees.ledger.noYearTitle}
        message={copy.fees.ledger.noYearBody}
        testID="fee-ledger-no-year"
      />,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="fee-ledger-error"
      />,
    );
  }

  if (list.isPending && !list.data) {
    return frame(
      <View style={styles.skeletons}>
        <Skeleton height={132} />
        <Skeleton height={44} />
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} height={84} />
        ))}
      </View>,
    );
  }

  if (all.length === 0) {
    return frame(
      <EmptyState
        icon="ledger"
        title={copy.fees.ledger.emptyTitle}
        message={copy.fees.ledger.emptyBody}
        testID="fee-ledger-empty"
      />,
    );
  }

  return frame(
    <View style={styles.body}>
      <Card style={styles.summary}>
        <View style={styles.summaryRow}>
          <ThemedText variant="meta">{copy.fees.ledger.summaryIn}</ThemedText>
          <ThemedText variant="bodyStrong" color={colors.tone.positive.fg}>
            {formatMoney(totals.credit)}
          </ThemedText>
        </View>
        <View style={styles.summaryRow}>
          <ThemedText variant="meta">{copy.fees.ledger.summaryOut}</ThemedText>
          <ThemedText variant="bodyStrong" color={colors.tone.critical.fg}>
            {formatMoney(totals.debit)}
          </ThemedText>
        </View>
        <View style={[styles.summaryRow, styles.netRow]}>
          <ThemedText variant="bodyStrong">
            {copy.fees.ledger.summaryNet}
          </ThemedText>
          <ThemedText
            variant="title"
            color={netNegative ? colors.tone.caution.fg : colors.ink}
            numberOfLines={1}
            maxFontSizeMultiplier={1.15}
            testID="fee-ledger-net"
          >
            {formatMoney(totals.net)}
          </ThemedText>
        </View>
      </Card>

      <View style={styles.filterRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${copy.fees.ledger.filterTitle}: ${filterLabel}`}
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [
            styles.chip,
            pressed ? styles.chipPressed : null,
          ]}
          testID="fee-ledger-filter"
        >
          <AppIcon name="filter" size={16} color={colors.muted} />
          <ThemedText variant="meta" numberOfLines={1}>
            {filterLabel}
          </ThemedText>
          <AppIcon name="chevronDown" size={14} color={colors.muted} />
        </Pressable>
        {filtered ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.fees.ledger.clearFilter}
            hitSlop={8}
            onPress={() => setTypeFilter(ALL_TYPES)}
            style={({ pressed }) => [
              styles.clear,
              pressed ? styles.chipPressed : null,
            ]}
            testID="fee-ledger-filter-clear"
          >
            <AppIcon name="close" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {rows.length === 0 ? (
        <EmptyState
          icon="search"
          title={copy.fees.ledger.filteredEmptyTitle}
          message={copy.fees.ledger.filteredEmptyBody}
          testID="fee-ledger-filtered-empty"
        />
      ) : (
        <>
          <SectionHead
            title={copy.fees.ledger.title}
            hint={copy.fees.ledger.count(rows.length, all.length)}
          />
          <Card padless>
            {rows.map((row, index) => (
              <LedgerRow key={row.id} row={row} first={index === 0} />
            ))}
          </Card>
        </>
      )}

      <ThemedText variant="caption" style={styles.readOnly}>
        {copy.fees.ledger.readOnly}
      </ThemedText>

      <ChoiceSheet
        visible={sheetOpen}
        title={copy.fees.ledger.filterTitle}
        options={[
          { id: ALL_TYPES, label: copy.fees.ledger.filterAll },
          ...typeOptions,
        ]}
        currentId={typeFilter}
        onSelect={(next) => {
          setTypeFilter(next);
          setSheetOpen(false);
        }}
        onDismiss={() => setSheetOpen(false)}
        testIDPrefix="fee-ledger-type"
      />
    </View>,
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  summary: {
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  netRow: {
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipPressed: {
    backgroundColor: colors.field,
  },
  clear: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  readOnly: {
    paddingHorizontal: spacing.xs,
  },
});

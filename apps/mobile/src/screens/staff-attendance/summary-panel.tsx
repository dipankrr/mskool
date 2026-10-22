import { memo, useMemo } from "react";
import { FlatList, ScrollView, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { Avatar } from "../../components/avatar";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { useTabBarSpace } from "../../components/tab-bar";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import type { Tone } from "../../theme/brand-admin";
import { gutter, radius, spacing } from "../../theme/tokens";
import type { RosterEntry } from "./roster";
import { statusTone } from "./status-meta";
import {
  averagePercent,
  coveragePercent,
  formatPercent,
  sectionTotals,
  summaryByStudent,
} from "./summary";
import type { SummaryRow as SummaryRowData } from "./summary";
import { useSectionRoster } from "./use-section-roster";

const RowSeparator = () => <View style={styles.separator} />;

/** One tinted fragment of a row's meta line ("3 present", "2 absent"). */
type MetaPart = { text: string; tone: Tone };

/**
 * One summary line: the same anatomy as a roster row (avatar, name, meta,
 * right capsule) minus the interaction — there is nothing to tap here, so
 * nothing looks tappable. The server's `attendancePercentage` string renders
 * as-is through `formatPercent`; the meta line names the non-zero day
 * buckets, each fragment in its status tone (the same information colour
 * the marking rows wear), so a clean student reads `42 present` in emerald
 * rather than a misleading `3/311 days` numerator against the year's plan.
 * Meta wraps to two lines instead of truncating — a hidden bucket would be
 * a lie of omission on a report.
 */
const SummaryRow = memo(function SummaryRow({
  entry,
  row,
  style,
}: {
  entry: RosterEntry;
  row: SummaryRowData | null;
  style?: StyleProp<ViewStyle>;
}) {
  const percent = row ? formatPercent(row.attendancePercentage) : null;
  const parts: MetaPart[] = row
    ? [
        row.daysPresent > 0
          ? {
              text: copy.attendance.summary.present(row.daysPresent),
              tone: statusTone.present,
            }
          : null,
        row.daysAbsent > 0
          ? {
              text: copy.attendance.summary.absent(row.daysAbsent),
              tone: statusTone.absent,
            }
          : null,
        row.daysLate > 0
          ? {
              text: copy.attendance.summary.late(row.daysLate),
              tone: statusTone.late,
            }
          : null,
        row.daysOnLeave > 0
          ? {
              text: copy.attendance.summary.onLeave(row.daysOnLeave),
              tone: statusTone.on_leave,
            }
          : null,
      ].filter((part): part is MetaPart => part !== null)
    : [];
  // A row that exists but fills no bucket still needs a line of its own.
  if (row && parts.length === 0) {
    parts.push({ text: copy.attendance.summary.present(0), tone: "neutral" });
  }

  return (
    <View
      testID={`summary-row-${entry.studentId}`}
      accessible
      accessibilityLabel={
        row && percent
          ? copy.attendance.summary.a11y.row(
              entry.name,
              parts.map((part) => part.text).join(", "),
              percent,
            )
          : copy.attendance.summary.a11y.none(entry.name)
      }
      style={[styles.row, style]}
    >
      <Avatar name={entry.name} />
      <View style={styles.rowText}>
        <ThemedText variant="name" numberOfLines={1}>
          {entry.name}
        </ThemedText>
        <ThemedText variant="meta" numberOfLines={2}>
          {row
            ? parts.map((part, index) => (
                <ThemedText
                  key={`${part.text}-${index}`}
                  variant="meta"
                  color={colors.tone[part.tone].fg}
                >
                  {index > 0 ? " · " : ""}
                  {part.text}
                </ThemedText>
              ))
            : copy.attendance.summary.noneYet}
        </ThemedText>
      </View>
      {percent ? (
        <StatusPill
          label={percent}
          tone="neutral"
          testID={`summary-percent-${entry.studentId}`}
        />
      ) : null}
    </View>
  );
});

/**
 * The summary panel (chunk 2): the section's year so far, straight from
 * `attendance.summary` — annual rows when they exist, the term fallback
 * otherwise, monthly never (the register's job). The year card carries the
 * two headline facts in reading order — the average (hero number) and the
 * coverage bar (days marked against the planned working days) — then the
 * list repeats the marking screen's roll order with every day bucket in its
 * status tone, so the same eyes find the same student and the same colours
 * in the same place. A caution line appears only when someone in the roster
 * has no data at all.
 *
 * `visible` gates the query only; the component stays mounted while the
 * marking panel is on screen so switching panels never refetches from zero.
 */
export function SummaryPanel({
  sectionId,
  visible,
}: {
  sectionId: string;
  visible: boolean;
}) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const tabSpace = useTabBarSpace();
  const { roster, query: enrollmentsQuery } = useSectionRoster(sectionId);
  const ready = Boolean(organizationId && academicYear);

  const summaryQuery = trpc.attendance.summary.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      sectionId,
    },
    { enabled: ready && visible, staleTime: 60_000 },
  );

  const byStudent = useMemo(
    () => summaryByStudent(summaryQuery.data ?? []),
    [summaryQuery.data],
  );
  const totals = useMemo(
    () => sectionTotals(byStudent, roster.map((entry) => entry.studentId)),
    [byStudent, roster],
  );
  const average = averagePercent(totals);

  const isPending = enrollmentsQuery.isPending || summaryQuery.isPending;
  const isError = enrollmentsQuery.isError || summaryQuery.isError;
  const retry = () => {
    if (enrollmentsQuery.isError) void enrollmentsQuery.refetch();
    if (summaryQuery.isError) void summaryQuery.refetch();
  };

  if (isPending) {
    return (
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        <Skeleton width={160} height={22} />
        <Skeleton height={164} style={styles.skeletonCard} />
        <View style={styles.skeletonRows}>
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      </ScrollView>
    );
  }

  if (isError) {
    return (
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        <ErrorCard
          cause={enrollmentsQuery.error ?? summaryQuery.error}
          onRetry={retry}
          testID="summary-error"
        />
      </ScrollView>
    );
  }

  if (roster.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
      >
        <EmptyState
          icon="students"
          title={copy.attendance.marking.rosterEmptyTitle}
          message={copy.attendance.marking.rosterEmptyBody}
          testID="summary-empty"
        />
      </ScrollView>
    );
  }

  return (
    <FlatList
      testID="summary-list"
      data={roster}
      keyExtractor={(entry) => entry.studentId}
      renderItem={({ item, index }) => (
        <SummaryRow
          entry={item}
          row={byStudent.get(item.studentId) ?? null}
          style={[
            index === 0 ? styles.rowFirst : null,
            index === roster.length - 1 ? styles.rowLast : null,
          ]}
        />
      )}
      ItemSeparatorComponent={RowSeparator}
      ListHeaderComponent={
        <View>
          <ThemedText variant="subtitle">
            {academicYear ? `${academicYear.name} · ` : ""}
            {copy.attendance.studentsCount(roster.length)}
          </ThemedText>
          <Card style={styles.yearCard} testID="summary-year-card">
            <ThemedText variant="sectionLabel">
              {copy.attendance.summary.yearLabel}
            </ThemedText>
            <ThemedText
              variant="hero"
              style={styles.heroValue}
              testID="summary-hero"
            >
              {average === null
                ? copy.attendance.summary.noValue
                : formatPercent(average)}
            </ThemedText>
            <ThemedText variant="meta">
              {copy.attendance.summary.averageLabel}
            </ThemedText>
            <View
              style={styles.coverageTrack}
              testID="summary-coverage-track"
            >
              <View
                style={[
                  styles.coverageFill,
                  { width: `${Number(coveragePercent(totals).toFixed(1))}%` },
                ]}
              />
            </View>
            <ThemedText variant="meta" testID="summary-coverage-line">
              {totals.workingDays === null || totals.workingDays <= 0
                ? copy.attendance.summary.noCoverageYet
                : copy.attendance.summary.coverage(
                    totals.markedDays,
                    totals.workingDays,
                  )}
            </ThemedText>
            <ThemedText variant="meta" style={styles.cardFootnote}>
              {copy.attendance.summary.footnote}
            </ThemedText>
          </Card>
          {totals.noData > 0 ? (
            <ThemedText
              variant="caption"
              color={colors.tone.caution.fg}
              style={styles.noDataLine}
              testID="summary-no-data-line"
            >
              {copy.attendance.summary.noDataLine(totals.noData)}
            </ThemedText>
          ) : null}
          <SectionLabel style={styles.studentsLabel}>
            {copy.attendance.summary.studentsLabel}
          </SectionLabel>
        </View>
      }
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingTop: spacing.md,
        paddingBottom: tabSpace,
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
  },
  yearCard: {
    marginTop: spacing.lg,
  },
  heroValue: {
    marginTop: spacing.md,
  },
  coverageTrack: {
    marginTop: spacing.lg,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  coverageFill: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  noDataLine: {
    marginTop: spacing.sm,
  },
  studentsLabel: {
    marginBottom: spacing.md,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: 68,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  rowFirst: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  rowLast: {
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  rowText: {
    flex: 1,
  },
  cardFootnote: {
    marginTop: spacing.sm,
  },
  skeletonCard: {
    marginTop: spacing.lg,
  },
  skeletonRows: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
});

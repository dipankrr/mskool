import { memo, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { Avatar } from "../../components/avatar";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StatusMeter } from "../../components/status-meter";
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
import { StudentSummarySheet } from "./student-summary-sheet";
import { SummaryInfoSheet } from "./summary-info-sheet";
import {
  averagePercent,
  coveragePercent,
  formatPercent,
  markedDaysForRow,
  presentSharePercentForTotals,
  sectionTotals,
  sortSummaryRoster,
  summaryByStudent,
} from "./summary";
import type { SummaryRow as SummaryRowData, SummarySort } from "./summary";
import { useSectionRoster } from "./use-section-roster";

const RowSeparator = () => <View style={styles.separator} />;

const SORTS: readonly { key: SummarySort; label: string }[] = [
  { key: "roll", label: copy.attendance.summary.sortRoll },
  { key: "top", label: copy.attendance.summary.sortTop },
  { key: "mostAbsent", label: copy.attendance.summary.sortMostAbsent },
];

/** One tinted fragment of a row's meta line ("3P", "2A"). */
type MetaPart = { text: string; a11y: string; tone: Tone };

/**
 * One summary line: avatar, name, bucket meta, a stacked bar scaled to the
 * student's marked days, and the operational `present / marked` count. It is
 * a button now — the year's numbers are too dense to explain in a row, so
 * the detail sheet carries the official rate and coverage. The meta line
 * keeps every non-zero bucket in its status tone as a compact key
 * (`2P 1A 1L 1H 1OL`), and wraps rather than hides one.
 */
const SummaryLine = memo(function SummaryLine({
  entry,
  row,
  onPress,
  style,
}: {
  entry: RosterEntry;
  row: SummaryRowData | null;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const marked = row ? markedDaysForRow(row) : 0;
  const presentOfMarked =
    row && marked > 0
      ? copy.attendance.summary.presentOfMarked(row.daysPresent, marked)
      : copy.attendance.summary.noValue;
  const parts: MetaPart[] = row
    ? [
        row.daysPresent > 0
          ? {
              text: copy.attendance.summary.shortCount.present(row.daysPresent),
              a11y: copy.attendance.summary.present(row.daysPresent),
              tone: statusTone.present,
            }
          : null,
        row.daysAbsent > 0
          ? {
              text: copy.attendance.summary.shortCount.absent(row.daysAbsent),
              a11y: copy.attendance.summary.absent(row.daysAbsent),
              tone: statusTone.absent,
            }
          : null,
        row.daysLate > 0
          ? {
              text: copy.attendance.summary.shortCount.late(row.daysLate),
              a11y: copy.attendance.summary.late(row.daysLate),
              tone: statusTone.late,
            }
          : null,
        row.daysHalfDay > 0
          ? {
              text: copy.attendance.summary.shortCount.halfDay(row.daysHalfDay),
              a11y: copy.attendance.summary.halfDay(row.daysHalfDay),
              tone: statusTone.half_day,
            }
          : null,
        row.daysOnLeave > 0
          ? {
              text: copy.attendance.summary.shortCount.onLeave(row.daysOnLeave),
              a11y: copy.attendance.summary.onLeave(row.daysOnLeave),
              tone: statusTone.on_leave,
            }
          : null,
      ].filter((part): part is MetaPart => part !== null)
    : [];
  if (row && parts.length === 0) {
    parts.push({
      text: copy.attendance.summary.shortCount.present(0),
      a11y: copy.attendance.summary.present(0),
      tone: "neutral",
    });
  }

  return (
    <Pressable
      testID={`summary-row-${entry.studentId}`}
      accessibilityRole="button"
      accessibilityLabel={
        row
          ? copy.attendance.summary.a11y.row(
              entry.name,
              parts.map((part) => part.a11y).join(", "),
              presentOfMarked,
            )
          : copy.attendance.summary.a11y.none(entry.name)
      }
      accessibilityHint={copy.attendance.summary.a11y.rowHint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, style, pressed ? styles.rowPressed : null]}
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
                  {index > 0 ? " " : ""}
                  {part.text}
                </ThemedText>
              ))
            : copy.attendance.summary.noneYet}
        </ThemedText>
        {row ? (
          <StatusMeter
            height={8}
            style={styles.rowMeter}
            segments={[
              { key: "present", value: row.daysPresent, tone: "positive" },
              { key: "absent", value: row.daysAbsent, tone: "critical" },
              { key: "late", value: row.daysLate, tone: "caution" },
              {
                key: "half_day",
                value: row.daysHalfDay,
                tone: "caution",
                opacity: 0.55,
              },
              { key: "on_leave", value: row.daysOnLeave, tone: "neutral" },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <ThemedText
          variant="bodyStrong"
          style={styles.rowCount}
          testID={`summary-percent-${entry.studentId}`}
        >
          {presentOfMarked}
        </ThemedText>
        <AppIcon name="chevronRight" size={16} color={colors.chevron} />
      </View>
    </Pressable>
  );
});

/**
 * The summary panel: coverage first, then the operational status mix, then
 * the roster. The official annual rate is still present because exam
 * eligibility reads it, but it no longer owns the whole card — at 6 of 311
 * days a 1.2% hero is technically true and practically useless. A student
 * row opens the detail sheet instead of squeezing every number into 56 dp.
 */
export function SummaryPanel({
  sectionId,
  visible,
  onStartMarking,
}: {
  sectionId: string;
  visible: boolean;
  onStartMarking?: () => void;
}) {
  const { organizationId, schoolId, academicYear } = useActiveContext();
  const tabSpace = useTabBarSpace();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.2;
  const { roster, query: enrollmentsQuery } = useSectionRoster(sectionId);
  const ready = Boolean(organizationId && academicYear);
  const [infoOpen, setInfoOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<SummarySort>("roll");

  const summaryQuery = trpc.attendance.summary.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
      academicYearId: academicYear?.id ?? "",
      sectionId,
    },
    { enabled: ready && visible, staleTime: 60_000 },
  );

  const byStudent = useMemo(() => summaryByStudent(summaryQuery.data ?? []), [summaryQuery.data]);
  const totals = useMemo(
    () =>
      sectionTotals(
        byStudent,
        roster.map((entry) => entry.studentId),
      ),
    [byStudent, roster],
  );
  const average = averagePercent(totals);
  const coverage = coveragePercent(totals);
  const coverageRatio =
    totals.workingDays !== null && totals.workingDays > 0
      ? (totals.markedDays / totals.workingDays) * 100
      : null;
  const presentShare = presentSharePercentForTotals(totals);
  const sortedRoster = useMemo(
    () => sortSummaryRoster(roster, byStudent, sort),
    [roster, byStudent, sort],
  );
  const selectedEntry =
    selectedId === null ? null : (roster.find((entry) => entry.studentId === selectedId) ?? null);
  const selectedRow = selectedId ? (byStudent.get(selectedId) ?? null) : null;

  const isPending = enrollmentsQuery.isPending || summaryQuery.isPending;
  const isError = enrollmentsQuery.isError || summaryQuery.isError;
  const retry = () => {
    if (enrollmentsQuery.isError) void enrollmentsQuery.refetch();
    if (summaryQuery.isError) void summaryQuery.refetch();
  };

  if (isPending) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
        <Skeleton width={160} height={22} />
        <Skeleton height={224} style={styles.skeletonCard} />
        <Skeleton height={56} style={styles.skeletonCard} />
        <View style={styles.skeletonRows}>
          <Skeleton height={68} />
          <Skeleton height={68} />
          <Skeleton height={68} />
          <Skeleton height={68} />
        </View>
      </ScrollView>
    );
  }

  if (isError) {
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}>
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
    <>
      <FlatList
        testID="summary-list"
        data={sortedRoster}
        keyExtractor={(entry) => entry.studentId}
        extraData={sort}
        renderItem={({ item, index }) => (
          <SummaryLine
            entry={item}
            row={byStudent.get(item.studentId) ?? null}
            onPress={() => setSelectedId(item.studentId)}
            style={[
              index === 0 ? styles.rowFirst : null,
              index === sortedRoster.length - 1 ? styles.rowLast : null,
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
              <View style={styles.cardHead}>
                <SectionLabel style={styles.cardLabel}>
                  {copy.attendance.summary.yearLabel}
                </SectionLabel>
                <Pressable
                  testID="summary-how"
                  accessibilityRole="button"
                  accessibilityLabel={copy.attendance.summary.howCalculated}
                  onPress={() => setInfoOpen(true)}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.infoButton,
                    pressed ? styles.infoPressed : null,
                  ]}
                >
                  <AppIcon name="info" size={22} color={colors.accentDeep} />
                </Pressable>
              </View>

              <View style={styles.coverageHero}>
                <ThemedText variant="hero" style={styles.heroValue} testID="summary-hero">
                  {coverageRatio === null
                    ? copy.attendance.summary.noValue
                    : formatPercent(coverageRatio)}
                </ThemedText>
                <View style={styles.coverageCopy}>
                  <ThemedText variant="bodyStrong">
                    {copy.attendance.summary.coverageLabel}
                  </ThemedText>
                  <ThemedText variant="meta" testID="summary-coverage-line">
                    {totals.workingDays === null || totals.workingDays <= 0
                      ? copy.attendance.summary.noCoverageYet
                      : copy.attendance.summary.coverageOf(
                          totals.markedDays,
                          totals.workingDays,
                        )}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.coverageTrack} testID="summary-coverage-track">
                <View style={[styles.coverageFill, { width: `${coverage}%` }]} />
              </View>

              <View style={styles.rateTiles}>
                <View style={styles.rateTile}>
                  <ThemedText variant="caption" color={colors.muted}>
                    {copy.attendance.summary.officialRateLabel}
                  </ThemedText>
                  <ThemedText
                    variant="title"
                    color={colors.accentDeep}
                    style={styles.rateValue}
                    testID="summary-official-rate"
                  >
                    {average === null
                      ? copy.attendance.summary.noValue
                      : formatPercent(average)}
                  </ThemedText>
                </View>
                <View style={styles.rateTile}>
                  <ThemedText variant="caption" color={colors.muted}>
                    {copy.attendance.summary.presentShareLabel}
                  </ThemedText>
                  <ThemedText
                    variant="title"
                    style={styles.rateValue}
                    testID="summary-present-share"
                  >
                    {presentShare === null
                      ? copy.attendance.summary.noValue
                      : formatPercent(presentShare)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText variant="meta" style={styles.rateNote}>
                {copy.attendance.summary.officialRateNote}
              </ThemedText>

              <View style={styles.statusCards} testID="summary-status-strip">
                <View style={[styles.statusRow, largeText ? styles.statusRowLarge : null]}>
                  <StatusCount
                    dense={largeText}
                    value={totals.present}
                    label={copy.attendance.marking.statuses.present}
                    tone={statusTone.present}
                  />
                  <StatusCount
                    dense={largeText}
                    value={totals.absent}
                    label={copy.attendance.marking.statuses.absent}
                    tone={statusTone.absent}
                  />
                  <StatusCount
                    dense={largeText}
                    value={totals.late}
                    label={copy.attendance.marking.statuses.late}
                    tone={statusTone.late}
                  />
                  <StatusCount
                    dense={largeText}
                    value={totals.halfDay}
                    label={copy.attendance.marking.statuses.half_day}
                    tone={statusTone.half_day}
                  />
                  <StatusCount
                    dense={largeText}
                    value={totals.onLeave}
                    label={copy.attendance.marking.statuses.on_leave}
                    tone={statusTone.on_leave}
                  />
                </View>
              </View>
            </Card>

            {totals.markedDays === 0 && onStartMarking ? (
              <Card style={styles.startCard}>
                <View style={styles.startCopy}>
                  <ThemedText variant="bodyStrong">
                    {copy.attendance.summary.noMarksTitle}
                  </ThemedText>
                  <ThemedText variant="meta">{copy.attendance.summary.noMarksBody}</ThemedText>
                </View>
                <CapsuleButton
                  title={copy.attendance.summary.markToday}
                  size="compact"
                  onPress={onStartMarking}
                  testID="summary-start-marking"
                />
              </Card>
            ) : null}

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
            <View style={styles.sortRow} testID="summary-sort">
              {SORTS.map((option) => {
                const active = sort === option.key;
                return (
                  <Pressable
                    key={option.key}
                    testID={`summary-sort-${option.key}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={option.label}
                    onPress={() => setSort(option.key)}
                    style={({ pressed }) => [
                      styles.sortChip,
                      active ? styles.sortChipActive : null,
                      pressed ? styles.sortChipPressed : null,
                    ]}
                  >
                    <ThemedText
                      variant="caption"
                      color={active ? colors.accentDeep : colors.muted}
                    >
                      {option.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: spacing.md,
          paddingBottom: tabSpace,
        }}
      />

      <SummaryInfoSheet visible={infoOpen} onDismiss={() => setInfoOpen(false)} />
      <StudentSummarySheet
        sectionId={sectionId}
        entry={selectedEntry}
        row={selectedRow}
        visible={selectedEntry !== null}
        onDismiss={() => setSelectedId(null)}
      />
    </>
  );
}

function StatusCount({
  dense,
  value,
  label,
  tone,
}: {
  dense: boolean;
  value: number;
  label: string;
  tone: Tone;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${value} ${label.toLowerCase()}`}
      style={[
        styles.statusCell,
        { backgroundColor: colors.tone[tone].bg },
        dense ? styles.statusCellLarge : null,
      ]}
    >
      <ThemedText variant="numeric" color={colors.tone[tone].fg}>
        {value}
      </ThemedText>
      <ThemedText variant="caption" color={colors.muted} numberOfLines={2}>
        {label}
      </ThemedText>
    </View>
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
  cardHead: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLabel: {
    marginTop: 0,
  },
  infoButton: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -spacing.sm,
    marginRight: -spacing.sm,
  },
  infoPressed: {
    backgroundColor: colors.field,
  },
  coverageHero: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  heroValue: {
    fontVariant: ["tabular-nums"],
  },
  coverageCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  coverageTrack: {
    marginTop: spacing.md,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.field,
    overflow: "hidden",
  },
  coverageFill: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  rateTiles: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rateTile: {
    flex: 1,
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  rateValue: {
    fontVariant: ["tabular-nums"],
  },
  rateNote: {
    marginTop: spacing.sm,
  },
  statusCards: {
    marginTop: spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  statusRowLarge: {
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  statusCell: {
    flex: 1,
    gap: spacing.xxs,
    minHeight: 72,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  statusCellLarge: {
    flexBasis: "28%",
    flexGrow: 1,
    flexShrink: 0,
  },
  startCard: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  startCopy: {
    gap: spacing.xxs,
  },
  noDataLine: {
    marginTop: spacing.sm,
  },
  studentsLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  sortChip: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  sortChipActive: {
    borderColor: colors.accentTint,
    backgroundColor: colors.accentTint,
  },
  sortChipPressed: {
    opacity: 0.7,
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
    minHeight: 68,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
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
    gap: spacing.xxs,
  },
  rowMeter: {
    marginTop: spacing.xxs,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  rowCount: {
    fontVariant: ["tabular-nums"],
  },
  skeletonCard: {
    marginTop: spacing.lg,
  },
  skeletonRows: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
});

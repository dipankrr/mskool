import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { formatReadableDate } from "../../lib/format";
import { dayKeyOf } from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { SegmentBar } from "./segments";
import type { SegmentOption } from "./segments";
import type { RubricRow } from "./types";

type RubricFilter = "all" | "active" | "retired";

const FILTER_OPTIONS: readonly SegmentOption<RubricFilter>[] = [
  {
    value: "all",
    label: copy.homework.rubrics.filterAll,
    testID: "homework-rubrics-filter-all",
  },
  {
    value: "active",
    label: copy.homework.rubrics.filterActive,
    testID: "homework-rubrics-filter-active",
  },
  {
    value: "retired",
    label: copy.homework.rubrics.filterRetired,
    testID: "homework-rubrics-filter-retired",
  },
];

/**
 * The branch's rubrics, seen by a teacher.
 *
 * The list is a library: a rubric is created once and attached to graded work,
 * so rows are scanned by name and read for their status. There are deliberately
 * no criteria counts here — the list read model carries no aggregate, and
 * inventing one client-side would mean N detail fetches for a screen nobody
 * asked to be slow. The count lives on the rubric's own page.
 *
 * Retired rubrics stay in the list (and on the homework that already uses
 * them); the segment is how a teacher finds one to bring back.
 */
export function HomeworkRubricsScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("school_settings:read");
  const canWrite = has("school_settings:update");

  const [filter, setFilter] = useState<RubricFilter>("all");

  const list = trpc.homework.rubrics.list.useQuery(
    {
      organizationId: organizationId ?? "",
      ...(schoolId ? { schoolId } : {}),
    },
    { enabled: ready && canRead && Boolean(organizationId) },
  );

  const rows = useMemo<RubricRow[]>(() => list.data ?? [], [list.data]);

  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        filter === "all"
          ? true
          : filter === "active"
            ? row.isActive
            : !row.isActive,
      ),
    [rows, filter],
  );

  const newAction =
    canRead && canWrite
      ? {
          label: copy.homework.rubrics.new,
          icon: "add" as const,
          onPress: () => router.push("/homework/rubrics/new"),
          accessibilityHint: copy.homework.rubrics.newTitle,
          testID: "homework-rubrics-new",
        }
      : undefined;

  const frame = (children: React.ReactNode) => (
    <ScreenFrame
      title={copy.homework.rubrics.title}
      meta={list.isSuccess ? copy.homework.rubrics.subtitle(rows.length) : null}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-rubrics-back"
      titleTestID="homework-rubrics-title"
      action={newAction}
      onRefresh={canRead ? () => void list.refetch() : undefined}
      refreshing={list.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.homework.rubrics.noAccessTitle}
        message={copy.homework.rubrics.noAccessBody}
        testID="homework-rubrics-denied"
      />,
    );
  }

  if (list.isPending) {
    return frame(
      <View
        style={styles.skeleton}
        accessibilityLabel={copy.homework.rubrics.title}
        accessibilityLiveRegion="polite"
      >
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={104} />
        ))}
      </View>,
    );
  }

  if (list.isError) {
    return frame(
      <ErrorCard
        cause={list.error}
        onRetry={() => void list.refetch()}
        testID="homework-rubrics-error"
      />,
    );
  }

  if (rows.length === 0) {
    return frame(
      <EmptyState
        icon="rubric"
        title={copy.homework.rubrics.emptyTitle}
        message={copy.homework.rubrics.emptyBody}
        testID="homework-rubrics-empty"
      >
        {canWrite ? (
          <CapsuleButton
            title={copy.homework.rubrics.emptyAction}
            icon="add"
            onPress={() => router.push("/homework/rubrics/new")}
            testID="homework-rubrics-empty-add"
          />
        ) : null}
      </EmptyState>,
    );
  }

  return frame(
    <View style={styles.body}>
      <SegmentBar
        label={copy.homework.rubrics.title}
        value={filter}
        options={FILTER_OPTIONS}
        onChange={setFilter}
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={filter === "retired" ? "lock" : "rubric"}
          title={
            filter === "retired"
              ? copy.homework.rubrics.noRetiredTitle
              : copy.homework.rubrics.noActiveTitle
          }
          message={
            filter === "retired"
              ? copy.homework.rubrics.noRetiredBody
              : copy.homework.rubrics.noActiveBody
          }
          testID="homework-rubrics-filtered-empty"
        />
      ) : (
        <View style={styles.rows}>
          {filtered.map((row) => (
            <RubricListRow
              key={row.id}
              row={row}
              onPress={() =>
                router.push({
                  pathname: "/homework/rubrics/[rubricId]",
                  params: { rubricId: row.id },
                })
              }
            />
          ))}
        </View>
      )}
    </View>,
  );
}

function RubricListRow({
  row,
  onPress,
}: {
  row: RubricRow;
  onPress: () => void;
}) {
  const updatedDay = dayKeyOf(row.updatedAt);
  const meta = updatedDay
    ? copy.homework.rubrics.updated(formatReadableDate(updatedDay))
    : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.name}
      accessibilityHint={[row.description, meta].filter(Boolean).join(". ")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`homework-rubrics-row-${row.id}`}
    >
      <View style={styles.rowHead}>
        <ThemedText variant="name" numberOfLines={2} style={styles.rowName}>
          {row.name}
        </ThemedText>
        {row.isActive ? null : (
          <StatusPill
            label={copy.homework.rubrics.statusRetired}
            tone="neutral"
          />
        )}
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      </View>

      {row.description?.trim().length ? (
        <ThemedText variant="meta" numberOfLines={2}>
          {row.description}
        </ThemedText>
      ) : null}

      {meta ? <ThemedText variant="caption">{meta}</ThemedText> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  skeleton: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  rows: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 96,
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowName: {
    flex: 1,
  },
});

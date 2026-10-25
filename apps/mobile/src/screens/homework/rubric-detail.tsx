import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate } from "../../lib/format";
import { dayKeyOf } from "../../lib/homework";
import { trimDecimal } from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { ConfirmSheet } from "./confirm-sheet";
import type { RubricCriterionRow } from "./types";

/**
 * One rubric, read by a teacher.
 *
 * The screen is read-only on purpose: the backend has no update endpoint, so a
 * rubric is corrected by creating a new one and retiring the old. Retire is a
 * soft state (homework already using it keeps it), which is why the action
 * lives here rather than as a destructive delete.
 *
 * Levels are alternatives inside a criterion, not points to sum, so the layout
 * reads down each criterion rather than totalling the rubric.
 */
export function HomeworkRubricDetailScreen() {
  const params = useLocalSearchParams<{
    rubricId?: string;
    created?: string;
  }>();
  const rubricId = params.rubricId ?? "";
  const created = params.created === "1";

  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("school_settings:read");
  const canWrite = has("school_settings:update");

  const scopeInput = {
    organizationId: organizationId ?? "",
    ...(schoolId ? { schoolId } : {}),
  };

  const query = trpc.homework.rubrics.byId.useQuery(
    { ...scopeInput, rubricId },
    {
      enabled:
        ready && canRead && Boolean(organizationId) && Boolean(rubricId),
    },
  );

  const utils = trpc.useUtils();
  const [sheet, setSheet] = useState<"retire" | "restore" | null>(null);
  const [done, setDone] = useState<"retired" | "active" | null>(null);

  const setActive = trpc.homework.rubrics.setActive.useMutation({
    onSuccess: (row) => {
      const next = row?.isActive ?? false;
      utils.homework.rubrics.byId.setData(
        { ...scopeInput, rubricId },
        (current) => (current ? { ...current, isActive: next } : current),
      );
      void utils.homework.rubrics.list.invalidate();
      setSheet(null);
      setDone(next ? "active" : "retired");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const closeSheet = () => {
    setSheet(null);
    setActive.reset();
  };

  const text = copy.homework.rubrics;
  const rubric = query.data ?? null;

  const frame = (children: React.ReactNode) => (
    <ScreenFrame
      title={text.title}
      meta={rubric?.name ?? null}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-rubric-detail-back"
      titleTestID="homework-rubric-detail-title"
      onRefresh={canRead ? () => void query.refetch() : undefined}
      refreshing={query.isRefetching}
      footer={
        rubric && canWrite ? (
          rubric.isActive ? (
            <CapsuleButton
              title={text.retire}
              icon="lock"
              variant="destructive"
              onPress={() => {
                setDone(null);
                setSheet("retire");
              }}
              testID="homework-rubric-detail-retire"
            />
          ) : (
            <CapsuleButton
              title={text.restore}
              icon="checkCircle"
              onPress={() => {
                setDone(null);
                setSheet("restore");
              }}
              testID="homework-rubric-detail-restore"
            />
          )
        ) : undefined
      }
    >
      {children}
    </ScreenFrame>
  );

  if (!canRead) {
    return frame(
      <EmptyState
        icon="shield"
        title={text.noAccessTitle}
        message={text.noAccessBody}
        testID="homework-rubric-detail-denied"
      />,
    );
  }

  if (!rubricId) {
    return frame(
      <EmptyState
        icon="rubric"
        title={text.notFoundTitle}
        message={text.notFoundBody}
        testID="homework-rubric-detail-missing"
      />,
    );
  }

  if (query.isPending) {
    return frame(
      <View
        style={styles.skeleton}
        accessibilityLabel={text.title}
        accessibilityLiveRegion="polite"
      >
        <Skeleton height={180} />
        <Skeleton height={160} />
      </View>,
    );
  }

  if (query.isError) {
    const friendly = toFriendlyError(query.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="rubric"
          title={text.notFoundTitle}
          message={text.notFoundBody}
          testID="homework-rubric-detail-not-found"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={query.error}
        onRetry={() => void query.refetch()}
        testID="homework-rubric-detail-error"
      />,
    );
  }

  if (!rubric) {
    return frame(
      <EmptyState
        icon="rubric"
        title={text.notFoundTitle}
        message={text.notFoundBody}
        testID="homework-rubric-detail-not-found"
      />,
    );
  }

  const updatedDay = dayKeyOf(rubric.updatedAt);
  const updatedLabel = updatedDay
    ? text.updated(formatReadableDate(updatedDay))
    : null;

  return (
    <>
      {frame(
        <View style={styles.body}>
          {created ? (
            <Notice
              tone="positive"
              title={text.savedTitle}
              message={text.savedBody}
              testID="homework-rubric-detail-saved"
            />
          ) : null}

          {done === "retired" ? (
            <Notice
              tone="neutral"
              title={text.retiredTitle}
              message={text.retiredBody}
              testID="homework-rubric-detail-retired"
            />
          ) : null}

          {done === "active" ? (
            <Notice
              tone="positive"
              title={text.restoredTitle}
              message={text.restoredBody}
              testID="homework-rubric-detail-restored"
            />
          ) : null}

          {!rubric.isActive && done !== "retired" ? (
            <Notice
              tone="neutral"
              title={text.statusRetired}
              message={text.retireBody}
              testID="homework-rubric-detail-inactive"
            />
          ) : null}

          {!canWrite ? (
            <Notice
              tone="neutral"
              title={text.viewerTitle}
              message={text.viewerBody}
              testID="homework-rubric-detail-viewer"
            />
          ) : null}

          <Card style={styles.hero}>
            <View style={styles.pills}>
              <StatusPill
                label={rubric.isActive ? text.statusActive : text.statusRetired}
                tone={rubric.isActive ? "positive" : "neutral"}
              />
              <StatusPill
                label={text.criteriaCount(rubric.criteria.length)}
                tone="neutral"
              />
            </View>

            <ThemedText variant="name" selectable style={styles.name}>
              {rubric.name}
            </ThemedText>

            <ThemedText variant="body" selectable>
              {rubric.description?.trim().length
                ? rubric.description
                : text.descriptionMissing}
            </ThemedText>

            {updatedLabel ? (
              <ThemedText variant="meta">{updatedLabel}</ThemedText>
            ) : null}
          </Card>

          {rubric.criteria.length === 0 ? (
            <Notice
              tone="neutral"
              title={text.criteriaError}
              message={text.criteriaEmpty}
              testID="homework-rubric-detail-no-criteria"
            />
          ) : (
            rubric.criteria.map((criterion, index) => (
              <CriterionCard
                key={criterion.id}
                criterion={criterion}
                position={index}
              />
            ))
          )}
        </View>,
      )}

      {sheet ? (
        <ConfirmSheet
          title={sheet === "retire" ? text.retireTitle : text.restoreTitle}
          body={sheet === "retire" ? text.retireBody : text.restoreBody}
          confirmLabel={
            sheet === "retire" ? text.retireConfirm : text.restoreConfirm
          }
          keepLabel={text.keep}
          tone={sheet === "retire" ? "destructive" : "default"}
          submitting={setActive.isPending}
          error={setActive.error}
          onConfirm={() =>
            setActive.mutate({
              ...scopeInput,
              rubricId,
              isActive: sheet === "restore",
            })
          }
          onClose={closeSheet}
          testIDPrefix="homework-rubric-detail-active"
        />
      ) : null}
    </>
  );
}

function CriterionCard({
  criterion,
  position,
}: {
  criterion: RubricCriterionRow;
  position: number;
}) {
  const text = copy.homework.rubrics;

  return (
    <Card style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.position}>
          <ThemedText variant="caption" color={colors.accentDeep}>
            {position + 1}
          </ThemedText>
        </View>
        <ThemedText variant="name" style={styles.cardName}>
          {criterion.name}
        </ThemedText>
      </View>

      {criterion.description?.trim().length ? (
        <ThemedText variant="meta">{criterion.description}</ThemedText>
      ) : null}

      {criterion.levels.length === 0 ? (
        <ThemedText variant="meta">{text.noLevels}</ThemedText>
      ) : (
        <View style={styles.levels}>
          {criterion.levels.map((level) => (
            <View key={level.id} style={styles.levelBox}>
              <View style={styles.levelHead}>
                <ThemedText variant="bodyStrong" style={styles.levelName}>
                  {level.label}
                </ThemedText>
                <ThemedText variant="caption" color={colors.accentDeep}>
                  {text.points(trimDecimal(level.points))}
                </ThemedText>
              </View>
              {level.description?.trim().length ? (
                <ThemedText variant="meta">{level.description}</ThemedText>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Card>
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
  hero: {
    gap: spacing.sm,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  name: {
    marginTop: spacing.xs,
  },
  card: {
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardName: {
    flex: 1,
  },
  position: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.accentTint,
  },
  levels: {
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  levelBox: {
    gap: spacing.xxs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.field,
  },
  levelHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  levelName: {
    flex: 1,
  },
});

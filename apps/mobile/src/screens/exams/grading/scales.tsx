import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { Card } from "../../../components/card";
import { CapsuleButton } from "../../../components/capsule-button";
import { EmptyState } from "../../../components/empty-state";
import { ErrorCard } from "../../../components/error-card";
import { ScreenFrame } from "../../../components/screen-frame";
import { Skeleton } from "../../../components/skeleton";
import { ThemedText } from "../../../components/themed-text";
import { useActiveBranchName } from "../../../hooks/use-active-context";
import { copy } from "../../../lib/copy";
import { bandPhrases, bandSentence } from "../../../lib/grading-scale";
import { colors } from "../../../theme/brand-admin";
import { fontFamily, spacing, touch } from "../../../theme/tokens";
import { useExamScope } from "../use-exam-data";
import { QuietChip, SectionHead } from "./ui";
import { useGradingScalesAdmin } from "./use-grading";

type ScaleRow = inferRouterOutputs<AppRouter>["exam"]["gradingScales"]["list"][number];

/**
 * GRADING SCALES (chunk 7F) — percentage bands that become grades.
 *
 * A row states the scale in one sentence ("A1 90–100 · A2 80–90 · B 0–80")
 * rather than a table: the editor is where the detail lives. Default and
 * locked are facts, so they are quiet chips, never controls.
 */
export function GradingScalesScreen() {
  const scope = useExamScope();
  const branchName = useActiveBranchName();
  const scales = useGradingScalesAdmin();

  const rows = scales.data ?? [];

  const frame = (children: ReactNode) => (
    <ScreenFrame
      title={copy.exams.grading.scales.title}
      meta={copy.exams.meta(scope.academicYear?.name ?? null, branchName)}
      backAccessibilityLabel={copy.common.back}
      backTestID="grading-scales-back"
      titleTestID="grading-scales-title"
      action={
        scope.canCreate
          ? {
              label: copy.exams.grading.scales.add,
              icon: "add",
              onPress: () => router.push("/exams/setup/grading-scales/new"),
              testID: "grading-scales-add",
            }
          : undefined
      }
      onRefresh={
        scope.canRead && scope.addressable
          ? () => void scales.refetch()
          : undefined
      }
      refreshing={scales.isRefetching}
    >
      {children}
    </ScreenFrame>
  );

  if (!scope.canRead) {
    return frame(
      <EmptyState
        icon="lock"
        title={copy.exams.deniedTitle}
        message={copy.exams.deniedBody}
        testID="grading-scales-denied"
      />,
    );
  }

  if (!scope.ready || scales.isPending) {
    return frame(
      <View style={styles.skeletons} testID="grading-scales-loading">
        <Skeleton height={76} />
        <Skeleton height={76} />
        <Skeleton height={76} />
      </View>,
    );
  }

  if (!scope.organizationId || !scope.schoolId) {
    return frame(
      <EmptyState
        icon="school"
        title={copy.exams.grading.noBranchTitle}
        message={copy.exams.grading.noBranchBody}
        testID="grading-scales-no-branch"
      />,
    );
  }

  if (scales.isError) {
    return frame(
      <ErrorCard
        cause={scales.error}
        onRetry={() => void scales.refetch()}
        testID="grading-scales-error"
      />,
    );
  }

  const defaultName = rows.find((row) => row.isDefault)?.name ?? null;

  return frame(
    <View style={styles.body}>
      {rows.length === 0 ? (
        <EmptyState
          icon="grade"
          title={copy.exams.grading.scales.emptyTitle}
          message={copy.exams.grading.scales.emptyBody}
          testID="grading-scales-empty"
        >
          {scope.canCreate ? (
            <CapsuleButton
              title={copy.exams.grading.scales.add}
              icon="add"
              size="compact"
              onPress={() => router.push("/exams/setup/grading-scales/new")}
              testID="grading-scales-empty-add"
            />
          ) : null}
        </EmptyState>
      ) : (
        <>
          <SectionHead
            title={copy.exams.grading.scales.title}
            hint={copy.exams.grading.scales.meta(rows.length, defaultName)}
          />
          <Card padless testID="grading-scales-list">
            {rows.map((row, index) => (
              <ScaleListRow
                key={row.id}
                row={row}
                first={index === 0}
                onPress={
                  scope.canUpdate
                    ? () =>
                        router.push({
                          pathname: "/exams/setup/grading-scales/[scaleId]",
                          params: { scaleId: row.id },
                        })
                    : undefined
                }
              />
            ))}
          </Card>
        </>
      )}
    </View>,
  );
}

function ScaleListRow({
  row,
  first,
  onPress,
}: {
  row: ScaleRow;
  first: boolean;
  onPress?: () => void;
}) {
  const phrases = bandPhrases(row.bands);
  const bands = bandSentence(row.bands);
  const meta = [row.name, bands].filter(Boolean).join(". ");
  /**
   * Name, then the chips on their own line, then the band sentence at full
   * width. Sharing the top line with two chips squeezed the sentence into half
   * the card and cut it mid-band ("· D …"); stacking the chips costs one line
   * and lets the whole scale read.
   */
  const body = (
    <>
      <ThemedText variant="bodyStrong" numberOfLines={2}>
        {row.name}
      </ThemedText>
      {row.isDefault || row.isLocked ? (
        <View style={styles.chips}>
          {row.isDefault ? (
            <QuietChip
              label={copy.exams.grading.scales.defaultChip}
              tone="positive"
              testID={`grading-scale-default-${row.id}`}
            />
          ) : null}
          {row.isLocked ? (
            <QuietChip
              label={copy.exams.grading.scales.lockedChip}
              testID={`grading-scale-locked-${row.id}`}
            />
          ) : null}
        </View>
      ) : null}
      {row.description ? (
        <ThemedText variant="meta" numberOfLines={2}>
          {row.description}
        </ThemedText>
      ) : null}
      {phrases.length > 0 ? (
        <ThemedText variant="caption" color={colors.muted} numberOfLines={2}>
          {phrases.map((phrase, index) => (
            <ThemedText
              key={`${phrase.label}-${phrase.range}-${index}`}
              variant="caption"
            >
              {index > 0 ? "  ·  " : ""}
              <ThemedText variant="caption" color={colors.ink}>
                {phrase.label}
              </ThemedText>
              <ThemedText
                variant="caption"
                color={colors.muted}
                style={styles.bandRange}
              >
                {` ${phrase.range}`}
              </ThemedText>
            </ThemedText>
          ))}
        </ThemedText>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View
        style={[styles.row, first ? null : styles.divider]}
        accessible
        accessibilityLabel={meta}
        testID={`grading-scale-row-${row.id}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={`grading-scale-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={meta}
      accessibilityHint={copy.exams.grading.scales.editTitle}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletons: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.xxs,
    minHeight: touch.row,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  /**
   * The grade stays semibold; its range drops to regular so the eye can scan
   * labels down the line instead of reading one uniform bold sentence.
   */
  bandRange: {
    fontFamily: fontFamily.regular,
  },
});

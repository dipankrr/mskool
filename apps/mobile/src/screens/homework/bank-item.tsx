import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { Card } from "../../components/card";
import { CapsuleButton } from "../../components/capsule-button";
import { EmptyState } from "../../components/empty-state";
import { ErrorCard } from "../../components/error-card";
import { FactRow } from "../../components/fact-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { Skeleton } from "../../components/skeleton";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { dayKeyOf, dayLabel, formatMarks } from "../../lib/homework";
import {
  answerKeySummary,
  isOptionType,
  optionLetter,
} from "../../lib/homework-questions";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { ConfirmSheet } from "./confirm-sheet";
import { difficultyLabel, questionTypeLabel } from "./meta";

/**
 * One bank question, read by a teacher.
 *
 * The screen is deliberately read-only apart from its lifecycle: the bank has
 * no update endpoint, so a wrong question is retired and rewritten rather than
 * silently edited in place. Retiring is a principals' permission
 * (`school_settings:update`); a teacher who can write questions still sees the
 * screen, minus the control, plus the reason.
 *
 * The answer key is teacher-only data, so it is shown here in full — options
 * carry their correctness markers and the other types spell their key out. A
 * manual type says it is graded by hand instead of showing an empty line.
 */
export function HomeworkBankItemScreen() {
  const params = useLocalSearchParams<{ itemId?: string }>();
  const itemId = params.itemId ?? "";

  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();

  const canRead = has("homework:read");
  const canManage = has("school_settings:update");
  const canReadSubjects = has("subject:read");

  const utils = trpc.useUtils();

  const query = trpc.homework.bank.byId.useQuery(
    { organizationId: organizationId ?? "", itemId },
    { enabled: ready && canRead && Boolean(organizationId) && Boolean(itemId) },
  );

  const subjects = trpc.subject.list.useQuery(
    { organizationId: organizationId ?? "", schoolId: schoolId ?? undefined },
    {
      enabled:
        ready && canRead && canReadSubjects && Boolean(organizationId),
    },
  );

  const item = query.data ?? null;
  const subjectName =
    subjects.data?.find((row) => row.id === item?.subjectId)?.name ?? null;

  const [sheet, setSheet] = useState<"retire" | "reactivate" | null>(null);
  const [done, setDone] = useState<"retired" | "active" | null>(null);

  const setActive = trpc.homework.bank.setActive.useMutation({
    onSuccess: (data) => {
      const next = data?.isActive ?? false;
      utils.homework.bank.byId.setData(
        { organizationId: organizationId ?? "", itemId },
        (current) => (current ? { ...current, isActive: next } : current),
      );
      void utils.homework.bank.list.invalidate();
      setSheet(null);
      setDone(next ? "active" : "retired");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const closeSheet = () => {
    setSheet(null);
    setActive.reset();
  };

  const frame = (children: React.ReactNode) => (
    <ScreenFrame
      title={copy.homework.bank.detailTitle}
      meta={subjectName}
      backAccessibilityLabel={copy.common.back}
      backTestID="homework-bank-item-back"
      titleTestID="homework-bank-item-title"
      onRefresh={canRead ? () => void query.refetch() : undefined}
      refreshing={query.isRefetching}
      footer={
        item && canManage ? (
          item.isActive ? (
            <CapsuleButton
              title={copy.homework.bank.retire}
              icon="lock"
              variant="destructive"
              onPress={() => {
                setDone(null);
                setSheet("retire");
              }}
              testID="homework-bank-retire"
            />
          ) : (
            <CapsuleButton
              title={copy.homework.bank.reactivate}
              icon="checkCircle"
              onPress={() => {
                setDone(null);
                setSheet("reactivate");
              }}
              testID="homework-bank-reactivate"
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
        title={copy.homework.bank.noAccessTitle}
        message={copy.homework.bank.noAccessBody}
        testID="homework-bank-item-denied"
      />,
    );
  }

  if (!itemId) {
    return frame(
      <EmptyState
        icon="bank"
        title={copy.homework.bank.notFoundTitle}
        message={copy.homework.bank.notFoundBody}
        testID="homework-bank-item-missing"
      />,
    );
  }

  if (query.isPending) {
    return frame(
      <View style={styles.skeleton}>
        <Skeleton height={190} />
        <Skeleton height={140} />
      </View>,
    );
  }

  if (query.isError) {
    const friendly = toFriendlyError(query.error);
    if (friendly.kind === "notFound" || friendly.kind === "forbidden") {
      return frame(
        <EmptyState
          icon="bank"
          title={copy.homework.bank.notFoundTitle}
          message={copy.homework.bank.notFoundBody}
          testID="homework-bank-item-not-found"
        />,
      );
    }
    return frame(
      <ErrorCard
        cause={query.error}
        onRetry={() => void query.refetch()}
        testID="homework-bank-item-error"
      />,
    );
  }

  if (!item) {
    return frame(
      <EmptyState
        icon="bank"
        title={copy.homework.bank.notFoundTitle}
        message={copy.homework.bank.notFoundBody}
        testID="homework-bank-item-not-found"
      />,
    );
  }

  const type = questionTypeLabel(item.questionType);
  const marks = formatMarks(item.defaultMarks) ?? item.defaultMarks;
  const optionType = isOptionType(item.questionType);
  const key = answerKeySummary({
    questionType: item.questionType,
    options: item.options.map((option, index) => ({
      id: index + 1,
      text: option.optionText,
      isCorrect: option.isCorrect,
    })),
    correctAnswer: item.correctAnswer,
  });

  return (
    <>
      {frame(
        <View style={styles.body}>
          {done === "retired" ? (
            <Notice
              tone="neutral"
              title={copy.homework.bank.retireDone}
              message={copy.homework.bank.retiredBody}
              testID="homework-bank-item-retired"
            />
          ) : null}

          {done === "active" ? (
            <Notice
              tone="positive"
              title={copy.homework.bank.reactivateDone}
              message={copy.homework.bank.activeBody}
              testID="homework-bank-item-active"
            />
          ) : null}

          {!item.isActive && done !== "retired" ? (
            <Notice
              tone="neutral"
              title={copy.homework.bank.retired}
              message={copy.homework.bank.retiredBody}
              testID="homework-bank-item-inactive"
            />
          ) : null}

          <Card style={styles.hero}>
            <View style={styles.pills}>
              <StatusPill label={type} tone="neutral" />
              <StatusPill
                label={difficultyLabel(item.difficulty)}
                tone="neutral"
              />
              <StatusPill
                label={item.isActive ? copy.homework.bank.active : copy.homework.bank.retired}
                tone={item.isActive ? "positive" : "neutral"}
              />
            </View>

            <ThemedText variant="name" selectable style={styles.question}>
              {item.body}
            </ThemedText>

            <ThemedText variant="meta">
              {copy.homework.bank.meta(type, marks)}
            </ThemedText>
          </Card>

          <Card style={styles.section}>
            <ThemedText variant="sectionLabel">
              {optionType
                ? copy.homework.bank.optionsHeading
                : copy.homework.bank.answerKey}
            </ThemedText>

            {optionType ? (
              item.options.length === 0 ? (
                <ThemedText variant="meta">
                  {copy.homework.bank.noOptions}
                </ThemedText>
              ) : (
                item.options.map((option, index) => (
                  <View
                    key={option.id}
                    style={styles.optionRow}
                  >
                    <AppIcon
                      name={option.isCorrect ? "checkCircle" : "closeCircle"}
                      size={18}
                      color={
                        option.isCorrect
                          ? colors.tone.positive.fg
                          : colors.chevron
                      }
                    />
                    <ThemedText
                      variant="body"
                      color={option.isCorrect ? colors.ink : colors.muted}
                      style={styles.optionText}
                    >
                      {`${optionLetter(index)}. ${option.optionText}`}
                    </ThemedText>
                    {option.isCorrect ? (
                      <ThemedText
                        variant="caption"
                        color={colors.tone.positive.fg}
                      >
                        {copy.homework.bank.correct}
                      </ThemedText>
                    ) : null}
                  </View>
                ))
              )
            ) : (
              <ThemedText variant="body" selectable>
                {key ?? copy.homework.bank.noKey}
              </ThemedText>
            )}
          </Card>

          <Card style={styles.section}>
            <ThemedText variant="sectionLabel">
              {copy.homework.bank.explanationHeading}
            </ThemedText>
            <ThemedText variant="body" selectable>
              {item.explanation?.trim().length
                ? item.explanation
                : copy.homework.bank.noExplanation}
            </ThemedText>
          </Card>

          <Card padless>
            <FactRow
              label={copy.homework.bank.filterSubject}
              value={subjectName ?? "—"}
              first
            />
            <FactRow
              label={copy.homework.bank.defaultMarks}
              value={marks}
            />
            <FactRow
              label={copy.homework.bank.difficulty}
              value={difficultyLabel(item.difficulty)}
            />
            <FactRow
              label={copy.homework.bank.visibility}
              value={
                item.visibility === "school"
                  ? copy.homework.bank.school
                  : copy.homework.bank.private
              }
            />
            {item.topic ? (
              <FactRow label={copy.homework.bank.topic} value={item.topic} />
            ) : null}
            <FactRow
              label={copy.homework.bank.added}
              value={dayLabel(dayKeyOf(item.createdAt))}
            />
          </Card>

          <ThemedText variant="meta" style={styles.note}>
            {copy.homework.bank.visibilityNote}
          </ThemedText>

          {!canManage ? (
            <ThemedText variant="meta" style={styles.note}>
              {copy.homework.bank.retireDenied}
            </ThemedText>
          ) : null}
        </View>,
      )}

      {sheet ? (
        <ConfirmSheet
          title={
            sheet === "retire"
              ? copy.homework.bank.retireTitle
              : copy.homework.bank.reactivateTitle
          }
          body={
            sheet === "retire"
              ? copy.homework.bank.retireBody
              : copy.homework.bank.reactivateBody
          }
          confirmLabel={
            sheet === "retire"
              ? copy.homework.bank.retireConfirm
              : copy.homework.bank.reactivateConfirm
          }
          keepLabel={copy.homework.actions.keep}
          tone={sheet === "retire" ? "destructive" : "default"}
          submitting={setActive.isPending}
          error={setActive.error}
          onConfirm={() =>
            setActive.mutate({
              organizationId: organizationId ?? "",
              itemId,
              isActive: sheet === "reactivate",
            })
          }
          onClose={closeSheet}
          testIDPrefix="homework-bank-item-active"
        />
      ) : null}
    </>
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
  question: {
    marginTop: spacing.xs,
    lineHeight: 26,
  },
  section: {
    gap: spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  optionText: {
    flex: 1,
  },
  note: {
    paddingHorizontal: spacing.xs,
  },
});

import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { StatusPill } from "../../components/status-pill";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { formatShortWeekday } from "../../lib/format";
import { formatClock } from "../../lib/homework";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { ExamPaper } from "./types";
import type { PaperCounts } from "./use-review-counts";

/** "Theory 80 + Practical 20", or "Out of 100" for a single component. */
export function componentsSummary(paper: ExamPaper): string {
  const parts = [...paper.components].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber,
  );
  if (parts.length === 0) return "";
  const total = parts.reduce((sum, part) => sum + Number(part.maxMarks), 0);
  if (parts.length === 1) return copy.exams.hub.outOf(String(total));
  return parts
    .map((part) => `${part.name} ${Number(part.maxMarks)}`)
    .join(" + ");
}

/**
 * One paper on the exam hub: the subject, when it sits, how it is marked, and
 * whether it is the caller's. Whole card is the target when the paper can be
 * opened. Before marks entry starts there is nothing to open, so the card is
 * a plain statement of the schedule with the reason in words — a dead tap
 * with no explanation is worse than no tap.
 */
export function PaperCard({
  paper,
  subject,
  sectionName,
  mine,
  reviewer,
  counts,
  showEntryProgress,
  openable,
  entryOpen,
  onPress,
}: {
  paper: ExamPaper;
  subject: string;
  /** Null for a class-wide paper. */
  sectionName: string | null;
  /** `null` = unknown (the caller is not assignment-constrained). */
  mine: boolean | null;
  /** A `marks:verify` holder at an entry stage: show review progress. */
  reviewer: boolean;
  /** `undefined` while loading; `null` when the paper could not be read. */
  counts: PaperCounts | null | undefined;
  /** The caller's own paper during entry: show how much is left, not just "Enter marks". */
  showEntryProgress: boolean;
  openable: boolean;
  entryOpen: boolean;
  onPress: () => void;
}) {
  const when = [
    formatShortWeekday(paper.examDate),
    formatClock(paper.startTime.slice(0, 5)),
    copy.exams.hub.duration(paper.durationMinutes),
  ].join(" · ");
  const scope = sectionName
    ? copy.exams.hub.section(sectionName)
    : copy.exams.hub.allSections;
  const how = componentsSummary(paper);
  const showReview = reviewer && openable && entryOpen;
  const toVerify = counts ? counts.entered - counts.verified : 0;
  const missing = counts ? counts.expected - counts.entered : 0;
  const review = !showReview
    ? null
    : counts === undefined
      ? { line: copy.exams.hub.review.loading, pill: null }
      : counts === null
        ? { line: copy.exams.hub.review.action, pill: null }
        : {
            line: copy.exams.hub.review.paperCounts(counts.verified, toVerify, missing),
            pill:
              toVerify > 0
                ? { label: copy.exams.hub.review.pillToVerify, tone: "caution" as const }
                : counts.expected > 0 && counts.verified === counts.expected
                  ? { label: copy.exams.hub.review.pillVerified, tone: "positive" as const }
                  : counts.entered === 0
                    ? { label: copy.exams.hub.review.pillNone, tone: "neutral" as const }
                    : { label: copy.exams.hub.review.pillWaiting, tone: "neutral" as const },
          };
  const action = review
    ? review.line
    : openable
      ? entryOpen && mine !== false
        ? copy.exams.hub.enter
        : copy.exams.hub.view
      : copy.exams.hub.waiting;
  // The teacher's own paper during entry: a live count instead of a bare
  // "Enter marks", so the card says what is still owed before it is opened.
  const entryProgress =
    !review && showEntryProgress && counts && counts.expected > 0
      ? counts.entered >= counts.expected
        ? copy.exams.hub.entryDone
        : copy.exams.hub.review.classLine(counts.entered, counts.expected)
      : null;

  const label = [
    subject,
    when,
    scope,
    how,
    entryProgress,
    review?.pill ? review.pill.label : null,
    mine === true
      ? copy.exams.hub.yourPaper
      : mine === false
        ? copy.exams.hub.notYourPaper
        : null,
    showReview ? copy.exams.hub.review.action : null,
    action,
  ]
    .filter(Boolean)
    .join(". ");

  const body = (
    <>
      <View style={styles.top}>
        <ThemedText variant="name" numberOfLines={2} style={styles.subject}>
          {subject}
        </ThemedText>
        {review?.pill ? (
          <StatusPill label={review.pill.label} tone={review.pill.tone} />
        ) : mine === true ? (
          <StatusPill label={copy.exams.hub.yourPaper} tone="positive" />
        ) : mine === false ? (
          <StatusPill label={copy.exams.hub.notYourPaper} tone="neutral" />
        ) : null}
      </View>
      <ThemedText variant="meta">{when}</ThemedText>
      <ThemedText variant="meta">{[scope, how].filter(Boolean).join(" · ")}</ThemedText>
      {entryProgress ? (
        <ThemedText
          variant="meta"
          color={
            entryProgress === copy.exams.hub.entryDone
              ? colors.tone.positive.fg
              : colors.muted
          }
        >
          {entryProgress}
        </ThemedText>
      ) : null}
      <View style={styles.action}>
        <ThemedText
          variant="bodyStrong"
          color={openable ? colors.accentDeep : colors.muted}
        >
          {action}
        </ThemedText>
        {openable ? (
          <AppIcon name="chevronRight" size={16} color={colors.accentDeep} />
        ) : null}
      </View>
    </>
  );

  if (!openable) {
    return (
      <View
        style={styles.card}
        accessible
        accessibilityLabel={label}
        testID={`paper-card-${paper.id}`}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => {
        void Haptics.selectionAsync();
      }}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`paper-card-${paper.id}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xxs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  subject: {
    flex: 1,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 24,
  },
});

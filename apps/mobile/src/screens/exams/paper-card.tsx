import { Pressable, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import type { AppIconName } from "../../components/app-icon";
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

/** One icon + one short fact, the card's unit of information. */
function Fact({
  icon,
  text,
  color = colors.muted,
}: {
  icon: AppIconName;
  text: string;
  color?: string;
}) {
  if (!text) return null;
  return (
    <View style={styles.fact}>
      <AppIcon name={icon} size={14} color={color} />
      <ThemedText variant="meta" color={color} numberOfLines={1} style={styles.factText}>
        {text}
      </ThemedText>
    </View>
  );
}

/**
 * One paper on the exam hub: a date tile (when), the subject, and three icon
 * facts — the time, who sits it, how it is marked. Whole card is the target
 * when the paper can be opened. Before marks entry starts there is nothing to
 * open, so the card is simply the schedule: no "opens later" line, because the
 * stage card above already says so once.
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
  const [weekday = "", day = "", month = ""] = formatShortWeekday(paper.examDate).split(" ");
  const time = [
    formatClock(paper.startTime.slice(0, 5)),
    copy.exams.hub.duration(paper.durationMinutes),
  ].join(" · ");
  const when = [formatShortWeekday(paper.examDate), time].join(" · ");
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
  // Nothing to say before marks entry opens: the card is just the schedule.
  const action = review
    ? review.line
    : openable
      ? entryOpen && mine !== false
        ? copy.exams.hub.enter
        : copy.exams.hub.view
      : null;
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
    <View style={styles.row}>
      <View style={styles.dateTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ThemedText variant="caption" color={colors.accentDeep}>
          {weekday}
        </ThemedText>
        <ThemedText variant="name" color={colors.accentDeep}>
          {day}
        </ThemedText>
        <ThemedText variant="caption" color={colors.accentDeep}>
          {month}
        </ThemedText>
      </View>
      <View style={styles.main}>
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
        <Fact icon="clock" text={time} />
        <Fact icon="students" text={scope} />
        <Fact icon="marks" text={how} />
        {entryProgress ? (
          <Fact
            icon={entryProgress === copy.exams.hub.entryDone ? "checkCircle" : "history"}
            text={entryProgress}
            color={
              entryProgress === copy.exams.hub.entryDone
                ? colors.tone.positive.fg
                : colors.muted
            }
          />
        ) : null}
        {action ? (
          <ThemedText variant="bodyStrong" color={colors.accentDeep} style={styles.action}>
            {action}
          </ThemedText>
        ) : null}
      </View>
      {openable ? (
        <AppIcon name="chevronRight" size={18} color={colors.chevron} />
      ) : null}
    </View>
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
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.field,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  dateTile: {
    width: 56,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
  },
  main: {
    flex: 1,
    gap: spacing.xs,
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
  fact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  factText: {
    flexShrink: 1,
  },
  action: {
    marginTop: spacing.xs,
  },
});

import { memo, useCallback, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { cellKey, isBelowPass } from "../../lib/exam-draft";
import type { Cell, PaperDraft } from "../../lib/exam-draft";
import { displayMarks, fullName } from "../../lib/exams";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import type { EntryComponent } from "./entry-row";
import type { RosterStudent } from "./types";

type BarFlag = "below" | "allowed" | null;

/** Verified, or sealed past verification. */
function isReviewed(status: string): boolean {
  return status === "verified" || status === "published" || status === "locked";
}

/**
 * One student in Review: a READ-first summary, not an input. The reviewer is
 * checking numbers against scripts; a 48 dp field per row would invite stray
 * edits while scrolling and put a keyboard in the way. Correcting is
 * deliberate: tap the row, change it in the student sheet.
 *
 * Everything shown is what the draft holds for the student's cells; a verified
 * row wears a seal and the word "Verified" (never colour alone), an entered row
 * wears nothing — it is not done yet.
 */
export const ReviewRow = memo(function ReviewRow({
  draft,
  student,
  components,
  graded,
  barFlag,
  onOpen,
}: {
  draft: PaperDraft;
  student: RosterStudent;
  components: readonly EntryComponent[];
  graded: boolean;
  barFlag: BarFlag;
  onOpen: (studentId: string) => void;
}) {
  const { studentId } = student;
  const subscribe = useCallback(
    (listener: () => void) => draft.subscribeStudent(studentId, listener),
    [draft, studentId],
  );
  const rev = useSyncExternalStore(subscribe, () =>
    draft.studentSignature(studentId),
  );
  const cells = readCells(draft, studentId, components, rev);

  const name = fullName(student);
  const multi = components.length > 1;
  const verified =
    cells.length > 0 &&
    cells.length === components.length &&
    cells.every((cell) => isReviewed(cell.base.status));
  const entered = cells.some((cell) => cell.base.status === "entered");
  const changed = cells.some((cell) => cell.remoteChange);
  const saving = cells.some((cell) => cell.phase === "saving");
  const missing = cells.every(
    (cell) => !isReviewed(cell.base.status) && cell.base.status !== "entered",
  );
  const below =
    !graded &&
    cells.some((cell, index) => {
      const component = components[index];
      return component ? isBelowPass(cell, component.pass) : false;
    });

  const values = cells.map((cell) => valueOf(cell, graded));
  const valueText = values.join(" · ");
  const state = verified
    ? copy.exams.paper.review.stateVerified
    : missing
      ? copy.exams.paper.review.stateMissing
      : copy.exams.paper.review.stateEntered;

  // The status line and its colour are decided together: a verified row says
  // "Verified" in the accent even when the student is below the attendance bar.
  const line: { text: string; color: string } | null = changed
    ? { text: copy.exams.paper.review.changedLine, color: colors.tone.caution.fg }
    : verified
      ? { text: copy.exams.paper.review.verifiedWord, color: colors.accentDeep }
      : below
        ? { text: copy.exams.paper.review.belowPass, color: colors.tone.caution.fg }
        : barFlag === "below"
          ? { text: copy.exams.paper.belowBar, color: colors.tone.caution.fg }
          : multi
            ? { text: components.map((component) => component.name).join(" · "), color: colors.muted }
            : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy.exams.paper.review.rowLabel(
        student.rollNumber,
        name,
        valueText,
        state,
      )}
      accessibilityHint={copy.exams.paper.exemptHint}
      onPress={() => onOpen(studentId)}
      style={({ pressed }) => [
        styles.row,
        changed ? styles.rowChanged : null,
        pressed ? styles.rowPressed : null,
      ]}
      testID={`review-row-${studentId}`}
    >
      <ThemedText variant="meta" style={styles.roll} numberOfLines={1}>
        {copy.exams.paper.roll(student.rollNumber)}
      </ThemedText>
      <View style={styles.nameBlock}>
        <ThemedText variant="bodyStrong" numberOfLines={2}>
          {name}
        </ThemedText>
        {line ? (
          <View style={styles.lineRow}>
            {changed ? (
              <View style={styles.pill}>
                <ThemedText
                  variant="caption"
                  color={colors.tone.caution.fg}
                  maxFontSizeMultiplier={1.3}
                >
                  {copy.exams.paper.review.changedPill}
                </ThemedText>
              </View>
            ) : (
              <ThemedText
                variant="meta"
                color={line.color}
                numberOfLines={2}
                style={styles.line}
              >
                {line.text}
              </ThemedText>
            )}
          </View>
        ) : null}
      </View>
      <ThemedText
        variant="name"
        color={below ? colors.tone.caution.fg : entered || verified ? colors.ink : colors.chevron}
        style={styles.value}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {valueText}
      </ThemedText>
      <View style={styles.glyph}>
        {saving ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : verified ? (
          <AppIcon name="grade" size={20} color={colors.accentDeep} />
        ) : null}
      </View>
    </Pressable>
  );
});

/**
 * The student's cells in component order. `rev` is the by-value signature the
 * caller subscribed to; unused in the body on purpose so a new signature
 * recomputes the list (the React Compiler would otherwise reuse it).
 */
function readCells(
  draft: PaperDraft,
  studentId: string,
  components: readonly EntryComponent[],
  rev: string,
): Cell[] {
  void rev;
  const cells: Cell[] = [];
  for (const component of components) {
    const cell = draft.get(cellKey(studentId, component.id));
    if (cell) cells.push(cell);
  }
  return cells;
}

function valueOf(cell: Cell, graded: boolean): string {
  if (cell.exempt) return copy.exams.paper.exemptChip;
  if (cell.absent) return copy.exams.paper.absentChip;
  const text = graded ? cell.text.trim() : displayMarks(cell.text);
  return text === "" ? "–" : text;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    marginBottom: spacing.sm - spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowChanged: {
    backgroundColor: colors.tone.caution.bg,
  },
  rowPressed: {
    backgroundColor: colors.field,
  },
  roll: {
    width: 26,
  },
  nameBlock: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    gap: spacing.xxs,
  },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  line: {
    flexShrink: 1,
  },
  pill: {
    minHeight: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.tone.caution.bg,
    borderWidth: 1,
    borderColor: colors.tone.caution.fg,
    justifyContent: "center",
  },
  value: {
    maxWidth: 120,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  glyph: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { totalQuestionMarks, type QuestionDraft } from "../../lib/homework-questions";
import { colors } from "../../theme/brand-admin";
import { radius, spacing } from "../../theme/tokens";
import { questionTypeLabel } from "./meta";
import { QuestionComposerSheet } from "./question-composer";

const q = copy.homework.questions;
const text = copy.homework.give;

/** Quiz step 3 (frame 12): a title, then the questions, each written in a sheet. */
export function QuizWorkStep({
  title,
  onTitle,
  titleError,
  questions,
  onQuestions,
  questionsError,
}: {
  title: string;
  onTitle: (v: string) => void;
  titleError?: string;
  questions: QuestionDraft[];
  onQuestions: (next: QuestionDraft[]) => void;
  questionsError?: string;
}) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const total = totalQuestionMarks(questions.map((d) => d.marks));

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onQuestions(next);
  };

  return (
    <View style={styles.stack}>
      <FormField
        label={text.titleLabel}
        value={title}
        onChangeText={onTitle}
        placeholder={text.quizTitlePlaceholder}
        error={titleError}
        maxLength={250}
        testID="give-quiz-title"
      />
      <View style={styles.head}>
        <ThemedText variant="sectionLabel" style={styles.grow}>
          {q.title}
        </ThemedText>
        {questions.length ? (
          <ThemedText variant="meta">{`${q.questionCount(questions.length)} · ${q.marksTotal(total)}`}</ThemedText>
        ) : null}
      </View>
      {questions.length === 0 ? (
        <View style={styles.empty}>
          <AppIcon name="quiz" size={28} color={colors.accentDeep} />
          <ThemedText variant="bodyStrong">{q.emptyTitle}</ThemedText>
          <ThemedText variant="meta" style={styles.center}>
            {text.quizEmptyBody}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.list}>
          {questions.map((d, i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              onPress={() => setEditing(i)}
              onLongPress={() =>
                Alert.alert(q.removeConfirmTitle, q.removeConfirmBody(i + 1), [
                  { text: copy.common.cancel, style: "cancel" },
                  { text: q.removeConfirm, style: "destructive", onPress: () => onQuestions(questions.filter((_, k) => k !== i)) },
                ])
              }
              accessibilityHint={text.quizQuestionHint}
              style={({ pressed }) => [styles.question, i > 0 ? styles.divider : null, pressed ? styles.pressed : null]}
              testID={`give-question-${i}`}
            >
              <View style={styles.number}>
                <ThemedText variant="bodyStrong" color={colors.accentDeep}>
                  {String(i + 1)}
                </ThemedText>
              </View>
              <View style={styles.grow}>
                <ThemedText variant="body" numberOfLines={2}>
                  {d.body}
                </ThemedText>
                <ThemedText variant="meta">{`${questionTypeLabel(d.questionType)} · ${q.marksOf(d.marks)}`}</ThemedText>
              </View>
              <View style={styles.moves}>
                <Pressable accessibilityLabel={q.moveUp} onPress={() => move(i, -1)} hitSlop={6} disabled={i === 0}>
                  <AppIcon name="chevronUp" size={20} color={i === 0 ? colors.hairline : colors.muted} />
                </Pressable>
                <Pressable accessibilityLabel={q.moveDown} onPress={() => move(i, 1)} hitSlop={6} disabled={i === questions.length - 1}>
                  <AppIcon name="chevronDown" size={20} color={i === questions.length - 1 ? colors.hairline : colors.muted} />
                </Pressable>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      {questionsError ? <Notice tone="critical" message={questionsError} /> : null}
      <CapsuleButton
        title={questions.length ? q.add : q.addFirst}
        icon="add"
        variant="secondary"
        onPress={() => setEditing("new")}
        style={styles.stretch}
        testID="give-question-add"
      />

      {editing !== null ? (
        <QuestionComposerSheet
          mode={editing === "new" ? "add" : "edit"}
          initial={editing === "new" ? undefined : questions[editing]}
          submitting={false}
          error={null}
          onSubmit={(draft) => {
            if (editing === "new") onQuestions([...questions, draft]);
            else onQuestions(questions.map((d, i) => (i === editing ? draft : d)));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );
}

export type QuizRules = { showScore: boolean; showAnswers: boolean };

/** Quiz step 4's rules (frame 13): when students see their score and the answers. */
export function QuizRulesStep({ rules, onRules }: { rules: QuizRules; onRules: (r: QuizRules) => void }) {
  return (
    <View style={styles.rules}>
      <ThemedText variant="sectionLabel">{text.quizRules}</ThemedText>
      <SwitchRow
        label={text.quizShowScore}
        value={rules.showScore}
        onChange={(v) => onRules({ ...rules, showScore: v })}
        testID="give-quiz-score"
      />
      <SwitchRow
        label={text.quizShowAnswers}
        value={rules.showAnswers}
        onChange={(v) => onRules({ ...rules, showAnswers: v })}
        testID="give-quiz-answers"
      />
      <ThemedText variant="caption">{text.quizOneAttempt}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  grow: { flex: 1, gap: spacing.xxs },
  stretch: { alignSelf: "stretch" },
  center: { textAlign: "center" },
  head: { flexDirection: "row", alignItems: "center" },
  empty: {
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  list: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: "hidden" },
  question: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  pressed: { opacity: 0.85 },
  number: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentTint,
  },
  moves: { gap: spacing.xs },
  rules: { gap: spacing.sm },
});

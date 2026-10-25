import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { AppIcon } from "../../components/app-icon";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import {
  AUTHORABLE_QUESTION_TYPES,
  MAX_ACCEPTED,
  MAX_BODY,
  MAX_EXPLANATION,
  MAX_OPTIONS,
  MAX_OPTION_TEXT,
  checkQuestionDraft,
  isOptionType,
  newOptionKey,
  optionLetter,
  switchQuestionType,
} from "../../lib/homework-questions";
import type {
  AuthorableQuestionType,
  QuestionDraft,
  QuestionDraftErrorKey,
} from "../../lib/homework-questions";
import { colors } from "../../theme/brand-admin";
import { radius, spacing, touch } from "../../theme/tokens";
import { questionTypeLabel } from "./meta";
import { SegmentBar } from "./segments";
import type { SegmentOption } from "./segments";

const TRUE_FALSE_OPTIONS: readonly SegmentOption<"" | "true" | "false">[] = [
  {
    value: "true",
    label: copy.homework.questions.true,
    testID: "homework-question-true",
  },
  {
    value: "false",
    label: copy.homework.questions.false,
    testID: "homework-question-false",
  },
];

/**
 * The question form's fields, shared by the assignment set's composer sheet and
 * the bank's full-screen authoring form. Living in one component is what keeps
 * the two surfaces from drifting: both write the same draft, validate the same
 * way, and cannot disagree about what "single choice" means.
 *
 * Type is a chip grid because it is the decision that changes every field below
 * it. Switching keeps what the types share and what the teacher typed; only the
 * fields the chosen type reads are validated and sent, so a mis-tap costs a tap,
 * not the question. The parent owns the draft and decides what save means.
 */
export function QuestionFields({
  draft,
  onChange,
  submitting = false,
  touched,
}: {
  draft: QuestionDraft;
  onChange: (next: QuestionDraft | ((current: QuestionDraft) => QuestionDraft)) => void;
  submitting?: boolean;
  touched: boolean;
}) {
  const check = checkQuestionDraft(draft);
  const text = copy.homework.questions;
  const optionType = isOptionType(draft.questionType);

  const errorOf = (key: QuestionDraftErrorKey): string | undefined =>
    touched && check.errors[key] ? check.errors[key] : undefined;

  const set = <K extends keyof QuestionDraft>(
    key: K,
    value: QuestionDraft[K],
  ) => onChange((current) => ({ ...current, [key]: value }));

  const chooseType = (next: AuthorableQuestionType) => {
    onChange((current) => switchQuestionType(current, next));
  };

  const editOption = (index: number, patch: { text?: string; isCorrect?: boolean }) => {
    onChange((current) => ({
      ...current,
      options: current.options.map((option, at) => {
        if (at !== index) {
          // Single choice is a radio: picking one clears the rest in the same
          // commit, so the invalid two-correct state is unreachable by taps.
          if (
            patch.isCorrect === true &&
            current.questionType === "mcq_single"
          ) {
            return { ...option, isCorrect: false };
          }
          return option;
        }
        return { ...option, ...patch };
      }),
    }));
  };

  const addOption = () => {
    if (draft.options.length >= MAX_OPTIONS) return;
    void Haptics.selectionAsync();
    onChange((current) => ({
      ...current,
      options: [
        ...current.options,
        { key: newOptionKey(), text: "", isCorrect: false },
      ],
    }));
  };

  const removeOption = (index: number) => {
    if (draft.options.length <= 2) return;
    void Haptics.selectionAsync();
    onChange((current) => ({
      ...current,
      options: current.options.filter((_, at) => at !== index),
    }));
  };

  return (
    <View style={styles.body}>
      <View style={styles.typeBlock}>
        <ThemedText variant="caption" style={styles.label}>
          {text.typeLabel}
        </ThemedText>
        <View
          style={styles.typeGrid}
          accessibilityRole="radiogroup"
          accessibilityLabel={text.typeLabel}
        >
          {AUTHORABLE_QUESTION_TYPES.map((type) => {
            const selected = draft.questionType === type;
            return (
              <Pressable
                key={type}
                testID={`homework-question-type-${type}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={questionTypeLabel(type)}
                disabled={submitting}
                onPress={() => chooseType(type)}
                style={({ pressed }) => [
                  styles.typeChip,
                  selected ? styles.typeChipOn : null,
                  pressed && !selected ? styles.pressed : null,
                ]}
              >
                <ThemedText
                  variant="caption"
                  color={selected ? colors.accentDeep : colors.ink}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                >
                  {questionTypeLabel(type)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <ThemedText variant="meta" style={styles.hint}>
          {text.composerTypeLocked}
        </ThemedText>
      </View>

      <FormField
        label={text.body}
        value={draft.body}
        onChangeText={(value) => set("body", value)}
        placeholder={text.bodyPlaceholder}
        help={text.bodyHelp}
        error={errorOf("body")}
        multiline
        numberOfLines={3}
        maxLength={MAX_BODY}
        editable={!submitting}
        testID="homework-question-body"
      />

      <FormField
        label={text.marks}
        value={draft.marks}
        onChangeText={(value) => set("marks", value)}
        keyboardType="decimal-pad"
        help={text.marksHelp}
        error={errorOf("marks")}
        editable={!submitting}
        maxLength={8}
        testID="homework-question-marks"
      />

      {optionType ? (
        <View style={styles.options}>
          <ThemedText variant="caption" style={styles.label}>
            {text.options}
          </ThemedText>
          <ThemedText variant="meta">
            {draft.questionType === "mcq_single"
              ? text.correctHintSingle
              : text.correctHintMulti}
          </ThemedText>

          {draft.options.map((option, index) => {
            const letter = optionLetter(index);
            return (
              <View key={option.key} style={styles.optionRow}>
                <ThemedText variant="bodyStrong" style={styles.letter}>
                  {letter}
                </ThemedText>
                <View
                  style={[
                    styles.optionField,
                    errorOf("options") && !option.text.trim()
                      ? styles.optionFieldError
                      : null,
                  ]}
                >
                  <TextInput
                    value={option.text}
                    onChangeText={(value) => editOption(index, { text: value })}
                    placeholder={text.optionPlaceholder(letter)}
                    placeholderTextColor={colors.muted}
                    style={styles.optionInput}
                    accessibilityLabel={text.optionPlaceholder(letter)}
                    maxLength={MAX_OPTION_TEXT}
                    editable={!submitting}
                    testID={`homework-question-option-${index}`}
                  />
                </View>
                <Pressable
                  accessibilityRole={
                    draft.questionType === "mcq_single" ? "radio" : "checkbox"
                  }
                  accessibilityState={{ checked: option.isCorrect }}
                  accessibilityLabel={text.correctOption(letter)}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    editOption(index, {
                      isCorrect:
                        draft.questionType === "mcq_single"
                          ? true
                          : !option.isCorrect,
                    });
                  }}
                  disabled={submitting}
                  style={({ pressed }) => [
                    styles.correct,
                    option.isCorrect ? styles.correctOn : null,
                    pressed ? styles.pressed : null,
                  ]}
                  testID={`homework-question-correct-${index}`}
                >
                  <AppIcon
                    name="check"
                    size={16}
                    color={option.isCorrect ? colors.accentDeep : colors.muted}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={text.removeOption(letter)}
                  onPress={() => removeOption(index)}
                  disabled={draft.options.length <= 2 || submitting}
                  style={({ pressed }) => [
                    styles.removeOption,
                    pressed ? styles.pressed : null,
                    draft.options.length <= 2 ? styles.disabled : null,
                  ]}
                  testID={`homework-question-remove-option-${index}`}
                >
                  <AppIcon name="close" size={16} color={colors.muted} />
                </Pressable>
              </View>
            );
          })}

          {errorOf("options") ? (
            <ThemedText
              variant="meta"
              color={colors.tone.critical.fg}
              accessibilityLiveRegion="polite"
            >
              {errorOf("options")}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={text.addOption}
            onPress={addOption}
            disabled={draft.options.length >= MAX_OPTIONS || submitting}
            style={({ pressed }) => [
              styles.addOption,
              pressed ? styles.pressed : null,
              draft.options.length >= MAX_OPTIONS ? styles.disabled : null,
            ]}
            testID="homework-question-add-option"
          >
            <AppIcon name="add" size={16} color={colors.accentDeep} />
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {text.addOption}
            </ThemedText>
          </Pressable>
          {draft.options.length >= MAX_OPTIONS ? (
            <ThemedText variant="meta">{text.optionLimit}</ThemedText>
          ) : null}
        </View>
      ) : null}

      {draft.questionType === "true_false" ? (
        <View style={styles.block}>
          <ThemedText variant="caption" style={styles.label}>
            {text.trueFalse}
          </ThemedText>
          <SegmentBar
            label={text.trueFalse}
            value={draft.trueFalse}
            options={TRUE_FALSE_OPTIONS}
            onChange={(value) => set("trueFalse", value)}
          />
          {errorOf("trueFalse") ? (
            <ThemedText variant="meta" color={colors.tone.critical.fg}>
              {errorOf("trueFalse")}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      {draft.questionType === "numeric" ? (
        <View style={styles.block}>
          <FormField
            label={text.numericValue}
            value={draft.numericValue}
            onChangeText={(value) => set("numericValue", value)}
            placeholder={text.numericValuePlaceholder}
            keyboardType="numbers-and-punctuation"
            error={errorOf("numericValue")}
            editable={!submitting}
            maxLength={16}
            testID="homework-question-numeric-value"
          />
          <FormField
            label={text.numericTolerance}
            value={draft.numericTolerance}
            onChangeText={(value) => set("numericTolerance", value)}
            placeholder={text.numericTolerancePlaceholder}
            keyboardType="decimal-pad"
            error={errorOf("numericTolerance")}
            editable={!submitting}
            maxLength={8}
            testID="homework-question-numeric-tolerance"
          />
        </View>
      ) : null}

      {draft.questionType === "fill_blank" ? (
        <View style={styles.block}>
          <FormField
            label={text.accepted}
            value={draft.acceptedAnswers}
            onChangeText={(value) => set("acceptedAnswers", value)}
            placeholder={text.acceptedPlaceholder}
            help={text.acceptedHelp}
            error={errorOf("acceptedAnswers")}
            multiline
            numberOfLines={Math.min(MAX_ACCEPTED, 5)}
            editable={!submitting}
            testID="homework-question-accepted"
          />
          <SwitchRow
            label={text.caseSensitive}
            value={draft.caseSensitive}
            onChange={(value) => set("caseSensitive", value)}
            disabled={submitting}
            testID="homework-question-case"
          />
        </View>
      ) : null}

      {draft.questionType === "short_answer" ||
      draft.questionType === "long_answer" ? (
        <Notice
          tone="neutral"
          message={text.manualNote}
          testID="homework-question-manual"
        />
      ) : null}

      <FormField
        label={text.explanation}
        value={draft.explanation}
        onChangeText={(value) => set("explanation", value)}
        placeholder={text.explanationPlaceholder}
        help={text.explanationHelp}
        error={errorOf("explanation")}
        multiline
        numberOfLines={3}
        maxLength={MAX_EXPLANATION}
        editable={!submitting}
        testID="homework-question-explanation"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  typeBlock: {
    gap: spacing.xs,
  },
  label: {
    marginBottom: 0,
  },
  hint: {
    marginTop: spacing.xxs,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  typeChip: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  typeChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  options: {
    gap: spacing.xs,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: touch.comfortable,
  },
  letter: {
    width: 18,
    textAlign: "center",
  },
  optionField: {
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.field,
  },
  optionFieldError: {
    borderWidth: 1,
    borderColor: colors.tone.critical.fg,
  },
  optionInput: {
    color: colors.ink,
    paddingVertical: spacing.xs,
  },
  correct: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
  },
  correctOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  removeOption: {
    width: 34,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  addOption: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  block: {
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  disabled: {
    opacity: 0.4,
  },
});

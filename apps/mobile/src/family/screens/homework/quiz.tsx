import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { AppIcon } from "../../../components/app-icon";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { answerText, isAnswered, quizScore } from "../../lib/quiz";
import type { QuizQuestion } from "../../lib/quiz";
import { Enter, Reveal } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FButton, FErrorState, FHeader, FScreen, FSheet, FSkeleton, FStamp, FText } from "../../ui";

type Result = NonNullable<inferRouterOutputs<AppRouter>["portalHomework"]["attempts"]["result"]>;

/**
 * The quiz, one try. Opening it starts (or resumes) the attempt; each answer
 * saves as it's given. The bar on top jumps between questions. After handing
 * in, the stamp and every answer marked right or wrong.
 */
export function FamilyHomeworkQuiz() {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const ref = { studentId, studentAssignmentId: id ?? "" };
  const utils = trpc.useUtils();
  const detail = trpc.portalHomework.get.useQuery(ref, { enabled: studentId.length > 0 && !!id });
  const start = trpc.portalHomework.attempts.start.useMutation();
  const submit = trpc.portalHomework.attempts.submit.useMutation({
    onSuccess: () => {
      void utils.portalHomework.get.invalidate(ref);
      // The results read the saved answers back; the cached copy is from before answering.
      void utils.portalHomework.attempts.get.invalidate();
      void utils.portalHomework.list.invalidate();
    },
  });
  const quiz = detail.data?.quiz ?? null;
  const title = detail.data?.title ?? utils.portalHomework.list.getData({ studentId, filter: "all" })?.find((i) => i.studentAssignmentId === id)?.title ?? "";
  const finished = submit.isSuccess || quiz?.attemptStatus === "submitted" || quiz?.attemptStatus === "graded";
  const attemptId = quiz?.attemptId ?? start.data?.attemptId ?? null;
  const asked = useRef(false);

  useEffect(() => {
    if (detail.data && !finished && !asked.current) {
      asked.current = true;
      start.mutate({ studentAssignmentId: detail.data.studentAssignmentId });
    }
    // Start once when the homework has loaded; `start` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, finished]);

  const attempt = trpc.portalHomework.attempts.get.useQuery({ attemptId: attemptId ?? "" }, { enabled: !!attemptId });
  const result = trpc.portalHomework.attempts.result.useQuery({ attemptId: attemptId ?? "" }, { enabled: !!attemptId && finished });
  const close = () => (router.canGoBack() ? router.back() : router.replace("/family/homework"));

  const failed = (detail.isError && !detail.data) || start.isError || (attempt.isError && !attempt.data);
  if (failed) {
    return (
      <FScreen header={<FHeader title={title} onBack={close} backLabel={t("quiz.close")} />}>
        <FErrorState
          body={start.error?.message}
          onRetry={() => {
            asked.current = false;
            void detail.refetch();
            void attempt.refetch();
          }}
        />
      </FScreen>
    );
  }

  const questions = (attempt.data?.questions ?? []) as QuizQuestion[];
  const loading = detail.isPending || !attempt.data || (finished && result.isPending);

  if (loading) {
    return (
      <FScreen header={<FHeader title={title} onBack={close} backLabel={t("quiz.close")} />}>
        <View style={{ gap: theme.space.md }}>
          <FSkeleton height={8} />
          <FSkeleton width="70%" height={28} />
          <FSkeleton height={60} radius="lg" />
          <FSkeleton height={60} radius="lg" />
        </View>
      </FScreen>
    );
  }

  if (finished && result.data) {
    return <Results title={title} subject={detail.data?.subjectName ?? ""} questions={questions} result={result.data} onClose={close} />;
  }
  if (finished) {
    return (
      <FScreen header={<FHeader title={title} onBack={close} backLabel={t("quiz.close")} />}>
        <FText variant="body" color="muted">
          {t("quiz.hidden")}
        </FText>
      </FScreen>
    );
  }

  return (
    <Taking
      attemptId={attemptId ?? ""}
      questions={questions}
      onClose={close}
      submitting={submit.isPending}
      onSubmit={() => submit.mutate({ attemptId: attemptId ?? "" })}
    />
  );
}

function Taking({
  attemptId,
  questions,
  onClose,
  submitting,
  onSubmit,
}: {
  attemptId: string;
  questions: QuizQuestion[];
  onClose: () => void;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const format = useFormat();
  const [index, setIndex] = useState(0);
  const [given, setGiven] = useState<Record<string, unknown>>({});
  const [confirm, setConfirm] = useState(false);
  const save = trpc.portalHomework.attempts.saveAnswer.useMutation();
  const opt = theme.components.homework.option;
  const q = questions[index];
  const answerOf = (question: QuizQuestion) => (question.id in given ? given[question.id] : question.savedAnswer);
  const unanswered = questions.filter((question) => !isAnswered(question.questionType, answerOf(question))).length;

  const answer = (value: unknown, persist = true) => {
    if (!q) return;
    setGiven((all) => ({ ...all, [q.id]: value }));
    if (persist) save.mutate({ attemptId, assignmentQuestionId: q.id, answer: value });
  };
  const persistTyped = () => {
    if (q && q.id in given) save.mutate({ attemptId, assignmentQuestionId: q.id, answer: given[q.id] });
  };
  const go = (to: number) => {
    persistTyped();
    setIndex(to);
  };

  if (!q) return null;
  const value = answerOf(q);
  const picked = (Array.isArray((value as { option_ids?: unknown } | null)?.option_ids)
    ? (value as { option_ids: number[] }).option_ids
    : []) as number[];
  const last = index === questions.length - 1;

  return (
    <FScreen
      testID="family-homework-quiz"
      header={
        <View style={{ gap: theme.space.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("quiz.close")}
            hitSlop={12}
            onPress={onClose}
            style={{ minHeight: theme.touch.min, justifyContent: "center", alignSelf: "flex-start" }}
          >
            <AppIcon name="chevronLeft" size={24} color={theme.color.ink} />
          </Pressable>
          <View style={[styles.row, { gap: theme.space.xs }]}>
            {questions.map((question, i) => (
              <Pressable
                key={question.id}
                accessibilityRole="button"
                accessibilityLabel={t("quiz.of", { n: i + 1, total: questions.length })}
                hitSlop={{ top: 12, bottom: 12 }}
                onPress={() => go(i)}
                style={[
                  styles.seg,
                  {
                    borderRadius: theme.radius.full,
                    backgroundColor:
                      i === index ? opt.on : isAnswered(question.questionType, answerOf(question)) ? theme.color.ink : theme.color.surfaceSunk,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      }
    >
      <Enter key={q.id} style={{ gap: theme.space.md }}>
        <FText variant="meta" color="muted">
          {t("quiz.ofMarks", { n: index + 1, total: questions.length, count: Number(q.marks), marks: format.marks(q.marks) })}
        </FText>
        <FText variant="title">{q.body}</FText>
        {q.image ? (
          <Image
            source={{ uri: q.image.url }}
            recyclingKey={q.image.id}
            cachePolicy="disk"
            contentFit="contain"
            accessibilityIgnoresInvertColors
            style={{ width: "100%", aspectRatio: q.image.width && q.image.height ? q.image.width / q.image.height : 4 / 3, maxHeight: 280, borderRadius: theme.radius.lg, backgroundColor: theme.color.surfaceMuted }}
          />
        ) : null}
        {q.questionType === "mcq_multi" ? (
          <FText variant="meta" color="muted">
            {t("quiz.pickMany")}
          </FText>
        ) : null}

        {q.questionType === "mcq_single" || q.questionType === "mcq_multi" ? (
          <View style={{ gap: theme.space.sm }}>
            {(q.options ?? []).map((o, i) => {
              const on = picked.includes(o.id);
              return (
                <Option
                  key={o.id}
                  letter={String.fromCharCode(65 + i)}
                  text={o.text}
                  image={o.image?.thumbUrl ?? o.image?.url ?? null}
                  on={on}
                  onPress={() =>
                    answer({
                      option_ids:
                        q.questionType === "mcq_single" ? [o.id] : on ? picked.filter((p) => p !== o.id) : [...picked, o.id],
                    })
                  }
                />
              );
            })}
          </View>
        ) : q.questionType === "true_false" ? (
          <View style={{ gap: theme.space.sm }}>
            {[true, false].map((v) => (
              <Option
                key={String(v)}
                letter={v ? "T" : "F"}
                text={v ? t("quiz.true") : t("quiz.false")}
                on={(value as { value?: unknown } | null)?.value === v}
                onPress={() => answer({ value: v })}
              />
            ))}
          </View>
        ) : q.questionType === "numeric" || q.questionType === "fill_blank" || q.questionType === "short_answer" || q.questionType === "long_answer" ? (
          <TextInput
            testID="hw-quiz-input"
            value={answerText(q.questionType, value)}
            onChangeText={(text) =>
              answer(q.questionType === "numeric" ? { value: text.trim() === "" ? null : Number(text) } : { text }, false)
            }
            onBlur={persistTyped}
            keyboardType={q.questionType === "numeric" ? "decimal-pad" : "default"}
            multiline={q.questionType === "long_answer"}
            placeholder={q.questionType === "numeric" ? t("quiz.numberHere") : t("quiz.typeHere")}
            placeholderTextColor={theme.components.field.placeholder}
            accessibilityLabel={q.body}
            style={[
              theme.text("heading"),
              {
                minHeight: q.questionType === "long_answer" ? 140 : 60,
                backgroundColor: theme.components.field.bg,
                borderRadius: theme.components.field.radius,
                paddingHorizontal: theme.space.lg,
                paddingVertical: theme.space.md,
                color: theme.color.ink,
                textAlignVertical: q.questionType === "long_answer" ? "top" : "center",
              },
            ]}
          />
        ) : (
          <FText variant="body" color="muted">
            {t("quiz.unsupported")}
          </FText>
        )}
        {save.isError ? (
          <FText variant="meta" color="critical">
            {t("quiz.saveFailed")}
          </FText>
        ) : null}
      </Enter>

      <View style={[styles.row, { gap: theme.space.sm }]}>
        {index > 0 ? <FButton label={t("quiz.prev")} variant="secondary" onPress={() => go(index - 1)} style={styles.side} /> : null}
        {last ? (
          <FButton testID="hw-quiz-finish" label={t("quiz.finish")} onPress={() => { persistTyped(); setConfirm(true); }} style={styles.flex} />
        ) : (
          <FButton
            testID="hw-quiz-next"
            label={isAnswered(q.questionType, value) ? t("quiz.next") : t("quiz.skip")}
            icon="chevronRight"
            variant={isAnswered(q.questionType, value) ? "primary" : "secondary"}
            onPress={() => go(index + 1)}
            style={styles.flex}
          />
        )}
      </View>

      <FSheet visible={confirm} onDismiss={() => setConfirm(false)} title={t("quiz.confirmTitle")}>
        <View style={{ gap: theme.space.lg }}>
          <FText variant="body" color="muted">
            {unanswered > 0 ? t("quiz.confirmBody", { count: unanswered }) : t("quiz.confirmAll")}
          </FText>
          <FButton testID="hw-quiz-confirm" label={t("quiz.confirm")} block loading={submitting} onPress={onSubmit} />
          <FButton label={t("quiz.keepGoing")} variant="quiet" block onPress={() => setConfirm(false)} />
        </View>
      </FSheet>
    </FScreen>
  );
}

function Option({
  letter,
  text,
  image = null,
  on,
  onPress,
}: {
  letter: string;
  text: string;
  image?: string | null;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useFamilyTheme();
  const opt = theme.components.homework.option;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[
        styles.row,
        {
          gap: theme.space.md,
          minHeight: opt.height,
          paddingHorizontal: theme.space.lg,
          paddingVertical: theme.space.sm,
          borderRadius: opt.radius,
          backgroundColor: on ? opt.on : opt.bg,
        },
      ]}
    >
      <View style={[styles.letter, { borderRadius: theme.radius.xs, backgroundColor: theme.color.surface }]}>
        <FText variant="label" tint={on ? opt.on : theme.color.ink}>
          {letter}
        </FText>
      </View>
      {image ? (
        <Image source={{ uri: image }} cachePolicy="disk" contentFit="cover" style={{ width: 64, height: 64, borderRadius: theme.radius.sm }} />
      ) : null}
      <FText variant="bodyStrong" tint={on ? opt.onFg : theme.color.ink} style={styles.flex}>
        {text}
      </FText>
    </Pressable>
  );
}

function Results({
  title,
  subject,
  questions,
  result,
  onClose,
}: {
  title: string;
  subject: string;
  questions: QuizQuestion[];
  result: Result;
  onClose: () => void;
}) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const format = useFormat();
  const opt = theme.components.homework.option;
  const score = quizScore(result);
  const tf = { yes: t("quiz.true"), no: t("quiz.false") };

  return (
    <FScreen testID="family-homework-quiz-result" header={<FHeader title={title} onBack={onClose} backLabel={t("quiz.close")} />}>
      {result.scoreVisible ? (
        <View style={[styles.center, { paddingVertical: theme.space.lg }]}>
          <Enter>
            <FStamp
              tone="coral"
              kicker={t("quiz.resultKicker", { subject })}
              value={format.marks(result.totalScore)}
              unit={`/${format.marks(result.maxScore)}`}
              sub={t("quiz.right", { right: score.right, total: questions.length })}
              width={230}
            />
          </Enter>
        </View>
      ) : (
        <FText variant="body" color="muted">
          {t("quiz.hidden")}
        </FText>
      )}
      {score.pending > 0 ? (
        <FText variant="meta" color="muted">
          {t("quiz.checking")}
        </FText>
      ) : null}
      {result.scoreVisible ? (
        <Reveal loading={false} placeholder={null}>
          <View style={{ gap: theme.space.md }}>
            <FText variant="label" color="muted">
              {t("quiz.yourAnswers")}
            </FText>
            {questions.map((q, i) => {
              const a = result.answers.find((x) => x.assignmentQuestionId === q.id);
              const right = a?.isCorrect;
              const mine = answerText(q.questionType, q.savedAnswer, q.options, tf) || t("quiz.noAnswer");
              const key = a?.correctOptionIds?.length
                ? answerText(q.questionType, { option_ids: a.correctOptionIds }, q.options, tf)
                : a?.correctAnswer !== undefined && a.correctAnswer !== null
                  ? answerText(q.questionType, a.correctAnswer, q.options, tf)
                  : null;
              return (
                <View
                  key={q.id}
                  style={[
                    styles.row,
                    {
                      gap: theme.space.md,
                      padding: theme.space.lg,
                      borderRadius: opt.radius,
                      backgroundColor: right === true ? opt.right : right === false ? opt.wrong : theme.color.surfaceMuted,
                    },
                  ]}
                >
                  <View style={[styles.flex, { gap: 2 }]}>
                    <FText variant="bodyStrong">{t("quiz.numbered", { n: i + 1, body: q.body })}</FText>
                    <FText variant="meta" color="muted">
                      {right === false ? t("quiz.you", { answer: mine }) : mine}
                    </FText>
                    {right === false && key ? (
                      <FText variant="meta" color="positive">
                        {t("quiz.correct", { answer: key })}
                      </FText>
                    ) : null}
                  </View>
                  {right === true ? (
                    <AppIcon name="check" size={22} color={opt.rightEdge} />
                  ) : right === false ? (
                    <AppIcon name="close" size={22} color={opt.wrongEdge} />
                  ) : (
                    <AppIcon name="clock" size={20} color={theme.color.muted} />
                  )}
                </View>
              );
            })}
            {!result.answersVisible ? (
              <FText variant="meta" color="muted">
                {t("quiz.keyLater")}
              </FText>
            ) : null}
          </View>
        </Reveal>
      ) : null}
    </FScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  side: { minWidth: 110 },
  center: { alignItems: "center" },
  seg: { flex: 1, height: 6 },
  letter: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});

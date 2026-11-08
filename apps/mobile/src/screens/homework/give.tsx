import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import type { ComesBack, GradingMode } from "@repo/contracts";

import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { StepProgress } from "../../components/step-progress";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  KIND_COMES_BACK,
  KIND_GRADING,
  DUE_TIME,
  dueInstant,
  duePresets,
  formatDue,
  gradingOptions,
  pickedLabel,
  pickedStudents,
  type GiveKind,
} from "../../lib/homework";
import { trpc } from "../../lib/trpc";
import { spacing } from "../../theme/tokens";
import { toSnapshotQuestion, type QuestionDraft } from "../../lib/homework-questions";
import { DueChips } from "./pickers";
import { QuizRulesStep, QuizWorkStep, type QuizRules } from "./give-quiz";
import { ClassesStep, Crumbs, KIND_ICON, KindStep, StepQuestion, WhenStep, WorkStep, todayLocal } from "./give-steps";
import { showGivenToast } from "./toast-store";
import { usePhotoUploads } from "./use-photo-uploads";

const text = copy.homework.give;
const STEPS = 4;
type Step = 0 | 1 | 2 | 3;

/**
 * Give (frames 5 to 14): what → classes → the work → when and how, one
 * question per screen like the admission flow. Back walks the steps; leaving
 * with work typed asks first. Step 4 starts from this teacher's last choices
 * for the subject, so most days it is a glance and Give.
 */
export function GiveScreen() {
  const { organizationId, schoolId } = useActiveContext();
  const utils = trpc.useUtils();
  const scopeInput = { organizationId: organizationId ?? "", ...(schoolId ? { schoolId } : {}) };

  const [step, setStep] = useState<Step>(0);
  const [kind, setKind] = useState<GiveKind | null>(null);
  // Opened from a class page ("Give to 6A"): that class is already picked.
  const preset = useLocalSearchParams<{ sectionId?: string; subjectId?: string }>();
  const fromClass = Boolean(preset.sectionId && preset.subjectId);
  const [pickedSubjectId, setSubjectId] = useState<string | null>(preset.subjectId ?? null);
  const [pickedSectionIds, setSectionIds] = useState<string[]>(preset.sectionId ? [preset.sectionId] : []);
  const [work, setWork] = useState({ title: "", details: "", book: "", pages: "" });
  const [showErrors, setShowErrors] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const today = todayLocal();
  const [dueDay, setDueDay] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState(DUE_TIME);
  // Step 4's choices: null until the teacher touches one, so the subject's
  // defaults (or "Same as last time") show through.
  const [comesBackChoice, setComesBack] = useState<ComesBack | null>(null);
  const [gradingChoice, setGradingMode] = useState<GradingMode | null>(null);
  const [maxMarksChoice, setMaxMarks] = useState<number | null>(null);
  const [minutesChoice, setMinutes] = useState<number | null | undefined>(undefined);
  const [lateDays, setLateDays] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  // A quiz rides the same four steps; its step 3 is questions, its step 4 the close time and rules.
  const [isQuiz, setIsQuiz] = useState(false);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [rules, setRules] = useState<QuizRules>({ showScore: true, showAnswers: true });
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState<unknown>(null);

  const pairsQuery = trpc.homework.pairs.useQuery(scopeInput, {
    enabled: Boolean(organizationId),
    staleTime: 60_000,
  });
  const pairs = useMemo(() => pairsQuery.data ?? [], [pairsQuery.data]);
  const singleClass = pairs.length === 1 && pairs[0]!.sections.length === 1;
  // One subject with one class: nothing to pick, so it is picked.
  const subjectId = pickedSubjectId ?? (singleClass ? pairs[0]!.subjectId : null);
  const sectionIds = pickedSectionIds.length || !singleClass ? pickedSectionIds : [pairs[0]!.sections[0]!.sectionId];

  const lastQuery = trpc.homework.list.useQuery(
    { ...scopeInput, mine: true, limit: 1 },
    { enabled: Boolean(organizationId), staleTime: 60_000 },
  );
  const last = lastQuery.data?.[0] ?? null;

  const defaultsQuery = trpc.homework.defaults.useQuery(
    { ...scopeInput, subjectId: subjectId ?? "", kind: kind ?? "homework" },
    { enabled: Boolean(organizationId && subjectId && kind), staleTime: 60_000 },
  );

  // Step 4 starts from the teacher's last choices for this subject and type.
  const d = defaultsQuery.data;
  const presets = kind ? duePresets(kind, today) : [];
  const due = dueDay ?? presets[0]?.day ?? today;
  const kindBacks: readonly ComesBack[] = kind ? KIND_COMES_BACK[kind] : ["brought"];
  const back: ComesBack =
    comesBackChoice ?? (d && kindBacks.includes(d.comesBack) ? d.comesBack : kindBacks[0]!);
  const allowedGrading = kind ? gradingOptions(kind, back) : (["none"] as const);
  const gradingMode: GradingMode =
    gradingChoice && allowedGrading.includes(gradingChoice)
      ? gradingChoice
      : d && allowedGrading.includes(d.gradingMode)
        ? d.gradingMode
        : allowedGrading[0]!;
  const maxMarks = maxMarksChoice ?? (d?.maxMarks ? Math.round(Number(d.maxMarks)) : 10);
  // Pre-picked: the subject's last choice, else 30 minutes.
  const minutes = minutesChoice === undefined ? (d?.estimatedMinutes ?? 30) : minutesChoice;

  const pair = subjectId && sectionIds[0] ? { sectionId: sectionIds[0], subjectId } : null;
  const uploads = usePhotoUploads(pair);
  const labels = pickedLabel(pairs, subjectId, sectionIds);
  const students = pickedStudents(pairs, subjectId, sectionIds);

  const create = trpc.homework.create.useMutation({
    onSuccess: (hw, vars) => {
      // A quiz finishes in submitQuiz, after its questions are attached.
      if (vars.kind === "quiz") return;
      setFinished(true);
      void utils.homework.home.invalidate();
      void utils.homework.list.invalidate();
      showGivenToast({ id: hw.id, labels, draft: !vars.give, sectionId: vars.sectionId, subjectId: vars.subjectId });
      router.dismissTo("/homework" as never);
    },
  });

  const setQuestionsMut = trpc.homework.questions.set.useMutation();
  const giveMut = trpc.homework.give.useMutation();

  /** Create the quiz as a draft, attach its questions, then give it: three calls, one tap. */
  const submitQuiz = async (giveNow: boolean) => {
    if (!subjectId || sectionIds.length === 0 || !organizationId) return;
    setQuizBusy(true);
    setQuizError(null);
    const p = { organizationId, sectionId: sectionIds[0]!, subjectId };
    try {
      const hw = await create.mutateAsync({
        ...p,
        kind: "quiz",
        sectionIds,
        title: work.title.trim(),
        dueAt: dueInstant(due, dueTime),
        give: false,
      });
      await setQuestionsMut.mutateAsync({
        ...p,
        id: hw.id,
        questions: questions.map((d, i) => toSnapshotQuestion(d, i + 1)),
        settings: {
          showScore: rules.showScore ? "after_submit" : "after_close",
          showAnswers: rules.showAnswers ? "after_close" : "never",
        },
      });
      if (giveNow) await giveMut.mutateAsync({ ...p, id: hw.id });
      setFinished(true);
      void utils.homework.home.invalidate();
      void utils.homework.list.invalidate();
      showGivenToast({ id: hw.id, labels, draft: !giveNow, sectionId: p.sectionId, subjectId });
      router.dismissTo("/homework" as never);
    } catch (cause) {
      setQuizError(cause);
    } finally {
      setQuizBusy(false);
    }
  };

  const errors = {
    title: kind !== "reading" && !work.title.trim() ? text.titleRequired : undefined,
    book: kind === "reading" && !work.book.trim() ? text.bookRequired : undefined,
    pages: kind === "reading" && !work.pages.trim() ? text.pagesRequired : undefined,
  };
  const workValid = !errors.title && !errors.book && !errors.pages;

  const dirty = kind !== null && !finished;
  // Back walks the steps; on the first step it leaves (guarded below).
  usePreventRemove(!finished && step > 0, () => {
    if (create.isPending) return;
    setStep((s) => (s === 2 && (singleClass || fromClass) ? 0 : ((s - 1) as Step)));
  });
  useUnsavedChanges(dirty && step === 0, {
    title: text.leaveTitle,
    body: text.leaveBody,
    keepEditing: copy.forms.keepEditing,
    discard: copy.forms.discard,
  });

  const resetChoices = () => {
    setComesBack(null);
    setGradingMode(null);
    setMaxMarks(null);
    setMinutes(undefined);
  };

  const pickKind = (picked: GiveKind | "quiz") => {
    const quiz = picked === "quiz";
    const k: GiveKind = quiz ? "homework" : picked;
    setIsQuiz(quiz);
    setKind(k);
    if (k !== kind || quiz !== isQuiz) {
      resetChoices();
      setDueDay(null);
    }
    setStep(singleClass || fromClass ? 2 : 1);
  };

  const toggleSection = (sid: string, sec: string) => {
    if (sid !== subjectId) {
      setSubjectId(sid);
      setSectionIds([sec]);
      resetChoices();
      return;
    }
    setSectionIds((all) => (all.includes(sec) ? all.filter((x) => x !== sec) : [...all, sec]));
  };

  const lastSubject = last && last.kind !== "quiz" ? pairs.find((p) => p.subjectId === last.subjectId) : undefined;
  const lastIds =
    last && lastSubject
      ? last.sections.map((s) => s.sectionId).filter((id) => lastSubject.sections.some((x) => x.sectionId === id))
      : [];
  const sameAsLast = !last || !lastSubject || lastIds.length === 0 ? null : {
      label: `${text.kinds[last.kind]} · ${lastSubject.subjectName} · ${pickedLabel(pairs, last.subjectId, lastIds)}`,
      onPress: () => {
        setKind(last.kind as GiveKind);
        setSubjectId(last.subjectId);
        setSectionIds(lastIds);
        setComesBack(last.comesBack);
        setGradingMode(last.gradingMode);
        setMaxMarks(last.maxMarks ? Math.round(Number(last.maxMarks)) : null);
        setMinutes(last.estimatedMinutes);
        setDueDay(null);
        setStep(2);
      },
    };

  const submit = (give: boolean) => {
    if (isQuiz) {
      void submitQuiz(give);
      return;
    }
    if (!kind || !subjectId || sectionIds.length === 0 || !organizationId) return;
    const dueAt = dueInstant(due, dueTime);
    const closeAt = lateDays > 0 ? new Date(new Date(dueAt).getTime() + lateDays * 86_400_000).toISOString() : undefined;
    const base = {
      organizationId,
      sectionId: sectionIds[0]!,
      subjectId,
      sectionIds,
      dueAt,
      ...(closeAt ? { closeAt } : {}),
      ...(minutes ? { estimatedMinutes: minutes } : {}),
      give,
    };
    if (kind === "reading") {
      create.mutate({
        ...base,
        kind,
        book: work.book.trim(),
        pages: work.pages.trim(),
        comesBack: back === "none" ? "none" : "tick",
      });
      return;
    }
    create.mutate({
      ...base,
      kind,
      title: work.title.trim(),
      ...(work.details.trim() ? { details: work.details.trim() } : {}),
      fileObjectIds: uploads.objectIds,
      comesBack: back,
      gradingMode,
      ...(gradingMode === "marks" ? { maxMarks: String(maxMarks) } : {}),
    });
  };

  const continueFrom = () => {
    if (step === 1 && sectionIds.length > 0) setStep(2);
    if (step === 2) {
      setShowErrors(true);
      if (isQuiz) {
        if (work.title.trim() && questions.length > 0) setStep(3);
        return;
      }
      if (!workValid) return;
      if (uploads.busy || uploads.failed) {
        setPhotoMessage(uploads.busy ? text.photosWaiting : text.photoFailed);
        return;
      }
      setPhotoMessage(null);
      setStep(3);
    }
  };

  const addPhoto = () => {
    Alert.alert(text.addPhoto, undefined, [
      { text: text.takePhoto, onPress: () => void uploads.add("camera").then(setPhotoMessage) },
      { text: text.choosePhotos, onPress: () => void uploads.add("library").then(setPhotoMessage) },
      { text: copy.common.cancel, style: "cancel" },
    ]);
  };

  const subjectName = pairs.find((p) => p.subjectId === subjectId)?.subjectName ?? "";
  const crumbs = [
    ...(kind
      ? [{ label: isQuiz ? text.kinds.quiz : text.kinds[kind], icon: KIND_ICON[isQuiz ? "quiz" : kind], onPress: () => setStep(0) }]
      : []),
    ...(subjectName ? [{ label: subjectName, onPress: singleClass ? undefined : () => setStep(1) }] : []),
    ...(labels ? [{ label: labels, onPress: singleClass ? undefined : () => setStep(1) }] : []),
    ...(step === 3 ? [{ label: kind === "reading" ? work.book : work.title, onPress: () => setStep(2) }] : []),
  ];

  return (
    <ScreenFrame
      key={step}
      title={text.title}
      meta={text.step(step + 1, STEPS)}
      titleInTopRow
      backAccessibilityLabel={copy.common.back}
      backTestID="give-back"
      stickyHeader={<StepProgress current={step} total={STEPS} label={text.progress(step + 1, STEPS)} testID="give-progress" />}
      footer={
        step === 0 ? undefined : (
          <View style={styles.footer}>
            {create.isError && !isQuiz ? (
              <Notice tone="critical" message={toFriendlyError(create.error).message} testID="give-error" />
            ) : null}
            {quizError ? <Notice tone="critical" message={toFriendlyError(quizError).message} testID="give-quiz-error" /> : null}
            {step === 1 ? (
              <CapsuleButton
                title={sectionIds.length ? text.nextWithClasses(labels, students) : text.next}
                onPress={continueFrom}
                disabled={sectionIds.length === 0}
                testID="give-next"
                style={styles.stretch}
              />
            ) : step === 2 ? (
              <CapsuleButton title={text.next} onPress={continueFrom} testID="give-next" style={styles.stretch} />
            ) : (
              <View style={styles.row}>
                <CapsuleButton
                  title={text.draft}
                  variant="secondary"
                  onPress={() => submit(false)}
                  disabled={create.isPending || quizBusy}
                  testID="give-draft"
                  style={styles.draft}
                />
                <CapsuleButton
                  title={create.isPending || quizBusy ? text.giving : text.giveTo(labels)}
                  icon="check"
                  onPress={() => submit(true)}
                  loading={create.isPending || quizBusy}
                  disabled={create.isPending || quizBusy}
                  testID="give-submit"
                  style={styles.grow}
                />
              </View>
            )}
          </View>
        )
      }
    >
      {step > 0 ? <Crumbs items={crumbs} /> : null}

      {step === 0 ? <KindStep value={isQuiz ? "quiz" : kind} onPick={pickKind} sameAsLast={sameAsLast} /> : null}

      {step === 1 ? (
        <ClassesStep
          pairs={pairs}
          loading={pairsQuery.isPending}
          error={pairsQuery.isError ? <ErrorCard cause={pairsQuery.error} onRetry={() => void pairsQuery.refetch()} /> : null}
          subjectId={subjectId}
          sectionIds={sectionIds}
          onToggle={toggleSection}
          onSelectAll={(sid) => {
            const subject = pairs.find((p) => p.subjectId === sid);
            if (!subject) return;
            const all = subject.sections.map((s) => s.sectionId);
            const allOn = sid === subjectId && all.every((x) => sectionIds.includes(x));
            if (sid !== subjectId) resetChoices();
            setSubjectId(sid);
            setSectionIds(allOn ? [] : all);
          }}
        />
      ) : null}

      {step === 2 && isQuiz ? (
        <View>
          <StepQuestion>{text.workTitle}</StepQuestion>
          <QuizWorkStep
            subjectId={subjectId ?? ""}
            subjectName={subjectName}
            title={work.title}
            onTitle={(v) => setWork((w) => ({ ...w, title: v }))}
            titleError={showErrors && !work.title.trim() ? text.titleRequired : undefined}
            questions={questions}
            onQuestions={setQuestions}
            questionsError={showErrors && questions.length === 0 ? text.quizNeedsQuestion : undefined}
          />
        </View>
      ) : null}

      {step === 3 && isQuiz ? (
        <View style={styles.quizWhen}>
          <StepQuestion meta={formatDue(dueInstant(due, dueTime))}>{text.whenTitle}</StepQuestion>
          <StepLabel>{text.closes}</StepLabel>
          <DueChips presets={presets} day={due} onDay={setDueDay} time={dueTime} onTime={setDueTime} minimumDate={today} />
          <QuizRulesStep rules={rules} onRules={setRules} />
        </View>
      ) : null}

      {step === 2 && kind && !isQuiz ? (
        <View>
          <StepQuestion>{text.workTitle}</StepQuestion>
          <WorkStep
            kind={kind}
            {...work}
            errors={showErrors ? errors : {}}
            onChange={(patch) => setWork((w) => ({ ...w, ...patch }))}
            photos={uploads.photos}
            onAddPhoto={addPhoto}
            onRemovePhoto={uploads.remove}
            onRetryPhoto={uploads.retry}
            photoMessage={photoMessage}
          />
        </View>
      ) : null}

      {step === 3 && kind && !isQuiz ? (
        <View>
          <StepQuestion meta={formatDue(dueInstant(due, dueTime))}>{text.whenTitle}</StepQuestion>
          <WhenStep
            kind={kind}
            presets={presets}
            dueDay={due}
            onDueDay={setDueDay}
            dueTime={dueTime}
            onDueTime={setDueTime}
            comesBack={back}
            onComesBack={(v) => {
              setComesBack(v);
              const allowed = gradingOptions(kind, v);
              if (!allowed.includes(gradingMode)) setGradingMode(allowed[0]!);
              else if (gradingMode === "none" && allowed.length > 1 && KIND_GRADING[kind][0] !== "none") {
                setGradingMode(KIND_GRADING[kind][0]);
              }

            }}
            gradingMode={gradingMode}
            onGradingMode={setGradingMode}
            maxMarks={maxMarks}
            onMaxMarks={setMaxMarks}
            minutes={minutes}
            onMinutes={setMinutes}
            lateDays={lateDays}
            onLateDays={setLateDays}
            moreOpen={moreOpen}
            onToggleMore={() => setMoreOpen((o) => !o)}
            todayIso={today}
            hasGradeScale
          />
        </View>
      ) : null}
    </ScreenFrame>
  );
}

function StepLabel({ children }: { children: string }) {
  return (
    <ThemedText variant="sectionLabel" style={styles.stepLabel}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  quizWhen: { gap: spacing.md },
  stepLabel: { marginTop: spacing.sm },
  footer: { gap: spacing.sm },
  stretch: { alignSelf: "stretch" },
  row: { flexDirection: "row", gap: spacing.sm },
  draft: { minWidth: 104 },
  grow: { flex: 1 },
});

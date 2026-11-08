import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import type { ComesBack, GradingMode } from "@repo/contracts";

import { CapsuleButton } from "../../components/capsule-button";
import { ErrorCard } from "../../components/error-card";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { StepProgress } from "../../components/step-progress";
import { useActiveContext } from "../../hooks/use-active-context";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import {
  KIND_COMES_BACK,
  KIND_GRADING,
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
  const [pickedSubjectId, setSubjectId] = useState<string | null>(null);
  const [pickedSectionIds, setSectionIds] = useState<string[]>([]);
  const [work, setWork] = useState({ title: "", details: "", book: "", pages: "" });
  const [showErrors, setShowErrors] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const today = todayLocal();
  const [dueDay, setDueDay] = useState<string | null>(null);
  // Step 4's choices: null until the teacher touches one, so the subject's
  // defaults (or "Same as last time") show through.
  const [comesBackChoice, setComesBack] = useState<ComesBack | null>(null);
  const [gradingChoice, setGradingMode] = useState<GradingMode | null>(null);
  const [maxMarksChoice, setMaxMarks] = useState<number | null>(null);
  const [minutesChoice, setMinutes] = useState<number | null | undefined>(undefined);
  const [lateDays, setLateDays] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [finished, setFinished] = useState(false);

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
  const minutes = minutesChoice === undefined ? (d?.estimatedMinutes ?? null) : minutesChoice;

  const pair = subjectId && sectionIds[0] ? { sectionId: sectionIds[0], subjectId } : null;
  const uploads = usePhotoUploads(pair);
  const labels = pickedLabel(pairs, subjectId, sectionIds);
  const students = pickedStudents(pairs, subjectId, sectionIds);

  const create = trpc.homework.create.useMutation({
    onSuccess: (hw, vars) => {
      setFinished(true);
      void utils.homework.home.invalidate();
      void utils.homework.list.invalidate();
      showGivenToast({ id: hw.id, labels, draft: !vars.give, sectionId: vars.sectionId, subjectId: vars.subjectId });
      router.dismissTo("/homework" as never);
    },
  });

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
    setStep((s) => (s === 2 && singleClass ? 0 : ((s - 1) as Step)));
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

  const pickKind = (k: GiveKind) => {
    setKind(k);
    if (k !== kind) {
      resetChoices();
      setDueDay(null);
    }
    setStep(singleClass ? 2 : 1);
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
    if (!kind || !subjectId || sectionIds.length === 0 || !organizationId) return;
    const dueAt = dueInstant(due);
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
    ...(kind ? [{ label: text.kinds[kind], icon: KIND_ICON[kind], onPress: () => setStep(0) }] : []),
    ...(subjectName ? [{ label: subjectName, onPress: singleClass ? undefined : () => setStep(1) }] : []),
    ...(labels ? [{ label: labels, onPress: singleClass ? undefined : () => setStep(1) }] : []),
    ...(step === 3 ? [{ label: kind === "reading" ? work.book : work.title, onPress: () => setStep(2) }] : []),
  ];

  return (
    <ScreenFrame
      key={step}
      title={text.title}
      meta={text.step(step + 1, STEPS)}
      backAccessibilityLabel={copy.common.back}
      backTestID="give-back"
      stickyHeader={<StepProgress current={step} total={STEPS} label={text.progress(step + 1, STEPS)} testID="give-progress" />}
      footer={
        step === 0 ? undefined : (
          <View style={styles.footer}>
            {create.isError ? (
              <Notice tone="critical" message={toFriendlyError(create.error).message} testID="give-error" />
            ) : null}
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
                  disabled={create.isPending}
                  testID="give-draft"
                  style={styles.draft}
                />
                <CapsuleButton
                  title={create.isPending ? text.giving : text.giveTo(labels)}
                  icon="check"
                  onPress={() => submit(true)}
                  loading={create.isPending}
                  disabled={create.isPending}
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

      {step === 0 ? <KindStep value={kind} onPick={pickKind} sameAsLast={sameAsLast} /> : null}

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
            if (sid !== subjectId) resetChoices();
            setSubjectId(sid);
            setSectionIds(subject.sections.map((s) => s.sectionId));
          }}
        />
      ) : null}

      {step === 2 && kind ? (
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

      {step === 3 && kind ? (
        <View>
          <StepQuestion meta={formatDue(dueInstant(due))}>{text.whenTitle}</StepQuestion>
          <WhenStep
            kind={kind}
            presets={presets}
            dueDay={due}
            onDueDay={setDueDay}
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

const styles = StyleSheet.create({
  footer: { gap: spacing.sm },
  stretch: { alignSelf: "stretch" },
  row: { flexDirection: "row", gap: spacing.sm },
  draft: { minWidth: 104 },
  grow: { flex: 1 },
});

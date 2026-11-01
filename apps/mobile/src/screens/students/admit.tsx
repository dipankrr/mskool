import { useMemo, useState } from "react";
import { ActivityIndicator, Keyboard, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import type { AddGuardianInput, CreateEnrollmentInput } from "@repo/contracts";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { EmptyState } from "../../components/empty-state";
import { LinkRow } from "../../components/link-row";
import { Notice } from "../../components/notice";
import { ScreenFrame } from "../../components/screen-frame";
import { SectionLabel } from "../../components/section-label";
import { Skeleton } from "../../components/skeleton";
import { StepProgress } from "../../components/step-progress";
import { ThemedText } from "../../components/themed-text";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { useUnsavedChanges } from "../../hooks/use-unsaved-changes";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate, todayIso } from "../../lib/format";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  admitSteps,
  emptyFamilyForm,
  familyPayloads,
  filledMoreGroups,
  filledSlots,
  findPossibleDuplicate,
  fullFormProblems,
  isAdmissionNumberRefusal,
  relationFor,
  sectionStrength,
  studentFullName,
  suggestAdmissionNumber,
  validateFamilyStep,
  validateFullStudent,
  validateStudentStep,
  type AdmitStep,
  type FamilyForm,
  type FamilySlot,
} from "./admit-logic";
import { ClassStep, FamilyStep, ReviewStep, StudentStep } from "./admit-steps";
import { enrollmentCreatePayload, guardianRelationLabel } from "./people-logic";
import {
  emptyStudentForm,
  isStudentFormDirty,
  studentCreatePayload,
  type StudentForm,
  type StudentFormField,
} from "./student-form";
import { StudentMoreFields } from "./student-more-fields";
import { photoUploadBody, StudentPhotoView, type PickedImage } from "./student-photo";

/**
 * Admit a student (plan `.kilo/plans/2026-11-01-admit-flow.md`): who, which
 * class, which family, check, done. One route with in-screen steps, because the
 * typed work belongs to one admission and nothing reaches the server until Check.
 *
 * Address, health and background aren't in the steps, so a counter admission
 * asks only what the desk needs today. "Full form" shows every field on one
 * screen for the desk holding a filled-in paper form; both are views of the same
 * typed work, so switching loses nothing.
 */
export function AdmitStudentScreen() {
  const { organizationId, schoolId, ready } = useActiveContext();
  const { has } = usePermissions();
  // Bumped by "Admit another": a fresh mount is what clears the flow.
  const [run, setRun] = useState(0);

  const frame = (body: React.ReactNode) => (
    <ScreenFrame
      title={copy.admit.title}
      backAccessibilityLabel={copy.common.back}
      backTestID="admit-back"
    >
      {body}
    </ScreenFrame>
  );

  if (!ready) return frame(<Skeleton height={220} />);
  if (!organizationId || !schoolId) {
    return frame(
      <EmptyState
        icon="students"
        title={copy.students.noOrgTitle}
        message={copy.students.noOrgBody}
      />,
    );
  }
  if (!has("student:read") || !has("student:create")) {
    return frame(
      <EmptyState
        icon="shield"
        title={copy.denied.studentsWriteTitle}
        message={copy.denied.studentsWriteBody}
        testID="admit-denied"
      />,
    );
  }

  return (
    <AdmitFlow
      key={run}
      organizationId={organizationId}
      schoolId={schoolId}
      onAdmitAnother={() => setRun((current) => current + 1)}
    />
  );
}

/** One save that follows the student, with what Done needs to show and retry it. */
type AdmitTask =
  | { kind: "photo"; photo: PickedImage; error: unknown }
  | { kind: "enrollment"; payload: CreateEnrollmentInput; label: string; error: unknown }
  | {
      kind: "guardian";
      slot: FamilySlot;
      payload: AddGuardianInput;
      who: string;
      error: unknown;
    };

type Admitted = {
  id: string;
  name: string;
  firstName: string;
  admissionNumber: string;
  admissionDate: string | null;
  photoUri: string | null;
  tasks: AdmitTask[];
};

function AdmitFlow({
  organizationId,
  schoolId,
  onAdmitAnother,
}: {
  organizationId: string;
  schoolId: string;
  onAdmitAnother: () => void;
}) {
  const { academicYear } = useActiveContext();
  const { has } = usePermissions();
  const canEnroll = has("enrollment:create");
  const canReadEnrollments = has("enrollment:read");
  const canAddFamily = has("student:update");
  const canGoToFees = has("fee_payment:create");

  const steps = useMemo(
    () => admitSteps({ enroll: canEnroll, addFamily: canAddFamily }),
    [canEnroll, canAddFamily],
  );

  const [initial] = useState<StudentForm>(() => ({
    ...emptyStudentForm(),
    admissionDate: todayIso(),
  }));
  const [form, setForm] = useState<StudentForm>(initial);
  const [family, setFamily] = useState<FamilyForm>(emptyFamilyForm);
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickedImage | null>(null);

  const [fullForm, setFullForm] = useState(false);
  const [step, setStep] = useState<AdmitStep>("student");
  // Arrived from Check's Edit: Continue goes straight back there.
  const [returnToCheck, setReturnToCheck] = useState(false);
  const [touched, setTouched] = useState<Set<StudentFormField>>(new Set());
  const [attempted, setAttempted] = useState<Set<AdmitStep>>(new Set());
  const [numberRefusal, setNumberRefusal] = useState<{ value: string; message: string } | null>(
    null,
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [admitted, setAdmitted] = useState<Admitted | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const register = trpc.student.list.useQuery({ organizationId, schoolId });
  const classes = trpc.academic.class.list.useQuery(
    { organizationId, schoolId },
    { enabled: canEnroll },
  );
  const sections = trpc.academic.section.list.useQuery(
    { organizationId, schoolId, academicYearId: academicYear?.id ?? "" },
    { enabled: canEnroll && Boolean(academicYear?.id) },
  );
  const enrollments = trpc.enrollment.list.useQuery(
    { organizationId, schoolId, academicYearId: academicYear?.id ?? "" },
    { enabled: canEnroll && canReadEnrollments && Boolean(academicYear?.id) },
  );

  const utils = trpc.useUtils();
  const createStudent = trpc.student.create.useMutation();
  const createEnrollment = trpc.enrollment.create.useMutation();
  const addGuardian = trpc.guardian.add.useMutation();
  const uploadPhoto = trpc.student.uploadPhoto.useMutation();

  const rows = useMemo(() => register.data ?? [], [register.data]);
  const studentErrors = useMemo(() => {
    const errors = fullForm ? validateFullStudent(form, rows) : validateStudentStep(form, rows);
    if (numberRefusal && numberRefusal.value === form.admissionNumber) {
      errors.admissionNumber = numberRefusal.message;
    }
    return errors;
  }, [form, rows, numberRefusal, fullForm]);
  const familyErrors = useMemo(() => validateFamilyStep(family), [family]);

  const strength = useMemo(
    () => (enrollments.data ? sectionStrength(enrollments.data) : null),
    [enrollments.data],
  );
  const classOptions = (classes.data ?? []).map(({ id, name }) => ({ id, name }));
  const sectionsOf = (id: string | null) =>
    (sections.data ?? [])
      .filter((section) => section.classId === id)
      .map((section) => ({
        id: section.id,
        name: section.name,
        strength: strength ? (strength.get(section.id) ?? 0) : null,
      }));

  const className = classOptions.find((option) => option.id === classId)?.name ?? null;
  const sectionName = sectionsOf(classId).find((option) => option.id === sectionId)?.name ?? null;
  const placement = className
    ? [className, sectionName ? copy.admit.class.sectionName(sectionName) : null]
        .filter(Boolean)
        .join(" · ")
    : null;

  const stepIndex = steps.indexOf(step);
  const dirty =
    isStudentFormDirty(form, initial) ||
    filledSlots(family).length > 0 ||
    classId !== null ||
    photo !== null;

  // Back walks the steps, from any control: header, hardware or swipe. On the
  // first step it's a real exit, which guards typed work. Once the student is
  // saved there's nothing left to protect, and back returns to the roster.
  const exitsFlow = fullForm || (stepIndex === 0 && !returnToCheck);
  usePreventRemove(!admitted && (saving || !exitsFlow), () => {
    if (saving) return;
    if (returnToCheck) {
      setReturnToCheck(false);
      setStep("review");
      return;
    }
    const previous = steps[stepIndex - 1];
    if (previous) setStep(previous);
  });
  useUnsavedChanges(!admitted && !saving && exitsFlow && dirty, {
    title: copy.admit.discardTitle,
    body: copy.admit.discardBody,
    keepEditing: copy.forms.keepEditing,
    discard: copy.forms.discard,
  });

  const setField = (field: StudentFormField, value: string | null) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError(null);
  };
  // Passing through an empty field isn't a mistake (the photo sits above the
  // name), so a blank one waits for Continue before it turns red.
  const touch = (field: StudentFormField) => {
    if (form[field]) setTouched((current) => new Set(current).add(field));
  };
  const studentFieldError = (field: StudentFormField) =>
    touched.has(field) || attempted.has("student") ? studentErrors[field] : undefined;

  const chooseClass = (id: string) => {
    // Tapping the chosen class clears it, the only way back to "no class".
    const next = id === classId ? null : id;
    setClassId(next);
    const options = sectionsOf(next);
    setSectionId(options.length === 1 ? (options[0]?.id ?? null) : null);
  };

  const continueFrom = () => {
    // Otherwise the keyboard covers the very fields a refusal points at.
    Keyboard.dismiss();
    setAttempted((current) => new Set(current).add(step));
    if (step === "student" && Object.keys(studentErrors).length > 0) return;
    if (step === "family" && Object.keys(familyErrors).length > 0) return;
    if (returnToCheck) {
      setReturnToCheck(false);
      setStep("review");
      return;
    }
    const next = steps[stepIndex + 1];
    if (next) setStep(next);
  };

  const runTask = async (studentId: string, task: AdmitTask): Promise<AdmitTask> => {
    try {
      if (task.kind === "photo") {
        const saved = await uploadPhoto.mutateAsync({
          organizationId,
          id: studentId,
          data: await photoUploadBody(task.photo),
        });
        utils.student.photo.setData(
          { organizationId, id: studentId },
          { objectId: saved.objectId },
        );
      } else if (task.kind === "enrollment") {
        await createEnrollment.mutateAsync({
          organizationId,
          schoolId,
          data: { ...task.payload, studentId },
        });
      } else {
        await addGuardian.mutateAsync({ organizationId, schoolId, id: studentId, ...task.payload });
      }
      return { ...task, error: null };
    } catch (error) {
      return { ...task, error };
    }
  };

  const refreshReads = () =>
    Promise.all([
      utils.student.list.invalidate(),
      utils.enrollment.list.invalidate(),
      utils.guardian.list.invalidate(),
    ]);

  const switchMode = () => {
    Keyboard.dismiss();
    setFullForm((current) => !current);
    setReturnToCheck(false);
    setSaveError(null);
  };

  const admit = async () => {
    Keyboard.dismiss();
    setSaveError(null);
    // The steps only check their own fields, and the full form can leave a bad
    // value behind in one the steps don't show. Nothing invalid reaches the server.
    if (
      Object.keys(validateFullStudent(form, rows)).length > 0 ||
      Object.keys(familyErrors).length > 0
    ) {
      setFullForm(true);
      setAttempted((current) => new Set(current).add("student").add("family"));
      return;
    }
    setSaving(true);
    let student: { id: string };
    try {
      student = await createStudent.mutateAsync({
        organizationId,
        schoolId,
        data: studentCreatePayload(form),
      });
    } catch (error) {
      const friendly = toFriendlyError(error);
      if (friendly.kind === "conflict" && isAdmissionNumberRefusal(friendly.message)) {
        setNumberRefusal({ value: form.admissionNumber, message: friendly.message });
        setAttempted((current) => new Set(current).add("student"));
        if (!fullForm) {
          setReturnToCheck(true);
          setStep("student");
        }
      } else {
        setSaveError(error);
      }
      setSaving(false);
      return;
    }

    // The student is on the register now. What follows can fail on its own,
    // and Done reports each one rather than claiming the whole admission.
    const planned: AdmitTask[] = [];
    if (photo) planned.push({ kind: "photo", photo, error: null });
    if (classId && academicYear?.id) {
      planned.push({
        kind: "enrollment",
        label: placement ?? "",
        error: null,
        payload: {
          ...enrollmentCreatePayload(
            { classId, sectionId, rollNumber: "" },
            { studentId: student.id, academicYearId: academicYear.id },
          ),
          ...(form.admissionDate ? { enrollmentDate: form.admissionDate } : {}),
        },
      });
    }
    for (const { slot, payload } of familyPayloads(family)) {
      planned.push({
        kind: "guardian",
        slot,
        payload,
        who: guardianRelationLabel(relationFor(slot, family)),
        error: null,
      });
    }

    const tasks: AdmitTask[] = [];
    for (const task of planned) {
      tasks.push(await runTask(student.id, task));
    }
    await refreshReads();
    setAdmitted({
      id: student.id,
      name: studentFullName(form),
      firstName: form.firstName.trim(),
      admissionNumber: form.admissionNumber.trim(),
      admissionDate: form.admissionDate,
      photoUri: photo?.uri ?? null,
      tasks,
    });
    setSaving(false);
  };

  const retryTask = async (index: number) => {
    const task = admitted?.tasks[index];
    if (!admitted || !task) return;
    setRetrying(index);
    const result = await runTask(admitted.id, task);
    await refreshReads();
    setAdmitted((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((existing, at) => (at === index ? result : existing)),
          }
        : current,
    );
    setRetrying(null);
  };

  if (admitted) {
    return (
      <DoneScreen
        admitted={admitted}
        canEnroll={canEnroll}
        canAddFamily={canAddFamily}
        canGoToFees={canGoToFees}
        retrying={retrying}
        onRetry={(index) => void retryTask(index)}
        onAdmitAnother={onAdmitAnother}
      />
    );
  }

  const stepTitle = {
    student: copy.admit.student.title,
    class: copy.admit.class.title,
    family: copy.admit.family.title,
    review: copy.admit.review.title,
  }[step];
  const stepLine = copy.admit.stepOf(stepIndex + 1, steps.length);
  const meta =
    step === "class" && academicYear
      ? `${stepLine} · ${copy.admit.class.session(academicYear.name)}`
      : `${copy.admit.title} · ${stepLine}`;

  const problems = fullForm ? fullFormProblems(studentErrors, familyErrors) : [];
  const fullFormAttempted = attempted.has("student") || attempted.has("family");

  const hasStepErrors =
    !fullForm &&
    attempted.has(step) &&
    ((step === "student" && Object.keys(studentErrors).length > 0) ||
      (step === "family" && Object.keys(familyErrors).length > 0));

  const skippingClass = step === "class" && !classId;
  const skippingFamily = step === "family" && filledSlots(family).length === 0;
  const continueLabel = returnToCheck
    ? copy.admit.backToCheck
    : skippingClass
      ? copy.admit.class.skip
      : skippingFamily
        ? copy.admit.family.skip
        : copy.admit.continue;

  const studentStep = (
    <StudentStep
      form={form}
      set={setField}
      touch={touch}
      fieldError={studentFieldError}
      suggestion={suggestAdmissionNumber(rows, numberRefusal?.value)}
      duplicate={findPossibleDuplicate(form, rows)}
      photo={photo}
      onPhoto={canAddFamily ? setPhoto : undefined}
      focusName={!fullForm}
    />
  );
  const classStep = (
    <ClassStep
      sessionName={academicYear?.name ?? null}
      classes={classOptions}
      sections={sectionsOf(classId)}
      classId={classId}
      sectionId={sectionId}
      loading={classes.isPending || sections.isPending}
      error={classes.error ?? sections.error}
      onRetry={() => {
        void classes.refetch();
        void sections.refetch();
      }}
      onClass={chooseClass}
      onSection={setSectionId}
    />
  );
  const familyStep = (
    <FamilyStep
      family={family}
      errors={familyErrors}
      showAll={attempted.has("family")}
      onChange={(slot, part, value) =>
        setFamily((current) => ({
          ...current,
          [slot]: { ...current[slot], [part]: value },
        }))
      }
      onRelation={(otherRelation) => setFamily((current) => ({ ...current, otherRelation }))}
      onPrimary={(primary) => setFamily((current) => ({ ...current, primary }))}
    />
  );

  if (fullForm) {
    return (
      <ScreenFrame
        key="full"
        title={copy.admit.fullForm.title}
        meta={copy.admit.fullForm.meta}
        backAccessibilityLabel={copy.common.back}
        backTestID="admit-back"
        action={{
          label: copy.admit.fullForm.close,
          accessibilityHint: copy.admit.fullForm.closeHint,
          onPress: switchMode,
          testID: "admit-mode",
        }}
        footer={
          <>
            {saveError ? (
              <Notice
                tone="critical"
                message={toFriendlyError(saveError).message}
                testID="admit-save-error"
              />
            ) : fullFormAttempted && problems.length > 0 ? (
              <Notice
                tone="critical"
                message={copy.admit.fullForm.fix(
                  problems.map((group) => copy.admit.fullForm.groups[group]).join(", "),
                )}
                testID="admit-invalid"
              />
            ) : null}
            <CapsuleButton
              title={copy.admit.review.admit(form.firstName.trim() || copy.admit.fullForm.student)}
              icon="check"
              onPress={() => void admit()}
              loading={saving}
              disabled={saving}
              testID="admit-submit"
              style={styles.action}
            />
          </>
        }
      >
        {studentStep}
        {canEnroll ? (
          <>
            <SectionLabel>{copy.admit.review.class}</SectionLabel>
            {classStep}
          </>
        ) : null}
        {canAddFamily ? (
          <>
            <SectionLabel>{copy.admit.review.family}</SectionLabel>
            {familyStep}
          </>
        ) : null}
        <StudentMoreFields
          form={form}
          set={setField}
          touch={touch}
          fieldError={studentFieldError}
        />
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      // A fresh scroll for each step: opening one partway down is disorienting.
      key={step}
      title={stepTitle}
      meta={meta}
      backAccessibilityLabel={copy.common.back}
      backTestID="admit-back"
      action={{
        label: copy.admit.fullForm.open,
        accessibilityHint: copy.admit.fullForm.openHint,
        onPress: switchMode,
        testID: "admit-mode",
      }}
      stickyHeader={
        <StepProgress
          current={stepIndex}
          total={steps.length}
          label={stepLine}
          testID="admit-progress"
        />
      }
      footer={
        <>
          {saveError ? (
            <Notice
              tone="critical"
              message={toFriendlyError(saveError).message}
              testID="admit-save-error"
            />
          ) : hasStepErrors ? (
            <Notice
              tone="critical"
              message={copy.admit.invalidSummary}
              testID="admit-invalid"
            />
          ) : null}
          {step === "review" ? (
            <CapsuleButton
              title={copy.admit.review.admit(form.firstName.trim())}
              icon="check"
              onPress={() => void admit()}
              loading={saving}
              disabled={saving}
              testID="admit-submit"
              style={styles.action}
            />
          ) : (
            <CapsuleButton
              title={continueLabel}
              // A skip is allowed, not recommended, so it doesn't wear the accent.
              variant={skippingClass || skippingFamily ? "secondary" : "primary"}
              onPress={continueFrom}
              testID="admit-continue"
              style={styles.action}
            />
          )}
        </>
      }
    >
      {step === "student" ? studentStep : null}
      {step === "class" ? classStep : null}
      {step === "family" ? familyStep : null}
      {step === "review" ? (
        <ReviewStep
          form={form}
          family={family}
          placement={placement}
          showClass={canEnroll}
          showFamily={canAddFamily}
          photo={photo}
          moreGroups={filledMoreGroups(form)}
          onEdit={(target) => {
            setReturnToCheck(true);
            setStep(target);
          }}
          onEditMore={switchMode}
        />
      ) : null}
    </ScreenFrame>
  );
}

function ResultRow({
  state,
  title,
  detail,
  onRetry,
  retrying,
  testID,
}: {
  state: "saved" | "failed" | "skipped";
  title: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
  testID: string;
}) {
  const icon =
    state === "saved"
      ? { name: "checkCircle" as const, color: colors.accent }
      : state === "failed"
        ? { name: "warningCircle" as const, color: colors.tone.critical.fg }
        : { name: "info" as const, color: colors.muted };
  return (
    <View style={styles.result} testID={testID}>
      {retrying ? (
        <ActivityIndicator size="small" color={colors.accent} style={styles.resultIcon} />
      ) : (
        <AppIcon name={icon.name} size={20} color={icon.color} />
      )}
      <View style={styles.resultBody}>
        <ThemedText variant="body">{title}</ThemedText>
        {detail ? (
          <ThemedText
            variant="meta"
            color={state === "failed" ? colors.tone.critical.fg : undefined}
          >
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {onRetry ? (
        <CapsuleButton
          title={copy.admit.done.retry}
          variant="secondary"
          size="mini"
          onPress={onRetry}
          disabled={retrying}
          testID={`${testID}-retry`}
        />
      ) : null}
    </View>
  );
}

function DoneScreen({
  admitted,
  canEnroll,
  canAddFamily,
  canGoToFees,
  retrying,
  onRetry,
  onAdmitAnother,
}: {
  admitted: Admitted;
  canEnroll: boolean;
  canAddFamily: boolean;
  canGoToFees: boolean;
  retrying: number | null;
  onRetry: (index: number) => void;
  onAdmitAnother: () => void;
}) {
  const hasEnrollment = admitted.tasks.some((task) => task.kind === "enrollment");
  const hasGuardians = admitted.tasks.some((task) => task.kind === "guardian");
  const enrolled = admitted.tasks.some((task) => task.kind === "enrollment" && !task.error);
  const photoSaved = admitted.tasks.some((task) => task.kind === "photo" && !task.error);

  // A failed retry should read as a refusal to act on, not a bare "failed".
  const reason = (error: unknown) => toFriendlyError(error).message;

  const openRecord = () =>
    router.replace({
      pathname: "/students/[studentId]",
      params: { studentId: admitted.id },
    });

  return (
    <ScreenFrame
      title={copy.admit.done.title}
      backAccessibilityLabel={copy.common.back}
      backTestID="admit-back"
      titleTestID="admit-done-title"
      footer={
        <>
          <CapsuleButton
            title={copy.admit.done.another}
            icon="add"
            onPress={onAdmitAnother}
            testID="admit-another"
            style={styles.action}
          />
          <CapsuleButton
            title={copy.admit.done.openRecord}
            variant="secondary"
            onPress={openRecord}
            testID="admit-open-record"
            style={styles.action}
          />
        </>
      }
    >
      <Card style={styles.hero}>
        <StudentPhotoView
          uri={photoSaved ? admitted.photoUri : null}
          name={admitted.name}
          size={64}
        />
        <View style={styles.heroBody}>
          <ThemedText variant="name" testID="admit-done-name">
            {admitted.name}
          </ThemedText>
          <ThemedText variant="meta">
            {copy.admit.done.summary(
              admitted.admissionNumber,
              formatReadableDate(admitted.admissionDate),
            )}
          </ThemedText>
        </View>
      </Card>

      <SectionLabel>{copy.admit.done.resultsLabel}</SectionLabel>
      <Card style={styles.results}>
        <ResultRow state="saved" title={copy.admit.done.register} testID="admit-result-register" />
        {canEnroll && !hasEnrollment ? (
          <ResultRow state="skipped" title={copy.admit.done.classSkipped} testID="admit-result-class" />
        ) : null}
        {admitted.tasks.map((task, index) =>
          task.kind === "photo" ? (
            <ResultRow
              key="photo"
              state={task.error ? "failed" : "saved"}
              title={task.error ? copy.admit.done.photoFailed : copy.admit.done.photoRow}
              detail={task.error ? reason(task.error) : undefined}
              onRetry={task.error ? () => onRetry(index) : undefined}
              retrying={retrying === index}
              testID="admit-result-photo"
            />
          ) : task.kind === "enrollment" ? (
            <ResultRow
              key="enrollment"
              state={task.error ? "failed" : "saved"}
              title={task.error ? copy.admit.done.classFailed : copy.admit.done.classRow(task.label)}
              detail={task.error ? reason(task.error) : undefined}
              onRetry={task.error ? () => onRetry(index) : undefined}
              retrying={retrying === index}
              testID="admit-result-class"
            />
          ) : (
            <ResultRow
              key={task.slot}
              state={task.error ? "failed" : "saved"}
              title={
                task.error
                  ? copy.admit.done.familyFailed(task.who)
                  : copy.admit.done.familyRow(task.who, task.payload.firstName)
              }
              detail={task.error ? reason(task.error) : copy.admit.done.familyLinked}
              onRetry={task.error ? () => onRetry(index) : undefined}
              retrying={retrying === index}
              testID={`admit-result-${task.slot}`}
            />
          ),
        )}
        {canAddFamily && !hasGuardians ? (
          <ResultRow state="skipped" title={copy.admit.done.familySkipped} testID="admit-result-family" />
        ) : null}
      </Card>

      <SectionLabel>{copy.admit.done.nextLabel}</SectionLabel>
      <Card padless style={styles.next}>
        <LinkRow
          first
          title={copy.admit.done.moreDetails}
          icon="edit"
          accessibilityHint={copy.admit.done.moreDetailsHint}
          onPress={() =>
            router.replace({ pathname: "/student-form", params: { id: admitted.id } })
          }
          testID="admit-more-details"
        />
        {canGoToFees && enrolled ? (
          <LinkRow
            title={copy.admit.done.fees}
            icon="collect"
            accessibilityHint={copy.admit.done.feesHint}
            onPress={() =>
              router.replace({
                pathname: "/fees/student/[studentId]",
                params: { studentId: admitted.id },
              })
            }
            testID="admit-go-to-fees"
          />
        ) : null}
      </Card>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: "stretch",
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  heroBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  results: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  result: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  resultIcon: {
    width: 20,
    height: 20,
  },
  resultBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  next: {
    marginTop: spacing.sm,
  },
});

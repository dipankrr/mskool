"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, CheckCircle2Icon, CheckIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { copy } from "@/lib/copy";
import { toFriendlyError } from "@/lib/errors";
import { formatIsoDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  admitSteps,
  emptyFamilyForm,
  familyPayloads,
  filledSlots,
  findAdmissionClash,
  findPossibleDuplicate,
  isAdmissionNumberRefusal,
  relationFor,
  sectionStrength,
  studentFullName,
  suggestAdmissionNumber,
  validateFamilyStep,
  type AdmitStep,
  type FamilyForm,
} from "./admit-logic";
import {
  admitStudentForm,
  ClassStep,
  FamilyStep,
  ReviewStep,
  StudentStep,
  type StudentValues,
} from "./admit-steps";
import { useAdmission, type AdmitTask } from "./use-admission";
import { useStudentEnrollments, useStudents } from "./use-students";

/**
 * ADMIT A STUDENT (plan `.kilo/plans/2026-11-01-admit-flow.md`): who, which
 * class, which family, check, done.
 *
 * Still a modal, on purpose: it keeps the register behind it and the
 * `?create=1` deep links, and a stray click elsewhere can't lose typed work.
 * Nothing reaches the server until Check, so closing early only asks for
 * confirmation. After that the student exists, and the last step reports each
 * later save on its own, with Retry beside anything that failed.
 *
 * The rail is what makes the steps feel short on a wide screen: each finished
 * step shows its answer, and clicking one goes back to it. A phone has no room
 * for it and gets a progress bar instead.
 */

const text = copy.students.admit;

const STUDENT_FIELDS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "gender",
  "admissionNumber",
  "admissionDate",
] as const;

type Admitted = {
  id: string;
  name: string;
  admissionNumber: string;
  admissionDate: string;
  tasks: AdmitTask[];
};

export function AdmitStudentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Read when closing, so typing doesn't re-render this shell.
  const guard = useRef({ dirty: false, busy: false });

  const requestChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (guard.current.busy) return;
    if (guard.current.dirty) {
      setConfirmingDiscard(true);
      return;
    }
    onOpenChange(false);
  };

  const body = (
    <AdmitWizard
      onGuardChange={(next) => {
        guard.current = next;
      }}
      onClose={() => requestChange(false)}
      onDone={() => {
        guard.current = { dirty: false, busy: false };
        onOpenChange(false);
      }}
      titleAs={isMobile ? SheetTitle : DialogTitle}
    />
  );

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={requestChange}>
          <SheetContent side="bottom" className="gap-0 p-0 data-[side=bottom]:h-[92svh]">
            {body}
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={requestChange}>
          <DialogContent className="block h-[min(40rem,90svh)] overflow-hidden p-0 sm:max-w-3xl">
            {body}
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title={text.discardTitle}
        consequence={text.discardBody}
        confirmLabel={text.discard}
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          guard.current = { dirty: false, busy: false };
          onOpenChange(false);
        }}
      />
    </>
  );
}

function AdmitWizard({
  onGuardChange,
  onClose,
  onDone,
  titleAs: Title,
}: {
  onGuardChange: (guard: { dirty: boolean; busy: boolean }) => void;
  onClose: () => void;
  onDone: () => void;
  titleAs: typeof DialogTitle | typeof SheetTitle;
}) {
  // A fresh mount is what clears the flow for the next admission.
  const [run, setRun] = useState(0);
  return (
    <AdmitFlow
      key={run}
      onGuardChange={onGuardChange}
      onClose={onClose}
      onDone={onDone}
      onAdmitAnother={() => setRun((current) => current + 1)}
      Title={Title}
    />
  );
}

function AdmitFlow({
  onGuardChange,
  onClose,
  onDone,
  onAdmitAnother,
  Title,
}: {
  onGuardChange: (guard: { dirty: boolean; busy: boolean }) => void;
  onClose: () => void;
  onDone: () => void;
  onAdmitAnother: () => void;
  Title: typeof DialogTitle | typeof SheetTitle;
}) {
  const { has, activeSession } = useActiveContext();
  const canEnroll = has("enrollment:create");
  const canAddFamily = has("student:update");
  const canCollectFees = has("fee_payment:create");

  const steps = useMemo(
    () => admitSteps({ enroll: canEnroll, addFamily: canAddFamily }),
    [canEnroll, canAddFamily],
  );

  const form = useForm<StudentValues>({
    resolver: zodResolver(admitStudentForm),
    // Every text input named, or its empty string reads as a change from
    // `undefined` and an untouched form asks before closing.
    defaultValues: {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      admissionNumber: "",
      admissionDate: todayIso(),
    },
  });

  const [family, setFamily] = useState<FamilyForm>(emptyFamilyForm);
  const [classId, setClassId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);

  const [step, setStep] = useState<AdmitStep>("student");
  // How far the desk has got, so the rail only offers steps already reached.
  const [furthest, setFurthest] = useState(0);
  // Arrived from Check's Edit: Continue goes straight back there.
  const [returnToCheck, setReturnToCheck] = useState(false);
  const [familyAttempted, setFamilyAttempted] = useState(false);
  const [refusedNumber, setRefusedNumber] = useState<string | undefined>();

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [admitted, setAdmitted] = useState<Admitted | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const register = useStudents();
  const classes = useClasses();
  const sections = useSections(undefined, { enabled: canEnroll && Boolean(activeSession) });
  const enrollments = useStudentEnrollments();
  const admission = useAdmission();

  const rows = useMemo(() => register.data ?? [], [register.data]);
  const strength = useMemo(
    () => (enrollments.data ? sectionStrength(enrollments.data) : null),
    [enrollments.data],
  );
  const familyErrors = useMemo(() => validateFamilyStep(family), [family]);

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
    ? [className, sectionName ? text.class.sectionName(sectionName) : null]
        .filter(Boolean)
        .join(" · ")
    : null;

  const values = form.watch();
  const filled = filledSlots(family);
  const stepIndex = steps.indexOf(step);

  const dirty = form.formState.isDirty || filled.length > 0 || classId !== null;
  useEffect(() => {
    onGuardChange({ dirty: dirty && !admitted, busy: saving });
  }, [dirty, admitted, saving, onGuardChange]);

  // Each step opens with focus on its first field, so typing carries on from
  // the keyboard. The steps with nothing to type focus their heading instead,
  // which also makes a screen reader announce where the desk has landed.
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const first =
        step === "student" || step === "family"
          ? panel.current?.querySelector<HTMLInputElement>("input:not([type=radio])")
          : null;
      (first ?? heading.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [step, admitted]);

  const goTo = (target: AdmitStep) => {
    setStep(target);
    setFurthest((current) => Math.max(current, steps.indexOf(target)));
  };

  const chooseClass = (id: string) => {
    setClassId(id);
    const options = sectionsOf(id);
    setSectionId(options.length === 1 ? (options[0]?.id ?? null) : null);
  };

  const validateStudentStep = async (): Promise<boolean> => {
    const valid = await form.trigger([...STUDENT_FIELDS], { shouldFocus: true });
    if (!valid) return false;
    const clash = findAdmissionClash(form.getValues("admissionNumber"), rows);
    if (clash) {
      form.setError(
        "admissionNumber",
        { message: text.student.numberTaken(`${clash.firstName} ${clash.lastName}`) },
        { shouldFocus: true },
      );
      return false;
    }
    return true;
  };

  const advance = async () => {
    if (step === "student" && !(await validateStudentStep())) return;
    if (step === "family") {
      setFamilyAttempted(true);
      if (Object.keys(familyErrors).length > 0) return;
    }
    if (returnToCheck) {
      setReturnToCheck(false);
      setStep("review");
      return;
    }
    const next = steps[stepIndex + 1];
    if (next) goTo(next);
  };

  const admit = async () => {
    if (saving) return;
    setSaveError(null);
    // Re-checked from here too: Edit may have reopened the student fields.
    if (!(await validateStudentStep())) {
      setStep("student");
      return;
    }
    setSaving(true);
    const parsed = admitStudentForm.parse(form.getValues());
    let student: { id: string };
    try {
      student = await admission.admit(parsed);
    } catch (error) {
      const friendly = toFriendlyError(error);
      if (friendly.kind === "conflict" && isAdmissionNumberRefusal(friendly.message)) {
        setRefusedNumber(parsed.admissionNumber);
        form.setError("admissionNumber", { message: friendly.message });
        setReturnToCheck(true);
        setStep("student");
      } else {
        setSaveError(friendly.message);
      }
      setSaving(false);
      return;
    }

    // The student is on the register now. What follows can fail on its own,
    // and the last step reports each one rather than claiming the whole thing.
    const admissionDate = parsed.admissionDate ?? todayIso();
    const planned: AdmitTask[] = [];
    if (classId && activeSession) {
      planned.push({
        kind: "enrollment",
        label: placement ?? "",
        error: null,
        payload: {
          studentId: student.id,
          academicYearId: activeSession.id,
          classId,
          enrollmentDate: admissionDate,
          ...(sectionId ? { sectionId } : {}),
        },
      });
    }
    for (const { slot, payload } of familyPayloads(family)) {
      planned.push({
        kind: "guardian",
        slot,
        payload,
        who: copy.guardians.relations[relationFor(slot, family)] ?? "",
        error: null,
      });
    }
    const tasks: AdmitTask[] = [];
    for (const task of planned) {
      tasks.push(await admission.run(student.id, task));
    }
    await admission.refresh();
    setAdmitted({
      id: student.id,
      name: studentFullName(parsed),
      admissionNumber: parsed.admissionNumber,
      admissionDate,
      tasks,
    });
    setSaving(false);
  };

  const retry = async (index: number) => {
    const task = admitted?.tasks[index];
    if (!admitted || !task) return;
    setRetrying(index);
    const result = await admission.run(admitted.id, task);
    await admission.refresh();
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void (step === "review" ? admit() : advance());
  };

  const back = () => {
    if (returnToCheck) {
      setReturnToCheck(false);
      setStep("review");
      return;
    }
    const previous = steps[stepIndex - 1];
    if (previous) setStep(previous);
    else onClose();
  };

  const skippingClass = step === "class" && !classId;
  const skippingFamily = step === "family" && filled.length === 0;
  const continueLabel = returnToCheck
    ? text.backToCheck
    : skippingClass
      ? text.class.skip
      : skippingFamily
        ? text.family.skip
        : text.continue;

  const stepTitle = {
    student: text.student.title,
    class: text.class.title,
    family: text.family.title,
    review: text.review.title,
  }[step];

  const railSummary: Record<AdmitStep, string | null> = {
    student: studentFullName(values) || null,
    class: placement,
    family: filled.length > 0 ? text.family.count(filled.length) : null,
    review: null,
  };
  const railLabel: Record<AdmitStep, string> = {
    student: text.rail.student,
    class: text.rail.class,
    family: text.rail.family,
    review: text.rail.review,
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] md:grid-cols-[13.5rem_1fr] md:grid-rows-1">
      <aside className="bg-muted/40 flex flex-col gap-5 border-b p-5 pr-12 md:border-r md:border-b-0 md:pr-5">
        <Title className="font-heading text-base font-medium">{text.title}</Title>
        {/* The phone's version of the rail. */}
        <div
          className="flex gap-1 md:hidden"
          role="progressbar"
          aria-label={text.stepOf(admitted ? steps.length : stepIndex + 1, steps.length)}
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={admitted ? steps.length : stepIndex + 1}
        >
          {steps.map((name, index) => (
            <span
              key={name}
              className={cn(
                "h-1 flex-1 rounded-full",
                admitted || index <= stepIndex ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <ol className="hidden flex-col gap-1 md:flex">
          {steps.map((name, index) => {
            const current = !admitted && name === step;
            const reached = index <= furthest;
            const complete = Boolean(admitted) || (reached && !current && index < furthest);
            return (
              <li key={name}>
                <button
                  type="button"
                  disabled={!reached || Boolean(admitted) || saving}
                  aria-current={current ? "step" : undefined}
                  onClick={() => {
                    setReturnToCheck(false);
                    setStep(name);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl p-2 text-left transition-colors",
                    "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                    current ? "bg-background" : null,
                    reached && !current && !admitted ? "hover:bg-accent/60" : null,
                  )}
                >
                  <span
                    className={cn(
                      "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                      current ? "border-primary text-primary" : null,
                      complete ? "bg-primary border-primary text-primary-foreground" : null,
                      !current && !complete ? "text-muted-foreground" : null,
                    )}
                  >
                    {complete ? <CheckIcon className="size-3" /> : index + 1}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={cn(
                        "text-sm",
                        current ? "font-medium" : null,
                        !reached ? "text-muted-foreground" : null,
                      )}
                    >
                      {railLabel[name]}
                    </span>
                    {railSummary[name] && !current ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {railSummary[name]}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {admitted ? (
        <DonePanel
          admitted={admitted}
          canEnroll={canEnroll}
          canAddFamily={canAddFamily}
          canCollectFees={canCollectFees}
          retrying={retrying}
          headingRef={heading}
          onRetry={(index) => void retry(index)}
          onAnother={onAdmitAnother}
          onDone={onDone}
        />
      ) : (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <div ref={panel} className="min-h-0 flex-1 overflow-y-auto p-6 md:pt-7">
            <p className="text-muted-foreground text-xs">
              {step === "class" && activeSession
                ? `${text.stepOf(stepIndex + 1, steps.length)} · ${text.class.session(activeSession.name)}`
                : text.stepOf(stepIndex + 1, steps.length)}
            </p>
            <h2
              ref={heading}
              tabIndex={-1}
              className="font-heading mt-1 mb-5 pr-8 text-xl font-medium outline-none"
            >
              {stepTitle}
            </h2>
            {step === "student" ? (
              <StudentStep
                form={form}
                suggestion={suggestAdmissionNumber(rows, refusedNumber)}
                duplicate={findPossibleDuplicate(values, rows)}
              />
            ) : null}
            {step === "class" ? (
              <ClassStep
                sessionName={activeSession?.name ?? null}
                classes={classOptions}
                sections={sectionsOf(classId)}
                classId={classId}
                sectionId={sectionId}
                loading={classes.isLoading || sections.isLoading}
                failed={classes.isError || sections.isError}
                onClass={chooseClass}
                onClearClass={() => {
                  setClassId(null);
                  setSectionId(null);
                }}
                onSection={setSectionId}
              />
            ) : null}
            {step === "family" ? (
              <FamilyStep
                family={family}
                errors={familyErrors}
                showAll={familyAttempted}
                onChange={(slot, part, value) =>
                  setFamily((current) => ({
                    ...current,
                    [slot]: { ...current[slot], [part]: value },
                  }))
                }
                onRelation={(otherRelation) =>
                  setFamily((current) => ({ ...current, otherRelation }))
                }
                onPrimary={(primary) => setFamily((current) => ({ ...current, primary }))}
              />
            ) : null}
            {step === "review" ? (
              <ReviewStep
                values={values}
                family={family}
                placement={placement}
                showClass={canEnroll}
                showFamily={canAddFamily}
                onEdit={(target) => {
                  setReturnToCheck(true);
                  setStep(target);
                }}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-t p-4">
            {/* Here rather than in the scroll: it must be read before the button. */}
            {step === "review" ? (
              <p className="text-muted-foreground text-xs" data-testid="admit-permanent">
                {text.review.permanent(values.admissionNumber.trim())}
              </p>
            ) : null}
            {saveError ? (
              <Alert variant="destructive" data-testid="admit-save-error">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={back}>
                {stepIndex === 0 && !returnToCheck ? copy.common.cancel : copy.common.back}
              </Button>
              {step === "review" ? (
                <Button type="submit" disabled={saving}>
                  {saving ? <Spinner data-icon="inline-start" /> : null}
                  {saving
                    ? text.review.admitting
                    : text.review.admit(form.getValues("firstName")?.trim() ?? "")}
                </Button>
              ) : (
                <Button
                  type="submit"
                  // A skip is allowed, not recommended, so it doesn't wear the accent.
                  variant={skippingClass || skippingFamily ? "outline" : "default"}
                >
                  {continueLabel}
                </Button>
              )}
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

function ResultRow({
  state,
  title,
  detail,
  onRetry,
  retrying,
}: {
  state: "saved" | "failed" | "skipped";
  title: string;
  detail?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <li className="flex items-start gap-3 text-sm">
      {retrying ? (
        <Spinner className="mt-0.5 size-4 shrink-0" />
      ) : state === "saved" ? (
        <CheckCircle2Icon className="text-primary mt-0.5 size-4 shrink-0" />
      ) : state === "failed" ? (
        <AlertCircleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
      ) : (
        <InfoIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{title}</span>
        {detail ? (
          <span className={cn("text-xs", state === "failed" ? "text-destructive" : "text-muted-foreground")}>
            {detail}
          </span>
        ) : null}
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
          {text.done.retry}
        </Button>
      ) : null}
    </li>
  );
}

function DonePanel({
  admitted,
  canEnroll,
  canAddFamily,
  canCollectFees,
  retrying,
  headingRef,
  onRetry,
  onAnother,
  onDone,
}: {
  admitted: Admitted;
  canEnroll: boolean;
  canAddFamily: boolean;
  canCollectFees: boolean;
  retrying: number | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onRetry: (index: number) => void;
  onAnother: () => void;
  onDone: () => void;
}) {
  const hasEnrollment = admitted.tasks.some((task) => task.kind === "enrollment");
  const hasGuardians = admitted.tasks.some((task) => task.kind === "guardian");
  const enrolled = admitted.tasks.some((task) => task.kind === "enrollment" && !task.error);
  const reason = (error: unknown) => toFriendlyError(error).message;

  return (
    <div className="flex min-h-0 flex-col" data-testid="admit-done">
      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:pt-7">
        <p className="text-muted-foreground text-xs">{text.done.title}</p>
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="font-heading mt-1 pr-8 text-xl font-medium outline-none"
        >
          {admitted.name}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {text.done.summary(admitted.admissionNumber, formatIsoDate(admitted.admissionDate))}
        </p>

        <h3 className="mt-6 mb-3 text-sm font-medium">{text.done.resultsLabel}</h3>
        <ul className="flex flex-col gap-3">
          <ResultRow state="saved" title={text.done.register} />
          {canEnroll && !hasEnrollment ? (
            <ResultRow state="skipped" title={text.done.classSkipped} />
          ) : null}
          {admitted.tasks.map((task, index) =>
            task.kind === "enrollment" ? (
              <ResultRow
                key="enrollment"
                state={task.error ? "failed" : "saved"}
                title={task.error ? text.done.classFailed : text.done.classRow(task.label)}
                detail={task.error ? reason(task.error) : undefined}
                onRetry={task.error ? () => onRetry(index) : undefined}
                retrying={retrying === index}
              />
            ) : (
              <ResultRow
                key={task.slot}
                state={task.error ? "failed" : "saved"}
                title={
                  task.error
                    ? text.done.familyFailed(task.who)
                    : text.done.familyRow(task.who, task.payload.firstName)
                }
                detail={task.error ? reason(task.error) : text.done.familyLinked}
                onRetry={task.error ? () => onRetry(index) : undefined}
                retrying={retrying === index}
              />
            ),
          )}
          {canAddFamily && !hasGuardians ? (
            <ResultRow state="skipped" title={text.done.familySkipped} />
          ) : null}
        </ul>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <Link
          href={`/students/${admitted.id}`}
          onClick={onDone}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          {text.done.openRecord}
        </Link>
        {canCollectFees && enrolled ? (
          <Link
            href={`/fees/collect?studentId=${admitted.id}`}
            onClick={onDone}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            {text.done.fees}
          </Link>
        ) : null}
        <Button type="button" onClick={onAnother}>
          {text.done.another}
        </Button>
      </div>
    </div>
  );
}

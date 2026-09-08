"use client";

import { ArrowLeftIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Button,
  buttonVariants,
} from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { ComponentsDialog } from "@/features/exams/components-dialog";
import { ScheduleDialog } from "@/features/exams/schedule-dialog";
import {
  useEligibilityActions,
  useExamDetail,
  useExamWorkflowMutations,
  usePublicationActions,
  useReadiness,
  useTerms,
} from "@/features/exams/use-exam-workflow";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { useStudents } from "@/features/students/use-students";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { ExamTransitionInput } from "@repo/contracts";
import type { ExamDetail } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * EXAM DETAIL (S2) — the blueprint and the walk to publication.
 *
 * Header: status + the lifecycle's next buttons (each a ConfirmDialog
 * whose consequence text is the state's meaning, so "open marks entry"
 * also says "the schedule freezes"). Body: schedules grouped per class
 * (batch editor), components per schedule, then the readiness panel —
 * the checklist the API will re-check at publish time, shown even when
 * incomplete because partial entry is a legitimate state to navigate.
 */

type ScheduleRow = NonNullable<ExamDetail>["schedules"][number];

// The service's transition map, mirrored for the buttons; the server
// remains the referee — an illegal move gets its worded refusal.
const NEXT_TRANSITIONS: Record<string, readonly string[]> = {
  draft: ["scheduled"],
  scheduled: ["ongoing", "draft"],
  ongoing: ["marks_entry"],
  marks_entry: ["under_verification"],
  under_verification: ["marks_entry"],
  published: ["locked"],
  locked: [],
};

const BLUEPRINT_EDITABLE = new Set(["draft", "scheduled"]);
const ENTRY_OPEN = new Set(["marks_entry", "under_verification"]);

/**
 * Button copy per move: targets are status names (`draft`, `locked`), but
 * the back-moves read differently — and the lock is the one irreversible
 * act, styled destructive with its consequence stated.
 */
function transitionCopy(examStatus: string, target: string) {
  const backToEntry = target === "marks_entry" && examStatus === "under_verification";
  const labelKey = backToEntry ? "back_to_entry" : target;
  const labels = copy.exams.workflow.transitions as Record<string, string | undefined>;
  const consequences = copy.exams.workflow.transitionConsequences as Record<string, string | undefined>;
  return {
    label: labels[labelKey] ?? target,
    consequence: consequences[labelKey] ?? "",
    destructive: target === "locked",
  };
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    ongoing: "Ongoing",
    marks_entry: "Marks entry",
    under_verification: "Under verification",
    published: "Published",
    locked: "Locked",
  };
  return labels[status] ?? status;
}

const scheduleColumn = createAppColumnHelper<ScheduleRow>();

export default function ExamDetailPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId;
  const { scopeArgs, has, writeScopeArgs } = useActiveContext();

  const detail = useExamDetail(examId);
  const classes = useClasses();
  const subjects = trpc.subject.list.useQuery(scopeArgs(), { staleTime: 30_000 });
  const terms = useTerms(detail.data?.exam.academicYearId ?? null);
  const students = useStudents();

  const { transition, saveSchedules, saveComponents } = useExamWorkflowMutations();
  const { recompute, override } = useEligibilityActions(examId);
  const { publishClass, publishExam } = usePublicationActions(examId);

  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [componentsFor, setComponentsFor] = useState<string | null>(null);  const [transitionTarget, setTransitionTarget] = useState<string | null>(null);
  const [publishClassId, setPublishClassId] = useState<string | null>(null);
  const [publishAllConfirm, setPublishAllConfirm] = useState(false);
  const [allowing, setAllowing] = useState<string | null>(null);
  const [allowReason, setAllowReason] = useState("");
  // Sections of the class being edited — the paper's section picker.
  // Disabled until a class is picked so a foreign class never 403s the dialog.
  const dialogSections = useSections(scheduleFor ?? undefined, {
    enabled: scheduleFor != null,
  });

  const exam = detail.data?.exam;
  // School-parent writes: the branch rides along, or the user is asked to
  // pick one. Org-only scope always fails server-side (requireSchoolId).
  const writeScope = () => {
    const scope = writeScopeArgs();
    if (!scope) toast.error(copy.errors.needsBranch);
    return scope;
  };
  // Stable identity for the hook dependency chain below.
  const schedules = useMemo(() => detail.data?.schedules ?? [], [detail.data]);
  const editable = Boolean(exam && BLUEPRINT_EDITABLE.has(exam.status));
  const entryOpen = Boolean(exam && ENTRY_OPEN.has(exam.status));

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const klass of classes.data ?? []) map.set(klass.id, klass.name);
    return map;
  }, [classes.data]);

  const subjectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of subjects.data ?? []) map.set(subject.id, subject.name);
    return map;
  }, [subjects.data]);

  const termName = useMemo(
    () => (terms.data ?? []).find((t) => t.id === exam?.termId)?.name ?? null,
    [terms.data, exam?.termId],
  );

  // Classes that actually sit this exam, in the school's own order.
  const examClassIds = useMemo(() => {
    const present = new Set(schedules.map((s) => s.classId));
    return (classes.data ?? [])
      .filter((klass) => present.has(klass.id))
      .map((klass) => klass.id);
  }, [classes.data, schedules]);

  const [readinessClassId, setReadinessClassId] = useState<string | null>(null);
  useEffect(() => {
    if (readinessClassId && examClassIds.includes(readinessClassId)) return;
    setReadinessClassId(examClassIds[0] ?? null);
  }, [examClassIds, readinessClassId]);

  const readiness = useReadiness(examId, readinessClassId ?? undefined);

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students.data ?? []) {
      map.set(student.id, [student.firstName, student.lastName].filter(Boolean).join(" "));
    }
    return map;
  }, [students.data]);

  const scheduleColumns = useMemo<DataTableColumns<ScheduleRow>>(
    () =>
      scheduleColumn.columns([
        scheduleColumn.display({
          id: "subject",
          header: copy.exams.workflow.fields.subject,
          cell: ({ row }) => subjectNameById.get(row.original.subjectId) ?? copy.common.none,
        }),
        scheduleColumn.accessor("examDate", {
          header: copy.exams.workflow.fields.date,
          cell: ({ row }) => formatIsoDate(row.original.examDate),
        }),
        scheduleColumn.display({
          id: "start",
          header: copy.exams.workflow.fields.startTime,
          cell: ({ row }) => row.original.startTime.slice(0, 5),
        }),
        scheduleColumn.accessor("durationMinutes", {
          header: copy.exams.workflow.fields.duration,
        }),
        scheduleColumn.display({
          id: "venue",
          header: copy.exams.workflow.fields.venue,
          cell: ({ row }) => row.original.venue || copy.common.none,
        }),
        scheduleColumn.display({
          id: "state",
          header: copy.exams.workflow.status,
          cell: ({ row }) =>
            row.original.isLocked ? (
              <Badge variant="secondary">{copy.exams.workflow.lockedBadge}</Badge>
            ) : (
              copy.common.none
            ),
        }),
        scheduleColumn.display({
          id: "components",
          header: copy.exams.workflow.componentSection,
          cell: ({ row }) => (
            <div className="flex items-center gap-1">
              {editable && has("exam:update") ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setComponentsFor(row.original.id)}
                >
                  {row.original.components.length > 0
                    ? `${row.original.components.length} ${copy.exams.workflow.componentSection.toLowerCase()}`
                    : copy.exams.workflow.addComponentRow}
                </Button>
              ) : (
                // Frozen papers stay READABLE: parts, max, pass, weight.
                <span className="text-muted-foreground text-xs">
                  {row.original.components.length > 0
                    ? row.original.components
                        .map(
                          (c) =>
                            `${c.name} ${Number(c.maxMarks)} (${copy.exams.workflow.fields.passMarksOverrideShort} ${Number(c.passMarks)}, ${Number(c.weightagePercentage)}%)`,
                        )
                        .join(" · ")
                    : copy.common.none}
                </span>
              )}
              {entryOpen ? (
                <Link
                  href={`/exams/${examId}/entry`}
                  className="text-sm font-medium hover:underline"
                >
                  {copy.exams.entry.title}
                </Link>
              ) : null}
            </div>
          ),
        }),
      ]),
    [subjectNameById, editable, entryOpen, examId, has],
  );

  // BUG-7 fix: these feed the dialogs' form-reset effects, so they MUST be
  // identity-stable across parent re-renders — an inline filter() hands the
  // dialog a fresh array on every render, and any background query refetch
  // (window refocus, staleTime expiry) then wiped the user's in-progress
  // rows. Memoized: identity changes only when the data really does. They
  // sit BEFORE the early returns — hooks cannot follow a conditional return
  // (the Rules of Hooks crash this page when they did).
  const scheduleRows = useMemo(
    () => schedules.filter((s) => s.classId === scheduleFor),
    [schedules, scheduleFor],
  );
  const componentsSchedule = useMemo(
    () => schedules.find((s) => s.id === componentsFor),
    [schedules, componentsFor],
  );

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title={copy.common.loading} description={undefined} />
        <Spinner className="mt-10" />
      </>
    );
  }

  if (!exam) {
    return (
      <EmptyState
        title={copy.exams.workflow.emptyTitle}
        description={copy.exams.workflow.emptyBody}
        action={
          <Link href="/exams" className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  const allowedTargets = NEXT_TRANSITIONS[exam.status] ?? [];
  const scheduleForClass = classNameById.get(scheduleFor ?? "") ?? "";
  const allowingStudent = studentNameById.get(allowing ?? "");

  return (
    <>
      <PageHeader
        title={exam.name}
        description={[termName, statusLabel(exam.status)].filter(Boolean).join(" · ")}
        actions={
          <Link href="/exams" className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />

      {/* Lifecycle — the next legal moves; the server words any refusal. */}
      {allowedTargets.length > 0 && has("exam:update") ? (
        <div className="flex flex-wrap gap-2">
          {allowedTargets.map((target) => {
            const t = transitionCopy(exam.status, target);
            return (
              <Button
                key={target}
                variant={t.destructive ? "destructive" : "outline"}
                disabled={transition.isPending}
                onClick={() => setTransitionTarget(target)}
              >
                {t.label}
              </Button>
            );
          })}
          {entryOpen || exam.status === "published" || exam.status === "locked" ? (
            <Link
              href={`/exams/${examId}/results`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              {copy.exams.results.title}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* Schedules, one group per class. */}
      <section aria-labelledby="schedules-heading" className="flex flex-col gap-3">
        <h2 id="schedules-heading" className="font-heading text-base font-semibold">
          {copy.exams.workflow.scheduleSection}
        </h2>
        <p className="text-muted-foreground -mt-2 text-sm">
          {copy.exams.workflow.scheduleSubtitle}
        </p>

        {/* BUG-6 fix: the class cards used to render only for classes that
            ALREADY had schedules — a fresh exam was a dead end with no way
            to add the first paper. While the blueprint is editable, every
            class of the branch is offered; once entry has opened, only the
            scheduled classes remain (readiness keeps its own list). */}
        {(() => {
          const schedulableClassIds =
            editable && has("exam:update")
              ? (classes.data ?? []).map((k) => k.id)
              : examClassIds;
          if (schedulableClassIds.length === 0) {
            return (
              <EmptyState
                icon={PlusIcon}
                title={copy.exams.workflow.scheduleSection}
                description={copy.exams.workflow.scheduleSubtitle}
              />
            );
          }
          return schedulableClassIds.map((classId) => (
            <Card key={classId}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{classNameById.get(classId) ?? classId}</CardTitle>
                {editable && has("exam:update") ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScheduleFor(classId)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    {copy.exams.workflow.editScheduleFor}
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                <DataTable
                  data={schedules.filter((s) => s.classId === classId)}
                  columns={scheduleColumns}
                  getRowId={(row) => row.id}
                  caption={copy.exams.workflow.scheduleSection}
                  isLoading={detail.isLoading}
                  error={detail.error}
                  onRetry={() => void detail.refetch()}
                  renderCard={(row) => (
                    <div className="rounded-lg border p-4">
                      <p className="font-medium">
                        {subjectNameById.get(row.subjectId) ?? copy.common.none}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatIsoDate(row.examDate)} · {row.startTime.slice(0, 5)} ·{" "}
                        {row.durationMinutes} min · {row.venue ?? copy.common.none}
                      </p>
                    </div>
                  )}
                  empty={
                    <EmptyState
                      title={copy.exams.workflow.addScheduleRow}
                      description={copy.exams.workflow.scheduleSubtitle}
                      action={
                        editable && has("exam:update") ? (
                          <Button variant="outline" onClick={() => setScheduleFor(classId)}>
                            <PlusIcon data-icon="inline-start" />
                            {copy.exams.workflow.addScheduleRow}
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
              </CardContent>
            </Card>
          ));
        })()}
      </section>

      {/* Readiness — the checklist publish re-checks, advisory and live. */}
      {examClassIds.length > 0 ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{copy.exams.workflow.readiness.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={readinessClassId ?? ""}
                onValueChange={(v) => {
                  if (v) setReadinessClassId(v);
                }}
              >
                <SelectTrigger aria-label={copy.exams.workflow.fields.class} className="w-44">
                  <SelectValue>
                    {(value: string | null) =>
                      value ? (classNameById.get(value) ?? copy.common.none) : copy.common.none
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {examClassIds.map((classId) => (
                    <SelectItem key={classId} value={classId}>
                      {classNameById.get(classId) ?? classId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {has("exam:update") ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={recompute.isPending}
                  onClick={() => {
                    const scope = writeScope();
                    if (!scope) return;
                    recompute.mutate({ ...scope, id: examId });
                  }}
                >
                  {copy.exams.workflow.readiness.compute}
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {readiness.isLoading ? (
              <Spinner />
            ) : readiness.data ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">
                    {copy.exams.workflow.readiness.entries}: {readiness.data.enteredEntries}/
                    {readiness.data.expectedEntries}
                  </Badge>
                  <Badge variant="outline">
                    {copy.exams.workflow.readiness.verified}: {readiness.data.verifiedEntries}
                  </Badge>
                  <Badge variant={readiness.data.staleCompute ? "destructive" : "secondary"}>
                    {readiness.data.staleCompute
                      ? copy.exams.workflow.readiness.stale
                      : copy.exams.workflow.readiness.fresh}
                  </Badge>
                </div>

                {readiness.data.belowBar.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-sm">
                      {copy.exams.workflow.readiness.belowBar}
                    </p>
                    {has("exam:update") &&
                    readiness.data.belowBar.some((row) => !row.isOverridden) ? (
                      <div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAllowing("ALL");
                            setAllowReason("");
                          }}
                        >
                          {copy.exams.workflow.readiness.allowAll}
                        </Button>
                      </div>
                    ) : null}
                    <ul className="flex flex-col gap-1">
                      {readiness.data.belowBar.map((row) => (
                        <li
                          key={row.studentId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                        >
                          <span className="font-medium">
                            {studentNameById.get(row.studentId) ?? row.studentId}
                          </span>
                          <span className="text-muted-foreground">
                            {row.attendancePercentage}% / {row.minRequiredPct}%
                          </span>
                          {has("exam:update") && !row.isOverridden ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setAllowing(row.studentId);
                                setAllowReason("");
                              }}
                            >
                              {copy.exams.workflow.readiness.allow}
                            </Button>
                          ) : (
                            <Badge variant="secondary">
                              {copy.exams.workflow.readiness.allowedBadge}
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="text-muted-foreground text-sm">
                  {copy.exams.workflow.readiness.publishedNote}
                </p>

                {has("exam:publish") ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={publishClass.isPending}
                      onClick={() => setPublishClassId(readinessClassId)}
                    >
                      {copy.exams.workflow.readiness.publishClass}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={publishExam.isPending}
                      onClick={() => setPublishAllConfirm(true)}
                    >
                      {copy.exams.workflow.readiness.publishAll}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Per-class schedule batch editor */}
      <ScheduleDialog
        open={Boolean(scheduleFor)}
        onOpenChange={(open) => {
          if (!open) setScheduleFor(null);
        }}
        examId={examId}
        classId={scheduleFor ?? ""}
        className={scheduleForClass}
        schedules={scheduleRows}
        subjects={subjects.data ?? []}
        sections={dialogSections.data ?? []}
        pending={saveSchedules.isPending}
        onSubmit={async (data) => {
          const scope = writeScope();
          if (!scope) return;
          await saveSchedules.mutateAsync({ ...scope, ...data });
          setScheduleFor(null);
        }}
      />

      {/* Per-schedule components batch editor */}
      {componentsSchedule ? (
        <ComponentsDialog
          open
          onOpenChange={(open) => {
            if (!open) setComponentsFor(null);
          }}
          scheduleId={componentsSchedule.id}
          scheduleLabel={`${classNameById.get(componentsSchedule.classId) ?? ""} — ${
            subjectNameById.get(componentsSchedule.subjectId) ?? ""
          }`}
          components={componentsSchedule.components}
          pending={saveComponents.isPending}
          onSubmit={async (data) => {
            const scope = writeScope();
            if (!scope) return;
            await saveComponents.mutateAsync({ ...scope, ...data });
            setComponentsFor(null);
          }}
        />
      ) : null}

      {/* Lifecycle confirmation — the consequence says what the state means. */}
      <ConfirmDialog
        open={Boolean(transitionTarget)}
        onOpenChange={(open) => {
          if (!open) setTransitionTarget(null);
        }}
        title={`${copy.exams.workflow.transitions.confirmTitle} ${
          transitionTarget && exam ? transitionCopy(exam.status, transitionTarget).label : ""
        }`}
        consequence={
          transitionTarget && exam ? transitionCopy(exam.status, transitionTarget).consequence : ""
        }
        confirmLabel={
          transitionTarget && exam
            ? transitionCopy(exam.status, transitionTarget).label
            : copy.common.save
        }
        destructive={transitionTarget === "locked"}
        pending={transition.isPending}
        onConfirm={() => {
          if (!transitionTarget) return;
          const scope = writeScope();
          if (!scope) return;
          transition.mutate({
            ...scope,
            id: examId,
            target: transitionTarget as ExamTransitionInput["target"],
          });
          setTransitionTarget(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(publishClassId)}
        onOpenChange={(open) => {
          if (!open) setPublishClassId(null);
        }}
        title={copy.exams.workflow.readiness.publishClass}
        consequence={copy.exams.workflow.readiness.publishedNote}
        confirmLabel={copy.exams.workflow.readiness.publishClass}
        pending={publishClass.isPending}
        onConfirm={() => {
          if (!publishClassId) return;
          const scope = writeScope();
          if (!scope) return;
          publishClass.mutate({ ...scope, id: examId, classId: publishClassId });
          setPublishClassId(null);
        }}
      />

      <ConfirmDialog
        open={publishAllConfirm}
        onOpenChange={(open) => {
          if (!open) setPublishAllConfirm(false);
        }}
        title={copy.exams.workflow.readiness.publishAll}
        consequence={copy.exams.workflow.readiness.publishedNote}
        confirmLabel={copy.exams.workflow.readiness.publishAll}
        pending={publishExam.isPending}
        onConfirm={() => {
          const scope = writeScope();
          if (!scope) return;
          publishExam.mutate({ ...scope, id: examId });
          setPublishAllConfirm(false);
        }}
      />

      {/* The advisory override — a reason is required, recorded with the user. */}
      <Dialog
        open={Boolean(allowing)}
        onOpenChange={(open) => {
          if (!open) setAllowing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {allowing === "ALL"
                ? copy.exams.workflow.readiness.allowAllTitle
                : copy.exams.workflow.readiness.allowTitle}
            </DialogTitle>
            <DialogDescription>
              {allowing === "ALL"
                ? copy.exams.workflow.readiness.allowAllConsequence
                : `${allowingStudent ?? copy.common.none} — ${copy.exams.workflow.readiness.belowBar}`}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="allow-reason">{copy.exams.workflow.readiness.reason}</FieldLabel>
            <Input
              id="allow-reason"
              value={allowReason}
              placeholder={copy.exams.workflow.readiness.reasonPlaceholder}
              maxLength={500}
              onChange={(event) => setAllowReason(event.target.value)}
            />
            {allowReason.trim().length < 3 ? (
              <p className="text-muted-foreground text-xs">
                {copy.exams.workflow.readiness.reasonRequired}
              </p>
            ) : null}
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllowing(null)}>
              {copy.common.cancel}
            </Button>
            <Button
              disabled={allowReason.trim().length < 3 || override.isPending}
              onClick={async () => {
                if (!allowing) return;
                const reason = allowReason.trim();
                const scope = writeScope();
                if (!scope) return;
                if (allowing === "ALL") {
                  // One reason, every below-bar student: sequential, each
                  // recorded with this user — entry itself stays unblocked.
                  const pending = (readiness.data?.belowBar ?? []).filter((r) => !r.isOverridden);
                  for (const row of pending) {
                    await override.mutateAsync({
                      ...scope,
                      examId,
                      studentId: row.studentId,
                      overrideEligible: true,
                      reason,
                    });
                  }
                } else {
                  override.mutate({
                    ...scope,
                    examId,
                    studentId: allowing,
                    overrideEligible: true,
                    reason,
                  });
                }
                setAllowing(null);
              }}
            >
              {copy.exams.workflow.readiness.allow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

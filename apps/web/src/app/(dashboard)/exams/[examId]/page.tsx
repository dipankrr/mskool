"use client";

import { ArrowLeftIcon, MoreHorizontalIcon } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import { ComponentsDialog } from "@/features/exams/components-dialog";
import { ExamEditDialog } from "@/features/exams/exam-edit-dialog";
import { ExamLifecycleTrack, statusBadgeVariant } from "@/features/exams/exam-lifecycle-track";
import { PapersSection } from "@/features/exams/papers-section";
import {
  useEligibilityActions,
  useExamDetail,
  useExamWorkflowMutations,
  usePublicationActions,
  useReadiness,
  useTerms,
} from "@/features/exams/use-exam-workflow";
import { useClasses } from "@/features/classes/use-classes";
import { useActiveContext } from "@/features/session/active-context";
import { useStudents } from "@/features/students/use-students";
import { copy } from "@/lib/copy";
import type { ExamTransitionInput } from "@repo/contracts";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * EXAM DETAIL — one screen that changes shape with the lifecycle stage.
 *
 * The lifecycle track is the map (kept — the owner named it the good
 * part); the page is the legs: draft/scheduled lead with the class chips
 * and their papers (created from each class's subjects by "Add classes",
 * not hand-added), marks entry onward leads with entry links and the
 * Results & publication card — which exists ONLY from entry onward, since
 * a draft has nothing to publish. ONE solid button is the stage's next
 * action; back-moves and secondary links live in the overflow menu.
 *
 * The server remains the referee: every transition and publish re-checks
 * its preconditions, and a refusal arrives with its own wording.
 */

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

const STATUS_ORDER = [
  "draft",
  "scheduled",
  "ongoing",
  "marks_entry",
  "under_verification",
  "published",
  "locked",
] as const;

const BLUEPRINT_EDITABLE = new Set(["draft", "scheduled"]);
const ENTRY_OPEN = new Set(["marks_entry", "under_verification"]);

/**
 * Button copy per move: targets are status names (`draft`, `locked`), but
 * the back-moves read differently — `marks_entry` is only a BACK move when
 * you're in verification (from ongoing it is the forward move) — and the
 * lock is the one irreversible act, styled destructive with its
 * consequence stated.
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

export default function ExamDetailPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId;
  const { scopeArgs, has, writeScopeArgs } = useActiveContext();

  const detail = useExamDetail(examId);
  const classes = useClasses();
  const subjects = trpc.subject.list.useQuery(scopeArgs(), { staleTime: 30_000 });
  const terms = useTerms(detail.data?.exam.academicYearId ?? null);
  const students = useStudents();

  const { transition, update, saveComponents } = useExamWorkflowMutations();
  const { recompute, override } = useEligibilityActions(examId);
  const { publishClass, publishExam } = usePublicationActions(examId);

  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  const [componentsFor, setComponentsFor] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<string | null>(null);
  const [publishClassId, setPublishClassId] = useState<string | null>(null);
  const [publishAllConfirm, setPublishAllConfirm] = useState(false);
  const [allowing, setAllowing] = useState<string | null>(null);
  const [allowReason, setAllowReason] = useState("");

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

  // The chips follow the data: default to the first class in the exam,
  // fall back when the active one leaves it (removed, or data refreshed).
  useEffect(() => {
    if (activeClassId && examClassIds.includes(activeClassId)) return;
    setActiveClassId(examClassIds[0] ?? null);
  }, [examClassIds, activeClassId]);

  const readiness = useReadiness(examId, activeClassId ?? undefined);

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students.data ?? []) {
      map.set(student.id, [student.firstName, student.lastName].filter(Boolean).join(" "));
    }
    return map;
  }, [students.data]);

  // The components editor's schedule, identity-stable across refetches.
  // It sits BEFORE the early returns — hooks cannot follow a conditional
  // return (the Rules of Hooks crash this page when they did).
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
  const order = (status: string) => STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  // Forward = later in the lifecycle; the first forward move is THE next
  // action (the solid button). Everything else demotes to the overflow.
  const forwardTargets = allowedTargets.filter((t) => order(t) > order(exam.status));
  const backTargets = allowedTargets.filter((t) => order(t) < order(exam.status));
  const primaryTransition = forwardTargets[0];
  const resultsLink = entryOpen || exam.status === "published" || exam.status === "locked";
  const primaryIsResults = !primaryTransition && resultsLink;

  const allowingStudent = studentNameById.get(allowing ?? "");
  const publication = copy.exams.workflow.publication;

  // The publish confirm's consequence carries the live checklist — the
  // pre-publication state is part of the consequence, not a separate
  // panel to decode first.
  const publishConsequence = () => {
    const parts: string[] = [];
    if (readiness.data) {
      parts.push(
        `${publication.entries}: ${readiness.data.enteredEntries}/${readiness.data.expectedEntries}`,
      );
      parts.push(`${publication.verified}: ${readiness.data.verifiedEntries}`);
      const below = readiness.data.belowBar.filter((r) => !r.isOverridden).length;
      if (below > 0) parts.push(publication.belowCount(below));
    }
    parts.push(publication.publishedNote);
    return parts.join(" · ");
  };

  return (
    <>
      <PageHeader
        title={exam.name}
        description={termName ?? undefined}
        actions={
          <>
            <Badge variant={statusBadgeVariant(exam.status)}>{statusLabel(exam.status)}</Badge>
            <Link href="/exams" className={cn(buttonVariants({ variant: "outline" }))}>
              <ArrowLeftIcon data-icon="inline-start" />
              {copy.common.back}
            </Link>
          </>
        }
      />

      {/* The walk, made visible: where this exam is and what remains. */}
      <ExamLifecycleTrack status={exam.status} />

      {/* ONE solid next action; back-moves and links in the overflow. */}
      {has("exam:update") || primaryIsResults ? (
        <div className="flex flex-wrap items-center gap-2">
          {primaryTransition && has("exam:update") ? (
            <Button
              disabled={transition.isPending}
              onClick={() => setTransitionTarget(primaryTransition)}
            >
              {transitionCopy(exam.status, primaryTransition).label}
            </Button>
          ) : null}
          {primaryIsResults ? (
            <Link href={`/exams/${examId}/results`} className={cn(buttonVariants())}>
              {publication.viewResults}
            </Link>
          ) : null}
          {has("exam:update") ||
          (resultsLink && !primaryIsResults) ||
          (exam.status === "published" && has("exam:update")) ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline">
                    <MoreHorizontalIcon data-icon="inline-start" />
                    {copy.exams.workflow.moreActions}
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                {has("exam:update") ? (
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    {copy.exams.workflow.editExam}
                  </DropdownMenuItem>
                ) : null}
                {resultsLink && !primaryIsResults ? (
                  <DropdownMenuItem render={<Link href={`/exams/${examId}/results`} />}>
                    {publication.viewResults}
                  </DropdownMenuItem>
                ) : null}
                {has("exam:update")
                  ? backTargets.map((target) => (
                      <DropdownMenuItem
                        key={target}
                        onClick={() => setTransitionTarget(target)}
                      >
                        {transitionCopy(exam.status, target).label}
                      </DropdownMenuItem>
                    ))
                  : null}
                {has("exam:update") && exam.status === "published" ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setTransitionTarget("locked")}
                  >
                    {transitionCopy(exam.status, "locked").label}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <PapersSection
        examId={examId}
        editable={editable}
        entryOpen={entryOpen}
        canUpdate={has("exam:update")}
        schedules={schedules}
        classes={classes.data ?? []}
        subjects={subjects.data ?? []}
        academicYearId={exam.academicYearId}
        activeClassId={activeClassId}
        onActiveClassChange={setActiveClassId}
        onEditComponents={setComponentsFor}
      />

      {/* Results & publication — exists only from marks entry onward; a
          draft has nothing to publish, and showing the machinery then is
          exactly what made it unreadable. */}
      {entryOpen && examClassIds.length > 0 && activeClassId ? (
        <Card>
          <CardHeader>
            <CardTitle>{publication.title}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{publication.subtitle}</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {readiness.isLoading ? (
              <Spinner />
            ) : readiness.data ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">
                    {publication.entries}: {readiness.data.enteredEntries}/
                    {readiness.data.expectedEntries}
                  </Badge>
                  <Badge variant="outline">
                    {publication.verified}: {readiness.data.verifiedEntries}
                  </Badge>
                  <Badge variant={readiness.data.staleCompute ? "destructive" : "secondary"}>
                    {readiness.data.staleCompute ? publication.stale : publication.fresh}
                  </Badge>
                  {has("exam:update") ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ms-auto"
                      disabled={recompute.isPending}
                      onClick={() => {
                        const scope = writeScope();
                        if (!scope) return;
                        recompute.mutate({ ...scope, id: examId });
                      }}
                    >
                      {publication.eligibilityRecheck}
                    </Button>
                  ) : null}
                </div>

                {readiness.data.belowBar.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-sm">{publication.belowBar}</p>
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
                          {publication.allowAll}
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
                              {publication.allow}
                            </Button>
                          ) : (
                            <Badge variant="secondary">{publication.allowedBadge}</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {has("exam:publish") ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={publishClass.isPending}
                      onClick={() => setPublishClassId(activeClassId)}
                    >
                      {publication.publishClass}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={publishExam.isPending}
                      onClick={() => setPublishAllConfirm(true)}
                    >
                      {publication.publishAll}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Per-paper components batch editor */}
      {componentsSchedule ? (
        <ComponentsDialog
          open
          onOpenChange={(open) => {
            if (!open) setComponentsFor(null);
          }}
          scheduleId={componentsSchedule.id}
          scheduleLabel={`${classNameById.get(componentsSchedule.classId) ?? ""} — ${
            subjects.data?.find((s) => s.id === componentsSchedule.subjectId)?.name ?? ""
          }`}
          components={componentsSchedule.components}
          examAllowsNegativeMarking={exam.allowsNegativeMarking}
          pending={saveComponents.isPending}
          onSubmit={async (data) => {
            const scope = writeScope();
            if (!scope) return;
            await saveComponents.mutateAsync({ ...scope, ...data });
            setComponentsFor(null);
          }}
        />
      ) : null}

      {/* The exam's own details — the server freezes weight/count once
          marks exist and words the refusal; the dialog stays open. */}
      <ExamEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        exam={exam}
        pending={update.isPending}
        onSubmit={async ({ id, data }) => {
          const scope = writeScope();
          if (!scope) return;
          await update.mutateAsync({ ...scope, id, data });
          setEditOpen(false);
        }}
      />

      {/* Lifecycle confirmation — the consequence says what the state means. */}
      <ConfirmDialog
        open={Boolean(transitionTarget)}
        onOpenChange={(open) => {
          if (!open) setTransitionTarget(null);
        }}
        title={`${copy.exams.workflow.transitions.confirmTitle} ${
          transitionTarget ? transitionCopy(exam.status, transitionTarget).label : ""
        }`}
        consequence={transitionTarget ? transitionCopy(exam.status, transitionTarget).consequence : ""}
        confirmLabel={transitionTarget ? transitionCopy(exam.status, transitionTarget).label : copy.common.save}
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
        title={publication.publishClass}
        consequence={publishConsequence()}
        confirmLabel={publication.publishClass}
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
        title={publication.publishAll}
        consequence={publishConsequence()}
        confirmLabel={publication.publishAll}
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
              {allowing === "ALL" ? publication.allowAllTitle : publication.allowTitle}
            </DialogTitle>
            <DialogDescription>
              {allowing === "ALL"
                ? publication.allowAllConsequence
                : `${allowingStudent ?? copy.common.none} — ${publication.belowBar}`}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="allow-reason">{publication.reason}</FieldLabel>
            <Input
              id="allow-reason"
              value={allowReason}
              placeholder={publication.reasonPlaceholder}
              maxLength={500}
              onChange={(event) => setAllowReason(event.target.value)}
            />
            {allowReason.trim().length < 3 ? (
              <p className="text-muted-foreground text-xs">{publication.reasonRequired}</p>
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
              {publication.allow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

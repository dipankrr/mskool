"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Spinner } from "@/components/ui/spinner";
import { useClasses } from "@/features/classes/use-classes";
import { useExamDetail } from "@/features/exams/use-exam-workflow";
import {
  useCardVersions,
  useClassResults,
  usePublications,
  useResultActions,
  useStudentEntries,
} from "@/features/exams/use-exam-results";
import { usePublicationActions } from "@/features/exams/use-exam-workflow";
import { useActiveContext } from "@/features/session/active-context";
import { useStudents } from "@/features/students/use-students";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { formatIsoDate } from "@/lib/format";
import type { ExamClassResults, ExamPublicationRow } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";

/**
 * RESULTS + PUBLICATION (S4) — the principal's decision surface.
 *
 * The league table and the stats are one read (the computed chain); the
 * publication controls live on the same screen as the numbers they freeze,
 * with the consequence said out loud. Corrections after publication go
 * through the ledger — the dialog names the entry, the revised mark, and
 * the reason, and the engine re-issues only the cards that changed.
 */

interface CardSubject {
  subjectId?: unknown;
  subjectName?: unknown;
  marksObtained?: unknown;
  grade?: unknown;
}

/** Defensive read: snapshotData is versioned JSON, never trust its shape. */
function cardSubjects(card: { snapshotData?: unknown }): CardSubject[] {
  const snap = card.snapshotData;
  if (typeof snap !== "object" || snap === null) return [];
  const subjects = (snap as { subjects?: unknown }).subjects;
  return Array.isArray(subjects) ? (subjects as CardSubject[]) : [];
}

function subjectReading(s: CardSubject): string {
  const mark = typeof s.marksObtained === "string" ? s.marksObtained : null;
  const grade = typeof s.grade === "string" ? s.grade : null;
  return mark ?? grade ?? "—";
}

/** What moved between two consecutive card versions, one line per subject. */
function versionDiff(older: CardSubject[], newer: CardSubject[]): string[] {
  const oldById = new Map(older.map((s) => [String(s.subjectId), s]));
  const lines: string[] = [];
  for (const n of newer) {
    const o = oldById.get(String(n.subjectId));
    const name = typeof n.subjectName === "string" ? n.subjectName : "?";
    if (!o || subjectReading(o) !== subjectReading(n)) {
      lines.push(`${name}: ${o ? subjectReading(o) : "—"} → ${subjectReading(n)}`);
    }
  }
  return lines;
}

export default function ExamResultsPage() {
  const params = useParams<{ examId: string }>();
  const examId = params.examId;
  const { has, writeScopeArgs } = useActiveContext();

  const detail = useExamDetail(examId);
  const classes = useClasses();
  const students = useStudents();
  const [pickedClassId, setPickedClassId] = useState<string | null>(null);
  const [windowAction, setWindowAction] = useState<"open" | "close" | null>(null);
  const [publishConfirm, setPublishConfirm] = useState<"class" | "all" | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [correctingEntry, setCorrectingEntry] = useState<string | null>(null);
  const [revisedMarks, setRevisedMarks] = useState("");
  const [revisedGrade, setRevisedGrade] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  const schedules = useMemo(() => detail.data?.schedules ?? [], [detail.data]);
  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const klass of classes.data ?? []) map.set(klass.id, klass.name);
    return map;
  }, [classes.data]);

  const examClassIds = useMemo(() => {
    const present = new Set(schedules.map((s) => s.classId));
    return (classes.data ?? [])
      .filter((klass) => present.has(klass.id))
      .map((klass) => klass.id);
  }, [classes.data, schedules]);

  const classId = pickedClassId ?? examClassIds[0] ?? null;
  const results = useClassResults(examId, classId ?? undefined);
  const publications = usePublications(examId);
  const { compute, computeRanks, applyRevision } = useResultActions(examId, classId);
  const publicationActions = usePublicationActions(examId);

  const { publishClass, publishExam, openWindow, closeWindow } = publicationActions;

  useEffect(() => {
    if (pickedClassId && examClassIds.includes(pickedClassId)) return;
    setPickedClassId(examClassIds[0] ?? null);
  }, [examClassIds, pickedClassId]);

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students.data ?? []) {
      map.set(student.id, [student.firstName, student.lastName].filter(Boolean).join(" "));
    }
    return map;
  }, [students.data]);

  const subjectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of results.data?.subjects ?? []) map.set(subject.id, subject.name);
    return map;
  }, [results.data?.subjects]);

  const termByStudent = useMemo(() => {
    const map = new Map<string, ExamClassResults["termResults"][number]>();
    for (const row of results.data?.termResults ?? []) map.set(row.studentId, row);
    return map;
  }, [results.data]);

  const subjectResultFor = (studentId: string, subjectId: string) =>
    (results.data?.subjectResults ?? []).find(
      (r) => r.studentId === studentId && r.subjectId === subjectId,
    );

  const publicationsByClass = useMemo(() => {
    const map = new Map<string, ExamPublicationRow>();
    for (const row of publications.data ?? []) map.set(row.classId, row);
    return map;
  }, [publications.data]);

  const entries = useStudentEntries(examId, correcting ?? undefined);
  const versions = useCardVersions(historyFor ?? undefined);

  // School-parent writes (see the detail page): org-only scope fails
  // server-side, so the branch rides along or the user is asked.
  const writeScope = () => {
    const scope = writeScopeArgs();
    if (!scope) toast.error(copy.errors.needsBranch);
    return scope;
  };
  if (detail.isLoading) {
    return <PageHeader title={copy.common.loading} description={undefined} />;
  }

  if (!detail.data || examClassIds.length === 0) {
    return (
      <EmptyState
        title={copy.exams.results.title}
        description={copy.exams.results.notComputed}
        action={
          <Link href={`/exams/${examId}`} className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />
    );
  }

  const publication = classId ? publicationsByClass.get(classId) : undefined;
  const windowOpen = publication?.state === "revision_open";

  const submitCorrection = () => {
    if (!correctingEntry || revisionReason.trim().length < 3) return;
    const marks = revisedMarks.trim() === "" ? null : revisedMarks.trim();
    const grade = revisedGrade.trim() === "" ? null : revisedGrade.trim();
    if (marks === null && grade === null) return;
    const scope = writeScope();
    if (!scope) return;
    applyRevision.mutate({
      ...scope,
      id: correctingEntry,
      revisedMarks: marks,
      revisedGrade: grade,
      revisionType: "marks_correction",
      reason: revisionReason.trim(),
    });
    setCorrecting(null);
    setCorrectingEntry(null);
    setRevisedMarks("");
    setRevisedGrade("");
    setRevisionReason("");
  };

  const rosterRows = results.data?.roster ?? [];

  return (
    <>
      <PageHeader
        title={copy.exams.results.title}
        description={copy.exams.results.subtitle}
        actions={
          <Link href={`/exams/${examId}`} className={cn(buttonVariants({ variant: "outline" }))}>
            <ArrowLeftIcon data-icon="inline-start" />
            {copy.common.back}
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={classId ?? ""}
          onValueChange={(v) => {
            if (v) setPickedClassId(v);
          }}
        >
          <SelectTrigger aria-label={copy.exams.results.classPicker} className="w-56">
            <SelectValue>
              {(value: string | null) =>
                value ? (classNameById.get(value) ?? copy.common.none) : copy.common.none
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {examClassIds.map((id) => (
              <SelectItem key={id} value={id}>
                {classNameById.get(id) ?? id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <PermissionGate permission="exam:update">
          <Button
            variant="outline"
            disabled={compute.isPending || computeRanks.isPending}
            onClick={() => {
              if (!classId) return;
              const scope = writeScope();
              if (!scope) return;
              compute.mutate({ ...scope, id: examId, classId });
            }}
          >
            {copy.exams.results.compute}
          </Button>
          <Button
            variant="ghost"
            disabled={compute.isPending || computeRanks.isPending}
            onClick={() => {
              const scope = writeScope();
              if (!scope) return;
              computeRanks.mutate({ ...scope, termId: detail.data!.exam.termId });
            }}
          >
            {copy.exams.results.computeRanks}
          </Button>
        </PermissionGate>
      </div>

      {/* Publication — the act and its proof, on the same screen. */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{copy.exams.results.publishCard}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <PermissionGate permission="exam:publish">
              <Button
                size="sm"
                disabled={publishClass.isPending}
                onClick={() => classId && setPublishConfirm("class")}
              >
                {copy.exams.workflow.publication.publishClass}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={publishExam.isPending}
                onClick={() => setPublishConfirm("all")}
              >
                {copy.exams.workflow.publication.publishAll}
              </Button>
            </PermissionGate>
            <PermissionGate permission="marks:publish">
              {classId && publication ? (
                <Button
                  variant={windowOpen ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setWindowAction(windowOpen ? "close" : "open")}
                >
                  {windowOpen ? copy.exams.results.closeWindow : copy.exams.results.openWindow}
                </Button>
              ) : null}
            </PermissionGate>
            <PermissionGate permission="report_card:read">
              {classId ? (
                <Link
                  href={`/exams/${examId}/results/print?class=${classId}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {copy.exams.card.printSet}
                </Link>
              ) : null}
            </PermissionGate>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {examClassIds.map((id) => {
            const record = publicationsByClass.get(id);
            return (
              <div
                key={id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <span className="font-medium">{classNameById.get(id) ?? id}</span>
                {record ? (
                  <span className="text-muted-foreground flex flex-wrap items-center gap-2">
                    <Badge variant={record.state === "published" ? "secondary" : "outline"}>
                      {record.state === "published"
                        ? `${copy.exams.results.publishedOn} ${formatIsoDate(record.publishedAt)}`
                        : copy.exams.results.revisionOpen}
                    </Badge>
                    {record.reIssuedAt ? (
                      <span>
                        {copy.exams.results.windowClosed} {formatIsoDate(record.reIssuedAt)}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <Badge variant="outline">{copy.exams.results.statusDraft}</Badge>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* The league table. */}
      {results.isLoading ? (
        <Spinner className="mt-6" />
      ) : results.error ? (
        <div className="mt-6 flex flex-col items-start gap-2" role="alert">
          <p className="text-destructive text-sm">{errorMessage(results.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void results.refetch()}>
            {copy.common.retry}
          </Button>
        </div>
      ) : results.data ? (
        rosterRows.length === 0 || results.data.termResults.length === 0 ? (
          <EmptyState title={copy.exams.results.title} description={copy.exams.results.notComputed} />
        ) : (
          <>
            <h2 className="font-heading text-base font-semibold">
              {copy.exams.results.tableTitle}
              <span className="text-muted-foreground ms-2 text-sm font-normal">
                {classNameById.get(classId ?? "") ?? ""}
              </span>
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{copy.exams.results.title}</caption>
                <thead>
                  <tr className="text-muted-foreground border-b text-left text-xs">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {copy.exams.results.rank}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {copy.exams.results.student}
                    </th>
                    {results.data.subjects.map((subject) => (
                      <th
                        scope="col"
                        key={subject.id}
                        className="py-2 pr-3 text-right font-medium"
                      >
                        {subject.name}
                      </th>
                    ))}
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {copy.exams.results.total}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {copy.exams.results.percent}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-center font-medium">
                      {copy.exams.results.grade}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {copy.exams.results.state}
                    </th>
                    <th scope="col" className="py-2 pr-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rosterRows.map((student) => {
                    const name =
                      [student.firstName, student.lastName].filter(Boolean).join(" ") ||
                      student.admissionNumber;
                    const term = termByStudent.get(student.studentId);
                    return (
                      <tr key={student.studentId} className="border-b last:border-b-0">
                        <td className="text-muted-foreground py-2 pr-3 tabular-nums">
                          {term?.rankInClass ?? "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="font-medium">{name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {student.rollNumber ?? student.admissionNumber}
                          </span>
                        </td>
                        {results.data!.subjects.map((subject) => {
                          const row = subjectResultFor(student.studentId, subject.id);
                          const cell = row
                            ? row.isExempted
                              ? copy.exams.results.exempt
                              : row.isAbsent
                                ? copy.exams.results.absent
                                : row.isGradedOnly
                                  ? (row.grade ?? "—")
                                  : row.finalMarks != null
                                    ? `${Number(row.finalMarks)}/${Number(row.maxMarks)}`
                                    : "—"
                            : "—";
                          const stateCell =
                            row?.isExempted || row?.isAbsent || !row || cell === "—";
                          return (
                            <td
                              key={subject.id}
                              className={cn(
                                "py-2 pr-3 text-right tabular-nums",
                                stateCell && "text-muted-foreground",
                              )}
                            >
                              {cell}
                            </td>
                          );
                        })}
                        <td className="py-2 pr-3 text-right font-medium tabular-nums">
                          {term?.totalMarks != null
                            ? `${Number(term.totalMarks)}/${term.maxMarks != null ? Number(term.maxMarks) : "—"}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {term?.percentage != null ? `${term.percentage}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-center">
                          {term?.grade ? (
                            <span className="font-medium">{term.grade}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {term ? (
                            <Badge variant={term.isPassed ? "secondary" : "destructive"}>
                              {term.isPassed ? copy.exams.results.passed : copy.exams.results.failed}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setHistoryFor(student.studentId)}
                            >
                              {copy.exams.results.cardHistory}
                            </Button>
                            {has("marks:publish") && windowOpen ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setCorrecting(student.studentId);
                                  setCorrectingEntry(null);
                                  setRevisedMarks("");
                                  setRevisedGrade("");
                                  setRevisionReason("");
                                }}
                              >
                                {copy.exams.results.correct}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Class statistics — what makes the numbers meaningful. */}
            <Card>
              <CardHeader>
                <CardTitle>{copy.exams.results.statsTitle}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {results.data.stats.map((stat) => (
                  <div key={stat.subjectId} className="rounded-lg border p-3">
                    <p className="font-medium">{subjectNameById.get(stat.subjectId) ?? stat.subjectId}</p>
                    <dl className="text-muted-foreground mt-1.5 space-y-0.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt>{copy.exams.results.average}</dt>
                        <dd className="text-foreground font-medium tabular-nums">
                          {stat.average ?? "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{copy.exams.results.highest}</dt>
                        <dd className="text-foreground font-medium tabular-nums">
                          {stat.highest ?? "—"}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>{copy.exams.results.passCount}</dt>
                        <dd className="text-foreground font-medium tabular-nums">
                          {stat.passCount}/{stat.enteredCount}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
                <div className="border-primary/30 bg-primary/5 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs">{copy.exams.results.classAverage}</p>
                  <p className="font-heading text-2xl font-semibold tabular-nums">
                    {results.data.classAverage != null ? `${results.data.classAverage}%` : "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )
      ) : null}

      {/* Publish confirmation — parents see the cards from here on. */}
      <ConfirmDialog
        open={Boolean(publishConfirm)}
        onOpenChange={(open) => {
          if (!open) setPublishConfirm(null);
        }}
        title={
          publishConfirm === "all"
            ? copy.exams.workflow.publication.publishAll
            : copy.exams.workflow.publication.publishClass
        }
        consequence={copy.exams.workflow.publication.publishedNote}
        confirmLabel={
          publishConfirm === "all"
            ? copy.exams.workflow.publication.publishAll
            : copy.exams.workflow.publication.publishClass
        }
        pending={publishClass.isPending || publishExam.isPending}
        onConfirm={() => {
          if (!publishConfirm) return;
          const scope = writeScope();
          if (!scope) return;
          if (publishConfirm === "all") {
            publishExam.mutate({ ...scope, id: examId });
          } else if (classId) {
            publishClass.mutate({ ...scope, id: examId, classId });
          }
          setPublishConfirm(null);
        }}
      />

      {/* Correction-window confirmation. */}
      <ConfirmDialog
        open={Boolean(windowAction)}
        onOpenChange={(open) => {
          if (!open) setWindowAction(null);
        }}
        title={
          windowAction === "open"
            ? copy.exams.results.windowOpenTitle
            : copy.exams.results.windowCloseTitle
        }
        consequence={
          windowAction === "open"
            ? copy.exams.results.windowOpenConsequence
            : copy.exams.results.windowCloseConsequence
        }
        confirmLabel={
          windowAction === "open"
            ? copy.exams.results.openWindow
            : copy.exams.results.closeWindow
        }
        destructive={windowAction === "close"}
        pending={openWindow.isPending || closeWindow.isPending}
        onConfirm={() => {
          if (!classId || !windowAction) return;
          const scope = writeScope();
          if (!scope) return;
          if (windowAction === "open") {
            openWindow.mutate({ ...scope, id: examId, classId });
          } else {
            closeWindow.mutate({ ...scope, id: examId, classId });
          }
          setWindowAction(null);
        }}
      />

      {/* The correction dialog — entry, revised mark, reason: all named. */}
      <Dialog
        open={Boolean(correcting)}
        onOpenChange={(open) => {
          if (!open) setCorrecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.exams.results.correctionTitle}</DialogTitle>
            <DialogDescription>
              {correcting ? (studentNameById.get(correcting) ?? correcting) : ""} —{" "}
              {copy.exams.results.correctionConsequence}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Select
              value={correctingEntry ?? ""}
              onValueChange={(v) => {
                if (v) setCorrectingEntry(v);
              }}
            >
              <SelectTrigger aria-label={copy.exams.results.entry}>
                <SelectValue>
                  {(value: string | null) => {
                    const entry = (entries.data ?? []).find((e) => e.id === value);
                    if (!entry) return copy.exams.results.entry;
                    const current =
                      entry.gradeObtained ?? entry.marksObtained != null
                        ? `${entry.gradeObtained ?? Number(entry.marksObtained)} / ${Number(entry.maxMarks)}`
                        : copy.common.none;
                    return `${entry.component} (${current})`;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(entries.data ?? [])
                  .filter((e) => e.resultStatus === "verified" || e.resultStatus === "published")
                  .map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.component} ({Number(entry.marksObtained ?? 0)} / {Number(entry.maxMarks)})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {correctingEntry ? (
              <div>
                <label htmlFor="revised-marks" className="text-sm font-medium">
                  {copy.exams.results.revisedMarks}
                </label>
                <Input
                  id="revised-marks"
                  inputMode="decimal"
                  value={revisedMarks}
                  onChange={(event) => setRevisedMarks(event.target.value)}
                />
              </div>
            ) : null}
            {correctingEntry ? (
              <div>
                <label htmlFor="revised-grade" className="text-sm font-medium">
                  {copy.exams.results.revisedGrade}
                </label>
                <Input
                  id="revised-grade"
                  maxLength={10}
                  value={revisedGrade}
                  placeholder={copy.exams.results.revisedGradePlaceholder}
                  onChange={(event) => setRevisedGrade(event.target.value)}
                />
              </div>
            ) : null}
            <div>
              <label htmlFor="revision-reason" className="text-sm font-medium">
                {copy.exams.workflow.publication.reason}
              </label>
              <Input
                id="revision-reason"
                value={revisionReason}
                placeholder={copy.exams.workflow.publication.reasonPlaceholder}
                onChange={(event) => setRevisionReason(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrecting(null)}>
              {copy.common.cancel}
            </Button>
            <Button
              disabled={
                !correctingEntry ||
                (revisedMarks.trim() === "" && revisedGrade.trim() === "") ||
                revisionReason.trim().length < 3 ||
                applyRevision.isPending
              }
              onClick={submitCorrection}
            >
              {copy.exams.results.correct}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card version history — every re-issue is visible. */}
      <Dialog
        open={Boolean(historyFor)}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.exams.results.cardVersionsTitle}</DialogTitle>
            <DialogDescription>
              {historyFor ? (studentNameById.get(historyFor) ?? historyFor) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {(versions.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">{copy.common.none}</p>
            ) : (
              (versions.data ?? []).map((card, index) => {
                // Versions arrive newest-first: the previous version is next.
                const previous = (versions.data ?? [])[index + 1];
                const changes = previous
                  ? versionDiff(cardSubjects(previous), cardSubjects(card))
                  : [];
                return (
                  <div
                    key={card.id}
                    className="flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        v{card.version}
                        {card.isCurrent ? (
                          <Badge variant="secondary" className="ml-2">
                            {copy.common.current}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground">
                        {formatIsoDate(card.publishedAt)}
                      </span>
                    </div>
                    {changes.length > 0 ? (
                      <ul className="text-muted-foreground list-disc pl-5 text-xs">
                        {changes.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { useExamWorkflowMutations } from "@/features/exams/use-exam-workflow";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { Class, ExamSchedule, Subject } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * PAPERS — the class-chip section that replaced the stacked per-class
 * cards. The chips ARE the class picker (of the old readiness panel AND
 * the old cards): one class active at a time, its papers in one table,
 * never a 5-classes × 8-subjects scroll.
 *
 * "Add classes" is the flow that replaced hand-adding every paper: each
 * new class's active curriculum mappings become prefilled schedule rows
 * (working-day date sequence, 09:30, 180 min, whole class) plus one
 * full-mark "Theory" part per paper — the CBSE norm as an EDITABLE
 * default, never a hidden rule. Both saves are the same batch endpoints
 * the editors use, so correcting a prefill is the ordinary edit path
 * (`schedules.save` replaces the class's rows and deletes the parts it
 * replaced — the service refuses once marks exist).
 *
 * The date-overlap badge is advisory client-side lint (same class, same
 * date, overlapping start→start+duration); the server stays the referee.
 */

const DEFAULT_START_TIME = "09:30";
const DEFAULT_DURATION_MINUTES = 180;
/** The CBSE norm, prefilled so the paper is valid before any edit. */
const DEFAULT_COMPONENT = {
  name: "Theory",
  maxMarks: "100",
  passMarks: "33",
  weightagePercentage: "100",
  isMandatoryPass: true,
  sequenceNumber: 1,
} as const;

/** Working-day sequence starting tomorrow, Sundays skipped. */
function prefilledExamDate(index: number): string {
  const day = new Date();
  day.setDate(day.getDate() + 1);
  while (day.getDay() === 0) day.setDate(day.getDate() + 1);
  let placed = 0;
  while (placed < index) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0) placed += 1;
  }
  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, "0");
  const dd = String(day.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const scheduleColumn = createAppColumnHelper<ExamSchedule>();

export function PapersSection({
  examId,
  editable,
  entryOpen,
  canUpdate,
  schedules,
  classes,
  subjects,
  academicYearId,
  activeClassId,
  onActiveClassChange,
  onEditPapers,
  onEditComponents,
}: {
  examId: string;
  /** Draft or scheduled — the only states whose blueprint can change. */
  editable: boolean;
  entryOpen: boolean;
  canUpdate: boolean;
  schedules: ExamSchedule[];
  classes: Class[];
  subjects: Subject[];
  academicYearId: string;
  activeClassId: string | null;
  onActiveClassChange: (classId: string) => void;
  onEditPapers: (classId: string) => void;
  onEditComponents: (scheduleId: string) => void;
}) {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removingFor, setRemovingFor] = useState<string | null>(null);

  // The shared workflow mutations — their toasts carry the server's
  // wording, so a refused save is never silent.
  const { saveSchedules, saveComponents } = useExamWorkflowMutations();

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const klass of classes) map.set(klass.id, klass.name);
    return map;
  }, [classes]);
  const subjectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of subjects) map.set(subject.id, subject.name);
    return map;
  }, [subjects]);

  // Classes that actually sit this exam, in the school's own order.
  const examClassIds = useMemo(() => {
    const present = new Set(schedules.map((s) => s.classId));
    return classes.filter((klass) => present.has(klass.id)).map((klass) => klass.id);
  }, [classes, schedules]);

  // Only the ACTIVE class's sections are fetched — a foreign class in the
  // addressed node would 403 (the useSections contract), so never ask.
  const sections = useSections(activeClassId ?? undefined, {
    enabled: Boolean(activeClassId),
  });
  const sectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections.data ?? []) map.set(section.id, section.name);
    return map;
  }, [sections.data]);

  const activeSchedules = useMemo(
    () => schedules.filter((s) => s.classId === activeClassId),
    [schedules, activeClassId],
  );

  // Advisory overlap lint: sort by start, flag rows that begin before the
  // previous row (same date) ends. Class-wide and section papers of the
  // same class CAN overlap legitimately (different rooms) — the badge is
  // a prompt to look, never a blocker.
  const conflictByScheduleId = useMemo(() => {
    const map = new Map<string, string>();
    const rows = [...activeSchedules].sort(
      (a, b) => a.examDate.localeCompare(b.examDate) || a.startTime.localeCompare(b.startTime),
    );
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]!;
      const row = rows[i]!;
      if (prev.examDate !== row.examDate) continue;
      if (prev.sectionId && row.sectionId && prev.sectionId !== row.sectionId) continue;
      const prevEnd =
        Number(prev.startTime.slice(0, 2)) * 60 +
        Number(prev.startTime.slice(3, 5)) +
        prev.durationMinutes;
      const rowStart = Number(row.startTime.slice(0, 2)) * 60 + Number(row.startTime.slice(3, 5));
      if (rowStart < prevEnd) map.set(row.id, subjectNameById.get(prev.subjectId) ?? "");
    }
    return map;
  }, [activeSchedules, subjectNameById]);

  const remainingClasses = classes.filter((klass) => !examClassIds.includes(klass.id));

  const addSelectedClasses = async () => {
    const scope = writeScopeArgs();
    if (!scope) {
      toast.error(copy.errors.needsBranch);
      return;
    }
    if (selectedClassIds.length === 0) {
      toast.error(copy.exams.workflow.addClassesNone);
      return;
    }
    setAdding(true);
    try {
      let papers = 0;
      for (const classId of selectedClassIds) {
        const mappings = await utils.assignment.subjectMapping.list.fetch({
          ...scopeArgs(),
          academicYearId,
          classId,
        });
        if (mappings.length === 0) continue;
        const rows = mappings.map((m, index) => ({
          classId,
          sectionId: null,
          subjectId: m.subjectId,
          examDate: prefilledExamDate(index),
          startTime: DEFAULT_START_TIME,
          durationMinutes: DEFAULT_DURATION_MINUTES,
        }));
        const saved = await saveSchedules.mutateAsync({ ...scope, id: examId, schedules: rows });
        for (const row of saved ?? []) {
          await saveComponents.mutateAsync({
            ...scope,
            id: row.id,
            components: [{ ...DEFAULT_COMPONENT }],
          });
          papers += 1;
        }
      }
      toast.success(
        copy.exams.workflow.addClassesAdded(
          selectedClassIds.length,
          papers,
        ),
      );
      setSelectedClassIds([]);
      setAddOpen(false);
    } catch {
      // Refused: the toast carries the wording; the dialog stays.
    } finally {
      setAdding(false);
    }
  };

  const removeClass = async () => {
    if (!removingFor) return;
    const scope = writeScopeArgs();
    if (!scope) {
      toast.error(copy.errors.needsBranch);
      return;
    }
    try {
      // An empty batch is the service's "remove the class" — it replaces
      // the class's rows (and their parts) with nothing.
      await saveSchedules.mutateAsync({ ...scope, id: examId, schedules: [] });
      setRemovingFor(null);
    } catch {
      // Refused (e.g. marks exist): the toast carries the wording.
    }
  };

  const columns = useMemo<DataTableColumns<ExamSchedule>>(
    () =>
      scheduleColumn.columns([
        scheduleColumn.display({
          id: "subject",
          header: copy.exams.workflow.fields.subject,
          cell: ({ row }) =>
            subjectNameById.get(row.original.subjectId) ?? copy.common.none,
        }),
        scheduleColumn.display({
          id: "section",
          header: copy.exams.workflow.fields.section,
          cell: ({ row }) =>
            row.original.sectionId
              ? (sectionNameById.get(row.original.sectionId) ?? copy.common.none)
              : copy.exams.workflow.allSections,
        }),
        scheduleColumn.display({
          id: "date",
          header: copy.exams.workflow.fields.date,
          cell: ({ row }) => (
            <div className="flex flex-col">
              <span>{formatIsoDate(row.original.examDate)}</span>
              {conflictByScheduleId.has(row.original.id) ? (
                <span className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400">
                  <TriangleAlertIcon aria-hidden className="size-3" />
                  {copy.exams.workflow.conflictWith(
                    conflictByScheduleId.get(row.original.id) ?? "",
                  )}
                </span>
              ) : null}
            </div>
          ),
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
          id: "components",
          header: copy.exams.workflow.componentSection,
          cell: ({ row }) =>
            canUpdate && editable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEditComponents(row.original.id)}
              >
                {row.original.components.length > 0
                  ? `${row.original.components.length} ${copy.exams.workflow.componentSection.toLowerCase()}`
                  : copy.exams.workflow.addComponentRow}
              </Button>
            ) : (
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
            ),
        }),
        scheduleColumn.display({
          id: "state",
          header: copy.exams.workflow.status,
          cell: ({ row }) =>
            row.original.isLocked ? (
              <Badge variant="secondary">{copy.exams.workflow.lockedBadge}</Badge>
            ) : entryOpen ? (
              <Link
                href={`/exams/${examId}/entry`}
                className="text-sm font-medium hover:underline"
              >
                {copy.exams.entry.title}
              </Link>
            ) : (
              copy.common.none
            ),
        }),
      ]),
    [
      subjectNameById,
      sectionNameById,
      conflictByScheduleId,
      canUpdate,
      editable,
      onEditComponents,
      entryOpen,
      examId,
    ],
  );

  return (
    <section aria-labelledby="schedules-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="schedules-heading" className="font-heading text-base font-semibold">
            {copy.exams.workflow.papersSection}
          </h2>
          <p className="text-muted-foreground text-sm">
            {copy.exams.workflow.papersSubtitle}
          </p>
        </div>
        {editable && canUpdate ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => {
              setSelectedClassIds([]);
              setAddOpen(true);
            }}>
              <PlusIcon data-icon="inline-start" />
              {copy.exams.workflow.addClasses}
            </Button>
            {activeClassId ? (
              <>
                <Button variant="outline" onClick={() => onEditPapers(activeClassId)}>
                  <PencilIcon data-icon="inline-start" />
                  {copy.exams.workflow.editScheduleFor}
                </Button>
                <Button variant="outline" onClick={() => setRemovingFor(activeClassId)}>
                  <Trash2Icon data-icon="inline-start" />
                  {copy.exams.workflow.removeClass}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {examClassIds.length > 0 ? (
        <div role="tablist" aria-label={copy.exams.workflow.fields.class} className="flex flex-wrap gap-1.5">
          {examClassIds.map((classId) => {
            const count = schedules.filter((s) => s.classId === classId).length;
            const selected = classId === activeClassId;
            return (
              <button
                key={classId}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onActiveClassChange(classId)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary font-medium text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted",
                )}
              >
                {classNameById.get(classId) ?? classId}
                <span className={cn("ml-1.5", selected ? "opacity-80" : "text-muted-foreground")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activeClassId ? (
        <DataTable
          data={activeSchedules}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.exams.workflow.papersSection}
          isLoading={sections.isLoading}
          error={sections.error}
          onRetry={() => void sections.refetch()}
          renderCard={(row) => (
            <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {subjectNameById.get(row.subjectId) ?? copy.common.none}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatIsoDate(row.examDate)} · {row.startTime.slice(0, 5)} ·{" "}
                  {row.durationMinutes} min · {row.venue ?? copy.common.none}
                </p>
                {conflictByScheduleId.has(row.id) ? (
                  <p className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400">
                    <TriangleAlertIcon aria-hidden className="size-3" />
                    {copy.exams.workflow.conflictWith(conflictByScheduleId.get(row.id) ?? "")}
                  </p>
                ) : null}
              </div>
              {entryOpen ? (
                <Link href={`/exams/${examId}/entry`} className="text-sm font-medium hover:underline">
                  {copy.exams.entry.title}
                </Link>
              ) : null}
            </div>
          )}
          empty={<span className="text-muted-foreground text-sm">{copy.common.none}</span>}
        />
      ) : examClassIds.length === 0 ? (
        <EmptyStateWithAdd
          editable={editable && canUpdate}
          onAdd={() => {
            setSelectedClassIds([]);
            setAddOpen(true);
          }}
        />
      ) : null}

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) setAddOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.exams.workflow.addClassesTitle}</DialogTitle>
            <DialogDescription>{copy.exams.workflow.addClassesDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {remainingClasses.length === 0 ? (
              <p className="text-muted-foreground text-sm">{copy.exams.workflow.addClassesEmpty}</p>
            ) : (
              remainingClasses.map((klass) => {
                const checked = selectedClassIds.includes(klass.id);
                return (
                  <label
                    key={klass.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setSelectedClassIds((prev) =>
                          value
                            ? [...prev, klass.id]
                            : prev.filter((id) => id !== klass.id),
                        )
                      }
                    />
                    {klass.name}
                  </label>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={adding} onClick={() => setAddOpen(false)}>
              {copy.common.cancel}
            </Button>
            <Button
              disabled={adding || selectedClassIds.length === 0 || remainingClasses.length === 0}
              onClick={() => void addSelectedClasses()}
            >
              {adding ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              {copy.exams.workflow.addClasses}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removingFor)}
        onOpenChange={(open) => {
          if (!open) setRemovingFor(null);
        }}
        title={copy.exams.workflow.removeClassTitle}
        consequence={copy.exams.workflow.removeClassConsequence}
        confirmLabel={copy.exams.workflow.removeClassConfirm}
        destructive
        pending={saveSchedules.isPending}
        onConfirm={() => void removeClass()}
      />
    </section>
  );
}

function EmptyStateWithAdd({
  editable,
  onAdd,
}: {
  editable: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">{copy.exams.workflow.papersEmptyBody}</p>
      {editable ? (
        <Button onClick={onAdd}>
          <PlusIcon data-icon="inline-start" />
          {copy.exams.workflow.addClasses}
        </Button>
      ) : null}
    </div>
  );
}

"use client";

import { PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { saveExamSchedulesInput } from "@repo/contracts";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { useExamWorkflowMutations } from "@/features/exams/use-exam-workflow";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import type { Class, ExamSchedule, Subject } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * PAPERS — the class-chip section, with the grid EDITABLE ON THE PAGE.
 *
 * The owner's call after the first redesign: editing belongs in the table
 * the principal is already looking at, not behind an "Edit" popup. So in
 * draft/scheduled the rows ARE inputs — date, start, minutes, venue,
 * section — and a "Save changes" bar appears the moment something differs
 * from the server. Edits are kept PER CLASS while hopping chips, and a
 * save is the same batch endpoint as before (replace the class's rows;
 * parts of replaced rows go with them — the service refuses once marks
 * exist).
 *
 * "Add classes" creates each new class's papers from its curriculum
 * (working-day dates, 09:30, 180 min, one full-mark Theory part — the
 * CBSE norm as an EDITABLE default). "Add subject" offers only the
 * class's MAPPED subjects that don't have a paper yet — never the whole
 * school catalogue.
 *
 * "Remove class" is an explicit `removeClassIds` on the save — an empty
 * batch used to be a silent no-op, because the replace works per class
 * PRESENT in the payload.
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

/** The wire shape a row must have to save (subset the form edits). */
type DraftRow = {
  /** The server row this draft came from — empty for rows added here. */
  id?: string;
  classId: string;
  sectionId: string | null;
  subjectId: string;
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue?: string;
  passMarks?: string;
};

function toDraft(s: ExamSchedule): DraftRow {
  return {
    id: s.id,
    classId: s.classId,
    sectionId: s.sectionId,
    subjectId: s.subjectId,
    examDate: s.examDate,
    // `type="time"` speaks HH:MM; the wire carries HH:MM:SS.
    startTime: s.startTime.slice(0, 5),
    durationMinutes: s.durationMinutes,
    venue: s.venue ?? undefined,
    // "0.00" is the not-yet-snapshotted default, not an override.
    passMarks: s.passMarks !== "0.00" ? s.passMarks : undefined,
  };
}

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
  onEditComponents,
}: {
  examId: string;
  /** Draft or scheduled — the only states whose papers can change. */
  editable: boolean;
  entryOpen: boolean;
  canUpdate: boolean;
  schedules: ExamSchedule[];
  classes: Class[];
  subjects: Subject[];
  academicYearId: string;
  activeClassId: string | null;
  onActiveClassChange: (classId: string) => void;
  onEditComponents: (scheduleId: string) => void;
}) {
  const { scopeArgs, writeScopeArgs } = useActiveContext();
  const utils = trpc.useUtils();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  // Per-class drafts: edits survive hopping chips, and a class with no
  // entry here simply renders the server's rows.
  const [drafts, setDrafts] = useState<Record<string, DraftRow[]>>({});
  const [newSubjectId, setNewSubjectId] = useState<string>("");

  const { saveSchedules, saveComponents } = useExamWorkflowMutations();

  const canEditRows = editable && canUpdate;

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

  // Only the ACTIVE class's sections and mappings are fetched — a foreign
  // class in the addressed node would 403 (the useSections contract).
  const sections = useSections(activeClassId ?? undefined, {
    enabled: Boolean(activeClassId),
  });
  const subjectTypes = trpc.exam.subjectTypes.list.useQuery(scopeArgs(), {
    staleTime: 30_000,
  });
  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    { ...scopeArgs(), academicYearId, classId: activeClassId ?? "" },
    { enabled: canEditRows && Boolean(activeClassId) && Boolean(academicYearId) },
  );
  // Papers come from EXAM-mode subjects only — a term-grade subject never
  // sits a paper; offering it here would schedule an unassessable one.
  const examModeSubjectIds = useMemo(() => {
    const termGradeIds = new Set(
      (subjectTypes.data ?? [])
        .filter((t) => t.assessmentMode !== "exam")
        .map((t) => t.id),
    );
    return new Set(
      (mappings.data ?? [])
        .filter((m) => m.subjectTypeId != null && !termGradeIds.has(m.subjectTypeId))
        .map((m) => m.subjectId),
    );
  }, [mappings.data, subjectTypes.data]);
  const sectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections.data ?? []) map.set(section.id, section.name);
    return map;
  }, [sections.data]);

  const serverRows = useMemo(
    () => schedules.filter((s) => s.classId === activeClassId),
    [schedules, activeClassId],
  );
  const serverDraft = useMemo(() => serverRows.map(toDraft), [serverRows]);
  const classDraft = activeClassId ? drafts[activeClassId] : undefined;
  const draftRows = classDraft ?? serverDraft;
  const dirty =
    Boolean(classDraft) && JSON.stringify(classDraft) !== JSON.stringify(serverDraft);

  const setRows = (rows: DraftRow[]) => {
    if (!activeClassId) return;
    setDrafts((prev) => ({ ...prev, [activeClassId]: rows }));
  };
  const updateRow = (index: number, patch: Partial<DraftRow>) => {
    setRows(draftRows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  // Mapped EXAM-mode subjects of the class that don't have a paper yet —
  // the only ones "Add subject" offers.
  const addableSubjects = useMemo(() => {
    const taken = new Set(draftRows.map((r) => r.subjectId));
    return [...examModeSubjectIds].filter((id) => !taken.has(id));
  }, [examModeSubjectIds, draftRows]);

  // Advisory overlap lint over the rows being shown (drafts included, so
  // the warning reacts while typing).
  const conflictByIndex = useMemo(() => {
    const map = new Map<number, string>();
    const rows = draftRows.map((row, index) => ({ row, index }));
    rows.sort(
      (a, b) =>
        (a.row.examDate || "").localeCompare(b.row.examDate || "") ||
        (a.row.startTime || "").localeCompare(b.row.startTime || ""),
    );
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1]!.row;
      const row = rows[i]!.row;
      if (!prev.examDate || prev.examDate !== row.examDate) continue;
      if (prev.sectionId && row.sectionId && prev.sectionId !== row.sectionId) continue;
      if (!prev.startTime || !row.startTime) continue;
      const prevEnd =
        Number(prev.startTime.slice(0, 2)) * 60 +
        Number(prev.startTime.slice(3, 5)) +
        (prev.durationMinutes || 0);
      const rowStart = Number(row.startTime.slice(0, 2)) * 60 + Number(row.startTime.slice(3, 5));
      if (rowStart < prevEnd) {
        map.set(rows[i]!.index, subjectNameById.get(prev.subjectId) ?? "");
      }
    }
    return map;
  }, [draftRows, subjectNameById]);

  const saveRows = async () => {
    if (!activeClassId) return;
    const scope = writeScopeArgs();
    if (!scope) {
      toast.error(copy.errors.needsBranch);
      return;
    }
    const payload = draftRows.map((r) => ({
      ...r,
      venue: r.venue || undefined,
      passMarks: r.passMarks || undefined,
    }));
    const parsed = saveExamSchedulesInput.safeParse({ id: examId, schedules: payload });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? copy.exams.workflow.saveBlocked);
      return;
    }
    try {
      await saveSchedules.mutateAsync({ ...scope, id: examId, schedules: parsed.data.schedules });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[activeClassId];
        return next;
      });
    } catch {
      // Refused: the toast carries the wording; the edits stay.
    }
  };

  const removeClass = async () => {
    if (!removeTarget) return;
    const scope = writeScopeArgs();
    if (!scope) {
      toast.error(copy.errors.needsBranch);
      return;
    }
    try {
      await saveSchedules.mutateAsync({
        ...scope,
        id: examId,
        schedules: [],
        removeClassIds: [removeTarget],
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[removeTarget];
        return next;
      });
      setRemoveTarget(null);
    } catch {
      // Refused (e.g. marks exist): the toast carries the wording.
    }
  };

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
      // Exam-mode subjects only — term-grade subjects never sit a paper.
      // Fetched fresh: the chips' cached list may not have resolved yet.
      const types = subjectTypes.data ?? (await utils.exam.subjectTypes.list.fetch(scopeArgs()));
      const termGradeTypeIds = new Set(
        types.filter((t) => t.assessmentMode !== "exam").map((t) => t.id),
      );
      for (const classId of selectedClassIds) {
        const classMappings = await utils.assignment.subjectMapping.list.fetch({
          ...scopeArgs(),
          academicYearId,
          classId,
        });
        const paperMappings = classMappings.filter(
          (m) => m.subjectTypeId != null && !termGradeTypeIds.has(m.subjectTypeId),
        );
        if (paperMappings.length === 0) continue;
        const rows: DraftRow[] = paperMappings.map((m, index) => ({
          classId,
          sectionId: null,
          subjectId: m.subjectId,
          examDate: prefilledExamDate(index),
          startTime: DEFAULT_START_TIME,
          durationMinutes: DEFAULT_DURATION_MINUTES,
        }));
        const saved = await saveSchedules.mutateAsync({ ...scope, id: examId, schedules: rows });
        // The save returns EVERY row of the exam — only the new class's
        // rows get the default part; a re-run must never reset another
        // class's customized components.
        for (const row of saved ?? []) {
          if (row.classId !== classId) continue;
          await saveComponents.mutateAsync({
            ...scope,
            id: row.id,
            components: [{ ...DEFAULT_COMPONENT }],
          });
          papers += 1;
        }
      }
      toast.success(copy.exams.workflow.addClassesAdded(selectedClassIds.length, papers));
      setSelectedClassIds([]);
      setAddOpen(false);
    } catch {
      // Refused: the toast carries the wording; the dialog stays.
    } finally {
      setAdding(false);
    }
  };

  const rowError = (row: DraftRow) =>
    Boolean(!row.subjectId || !row.examDate || !row.startTime || !row.durationMinutes);

  const header = copy.exams.workflow.fields;

  const renderReadonlyTable = () => (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground border-b text-left text-xs">
          <th className="py-2 pe-2 font-medium">{header.subject}</th>
          <th className="py-2 pe-2 font-medium">{header.section}</th>
          <th className="py-2 pe-2 font-medium">{header.date}</th>
          <th className="py-2 pe-2 font-medium">{header.startTime}</th>
          <th className="py-2 pe-2 font-medium">{header.duration}</th>
          <th className="py-2 pe-2 font-medium">{header.venue}</th>
          <th className="py-2 pe-2 font-medium">{copy.exams.workflow.componentSection}</th>
          <th className="py-2 font-medium">{copy.exams.workflow.status}</th>
        </tr>
      </thead>
      <tbody>
        {serverRows.map((row) => (
          <tr key={row.id} className="border-b last:border-b-0">
            <td className="py-2.5 pe-2">{subjectNameById.get(row.subjectId) ?? copy.common.none}</td>
            <td className="py-2.5 pe-2">
              {row.sectionId
                ? (sectionNameById.get(row.sectionId) ?? copy.common.none)
                : copy.exams.workflow.allSections}
            </td>
            <td className="py-2.5 pe-2">
              <div className="flex flex-col">
                <span>{formatIsoDate(row.examDate)}</span>
              </div>
            </td>
            <td className="py-2.5 pe-2">{row.startTime.slice(0, 5)}</td>
            <td className="py-2.5 pe-2">{row.durationMinutes}</td>
            <td className="py-2.5 pe-2">{row.venue || copy.common.none}</td>
            <td className="py-2.5 pe-2">
              <span className="text-muted-foreground text-xs">
                {row.components.length > 0
                  ? row.components
                      .map(
                        (c) =>
                          `${c.name} ${Number(c.maxMarks)} (${copy.exams.workflow.fields.passMarksOverrideShort} ${Number(c.passMarks)}, ${Number(c.weightagePercentage)}%)`,
                      )
                      .join(" · ")
                  : copy.common.none}
              </span>
            </td>
            <td className="py-2.5">
              {row.isLocked ? (
                <Badge variant="secondary">{copy.exams.workflow.lockedBadge}</Badge>
              ) : entryOpen ? (
                <Link href={`/exams/${examId}/entry`} className="font-medium hover:underline">
                  {copy.exams.entry.title}
                </Link>
              ) : (
                copy.common.none
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const renderEditTable = () => (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-muted-foreground text-left text-xs">
              <th className="pb-1 pe-2 font-medium">{header.subject}</th>
              <th className="pb-1 pe-2 font-medium">{header.section}</th>
              <th className="pb-1 pe-2 font-medium">{header.date}</th>
              <th className="pb-1 pe-2 font-medium">{header.startTime}</th>
              <th className="pb-1 pe-2 font-medium">{header.duration}</th>
              <th className="pb-1 pe-2 font-medium">{header.venue}</th>
              <th className="pb-1 pe-2 font-medium">{header.passMarksOverrideShort}</th>
              <th className="pb-1 pe-2 font-medium">{copy.exams.workflow.componentSection}</th>
              <th className="pb-1" aria-label={copy.common.actions} />
            </tr>
          </thead>
          <tbody>
            {draftRows.map((row, index) => {
              const invalid = rowError(row);
              const conflict = conflictByIndex.get(index);
              return (
                <tr key={`${row.subjectId}-${index}`}>
                  <td className="pb-2 pe-2 align-top">
                    <div className="flex flex-col">
                      <span className={cn(invalid && !row.subjectId && "text-destructive")}>
                        {subjectNameById.get(row.subjectId) ?? copy.common.none}
                      </span>
                      {conflict ? (
                        <span className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400">
                          <TriangleAlertIcon aria-hidden className="size-3" />
                          {copy.exams.workflow.conflictWith(conflict)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Select
                      value={row.sectionId ?? "all"}
                      onValueChange={(v) =>
                        updateRow(index, { sectionId: v === "all" ? null : v })
                      }
                    >
                      <SelectTrigger
                        aria-label={`${header.section} ${index + 1}`}
                        className="w-28"
                      >
                        <SelectValue>
                          {(value: string | null) =>
                            value && value !== "all"
                              ? (sectionNameById.get(value) ?? copy.common.none)
                              : copy.exams.workflow.allSections
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{copy.exams.workflow.allSections}</SelectItem>
                        {(sections.data ?? []).map((section) => (
                          <SelectItem key={section.id} value={section.id}>
                            {section.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Input
                      type="date"
                      aria-label={`${header.date} ${index + 1}`}
                      aria-invalid={invalid && !row.examDate ? true : undefined}
                      className="w-36"
                      value={row.examDate}
                      onChange={(e) => updateRow(index, { examDate: e.target.value })}
                    />
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Input
                      type="time"
                      aria-label={`${header.startTime} ${index + 1}`}
                      aria-invalid={invalid && !row.startTime ? true : undefined}
                      className="w-24"
                      value={row.startTime}
                      onChange={(e) => updateRow(index, { startTime: e.target.value })}
                    />
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Input
                      type="number"
                      min={5}
                      max={600}
                      inputMode="numeric"
                      aria-label={`${header.duration} ${index + 1}`}
                      aria-invalid={invalid && !row.durationMinutes ? true : undefined}
                      className="w-20"
                      value={row.durationMinutes}
                      onChange={(e) =>
                        updateRow(index, {
                          durationMinutes: e.target.value === "" ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Input
                      maxLength={150}
                      aria-label={`${header.venue} ${index + 1}`}
                      className="w-32"
                      value={row.venue ?? ""}
                      onChange={(e) => updateRow(index, { venue: e.target.value })}
                    />
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    <Input
                      inputMode="decimal"
                      aria-label={`${header.passMarksOverride} ${index + 1}`}
                      className="w-20"
                      placeholder={copy.common.none}
                      value={row.passMarks ?? ""}
                      onChange={(e) => updateRow(index, { passMarks: e.target.value })}
                    />
                  </td>
                  <td className="pb-2 pe-2 align-top">
                    {row.id ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEditComponents(row.id!)}
                      >
                        {copy.exams.workflow.componentSection}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {copy.exams.workflow.saveRowFirst}
                      </span>
                    )}
                  </td>
                  <td className="pb-2 align-top">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${copy.exams.workflow.removeRow} ${index + 1}`}
                      onClick={() => setRows(draftRows.filter((_, i) => i !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={newSubjectId || undefined}
          onValueChange={(v) => {
            if (!v || !activeClassId) return;
            setNewSubjectId("");
            setRows([
              ...draftRows,
              {
                classId: activeClassId,
                sectionId: null,
                subjectId: v,
                examDate: prefilledExamDate(draftRows.length),
                startTime: DEFAULT_START_TIME,
                durationMinutes: DEFAULT_DURATION_MINUTES,
              },
            ]);
          }}
        >
          <SelectTrigger className="w-56" disabled={addableSubjects.length === 0}>
            <PlusIcon data-icon="inline-start" />
            <SelectValue>
              {addableSubjects.length > 0
                ? copy.exams.workflow.addScheduleRow
                : copy.exams.workflow.allSubjectsAdded}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {addableSubjects.map((id) => (
              <SelectItem key={id} value={id}>
                {subjectNameById.get(id) ?? id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {dirty ? (
          <div className="ms-auto flex items-center gap-2">
            <Button
              variant="ghost"
              disabled={saveSchedules.isPending}
              onClick={() => {
                if (!activeClassId) return;
                setDrafts((prev) => {
                  const next = { ...prev };
                  delete next[activeClassId];
                  return next;
                });
              }}
            >
              {copy.common.cancel}
            </Button>
            <Button
              onClick={() => void saveRows()}
              disabled={saveSchedules.isPending || draftRows.some(rowError)}
            >
              <PencilIcon data-icon="inline-start" />
              {copy.exams.workflow.saveChanges}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <section aria-labelledby="schedules-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="schedules-heading" className="font-heading text-base font-semibold">
            {copy.exams.workflow.papersSection}
          </h2>
          <p className="text-muted-foreground text-sm">{copy.exams.workflow.papersSubtitle}</p>
        </div>
        {canEditRows ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setSelectedClassIds([]);
                setAddOpen(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              {copy.exams.workflow.addClasses}
            </Button>
            {activeClassId ? (
              <Button variant="outline" onClick={() => setRemoveTarget(activeClassId)}>
                <Trash2Icon data-icon="inline-start" />
                {copy.exams.workflow.removeClass}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {examClassIds.length > 0 ? (
        <div
          role="tablist"
          aria-label={copy.exams.workflow.fields.class}
          className="flex flex-wrap gap-1.5"
        >
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
        <div className="rounded-lg border p-3">
          {canEditRows ? renderEditTable() : renderReadonlyTable()}
        </div>
      ) : examClassIds.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">{copy.exams.workflow.papersEmptyBody}</p>
          {canEditRows ? (
            <Button
              onClick={() => {
                setSelectedClassIds([]);
                setAddOpen(true);
              }}
            >
              <PlusIcon data-icon="inline-start" />
              {copy.exams.workflow.addClasses}
            </Button>
          ) : null}
        </div>
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
            {classes.filter((klass) => !examClassIds.includes(klass.id)).length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {copy.exams.workflow.addClassesEmpty}
              </p>
            ) : (
              classes
                .filter((klass) => !examClassIds.includes(klass.id))
                .map((klass) => {
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
                            value ? [...prev, klass.id] : prev.filter((id) => id !== klass.id),
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
              disabled={adding || selectedClassIds.length === 0}
              onClick={() => void addSelectedClasses()}
            >
              {adding ? <Spinner data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              {copy.exams.workflow.addClasses}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
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

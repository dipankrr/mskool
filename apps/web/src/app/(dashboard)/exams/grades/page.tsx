"use client";

import { NotebookPenIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSections } from "@/features/sections/use-sections";
import { useClasses } from "@/features/classes/use-classes";
import { useStudentEnrollments } from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * TERM GRADES — the term_grade pipeline's entry screen (the screen whose
 * absence left Subject Types' flags doing nothing visible).
 *
 * A term-grade subject never sits a paper: the class's curriculum rows
 * whose RESULT TYPE is assessed by "Term grade" get a grade + remarks at
 * term end, per student. One subject at a time (chips), one student per
 * row; cells save on blur through the SAME subject gate as the marks grid
 * (ADR-029/029a — section + subject name the fact the save answers).
 *
 * Grade-only subjects that DO sit a paper are entered in the marks grid —
 * this screen is only for the no-paper pipeline.
 */

type RosterRow = {
  studentId: string;
  rollNumber: string | number | null;
  name: string;
};

export default function TermGradesPage() {
  const { scopeArgs, has, academicYearId } = useActiveContext();
  const utils = trpc.useUtils();

  const classes = useClasses();
  const [classId, setClassId] = useState("");
  const sections = useSections(classId || undefined, { enabled: Boolean(classId) });
  const [sectionId, setSectionId] = useState("");
  const terms = trpc.academic.term.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "" },
    { enabled: Boolean(academicYearId) },
  );
  const [termId, setTermId] = useState("");

  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "", classId },
    { enabled: Boolean(classId) },
  );
  const subjectTypes = trpc.exam.subjectTypes.list.useQuery(scopeArgs(), {
    staleTime: 30_000,
  });
  const subjectsList = trpc.subject.list.useQuery(scopeArgs(), { staleTime: 30_000 });
  const enrollments = useStudentEnrollments();
  const existing = trpc.exam.termGrades.list.useQuery(
    { ...scopeArgs(), termId },
    { enabled: Boolean(termId) },
  );

  // The class's term-grade subjects — the ONLY rows this screen enters.
  const termGradeSubjects = useMemo(() => {
    const termGradeTypeIds = new Set(
      (subjectTypes.data ?? [])
        .filter((t) => t.assessmentMode === "term_grade")
        .map((t) => t.id),
    );
    return (mappings.data ?? [])
      .filter((m) => m.subjectTypeId != null && termGradeTypeIds.has(m.subjectTypeId))
      .map((m) => ({ mappingId: m.id, subjectId: m.subjectId }));
  }, [mappings.data, subjectTypes.data]);

  const [subjectId, setSubjectId] = useState("");
  const activeSubject = termGradeSubjects.find((s) => s.subjectId === subjectId) ?? null;

  const subjectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of subjectsList.data ?? []) map.set(s.id, s.name);
    return map;
  }, [subjectsList.data]);

  // Roster: the section's enrollments in roll order (the mark page's sort —
  // un-numbered rolls go last, deliberately reachable).
  const roster = useMemo<RosterRow[]>(
    () =>
      (enrollments.data ?? [])
        .filter((pair) => pair.enrollment.sectionId === sectionId)
        .slice()
        .sort((a, b) => {
          const ra = a.enrollment.rollNumber;
          const rb = b.enrollment.rollNumber;
          if (ra == null || rb == null) {
            if (ra == null && rb == null)
              return a.student.firstName.localeCompare(b.student.firstName);
            return ra == null ? 1 : -1;
          }
          return Number(ra) - Number(rb);
        })
        .map((pair) => ({
          studentId: pair.student.id,
          rollNumber: pair.enrollment.rollNumber,
          name: [pair.student.firstName, pair.student.lastName].filter(Boolean).join(" "),
        })),
    [enrollments.data, sectionId],
  );

  const save = trpc.exam.termGrades.save.useMutation({
    onSuccess: async () => {
      await utils.exam.termGrades.list.invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const existingFor = (studentId: string) =>
    activeSubject
      ? (existing.data ?? []).find(
          (row) => row.studentId === studentId && row.mappingId === activeSubject.mappingId,
        )
      : undefined;

  const [savedRow, setSavedRow] = useState<string | null>(null);
  const markSaved = (studentId: string) => {
    setSavedRow(studentId);
    setTimeout(() => setSavedRow(null), 2000);
  };

  const gradeColumn = createAppColumnHelper<RosterRow>();
  const columns = useMemo<DataTableColumns<RosterRow>>(
    () =>
      gradeColumn.columns([
        gradeColumn.accessor("rollNumber", { header: copy.exams.grades.roll }),
        gradeColumn.display({
          id: "student",
          header: copy.exams.grades.student,
          cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
        }),
        gradeColumn.display({
          id: "grade",
          header: copy.exams.grades.grade,
          cell: ({ row }) => {
            const current = existingFor(row.original.studentId);
            return (
              <div className="flex items-center gap-2">
                <Input
                  aria-label={`${copy.exams.grades.grade} — ${row.original.name}`}
                  maxLength={10}
                  defaultValue={current?.grade ?? ""}
                  className="w-24"
                  disabled={!has("marks:create")}
                  onBlur={(e) => {
                    const grade = e.target.value.trim();
                    if (!grade || !activeSubject || !sectionId || !termId) return;
                    if (current?.grade === grade) return;
                    save.mutate(
                      {
                        ...scopeArgs(),
                        studentId: row.original.studentId,
                        termId,
                        mappingId: activeSubject.mappingId,
                        sectionId,
                        subjectId: activeSubject.subjectId,
                        grade,
                        ...(current?.teacherRemarks
                          ? { teacherRemarks: current.teacherRemarks }
                          : {}),
                      },
                      { onSuccess: () => markSaved(row.original.studentId) },
                    );
                  }}
                />
                {savedRow === row.original.studentId ? (
                  <span className="text-muted-foreground text-xs">{copy.exams.grades.saved}</span>
                ) : null}
              </div>
            );
          },
        }),
        gradeColumn.display({
          id: "remarks",
          header: copy.exams.grades.remarks,
          cell: ({ row }) => {
            const current = existingFor(row.original.studentId);
            return (
              <Input
                aria-label={`${copy.exams.grades.remarks} — ${row.original.name}`}
                maxLength={500}
                defaultValue={current?.teacherRemarks ?? ""}
                className="w-full max-w-72"
                disabled={!has("marks:create")}
                onBlur={(e) => {
                  const remarks = e.target.value.trim();
                  const grade = current?.grade ?? "";
                  if (!grade || !activeSubject || !sectionId || !termId) return;
                  if ((current?.teacherRemarks ?? "") === remarks) return;
                  save.mutate(
                    {
                      ...scopeArgs(),
                      studentId: row.original.studentId,
                      termId,
                      mappingId: activeSubject.mappingId,
                      sectionId,
                      subjectId: activeSubject.subjectId,
                      grade,
                      ...(remarks ? { teacherRemarks: remarks } : {}),
                    },
                    { onSuccess: () => markSaved(row.original.studentId) },
                  );
                }}
              />
            );
          },
        }),
      ]),
    // scopeArgs and save are stable (the context memo / the mutation hook);
    // everything the cells read is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, existing.data, activeSubject, sectionId, termId, has, savedRow, scopeArgs],
  );

  const ready = Boolean(classId && sectionId && termId && activeSubject);
  const canSave = has("marks:create");

  return (
    <>
      <PageHeader title={copy.exams.grades.title} description={copy.exams.grades.subtitle} />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={classId || undefined}
          onValueChange={(v) => {
            if (!v) return;
            setClassId(v);
            setSectionId("");
            setSubjectId("");
          }}
        >
          <SelectTrigger aria-label={copy.exams.grades.class} className="w-44">
            <SelectValue>
              {(value: string | null) =>
                value
                  ? (classes.data ?? []).find((k) => k.id === value)?.name ?? value
                  : copy.exams.grades.class
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(classes.data ?? []).map((klass) => (
              <SelectItem key={klass.id} value={klass.id}>
                {klass.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sectionId || undefined}
          onValueChange={(v) => {
            if (v) setSectionId(v);
          }}
          disabled={!classId}
        >
          <SelectTrigger aria-label={copy.exams.grades.section} className="w-36">
            <SelectValue>
              {(value: string | null) =>
                value
                  ? ((sections.data ?? []).find((s) => s.id === value)?.name ?? value)
                  : copy.exams.grades.section
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(sections.data ?? []).map((section) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={termId || undefined}
          onValueChange={(v) => {
            if (v) setTermId(v);
          }}
          disabled={!academicYearId}
        >
          <SelectTrigger aria-label={copy.exams.grades.term} className="w-36">
            <SelectValue>
              {(value: string | null) =>
                value
                  ? ((terms.data ?? []).find((t) => t.id === value)?.name ?? value)
                  : copy.exams.grades.term
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(terms.data ?? []).map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!canSave ? <Badge variant="outline">{copy.exams.grades.readOnly}</Badge> : null}
      </div>

      {classId && termGradeSubjects.length > 0 ? (
        <div
          role="tablist"
          aria-label={copy.exams.grades.subject}
          className="flex flex-wrap gap-1.5"
        >
          {termGradeSubjects.map((s) => {
            const selected = s.subjectId === subjectId;
            return (
              <button
                key={s.subjectId}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setSubjectId(s.subjectId)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary font-medium text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted",
                )}
              >
                {subjectNames.get(s.subjectId) ?? s.subjectId}
              </button>
            );
          })}
        </div>
      ) : null}

      {classId && termGradeSubjects.length === 0 ? (
        <EmptyState
          icon={NotebookPenIcon}
          title={copy.exams.grades.title}
          description={copy.exams.grades.pickSubjectFirst}
        />
      ) : null}
      {classId && (sections.data ?? []).length === 0 ? (
        <EmptyState title={copy.exams.grades.title} description={copy.exams.grades.noSection} />
      ) : null}
      {ready && roster.length === 0 ? (
        <EmptyState title={copy.exams.grades.title} description={copy.exams.grades.emptyRoster} />
      ) : null}

      {ready && roster.length > 0 ? (
        <DataTable
          data={roster}
          columns={columns}
          getRowId={(row) => row.studentId}
          caption={copy.exams.grades.title}
          isLoading={existing.isLoading}
          error={existing.error}
          onRetry={() => void existing.refetch()}
          renderCard={(row) => (
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="text-muted-foreground text-xs">
                  {copy.exams.grades.grade}: {existingFor(row.studentId)?.grade ?? "—"}
                </p>
              </div>
            </div>
          )}
          empty={<span className="text-muted-foreground text-sm">{copy.common.none}</span>}
        />
      ) : null}
    </>
  );
}

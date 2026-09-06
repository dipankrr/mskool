"use client";

import { MoreHorizontalIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FormDialog } from "@/components/form-dialog";
import { PermissionGate } from "@/components/permission-gate";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useActiveContext } from "@/features/session/active-context";
import { toast } from "sonner";

import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import { trpc } from "@/lib/trpc/client";
import { errorMessage } from "@/lib/errors";
import type {
  ClassSubjectMappingRow,
  SectionTeacherAssignmentRow,
  Subject,
} from "@/lib/trpc/types";

/**
 * THE CLASS CURRICULUM (S2's recorded straggler, now landed) — which
 * subjects this class takes this year (the mappings), and who teaches
 * what in each section (the assignments). Everything exam-shaped hangs
 * off these rows: the blueprint's coverage gate counts the counted
 * mappings, and the ADR-029 subject gate reads the assignment facts.
 *
 * Mappings are (year, class, subject) rows — subject picker + sequence;
 * assignments are (section, subject, teacher) rows keyed on the USER id,
 * so the staffing picker reads the teacher directory.
 */

const mappingColumn = createAppColumnHelper<ClassSubjectMappingRow>();
const assignmentColumn = createAppColumnHelper<SectionTeacherAssignmentRow>();

type Teacher = { userId: string; name: string };

export function CurriculumSection({
  classId,
  academicYearId,
  sections,
}: {
  classId: string;
  academicYearId: string;
  /** The class's sections — the assignment table is per-section. */
  sections: Array<{ id: string; name: string }>;
}) {
  const { scopeArgs, has } = useActiveContext();
  const utils = trpc.useUtils();

  // The section renders only what the caller can read: a class teacher
  // (no subject_mapping:read) sees the staffing table but not the subject
  // mappings, and the queries never fire — a forbidden list renders a
  // worded error this component cannot swallow, and the class page is for
  // teachers too.
  const canReadMappings = has("subject_mapping:read");
  const canReadAssignments = has("teacher_assignment:read");

  const subjects = trpc.subject.list.useQuery(scopeArgs(), {
    staleTime: 30_000,
    enabled: canReadMappings,
  });
  const mappings = trpc.assignment.subjectMapping.list.useQuery(
    { ...scopeArgs(), academicYearId, classId },
    { enabled: canReadMappings },
  );
  const teachers = trpc.assignment.teacherDirectory.useQuery(scopeArgs(), {
    staleTime: 30_000,
    enabled: canReadAssignments,
  });

  const [sectionPicked, setSectionPicked] = useState<string | null>(null);
  const activeSectionId = sectionPicked ?? sections[0]?.id ?? null;
  const assignments = trpc.assignment.teacherAssignment.list.useQuery(
    { ...scopeArgs(), sectionId: activeSectionId ?? "" },
    { enabled: Boolean(activeSectionId) && canReadAssignments },
  );

  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingSubject, setMappingSubject] = useState("");
  const [mappingSequence, setMappingSequence] = useState("");
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentSubject, setAssignmentSubject] = useState("");
  const [assignmentTeacher, setAssignmentTeacher] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("");

  const subjectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of (subjects.data ?? []) as Subject[]) {
      map.set(subject.id, subject.name);
    }
    return map;
  }, [subjects.data]);

  const mappingIds = new Set((mappings.data ?? []).map((m) => m.subjectId));
  const mappableSubjects = (subjects.data ?? []).filter(
    (subject) => !mappingIds.has(subject.id),
  );

  const createMapping = trpc.assignment.subjectMapping.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.classes.curriculum.mapped);
      await utils.assignment.subjectMapping.list.invalidate();
      setMappingOpen(false);
      setMappingSubject("");
      setMappingSequence("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createAssignment = trpc.assignment.teacherAssignment.create.useMutation({
    onSuccess: async () => {
      toast.success(copy.classes.curriculum.assigned);
      await utils.assignment.teacherAssignment.list.invalidate();
      setAssignmentOpen(false);
      setAssignmentSubject("");
      setAssignmentTeacher("");
      setAssignmentRole("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const mappingColumns = useMemo<DataTableColumns<ClassSubjectMappingRow>>(
    () =>
      mappingColumn.columns([
        mappingColumn.accessor("sequenceNumber", {
          header: copy.sessions.termFields.sequence,
        }),
        mappingColumn.display({
          id: "subject",
          header: copy.classes.curriculum.subject,
          cell: ({ row }) => subjectNameById.get(row.original.subjectId) ?? row.original.subjectId,
        }),
        mappingColumn.display({
          id: "elective",
          header: copy.classes.curriculum.elective,
          cell: ({ row }) =>
            row.original.isElective ? (
              <Badge variant="outline">{copy.classes.curriculum.elective}</Badge>
            ) : null,
        }),
      ]),
    [subjectNameById],
  );

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of (teachers.data ?? []) as Teacher[]) map.set(t.userId, t.name);
    return map;
  }, [teachers.data]);

  const assignmentColumns = useMemo<DataTableColumns<SectionTeacherAssignmentRow>>(
    () =>
      assignmentColumn.columns([
        assignmentColumn.display({
          id: "subject",
          header: copy.classes.curriculum.subject,
          cell: ({ row }) => subjectNameById.get(row.original.subjectId!) ?? copy.common.none,
        }),
        assignmentColumn.display({
          id: "teacher",
          header: copy.classes.curriculum.teacher,
          cell: ({ row }) => teacherNameById.get(row.original.userId) ?? copy.common.none,
        }),
        assignmentColumn.accessor("role", {
          header: copy.classes.curriculum.role,
          cell: ({ row }) => (
            <Badge variant="outline">
              {copy.classes.curriculum.roles[
                row.original.role as keyof typeof copy.classes.curriculum.roles
              ] ?? row.original.role}
            </Badge>
          ),
        }),
      ]),
    [subjectNameById, teacherNameById],
  );

  // A caller with NEITHER read sees nothing at all — the section is the
  // principal's view of the class; a teacher's portal into it is the
  // register, not the curriculum.
  if (!canReadMappings && !canReadAssignments) return null;

  return (
    <section aria-label={copy.classes.curriculum.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">
          {copy.classes.curriculum.title}
        </h2>
        <PermissionGate permission="subject_mapping:create">
          <Button
            variant="outline"
            size="sm"
            disabled={mappableSubjects.length === 0}
            onClick={() => setMappingOpen(true)}
          >
            <PlusIcon data-icon="inline-start" />
            {copy.classes.curriculum.mapSubject}
          </Button>
        </PermissionGate>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">
        {copy.classes.curriculum.subtitle}
      </p>

      <DataTable
        data={mappings.data ?? []}
        columns={mappingColumns}
        getRowId={(row) => row.id}
        caption={copy.classes.curriculum.title}
        isLoading={mappings.isLoading}
        error={mappings.error}
        onRetry={() => void mappings.refetch()}
        renderCard={(row) => (
          <div className="rounded-lg border p-4">
            <p className="font-medium">
              {row.sequenceNumber}. {subjectNameById.get(row.subjectId) ?? row.subjectId}
            </p>
          </div>
        )}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={copy.classes.curriculum.emptyTitle}
            description={copy.classes.curriculum.emptyBody}
            action={
              <PermissionGate permission="subject_mapping:create">
                <Button onClick={() => setMappingOpen(true)}>Map the first subject</Button>
              </PermissionGate>
            }
          />
        }
      />

      {/* Who teaches what where — per section (ADR-029's fact table). */}
      {sections.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-base font-semibold">
              {copy.classes.curriculum.staffing}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={activeSectionId ?? ""}
                onValueChange={(v) => {
                  if (v) setSectionPicked(v);
                }}
              >
                <SelectTrigger aria-label={copy.classes.curriculum.section} className="w-44">
                  <SelectValue>
                    {(value: string | null) =>
                      value
                        ? (sections.find((s) => s.id === value)?.name ?? copy.common.none)
                        : copy.common.none
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <PermissionGate permission="teacher_assignment:create">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAssignmentOpen(true)}
                >
                  <PlusIcon data-icon="inline-start" />
                  {copy.classes.curriculum.assign}
                </Button>
              </PermissionGate>
            </div>
          </div>
          <p className="text-muted-foreground -mt-1 text-sm">
            {copy.classes.curriculum.staffingSubtitle}
          </p>

          <DataTable
            data={assignments.data ?? []}
            columns={assignmentColumns}
            getRowId={(row) => row.id}
            caption={copy.classes.curriculum.staffing}
            isLoading={assignments.isLoading}
            error={assignments.error}
            onRetry={() => void assignments.refetch()}
            renderCard={(row) => (
              <div className="rounded-lg border p-4">
                <p className="font-medium">
                  {subjectNameById.get(row.subjectId ?? "") ?? copy.common.none}
                </p>
                <p className="text-muted-foreground text-xs">
                  {teacherNameById.get(row.userId) ?? copy.common.none}
                </p>
              </div>
            )}
            empty={
              <EmptyState
                title={copy.classes.curriculum.staffingEmptyTitle}
                description={copy.classes.curriculum.staffingEmptyBody}
              />
            }
          />
        </>
      ) : null}

      {/* Map-subject dialog */}
      <FormDialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        title={copy.classes.curriculum.mapSubject}
        description={copy.classes.curriculum.subtitle}
        pending={createMapping.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!mappingSubject) return;
          createMapping.mutate({
            ...scopeArgs(),
            academicYearId,
            classId,
            subjectId: mappingSubject,
            data: {
              academicYearId,
              classId,
              subjectId: mappingSubject,
              sequenceNumber: Number(mappingSequence || (mappings.data?.length ?? 0) + 1),
            },
          });
        }}
      >
        <Field>
          <FieldLabel htmlFor="curriculum-subject">{copy.classes.curriculum.subject}</FieldLabel>
          <Select
            value={mappingSubject}
            onValueChange={(v) => {
              if (v) setMappingSubject(v);
            }}
          >
            <SelectTrigger id="curriculum-subject">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? (subjectNameById.get(value) ?? copy.common.none)
                    : copy.common.required
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {mappableSubjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{copy.classes.curriculum.subjectHelp}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="curriculum-sequence">{copy.sessions.termFields.sequence}</FieldLabel>
          <Input
            id="curriculum-sequence"
            type="number"
            min={1}
            value={mappingSequence}
            onChange={(event) => setMappingSequence(event.target.value)}
          />
        </Field>
      </FormDialog>

      {/* Assign-teacher dialog */}
      <FormDialog
        open={assignmentOpen}
        onOpenChange={setAssignmentOpen}
        title={copy.classes.curriculum.assign}
        description={`${copy.classes.curriculum.section}: ${
          sections.find((s) => s.id === activeSectionId)?.name ?? ""
        }`}
        pending={createAssignment.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!activeSectionId || !assignmentTeacher || !assignmentRole) return;
          createAssignment.mutate({
            ...scopeArgs(),
            sectionId: activeSectionId,
            academicYearId,
            userId: assignmentTeacher,
            role: assignmentRole as "subject_teacher" | "class_teacher",
            // The CHECK pairs the role with the subject: a class teacher
            // has none; a subject teacher must have hers.
            ...(assignmentRole === "subject_teacher" && assignmentSubject
              ? { subjectId: assignmentSubject }
              : {}),
          });
        }}
      >
        <Field>
          <FieldLabel htmlFor="assign-role">{copy.classes.curriculum.role}</FieldLabel>
          <Select
            value={assignmentRole}
            onValueChange={(v) => {
              if (v) setAssignmentRole(v);
            }}
          >
            <SelectTrigger id="assign-role">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? (copy.classes.curriculum.roles[value as "subject_teacher"] ?? value)
                    : copy.common.required
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subject_teacher">
                {copy.classes.curriculum.roles.subject_teacher}
              </SelectItem>
              <SelectItem value="class_teacher">
                {copy.classes.curriculum.roles.class_teacher}
              </SelectItem>
            </SelectContent>
          </Select>
          <FieldError>{copy.classes.curriculum.roleHelp}</FieldError>
        </Field>
        {assignmentRole === "subject_teacher" ? (
          <Field>
            <FieldLabel htmlFor="assign-subject">{copy.classes.curriculum.subject}</FieldLabel>
            <Select
              value={assignmentSubject}
              onValueChange={(v) => {
                if (v) setAssignmentSubject(v);
              }}
            >
              <SelectTrigger id="assign-subject">
                <SelectValue>
                  {(value: string | null) =>
                    value ? (subjectNameById.get(value) ?? copy.common.none) : copy.common.required
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(mappings.data ?? []).map((mapping) => (
                  <SelectItem key={mapping.id} value={mapping.subjectId}>
                    {subjectNameById.get(mapping.subjectId) ?? mapping.subjectId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="assign-teacher">{copy.classes.curriculum.teacher}</FieldLabel>
          <Select
            value={assignmentTeacher}
            onValueChange={(v) => {
              if (v) setAssignmentTeacher(v);
            }}
          >
            <SelectTrigger id="assign-teacher">
              <SelectValue>
                {(value: string | null) =>
                  value
                    ? (teacherNameById.get(value) ?? copy.common.none)
                    : copy.common.required
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {((teachers.data ?? []) as Teacher[]).map((teacher) => (
                <SelectItem key={teacher.userId} value={teacher.userId}>
                  {teacher.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FormDialog>
    </section>
  );
}

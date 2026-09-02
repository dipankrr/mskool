"use client";

import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { AdmitStudentDialog } from "@/features/students/admit-dialog";
import {
  useStudentEnrollments,
  useStudents,
  useStudentMutations,
} from "@/features/students/use-students";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import type { Student } from "@/lib/trpc/types";

/**
 * THE ADMISSION REGISTER — the front desk's first screen and the entry point
 * of the admission flow (U2 adds the detail page with enrollment and section
 * assignment).
 *
 * Several queries, deliberately decoupled by permission: the register itself
 * (`student.list`, `student:read`), the enrollment join for the Class column
 * (`enrollment.list`, `enrollment:read`), and the class/section name lookups.
 * A caller who holds `student:read` but not `enrollment:read` — a librarian —
 * gets a register whose Class column reads "—", not a failed screen. A column
 * that needs several permissions must degrade per permission, not per page.
 *
 * The search is server-side (`q` crosses name parts and the admission
 * number) and debounced, so typing "Aditi" does not fire six queries.
 */

const column = createAppColumnHelper<Student>();

const SEARCH_DEBOUNCE_MS = 300;

function fullName(row: Student): string {
  return [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ");
}

export default function StudentsPage() {
  const { has, writeScopeArgs } = useActiveContext();

  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const students = useStudents(debouncedSearch);
  const enrollments = useStudentEnrollments();
  const classes = useClasses();
  const sections = useSections();
  const { create } = useStudentMutations();

  // The branch the register will attribute an admission to. With no branch
  // chosen (a trust with several, none selected) the admit button waits —
  // asking which branch is the screen's job, not the server's guess.
  const canAdmit = has("student:create") && Boolean(writeScopeArgs());

  const classNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const cls of classes.data ?? []) map.set(cls.id, cls.name);
    return map;
  }, [classes.data]);

  const sectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const section of sections.data ?? []) map.set(section.id, section.name);
    return map;
  }, [sections.data]);

  const enrollmentByStudent = useMemo(() => {
    const map = new Map<string, { classId: string; sectionId: string | null }>();
    for (const pair of enrollments.data ?? []) {
      map.set(pair.student.id, {
        classId: pair.enrollment.classId,
        sectionId: pair.enrollment.sectionId,
      });
    }
    return map;
  }, [enrollments.data]);

  // useCallback so the columns memo can depend on it without re-running
  // every render — it closes over the memoised maps, which change together.
  const enrolledLabel = useCallback((studentId: string): string => {
    const enrollment = enrollmentByStudent.get(studentId);
    if (!enrollment) return copy.students.notEnrolled;
    const className = classNameById.get(enrollment.classId);
    if (!className) return copy.common.none;
    const sectionName = enrollment.sectionId
      ? sectionNameById.get(enrollment.sectionId)
      : undefined;
    return sectionName ? `${className} · ${sectionName}` : className;
  }, [classNameById, sectionNameById, enrollmentByStudent]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("admissionNumber", {
          header: copy.students.fields.admissionNumber,
          cell: ({ row }) => (
            <Badge variant="outline">{row.original.admissionNumber}</Badge>
          ),
        }),
        column.display({
          id: "name",
          header: copy.students.fields.firstName,
          cell: ({ row }) => (
            <Link
              href={`/students/${row.original.id}`}
              className="font-medium hover:underline"
            >
              {fullName(row.original)}
            </Link>
          ),
        }),
        column.display({
          id: "enrolled",
          header: copy.students.enrolledIn,
          cell: ({ row }) => enrolledLabel(row.original.id),
        }),
        column.accessor("gender", {
          header: copy.students.fields.gender,
          cell: ({ row }) => copy.students.genders[row.original.gender],
        }),
        column.accessor("dateOfBirth", {
          header: copy.students.fields.dateOfBirth,
          cell: ({ row }) => formatIsoDate(row.original.dateOfBirth),
        }),
      ]),
    // The label helper closes over the memoised maps; they change together.
    [enrolledLabel],
  );

  const openAdmit = () => setFormOpen(true);

  const rows = students.data ?? [];
  const searching = debouncedSearch.length > 0;

  return (
    <>
      <PageHeader
        title={copy.nav.students}
        description={copy.students.subtitle}
        actions={
          <PermissionGate permission="student:create">
            <Button onClick={openAdmit} disabled={!canAdmit}>
              <PlusIcon data-icon="inline-start" />
              {copy.students.add}
            </Button>
          </PermissionGate>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={copy.students.searchPlaceholder}
          aria-label={copy.students.searchLabel}
          className="pl-9"
        />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        caption={copy.students.subtitle}
        isLoading={students.isLoading}
        error={students.error}
        onRetry={() => void students.refetch()}
        renderCard={(row) => (
          <div className="flex items-start justify-between gap-3 rounded-lg border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/students/${row.id}`}
                className="truncate font-medium hover:underline"
              >
                {fullName(row)}
              </Link>
              <span className="text-muted-foreground truncate text-xs">
                {enrolledLabel(row.id)}
              </span>
            </div>
            <Badge variant="outline">{row.admissionNumber}</Badge>
          </div>
        )}
        empty={
          searching ? (
            <EmptyState
              icon={SearchIcon}
              title={copy.students.noResultsTitle}
              description={copy.students.noResultsBody}
            />
          ) : (
            <EmptyState
              icon={UsersIcon}
              title={copy.students.emptyTitle}
              description={copy.students.emptyBody}
              action={
                <PermissionGate permission="student:create">
                  <Button onClick={openAdmit}>{copy.students.add}</Button>
                </PermissionGate>
              }
            />
          )
        }
      />

      <AdmitStudentDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        pending={create.isPending}
        onSubmit={async (data) => {
          // Close on success only: a refused admission keeps the form up
          // with the toast's wording beside it.
          try {
            await create.submit(data);
            setFormOpen(false);
          } catch {
            // The error toast is shown by the hook; the form stays.
          }
        }}
      />
    </>
  );
}

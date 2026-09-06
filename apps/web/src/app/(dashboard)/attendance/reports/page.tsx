"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/ui/spinner";
import { useClasses } from "@/features/classes/use-classes";
import { useSections } from "@/features/sections/use-sections";
import { useActiveContext } from "@/features/session/active-context";
import { useStudents } from "@/features/students/use-students";
import { copy } from "@/lib/copy";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { DataTable } from "@/components/data-table";
import { trpc } from "@/lib/trpc/client";

/**
 * ATTENDANCE REPORTS (S5 — the Phase 3 rider) — the screen the summaries
 * table always needed: one section's students × their term and annual
 * attendance percentages, the same rows the exam eligibility checks read
 * (hard rule 5 in UI: this is daily_attendance_status's aggregate, never
 * the raw records).
 *
 * Monthly rows exist too but a report per month × student is the register's
 * job, not the report's — the term/annual view is what decisions read.
 */

type SummaryRow = NonNullable<
  ReturnType<typeof useAttendanceSummaries>["data"]
>[number];

function useAttendanceSummaries(academicYearId: string | null, sectionId: string | null) {
  const { scopeArgs } = useActiveContext();
  return trpc.attendance.summary.useQuery(
    { ...scopeArgs(), academicYearId: academicYearId ?? "", sectionId: sectionId ?? undefined },
    { enabled: Boolean(academicYearId && sectionId) },
  );
}

const column = createAppColumnHelper<SummaryRow>();

export default function AttendanceReportsPage() {
  const { academicYearId } = useActiveContext();
  const classes = useClasses();
  const [classId, setClassId] = useState<string | null>(null);
  const sections = useSections(classId ?? undefined, { enabled: Boolean(classId) });
  const [sectionId, setSectionId] = useState<string | null>(null);

  const effectiveSectionId = sectionId ?? sections.data?.[0]?.id ?? null;
  const summaries = useAttendanceSummaries(academicYearId, effectiveSectionId);
  const students = useStudents();

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of students.data ?? []) {
      map.set(student.id, [student.firstName, student.lastName].filter(Boolean).join(" "));
    }
    return map;
  }, [students.data]);

  // One row per student: the annual row (or the worst term row if the year
  // is still running and no annual exists yet).
  const rows = useMemo(() => {
    const list = summaries.data ?? [];
    const annual = list.filter((row) => row.periodType === "annual");
    return annual.length > 0 ? annual : list.filter((row) => row.periodType === "term");
  }, [summaries.data]);

  const columns = useMemo<DataTableColumns<SummaryRow>>(
    () =>
      column.columns([
        column.display({
          id: "student",
          header: copy.exams.results.student,
          cell: ({ row }) =>
            studentNameById.get(row.original.studentId) ?? row.original.studentId,
        }),
        column.accessor("periodType", {
          header: copy.exams.reports.period,
          cell: ({ row }) =>
            row.original.periodType === "annual"
              ? copy.exams.reports.annual
              : copy.exams.reports.termRow,
        }),
        column.accessor("workingDays", { header: copy.exams.reports.workingDays }),
        column.accessor("daysPresent", { header: copy.exams.reports.present }),
        column.accessor("daysAbsent", { header: copy.exams.reports.absent }),
        column.accessor("attendancePercentage", {
          header: copy.exams.reports.percent,
          cell: ({ row }) => (
            <Badge variant="outline">{row.original.attendancePercentage}%</Badge>
          ),
        }),
      ]),
    [studentNameById],
  );

  return (
    <>
      <PageHeader
        title={copy.exams.reports.title}
        description={copy.exams.reports.subtitle}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={classId ?? ""}
          onValueChange={(v) => {
            if (v) {
              setClassId(v);
              setSectionId(null);
            }
          }}
        >
          <SelectTrigger aria-label={copy.exams.workflow.fields.class} className="w-56">
            <SelectValue>
              {(value: string | null) =>
                value
                  ? (classes.data ?? []).find((klass) => klass.id === value)?.name ??
                    copy.common.none
                  : copy.common.none
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
          value={effectiveSectionId ?? ""}
          onValueChange={(v) => {
            if (v) setSectionId(v);
          }}
        >
          <SelectTrigger aria-label={copy.exams.entry.section} className="w-44">
            <SelectValue>
              {(value: string | null) =>
                value
                  ? ((sections.data ?? []).find((section) => section.id === value)?.name ??
                    copy.common.none)
                  : copy.common.none
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

        <Button
          variant="ghost"
          onClick={() => {
            setClassId(null);
            setSectionId(null);
          }}
        >
          {copy.common.clear}
        </Button>
      </div>

      {summaries.isLoading ? (
        <Spinner className="mt-8" />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.exams.reports.title}
          isLoading={summaries.isLoading}
          error={summaries.error}
          onRetry={() => void summaries.refetch()}
          renderCard={(row) => (
            <div className="rounded-lg border p-4">
              <p className="font-medium">
                {studentNameById.get(row.studentId) ?? row.studentId}
              </p>
              <p className="text-muted-foreground text-xs">
                {copy.exams.reports.present} {row.daysPresent}/{row.workingDays} ·{" "}
                {row.attendancePercentage}%
              </p>
            </div>
          )}
          empty={
            <EmptyState
              title={copy.exams.reports.emptyTitle}
              description={copy.exams.reports.emptyBody}
            />
          }
        />
      )}
    </>
  );
}

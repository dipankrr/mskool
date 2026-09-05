"use client";

import { PlusIcon } from "lucide-react";
import { useMemo } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PermissionGate } from "@/components/permission-gate";
import { createAppColumnHelper, type DataTableColumns } from "@/lib/table";
import { copy } from "@/lib/copy";
import { useActiveContext } from "@/features/session/active-context";
import { useExams } from "@/features/exams/use-exam-workflow";

/**
 * THE EXAMS HUB (S2, read-only slice): every exam for the active session
 * with its lifecycle badge, linking to the detail page. Creation and
 * blueprint editing land with the next S2 commit (specified in
 * .kilo/plans/specs/s2-exam-setup.md).
 */

const column = createAppColumnHelper<ExamRow>();

type ExamRow = NonNullable<ReturnType<typeof useExams>["data"]>[number];

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

export default function ExamsPage() {
  const { academicYearId } = useActiveContext();
  const exams = useExams(academicYearId);

  const columns = useMemo<DataTableColumns<ExamRow>>(
    () =>
      column.columns([
        column.accessor("name", {
          header: copy.exams.subjects.fields.name,
          cell: ({ row }) => (
            <Link href={`/exams/${row.original.id}`} className="font-medium hover:underline">
              {row.original.name}
            </Link>
          ),
        }),
        column.accessor("examType", {
          header: copy.exams.workflow.type,
          cell: ({ row }) => <Badge variant="outline">{row.original.examType}</Badge>,
        }),
        column.accessor("status", {
          header: copy.exams.workflow.status,
          cell: ({ row }) => <Badge variant="outline">{statusLabel(row.original.status)}</Badge>,
        }),
      ]),
    [],
  );

  const rows = exams.data ?? [];

  return (
    <>
      <PageHeader title={copy.exams.setup.title} description={copy.exams.setup.subtitle} />
      <section aria-labelledby="exams-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="exams-heading" className="font-heading text-base font-semibold">
            {copy.exams.workflow.title}
          </h2>
          <PermissionGate permission="exam:create">
            <span className="text-muted-foreground text-xs">{copy.exams.workflow.comingSoon}</span>
          </PermissionGate>
        </div>

        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption={copy.exams.workflow.title}
          isLoading={exams.isLoading}
          error={exams.error}
          onRetry={() => void exams.refetch()}
          renderCard={(row) => (
            <Link href={`/exams/${row.id}`} className="block rounded-lg border p-4">
              <p className="flex items-center justify-between font-medium">
                {row.name}
                <Badge variant="outline">{statusLabel(row.status)}</Badge>
              </p>
            </Link>
          )}
          empty={
            <EmptyState
              icon={PlusIcon}
              title={copy.exams.workflow.emptyTitle}
              description={copy.exams.workflow.emptyBody}
            />
          }
        />
      </section>
    </>
  );
}

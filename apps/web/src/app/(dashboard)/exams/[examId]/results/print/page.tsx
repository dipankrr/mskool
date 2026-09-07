"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/ui/spinner";
import { ArrowLeftIcon, PrinterIcon } from "lucide-react";
import {
  parseCardSnapshot,
  ReportCardView,
  type ReportCardSnapshot,
} from "@/features/exams/report-card-view";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import type { ExamClassCard } from "@/lib/trpc/types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

/**
 * THE CLASS SET (S5) — the client-side print pass: every student's CURRENT
 * card for the exam's term, one after another with a page break between.
 * The browser's print dialog produces the PDFs (the owner's decision);
 * the school keeps the data, the browser keeps the layout work.
 */

export default function ClassSetPrintPage() {
  const params = useParams<{ examId: string }>();
  const search = useSearchParams();
  const classId = search.get("class");
  const examId = params.examId;
  const { scopeArgs } = useActiveContext();

  const cards = trpc.exam.cards.classSet.useQuery(
    { ...scopeArgs(), id: examId, classId: classId ?? "" },
    { enabled: Boolean(classId) },
  );

  const snapshots = useMemo(
    () =>
      (cards.data?.cards ?? [])
        .map((card) => ({ card, snapshot: parseCardSnapshot(card.snapshotData) }))
        .filter((row): row is { card: ExamClassCard; snapshot: ReportCardSnapshot } => row.snapshot != null),
    [cards.data],
  );

  if (cards.isLoading) {
    return (
      <>
        <PageHeader title={copy.exams.card.printSet} description={undefined} />
        <Spinner className="mt-10" />
      </>
    );
  }

  if (cards.error) {
    return (
      <>
        <PageHeader title={copy.exams.card.printSet} description={undefined} />
        <div className="mt-6 flex flex-col items-start gap-2" role="alert">
          <p className="text-destructive text-sm">{errorMessage(cards.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void cards.refetch()}>
            {copy.common.retry}
          </Button>
        </div>
      </>
    );
  }

  if (!classId || snapshots.length === 0) {
    return (
      <>
        <PageHeader title={copy.exams.card.printSet} description={undefined} />
        <EmptyState
          title={copy.exams.portal.emptyTitle}
          description={copy.exams.portal.emptyBody}
          action={
            <Link
              href={`/exams/${examId}/results`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {copy.common.back}
            </Link>
          }
        />
      </>
    );
  }

  // Invalid snapshots are listed, never silently dropped — a missing card
  // on print day is a fact the office must see, not an empty page.
  const invalidCount = (cards.data?.cards ?? []).length - snapshots.length;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={copy.exams.card.printSet}
          description={copy.exams.card.printCount(snapshots.length)}
          actions={
            <div className="flex gap-2">
              <Link
                href={`/exams/${examId}/results`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                {copy.common.back}
              </Link>
              <Button onClick={() => window.print()}>
                <PrinterIcon data-icon="inline-start" />
                {copy.exams.portal.print}
              </Button>
            </div>
          }
        />
      </div>

      <div className="flex flex-col gap-6">
        {invalidCount > 0 ? (
          <p className="text-destructive text-sm print:hidden">
            {copy.exams.card.invalidCount(invalidCount)}
          </p>
        ) : null}
        {snapshots.map(({ snapshot }) => (
          <div key={snapshot.student.admissionNumber} className="break-after-page">
            <ReportCardView snapshot={snapshot} />
          </div>
        ))}
      </div>
    </>
  );
}

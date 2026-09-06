"use client";

import { useMemo, useState } from "react";

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
import {
  parseCardSnapshot,
  ReportCardView,
} from "@/features/exams/report-card-view";
import { useActiveContext } from "@/features/session/active-context";
import { copy } from "@/lib/copy";
import { formatIsoDate } from "@/lib/format";
import { trpc } from "@/lib/trpc/client";

/**
 * THE FAMILY'S RESULTS (S5) — the portal door's other side.
 *
 * Hard rule 8 made real in UI: the page reads `published_report_cards`
 * ONLY (the ownership-scoped studentProcedure), so an unpublished mark
 * cannot reach this screen no matter how the component is misused. The
 * card renders from the frozen snapshot — nothing live, nothing computed
 * in the browser — and Print hands the exact same DOM to the printer.
 */

export default function PortalResultsPage() {
  const { academicYearId } = useActiveContext();
  const cards = trpc.portalExam.results.list.useQuery({ academicYearId: academicYearId ?? undefined });
  const [pickedCardId, setPickedCardId] = useState<string | null>(null);

  // Stable identity for the name map's dependency array.
  const list = useMemo(() => cards.data ?? [], [cards.data]);
  const cardId = pickedCardId ?? list[0]?.id ?? null;
  const card = trpc.portalExam.results.card.useQuery(
    { cardId: cardId ?? "" },
    { enabled: Boolean(cardId) },
  );

  const studentLabelById = useMemo(() => {
    // The list's snapshots carry the child's name; the picker reads it so
    // a multi-child login can tell the cards apart without another call.
    const map = new Map<string, string>();
    for (const row of list) {
      const snapshot = parseCardSnapshot(row.snapshotData);
      if (snapshot) map.set(row.id, snapshot.student.name);
    }
    return map;
  }, [list]);

  const snapshot = useMemo(
    () => (card.data ? parseCardSnapshot(card.data.snapshotData) : null),
    [card.data],
  );

  if (cards.isLoading) {
    return (
      <>
        <PageHeader title={copy.exams.portal.title} description={copy.exams.portal.subtitle} />
        <Spinner className="mt-10" />
      </>
    );
  }

  if (list.length === 0) {
    return (
      <>
        <PageHeader title={copy.exams.portal.title} description={copy.exams.portal.subtitle} />
        <EmptyState title={copy.exams.portal.emptyTitle} description={copy.exams.portal.emptyBody} />
      </>
    );
  }

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={copy.exams.portal.title}
          description={copy.exams.portal.subtitle}
          actions={
            <Button variant="outline" onClick={() => window.print()}>
              {copy.exams.portal.print}
            </Button>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select
            value={cardId ?? ""}
            onValueChange={(v) => {
              if (v) setPickedCardId(v);
            }}
          >
            <SelectTrigger aria-label={copy.exams.portal.childPicker} className="w-64">
              <SelectValue>
                {(value: string | null) => {
                  const row = list.find((c) => c.id === value);
                  const label = value ? (studentLabelById.get(value) ?? copy.common.none) : copy.common.none;
                  return row ? `${label} · ${formatIsoDate(row.publishedAt)}` : label;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {list.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {studentLabelById.get(row.id) ?? row.id} · {formatIsoDate(row.publishedAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {card.isLoading ? (
        <Spinner className="mt-6" />
      ) : snapshot ? (
        <ReportCardView snapshot={snapshot} />
      ) : (
        <p className="text-muted-foreground text-sm">{copy.exams.card.invalid}</p>
      )}
    </>
  );
}

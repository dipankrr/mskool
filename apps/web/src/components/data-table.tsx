"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import type { RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/list-skeleton";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import { useAppTable, type DataTableColumns } from "@/lib/table";

/**
 * ONE LIST COMPONENT, TWO SHAPES.
 *
 * A 12-column table on a 360px screen is either unreadable or a horizontal-scroll
 * puzzle, and the people using this app are often on a budget Android in an office
 * corridor. So the same rows render as cards below 768px and as a table above it.
 *
 * **The switch is CSS, not JavaScript.** Both branches are in the markup and
 * `md:hidden` / `hidden md:block` decides which is painted. Measuring the viewport
 * in JS would mean the server renders one branch and the client another, which is a
 * hydration mismatch — React discards the tree and the page flashes. The cost is
 * that both branches exist in the DOM; for lists of this size that is cheaper than
 * the alternative, and neither branch is ever painted twice.
 *
 * **Both shapes read the same row model**, so a sorted header reorders the cards
 * too. The card renderer receives `row.original`, not a cell array, because a card
 * is a designed summary rather than a transposed table row.
 *
 * Loading, empty and error are handled here rather than at each call site, since a
 * list that silently renders nothing is indistinguishable from a list that is still
 * loading — and that ambiguity is exactly what makes a slow connection feel broken.
 */
export function DataTable<TRow extends RowData>({
  data,
  columns,
  getRowId,
  renderCard,
  empty,
  caption,
  isLoading = false,
  error,
  onRetry,
  skeletonRows,
}: {
  data: TRow[];
  columns: DataTableColumns<TRow>;
  /** Stable row identity. Never the array index — rows reorder when sorted. */
  getRowId: (row: TRow) => string;
  /** The <768px shape. Gets the row itself, not its cells. */
  renderCard: (row: TRow) => ReactNode;
  /** Shown when the list is genuinely empty. Use `EmptyState`. */
  empty: ReactNode;
  /** Screen-reader description of the table. */
  caption?: string;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  skeletonRows?: number;
}) {
  /**
   * Called unconditionally, before any early return: hooks cannot live behind a
   * branch, and an empty or failed list still has to build a table instance.
   */
  const table = useAppTable({ columns, data, getRowId });

  if (isLoading) return <ListSkeleton rows={skeletonRows} />;

  if (error) {
    return (
      <EmptyState
        title={copy.access.loadFailedTitle}
        description={errorMessage(error)}
        action={
          onRetry ? <Button onClick={onRetry}>{copy.common.retry}</Button> : undefined
        }
      />
    );
  }

  if (data.length === 0) return <>{empty}</>;

  const rows = table.getRowModel().rows;

  return (
    <>
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div key={row.id}>{renderCard(row.original)}</div>
        ))}
      </div>

      <div className="hidden rounded-lg border md:block">
        <Table>
          {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const direction = header.column.getCanSort()
                    ? header.column.getIsSorted()
                    : false;

                  return (
                    <TableHead
                      key={header.id}
                      /**
                       * The sort state belongs on the cell for assistive tech, not
                       * only in the icon — an icon-only indicator is invisible to a
                       * screen reader.
                       */
                      aria-sort={
                        direction === "asc"
                          ? "ascending"
                          : direction === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-mx-2"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={header} />
                          {direction === "asc" ? (
                            <ArrowUpIcon data-icon="inline-end" />
                          ) : direction === "desc" ? (
                            <ArrowDownIcon data-icon="inline-end" />
                          ) : (
                            <ChevronsUpDownIcon
                              data-icon="inline-end"
                              className="opacity-50"
                            />
                          )}
                        </Button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

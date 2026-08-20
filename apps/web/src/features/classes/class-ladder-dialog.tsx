"use client";

import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FormDialog } from "@/components/form-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { useClassMutations } from "@/features/classes/use-classes";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import type { Class } from "@/lib/trpc/types";

/**
 * THE CLASS LADDER — and why there is no "order" field anywhere in this app.
 *
 * `classes` is unique per branch on both `name` and `numeric_order`. Exposing the
 * order as an input hands a non-technical admin a collision on a number they have no
 * reason to understand: "Another class already uses that position in the order" is a
 * true sentence and a useless one. The order is also entirely standard, so the UI
 * supplies it.
 *
 * Pre-primary rungs sit **below zero** — Nursery −3, LKG −2, UKG −1 — matching
 * `academic.contract.ts`. Numbering them 0,1,2 would push Class 1 to 3 and break the
 * obvious mapping for every class above it.
 *
 * **Bulk creation is N sequential requests, because no transactional bulk endpoint
 * exists.** Partial success is therefore a normal outcome, not an error path: the
 * ninth call can fail while the first eight are already committed. So the dialog
 * reports per row and offers to retry only what failed. A single "couldn't add
 * classes" toast would hide which rows landed, and the user's only recovery would be
 * to guess.
 */

type Rung = { name: string; numericOrder: number };

const LADDER: Rung[] = [
  { name: "Nursery", numericOrder: -3 },
  { name: "LKG", numericOrder: -2 },
  { name: "UKG", numericOrder: -1 },
  ...Array.from({ length: 12 }, (_, index) => ({
    name: `Class ${index + 1}`,
    numericOrder: index + 1,
  })),
];

type RowState = {
  rung: Rung;
  status: "waiting" | "creating" | "done" | "failed";
  message?: string;
};

export function ClassLadderDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already-created classes, so a rung cannot be added twice. */
  existing: Class[];
}) {
  const { createOne, refresh } = useClassMutations();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [running, setRunning] = useState(false);

  /**
   * Matched on name, not order: a school that renamed "Class 1" to "Standard I" has
   * the rung filled even though the ladder's label differs, and offering it again
   * would only produce a duplicate-order conflict.
   */
  const takenNames = useMemo(
    () => new Set(existing.map((cls) => cls.name.trim().toLowerCase())),
    [existing],
  );
  const takenOrders = useMemo(
    () => new Set(existing.map((cls) => cls.numericOrder)),
    [existing],
  );

  const isTaken = (rung: Rung) =>
    takenNames.has(rung.name.toLowerCase()) || takenOrders.has(rung.numericOrder);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setRows(null);
    setRunning(false);
  }, [open]);

  const toggle = (order: number) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(order)) {
        next.delete(order);
      } else {
        next.add(order);
      }
      return next;
    });
  };

  /** Sequential on purpose: see the note above about coherent partial failure. */
  const run = async (queue: Rung[]) => {
    setRunning(true);

    let state: RowState[] = queue.map((rung) => ({ rung, status: "waiting" }));
    setRows(state);

    for (const rung of queue) {
      state = state.map((row) =>
        row.rung.numericOrder === rung.numericOrder
          ? { ...row, status: "creating" }
          : row,
      );
      setRows(state);

      try {
        await createOne({ name: rung.name, numericOrder: rung.numericOrder });
        state = state.map((row) =>
          row.rung.numericOrder === rung.numericOrder
            ? { ...row, status: "done", message: undefined }
            : row,
        );
      } catch (error) {
        state = state.map((row) =>
          row.rung.numericOrder === rung.numericOrder
            ? {
                ...row,
                status: "failed",
                // Already human after ADR-026 — a duplicate name or order says so.
                message: errorMessage(error),
              }
            : row,
        );
      }
      setRows(state);
    }

    setRunning(false);

    // One refresh at the end rather than one per row: the list would otherwise
    // reflow a dozen times while the user is reading the report.
    await refresh();

    const added = state.filter((row) => row.status === "done").length;

    if (added > 0) toast.success(copy.classes.bulkAdded(added, state.length));
    if (added < state.length) toast.error(copy.classes.bulkPartial);
  };

  const failedRungs = (rows ?? [])
    .filter((row) => row.status === "failed")
    .map((row) => row.rung);

  const reporting = rows !== null;
  const allDone = reporting && failedRungs.length === 0 && !running;

  const submitLabel = !reporting
    ? copy.classes.add
    : failedRungs.length > 0
      ? copy.classes.bulkRetryFailed
      : copy.common.close;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.classes.ladderTitle}
      description={reporting ? undefined : copy.classes.ladderHelp}
      submitLabel={submitLabel}
      pending={running}
      disabled={!reporting && selected.size === 0}
      onSubmit={(event) => {
        event.preventDefault();

        if (allDone) {
          onOpenChange(false);
          return;
        }

        if (reporting) {
          void run(failedRungs);
          return;
        }

        void run(LADDER.filter((rung) => selected.has(rung.numericOrder)));
      }}
    >
      {reporting ? (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.rung.numericOrder}
              className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <span className="font-medium">{row.rung.name}</span>
              <span className="flex min-w-0 items-center gap-2 text-right">
                {row.status === "creating" ? <Spinner /> : null}
                {row.status === "done" ? (
                  <>
                    <CheckIcon className="size-4" />
                    <span className="text-muted-foreground">{copy.setup.done}</span>
                  </>
                ) : null}
                {row.status === "failed" ? (
                  <span className="text-destructive text-xs">{row.message}</span>
                ) : null}
                {row.status === "waiting" ? (
                  <span className="text-muted-foreground text-xs">
                    {copy.common.loading}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/*
            Stated before the mistake is made. Two "Class 11" rows collide on both
            name and order, and the collision is only reported by the database — long
            after the admin has decided how to model streams.
          */}
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>{copy.terms.class} 11</AlertTitle>
            <AlertDescription>{copy.classes.streamNote}</AlertDescription>
          </Alert>

          <div className="grid gap-1 sm:grid-cols-2">
            {LADDER.map((rung) => {
              const taken = isTaken(rung);

              return (
                <Field
                  key={rung.numericOrder}
                  orientation="horizontal"
                  data-disabled={taken ? true : undefined}
                >
                  <Checkbox
                    id={`rung-${rung.numericOrder}`}
                    checked={taken || selected.has(rung.numericOrder)}
                    disabled={taken}
                    onCheckedChange={() => toggle(rung.numericOrder)}
                  />
                  <FieldLabel htmlFor={`rung-${rung.numericOrder}`}>
                    {rung.name}
                  </FieldLabel>
                  {taken ? (
                    <FieldDescription>{copy.common.active}</FieldDescription>
                  ) : null}
                </Field>
              );
            })}
          </div>
        </>
      )}
    </FormDialog>
  );
}

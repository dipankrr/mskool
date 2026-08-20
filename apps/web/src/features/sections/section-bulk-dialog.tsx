"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { FormDialog } from "@/components/form-dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useSectionMutations } from "@/features/sections/use-sections";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";
import type { Section } from "@/lib/trpc/types";

/**
 * "Add A, B, C" in one step, because that is how the job is actually described.
 *
 * Creating sections one at a time means opening a dialog three times to type three
 * letters. So the input takes a list, split on commas or newlines, and the same
 * sequential runner the class ladder uses does the rest — partial success is a normal
 * outcome with no transactional bulk endpoint, so each name reports its own result and
 * only the failures can be retried.
 */

type RowState = {
  name: string;
  status: "waiting" | "creating" | "done" | "failed";
  message?: string;
};

/** Commas, newlines or both. Blank entries dropped, duplicates collapsed. */
function parseNames(raw: string): string[] {
  const seen = new Set<string>();

  return raw
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => {
      if (part.length === 0) return false;
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function SectionBulkDialog({
  open,
  onOpenChange,
  classId,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  existing: Section[];
}) {
  const { createOne, refresh } = useSectionMutations(classId);

  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [running, setRunning] = useState(false);

  const takenNames = useMemo(
    () => new Set(existing.map((section) => section.name.trim().toLowerCase())),
    [existing],
  );

  useEffect(() => {
    if (!open) return;
    setRaw("");
    setRows(null);
    setRunning(false);
  }, [open]);

  const parsed = parseNames(raw);
  const clashes = parsed.filter((name) => takenNames.has(name.toLowerCase()));
  /**
   * Names that already exist are dropped from the queue rather than sent and
   * refused. The server would answer with a readable conflict, but queuing a request
   * whose only possible outcome is failure — and then reporting that failure as if
   * it were news — is worse than saying so before submitting.
   */
  const runnable = parsed.filter((name) => !takenNames.has(name.toLowerCase()));

  const run = async (queue: string[]) => {
    setRunning(true);

    let state: RowState[] = queue.map((name) => ({ name, status: "waiting" }));
    setRows(state);

    for (const name of queue) {
      state = state.map((row) =>
        row.name === name ? { ...row, status: "creating" } : row,
      );
      setRows(state);

      try {
        await createOne(name);
        state = state.map((row) =>
          row.name === name ? { ...row, status: "done", message: undefined } : row,
        );
      } catch (error) {
        state = state.map((row) =>
          row.name === name
            ? { ...row, status: "failed", message: errorMessage(error) }
            : row,
        );
      }
      setRows(state);
    }

    setRunning(false);
    await refresh();

    const added = state.filter((row) => row.status === "done").length;

    if (added > 0) toast.success(copy.sections.bulkAdded(added, state.length));
    if (added < state.length) toast.error(copy.sections.bulkPartial);
  };

  const failed = (rows ?? [])
    .filter((row) => row.status === "failed")
    .map((row) => row.name);

  const reporting = rows !== null;
  const allDone = reporting && failed.length === 0 && !running;

  const submitLabel = !reporting
    ? copy.sections.add
    : failed.length > 0
      ? copy.sections.bulkRetryFailed
      : copy.common.close;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={copy.sections.addTitle}
      description={reporting ? undefined : copy.sections.namesHelp}
      submitLabel={submitLabel}
      pending={running}
      disabled={!reporting && runnable.length === 0}
      onSubmit={(event) => {
        event.preventDefault();

        if (allDone) {
          onOpenChange(false);
          return;
        }

        if (reporting) {
          void run(failed);
          return;
        }

        void run(runnable);
      }}
    >
      {reporting ? (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.name}
              className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <span className="font-medium">{row.name}</span>
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
        <Field data-invalid={clashes.length > 0 ? true : undefined}>
          <FieldLabel htmlFor="section-names">{copy.sections.bulkLabel}</FieldLabel>
          <Input
            id="section-names"
            autoFocus
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="A, B, C"
          />
          <FieldDescription>{copy.sections.bulkHelp}</FieldDescription>
          {/*
            Named before submitting rather than after failing: the server would refuse
            these with a readable conflict, but there is no reason to spend a round
            trip discovering something already on screen.
          */}
          {clashes.length > 0 ? (
            <FieldError>
              {clashes.join(", ")} already {clashes.length === 1 ? "exists" : "exist"} in
              this class this session, so {clashes.length === 1 ? "it" : "they"} will be
              skipped.
            </FieldError>
          ) : null}
          {runnable.length > 0 ? (
            <FieldDescription>
              {runnable.length === 1
                ? `Will add: ${runnable[0]}`
                : `Will add ${runnable.length}: ${runnable.join(", ")}`}
            </FieldDescription>
          ) : null}
        </Field>
      )}
    </FormDialog>
  );
}

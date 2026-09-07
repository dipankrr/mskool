"use client";

import { MoreVerticalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExamEntryComponent, ExamEntryGrid } from "@/lib/trpc/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { copy } from "@/lib/copy";
import { errorMessage } from "@/lib/errors";

/**
 * THE MARKS GRID (S3) — a spreadsheet, not a DataTable: rows are students,
 * columns are the paper's components, and every cell autosaves.
 *
 * State model, per cell — the user always knows where a cell stands:
 *   typing (unsaved) → saving → saved (server truth) | refused (worded).
 * The server's response is the cell's truth: its `updatedAt` becomes the
 * next save's optimistic-concurrency witness, so a second writer can never
 * be silently overwritten.
 *
 * Verified cells render disabled (the revision ledger owns them now);
 * absent/exempt are statuses in the cell menu, not fake numbers — the
 * result math treats them specially (absence is a flag, not a zero).
 */

const EXEMPTION_TYPES = ["medical", "disability", "board_approved", "other"] as const;

type CellKey = string;

interface CellState {
  marks: string;
  grade: string;
  absent: boolean;
  exempted: boolean;
  exemptionType?: string;
  phase: "idle" | "saving" | "saved" | "error";
  error?: string;
  resultStatus: string;
  entryId?: string;
  updatedAt?: string;
}

const cellKey = (studentId: string, componentId: string): CellKey =>
  `${studentId}|${componentId}`;

/** "72.00" → "72" — the wire is decimal-fixed, the input is human. */
function displayMarks(value: string | null): string {
  if (value == null) return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

function buildCells(grid: ExamEntryGrid): Map<CellKey, CellState> {
  const map = new Map<CellKey, CellState>();
  // Every roster × component cell exists from the start — entries are
  // sparse (rows are created lazily on first save), so building from
  // entries alone leaves fresh papers with nowhere to type.
  for (const student of grid.roster) {
    for (const component of grid.components) {
      map.set(cellKey(student.studentId, component.id), {
        marks: "",
        grade: "",
        absent: false,
        exempted: false,
        exemptionType: undefined,
        phase: "idle",
        resultStatus: "draft",
      });
    }
  }
  for (const entry of grid.entries) {
    map.set(cellKey(entry.studentId, entry.componentId), {
      marks: displayMarks(entry.marksObtained),
      grade: entry.gradeObtained ?? "",
      absent: entry.isAbsent,
      exempted: entry.isExempted,
      exemptionType: undefined,
      phase: "idle",
      resultStatus: entry.resultStatus,
      entryId: entry.id,
      updatedAt: new Date(entry.updatedAt).toISOString(),
    });
  }
  return map;
}

export interface MarkGridSaveInput {
  componentId: string;
  studentId: string;
  marks: string | null;
  grade?: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  exemptionType?: string | null;
  expectedUpdatedAt?: string;
}

/** The slice of the autosave response the grid needs to update its cell. */
export type MarkGridSaveResult = {
  id: string;
  resultStatus: string;
  marksObtained: string | null;
  gradeObtained: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  updatedAt: string;
} | null;

export function MarksEntryGrid({
  grid,
  editable,
  eligibility,
  onSave,
}: {
  grid: ExamEntryGrid;
  /** False when the exam is outside the entry window — the grid reads. */
  editable: boolean;
  /** studentId → the advisory eligibility row (undefined = none). */
  eligibility: Map<
    string,
    { isEligible: boolean; isOverridden: boolean } | undefined
  >;
  onSave: (input: MarkGridSaveInput) => Promise<MarkGridSaveResult>;
}) {
  const [cells, setCells] = useState<Map<CellKey, CellState>>(() => buildCells(grid));
  const timers = useRef(new Map<CellKey, ReturnType<typeof setTimeout>>());
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  // Rebuild from server truth when the query refetches — but never clobber
  // a cell that is saving or refused (its truth is still in flight).
  useEffect(() => {
    const fresh = buildCells(grid);
    setCells((prev) => {
      const next = new Map(fresh);
      for (const [key, state] of prev) {
        if (state.phase === "saving" || state.phase === "error") {
          next.set(key, state);
        }
      }
      return next;
    });
  }, [grid]);

  const patchCell = useCallback((key: CellKey, patch: Partial<CellState>) => {
    setCells((prev) => {
      const current = prev.get(key);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(key, { ...current, ...patch });
      return next;
    });
  }, []);

  const commitState = useCallback(
    async (key: CellKey, componentId: string, studentId: string, explicit?: CellState) => {
      // Explicit state wins: callers that just setState'd (status menu)
      // pass the NEXT state — reading the ref here would serialize the
      // pre-toggle flags and the toggle would snap back on save.
      const state = explicit ?? cellsRef.current.get(key);
      if (!state) return;
      const component = grid.components.find((c) => c.id === componentId);
      if (!component) return;

      const graded = grid.isGradedOnly;
      const marks =
        graded || state.absent || state.exempted
          ? null
          : state.marks.trim() === ""
            ? null
            : state.marks.trim();
      const grade = graded ? state.grade.trim() || null : null;
      if (marks != null && Number(marks) > Number(component.maxMarks)) {
        // The first line of defence; the DB trigger is the last.
        patchCell(key, { phase: "error", error: `≤ ${component.maxMarks}` });
        return;
      }

      patchCell(key, { phase: "saving", error: undefined });
      try {
        const saved = await onSave({
          componentId,
          studentId,
          marks,
          grade,
          isAbsent: state.absent,
          isExempted: state.exempted,
          exemptionType: state.exempted ? (state.exemptionType ?? null) : null,
          expectedUpdatedAt: state.updatedAt,
        });
        if (saved) {
          patchCell(key, {
            phase: "saved",
            error: undefined,
            resultStatus: saved.resultStatus,
            marks: displayMarks(saved.marksObtained),
            grade: saved.gradeObtained ?? "",
            absent: saved.isAbsent,
            exempted: saved.isExempted,
            entryId: saved.id,
            updatedAt: new Date(saved.updatedAt).toISOString(),
          });
          return;
        }
        patchCell(key, { phase: "error", error: copy.exams.entry.refused });
      } catch (error) {
        // The hook toasts the server's wording; the cell keeps it too, so
        // a gate refusal never reads as a version conflict.
        patchCell(key, { phase: "error", error: errorMessage(error) });
      }
    },
    [grid.components, grid.isGradedOnly, onSave, patchCell],
  );

  const commit = useCallback(
    async (key: CellKey, componentId: string, studentId: string) =>
      commitState(key, componentId, studentId),
    [commitState],
  );

  // Navigating away with keystrokes still debounced must not eat them:
  // flush every pending cell (best-effort — the saves run, the unmounted
  // grid simply stops listening for their results).
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [key, timer] of pending) {
        clearTimeout(timer);
        pending.delete(key);
        const [studentId, componentId] = key.split("|");
        void commitState(key, componentId ?? "", studentId ?? "");
      }
    };
  }, [commitState]);

  const scheduleSave = useCallback(
    (key: CellKey, componentId: string, studentId: string) => {
      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.current.delete(key);
        void commit(key, componentId, studentId);
      }, 800);
      timers.current.set(key, timer);
    },
    [commit],
  );

  const setCell = useCallback(
    (key: CellKey, componentId: string, studentId: string, patch: Partial<CellState>) => {
      patchCell(key, { ...patch, phase: "idle" });
      scheduleSave(key, componentId, studentId);
    },
    [patchCell, scheduleSave],
  );

  const roster = grid.roster;
  const components = useMemo(
    () => [...grid.components].sort((a, b) => a.sequenceNumber - b.sequenceNumber),
    [grid.components],
  );

  const cellEditable = (state?: CellState) =>
    editable && (!state || state.resultStatus !== "verified");

  const renderInput = (studentId: string, component: ExamEntryComponent, ariaLabel: string) => {
    const key = cellKey(studentId, component.id);
    const state = cells.get(key);
    const locked = !cellEditable(state);
    const over = state && !grid.isGradedOnly && Number(state.marks) > Number(component.maxMarks);

    // Graded-only papers take grades, not marks, on the Overall component.
    if (grid.isGradedOnly) {
      return (
        <div className="flex items-center gap-1">
          <Input
            type="text"
            inputMode="text"
            maxLength={10}
            className="w-20"
            disabled={locked}
            aria-label={ariaLabel}
            placeholder={copy.exams.entry.gradePlaceholder}
            value={state?.grade ?? ""}
            onChange={(e) =>
              setCell(key, component.id, studentId, {
                grade: e.target.value,
                absent: false,
                exempted: false,
                exemptionType: undefined,
              })
            }
            onBlur={() => {
              const timer = timers.current.get(key);
              if (timer) {
                clearTimeout(timer);
                timers.current.delete(key);
              }
              void commit(key, component.id, studentId);
            }}
          />
          {state?.phase === "saving" ? (
            <span className="text-muted-foreground text-xs">{copy.exams.entry.saving}</span>
          ) : state?.phase === "saved" ? (
            <span className="text-muted-foreground text-xs" aria-live="polite">
              {copy.exams.entry.saved}
            </span>
          ) : state?.phase === "error" ? (
            <span className="text-destructive text-xs" aria-live="assertive">
              {state.error ?? copy.exams.entry.conflict}
            </span>
          ) : null}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="decimal"
          min={grid.allowsNegativeMarking ? undefined : 0}
          max={Number(component.maxMarks)}
          step="0.5"
          className="w-20"
          disabled={locked}
          aria-label={ariaLabel}
          value={state?.marks ?? ""}
          onChange={(e) =>
            // Typing a mark clears any status — the menu re-applies it.
            // (Clearing only `absent` left exempted set and swallowed the
            // keystrokes on save.)
            setCell(key, component.id, studentId, {
              marks: e.target.value,
              absent: false,
              exempted: false,
              exemptionType: undefined,
            })
          }
          onBlur={() => {
            const timer = timers.current.get(key);
            if (timer) {
              clearTimeout(timer);
              timers.current.delete(key);
            }
            void commit(key, component.id, studentId);
          }}
        />
        {state?.phase === "saving" ? (
          <span className="text-muted-foreground text-xs">{copy.exams.entry.saving}</span>
        ) : state?.phase === "saved" ? (
          <span className="text-muted-foreground text-xs" aria-live="polite">
            {copy.exams.entry.saved}
          </span>
        ) : state?.phase === "error" || over ? (
          <span className="text-destructive text-xs" aria-live="assertive">
            {over ? `≤ ${component.maxMarks}` : (state?.error ?? copy.exams.entry.conflict)}
          </span>
        ) : null}
      </div>
    );
  };

  const renderMenu = (studentId: string, component: ExamEntryComponent, studentName: string) => {
    const key = cellKey(studentId, component.id);
    const state = cells.get(key);
    const locked = !cellEditable(state);
    if (locked) return null;

    const setStatus = (patch: Partial<CellState>) => {
      const timer = timers.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(key);
      }
      // Commit the NEXT state explicitly — patchCell's setState hasn't
      // flushed when commit runs, so reading back would save stale flags.
      const current = cellsRef.current.get(key);
      const next: CellState = {
        marks: "",
        grade: "",
        absent: false,
        exempted: false,
        phase: "idle",
        resultStatus: "draft",
        ...current,
        ...patch,
      };
      patchCell(key, next);
      void commitState(key, component.id, studentId, next);
    };

    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`${studentName} — ${component.name}`} />
          }
        >
          <MoreVerticalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() =>
              setStatus({ absent: !state?.absent, exempted: false, marks: "" })
            }
          >
            {state?.absent
              ? `${copy.exams.entry.absent} ✓`
              : copy.exams.entry.absent}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{copy.exams.entry.exempt}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuLabel>{copy.exams.entry.exemptType}</DropdownMenuLabel>
              {EXEMPTION_TYPES.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() =>
                    setStatus({
                      exempted: true,
                      exemptionType: type,
                      absent: false,
                      marks: "",
                    })
                  }
                >
                  {copy.exams.entry.exemptionTypes[type]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              setStatus({ absent: false, exempted: false, exemptionType: undefined, marks: "" })
            }
          >
            {copy.exams.entry.clear}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const cellStateBadge = (state?: CellState) =>
    state?.resultStatus === "verified" ? (
      <Badge variant="secondary">{copy.exams.entry.verifiedBadge}</Badge>
    ) : null;

  if (roster.length === 0) {
    return <p className="text-muted-foreground text-sm">{copy.exams.entry.emptyRoster}</p>;
  }

  return (
    <>
      {/* Desktop: the spreadsheet. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{copy.exams.entry.title}</caption>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 pr-4 font-medium">
                {copy.exams.entry.student}
              </th>
              {components.map((component) => (
                <th scope="col" key={component.id} className="py-2 pr-4 font-medium">
                  {component.name}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {copy.exams.entry.max} {Number(component.maxMarks)} ·{" "}
                    {copy.exams.entry.pass} {Number(component.passMarks)}
                    {component.isMandatoryPass ? " · ✓" : ""}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((student) => {
              const name = [student.firstName, student.lastName].filter(Boolean).join(" ");
              const elig = eligibility.get(student.studentId);
              return (
                <tr key={student.studentId} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {student.rollNumber ?? student.admissionNumber}
                    </span>
                    {elig && !elig.isEligible && !elig.isOverridden ? (
                      <Badge variant="outline" className="mt-1">
                        {copy.exams.entry.eligibilityBadge}
                      </Badge>
                    ) : null}
                  </td>
                  {components.map((component) => {
                    const state = cells.get(cellKey(student.studentId, component.id));
                    return (
                      <td key={component.id} className="py-2 pr-4">
                        <div className="flex items-center gap-1">
                          {renderInput(student.studentId, component, `${name} — ${component.name}`)}
                          {renderMenu(student.studentId, component, name)}
                          {cellStateBadge(state)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: the task survives as one card per student. */}
      <div className="flex flex-col gap-3 md:hidden">
        {roster.map((student) => {
          const name = [student.firstName, student.lastName].filter(Boolean).join(" ");
          const elig = eligibility.get(student.studentId);
          return (
            <div key={student.studentId} className="rounded-lg border p-3">
              <p className="font-medium">
                {name}
                <span className="text-muted-foreground ml-2 text-xs">
                  {student.rollNumber ?? student.admissionNumber}
                </span>
              </p>
              {elig && !elig.isEligible && !elig.isOverridden ? (
                <Badge variant="outline" className="mt-1">
                  {copy.exams.entry.eligibilityBadge}
                </Badge>
              ) : null}
              <div className="mt-2 flex flex-col gap-2">
                {components.map((component) => {
                  const state = cells.get(cellKey(student.studentId, component.id));
                  return (
                    <div key={component.id} className="flex items-center justify-between gap-2">
                      <span className="text-sm">
                        {component.name}
                        <span className="text-muted-foreground block text-xs">
                          {copy.exams.entry.max} {Number(component.maxMarks)}
                        </span>
                      </span>
                      <div className="flex items-center gap-1">
                        {renderInput(student.studentId, component, `${name} — ${component.name}`)}
                        {renderMenu(student.studentId, component, name)}
                        {cellStateBadge(state)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

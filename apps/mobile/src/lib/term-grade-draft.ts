/**
 * The term-grade draft store (chunk 7E): one subject's area grades for one
 * section, kept OUTSIDE React for the same reasons as the marks grid
 * (`exam-draft.ts`):
 *
 *  - a row that scrolls out of the FlatList window never loses typed text,
 *  - one keystroke re-renders one row (rows subscribe to their own cell),
 *  - "never lose typed work", "one in-flight save per student" and "a cleared
 *    field never deletes a saved grade" are plain code with plain tests.
 *
 * A cell is one student's grade + remarks. `base` is what the server last
 * confirmed; the typed values are what the teacher has changed since. Saves
 * are per commit (Next / blur / the details sheet), never per keystroke.
 */

export const GRADE_MAX = 10;
export const REMARKS_MAX = 500;

export type TermGradeBase = {
  rowId: string | null;
  grade: string | null;
  remarks: string | null;
  /** Round-tripped verbatim; used to order refetches, never reformatted. */
  updatedAt: string | null;
};

export type TermGradeProblem = {
  kind: "empty" | "server" | "conflict";
  /** Server wording for `server`/`conflict`; null for the local `empty` rule. */
  message: string | null;
};

export type TermGradeCell = {
  studentId: string;
  grade: string;
  remarks: string;
  base: TermGradeBase;
  phase: "idle" | "saving" | "failed";
  problem: TermGradeProblem | null;
  /** The server's value moved after the screen had shown it. */
  remoteChange: boolean;
};

export type TermGradeSaveInput = {
  studentId: string;
  grade: string;
  remarks: string | null;
};

export type TermGradeSaveResult = TermGradeBase;

export type ServerTermGrade = {
  studentId: string;
  rowId: string | null;
  grade: string | null;
  remarks: string | null;
  updatedAt: string | null;
};

export type DescribedError = { message: string; conflict: boolean };

export type TermGradeDraftOptions = {
  save: (input: TermGradeSaveInput) => Promise<TermGradeSaveResult | null>;
  describeError: (cause: unknown) => DescribedError;
  /** Fired once per conflict so the screen can re-read the term's rows. */
  onConflict?: (studentId: string) => void;
  /** Concurrent saves across DIFFERENT students. One student is always serial. */
  maxParallel?: number;
};

const BLANK_BASE: TermGradeBase = {
  rowId: null,
  grade: null,
  remarks: null,
  updatedAt: null,
};

/** Upper-case a grade and cap it at the contract's 10 characters. */
export function sanitizeGrade(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").slice(0, GRADE_MAX);
}

/** Remarks keep their line breaks; only the contract's ceiling applies. */
export function sanitizeRemarks(raw: string): string {
  return raw.slice(0, REMARKS_MAX);
}

function signatureOf(cell: TermGradeCell): string {
  return `${cell.grade}\u0000${cell.remarks}`;
}

function baseSignature(base: TermGradeBase): string {
  return `${base.grade ?? ""}\u0000${base.remarks ?? ""}`;
}

function baseOf(result: TermGradeSaveResult): TermGradeBase {
  return {
    rowId: result.rowId,
    grade: result.grade,
    remarks: result.remarks,
    updatedAt: result.updatedAt,
  };
}

function isOlder(next: string | null, current: string | null): boolean {
  if (!next || !current) return false;
  const a = new Date(next).getTime();
  const b = new Date(current).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a < b;
}

export class TermGradeDraft {
  private cells = new Map<string, TermGradeCell>();
  private cellListeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private options: TermGradeDraftOptions;
  private loadedFlag = false;
  private versionCounter = 0;
  private inFlight = new Set<string>();
  private inFlightSignature = new Map<string, string>();
  private waiting: string[] = [];
  private active = 0;

  constructor(options: TermGradeDraftOptions) {
    this.options = options;
  }

  /** Rebind the save closure after construction (the section/mapping in hand). */
  bind(next: Partial<TermGradeDraftOptions>): void {
    this.options = { ...this.options, ...next };
  }

  // -- subscription (useSyncExternalStore) ---------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  };

  readonly getVersion = (): number => this.versionCounter;

  subscribeCell(studentId: string, listener: () => void): () => void {
    let set = this.cellListeners.get(studentId);
    if (!set) {
      set = new Set();
      this.cellListeners.set(studentId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  private publish(studentId: string, global: boolean): void {
    this.cellListeners.get(studentId)?.forEach((listener) => listener());
    if (global) {
      this.versionCounter += 1;
      this.globalListeners.forEach((listener) => listener());
    }
  }

  // -- reads ----------------------------------------------------------------

  get loaded(): boolean {
    return this.loadedFlag;
  }

  get(studentId: string): TermGradeCell | undefined {
    return this.cells.get(studentId);
  }

  all(): TermGradeCell[] {
    return [...this.cells.values()];
  }

  isDirty(cell: TermGradeCell): boolean {
    return signatureOf(cell) !== baseSignature(cell.base);
  }

  /**
   * The footer's one line. `typing` is typed-but-not-committed or invalid;
   * `saving` is in flight; `failed` needs a retry; `total` is the leave
   * guard's count. `graded` is what the server has confirmed.
   */
  status(version = 0): {
    saving: number;
    failed: number;
    typing: number;
    total: number;
    graded: number;
  } {
    void version; // the change counter, passed so a memoizing caller recomputes
    let saving = 0;
    let failed = 0;
    let typing = 0;
    let graded = 0;
    for (const cell of this.cells.values()) {
      if (cell.base.grade !== null && cell.base.grade !== "") graded += 1;
      if (cell.phase === "saving") saving += 1;
      else if (cell.phase === "failed") failed += 1;
      else if (this.isDirty(cell) || cell.problem) typing += 1;
    }
    return { saving, failed, typing, total: saving + failed + typing, graded };
  }

  // -- server sync ------------------------------------------------------------

  private ensure(studentId: string): TermGradeCell {
    const existing = this.cells.get(studentId);
    if (existing) return existing;
    const cell: TermGradeCell = {
      studentId,
      grade: "",
      remarks: "",
      base: BLANK_BASE,
      phase: "idle",
      problem: null,
      remoteChange: false,
    };
    this.cells.set(studentId, cell);
    return cell;
  }

  private fromBase(studentId: string, base: TermGradeBase): TermGradeCell {
    return {
      studentId,
      grade: base.grade ?? "",
      remarks: base.remarks ?? "",
      base,
      phase: "idle",
      problem: null,
      remoteChange: false,
    };
  }

  /**
   * Create every row's cell and merge the server's rows in one step, so a row
   * never reads a cell that does not exist. Safe on every refetch.
   */
  load(studentIds: readonly string[], rows: readonly ServerTermGrade[]): void {
    for (const studentId of studentIds) this.ensure(studentId);
    this.sync(rows);
    this.loadedFlag = true;
    this.versionCounter += 1;
    this.globalListeners.forEach((listener) => listener());
  }

  /**
   * Merge server rows without clobbering typed work: a clean cell adopts the
   * server's value; one with typed, saving or failed work keeps what was typed
   * and only refreshes its base. A refetch older than the base is ignored.
   */
  sync(rows: readonly ServerTermGrade[]): void {
    let changed = false;
    for (const row of rows) {
      const cell = this.cells.get(row.studentId);
      if (!cell) continue;
      const next: TermGradeBase = {
        rowId: row.rowId,
        grade: row.grade,
        remarks: row.remarks,
        updatedAt: row.updatedAt,
      };
      if (isOlder(next.updatedAt, cell.base.updatedAt)) continue;
      const pending =
        cell.phase !== "idle" || this.isDirty(cell) || cell.problem !== null;
      if (pending) {
        if (cell.base.updatedAt !== next.updatedAt) {
          this.cells.set(row.studentId, { ...cell, base: next });
          this.publish(row.studentId, true);
          changed = true;
        }
        continue;
      }
      const adopted = this.fromBase(row.studentId, next);
      // A value the screen already showed has moved under it: flag it. The
      // first load never flags, and our own saves arrive through `landed`.
      adopted.remoteChange =
        cell.remoteChange ||
        (this.loadedFlag && baseSignature(cell.base) !== baseSignature(next));
      if (
        cell.grade !== adopted.grade ||
        cell.remarks !== adopted.remarks ||
        cell.base.updatedAt !== adopted.base.updatedAt ||
        cell.remoteChange !== adopted.remoteChange
      ) {
        this.cells.set(row.studentId, adopted);
        this.publish(row.studentId, false);
        changed = true;
      }
    }
    if (changed) {
      this.versionCounter += 1;
      this.globalListeners.forEach((listener) => listener());
    }
  }

  // -- edits ----------------------------------------------------------------

  private replace(studentId: string, next: TermGradeCell): void {
    const prev = this.cells.get(studentId);
    this.cells.set(studentId, next);
    const structural =
      !prev ||
      prev.phase !== next.phase ||
      prev.problem !== next.problem ||
      prev.base !== next.base ||
      this.isDirty(prev) !== this.isDirty(next) ||
      prev.remoteChange !== next.remoteChange;
    this.publish(studentId, structural);
  }

  setGrade(studentId: string, raw: string): void {
    const cell = this.ensure(studentId);
    const grade = sanitizeGrade(raw);
    if (grade === cell.grade) return;
    this.replace(studentId, {
      ...cell,
      grade,
      // A fresh keystroke retires the old complaint; a failed save stays
      // failed until it is retried or discarded so the row keeps saying so.
      problem: cell.phase === "failed" ? cell.problem : null,
    });
  }

  setRemarks(studentId: string, raw: string): void {
    const cell = this.ensure(studentId);
    const remarks = sanitizeRemarks(raw);
    if (remarks === cell.remarks) return;
    this.replace(studentId, {
      ...cell,
      remarks,
      problem: cell.phase === "failed" ? cell.problem : null,
    });
  }

  /** Throw away typed work and show the server's values again. */
  discard(studentId: string): void {
    const cell = this.cells.get(studentId);
    if (!cell || cell.phase === "saving") return;
    this.replace(studentId, {
      ...this.fromBase(studentId, cell.base),
      remoteChange: cell.remoteChange,
    });
  }

  /** The teacher has seen this row's moved server value. */
  acknowledge(studentId: string): void {
    const cell = this.cells.get(studentId);
    if (!cell || !cell.remoteChange) return;
    this.replace(studentId, { ...cell, remoteChange: false });
  }

  // -- saving ---------------------------------------------------------------

  /** Validate and queue a save. A clean cell is a no-op. */
  commit(studentId: string): void {
    const cell = this.cells.get(studentId);
    if (!cell) return;
    if (!this.isDirty(cell)) {
      if (cell.problem && cell.phase === "idle") {
        this.replace(studentId, { ...cell, problem: null });
      }
      return;
    }
    const problem = this.validate(cell);
    if (problem) {
      this.replace(studentId, { ...cell, problem, phase: "idle" });
      return;
    }
    if (cell.problem) this.replace(studentId, { ...cell, problem: null });
    if (
      this.inFlight.has(studentId) &&
      this.inFlightSignature.get(studentId) === signatureOf(cell)
    ) {
      return; // the save that is already out says exactly this
    }
    this.enqueue(studentId);
  }

  retry(studentId: string): void {
    const cell = this.cells.get(studentId);
    if (!cell || cell.phase === "saving") return;
    this.replace(studentId, { ...cell, phase: "idle", problem: null });
    this.commit(studentId);
  }

  retryAll(): void {
    for (const cell of this.cells.values()) {
      if (cell.phase === "failed") this.retry(cell.studentId);
    }
  }

  private validate(cell: TermGradeCell): TermGradeProblem | null {
    if (cell.grade.trim() === "") {
      return { kind: "empty", message: null };
    }
    if (cell.grade.trim().length > GRADE_MAX) {
      return { kind: "empty", message: null };
    }
    return null;
  }

  private enqueue(studentId: string): void {
    if (!this.waiting.includes(studentId)) this.waiting.push(studentId);
    if (this.inFlight.has(studentId)) return; // serial per student
    this.pump();
  }

  private pump(): void {
    const limit = this.options.maxParallel ?? 3;
    while (this.active < limit) {
      const index = this.waiting.findIndex((key) => !this.inFlight.has(key));
      if (index === -1) return;
      const [studentId] = this.waiting.splice(index, 1);
      if (studentId === undefined) return;
      void this.run(studentId);
    }
  }

  private async run(studentId: string): Promise<void> {
    const cell = this.cells.get(studentId);
    if (!cell || !this.isDirty(cell)) {
      this.pump();
      return;
    }
    this.inFlight.add(studentId);
    this.active += 1;
    const sent = signatureOf(cell);
    this.inFlightSignature.set(studentId, sent);
    const input: TermGradeSaveInput = {
      studentId,
      grade: cell.grade.trim(),
      remarks: cell.remarks.trim() || null,
    };
    this.replace(studentId, { ...cell, phase: "saving", problem: null });
    try {
      const result = await this.options.save(input);
      if (!result) throw new Error("not-saved");
      this.landed(studentId, sent, result);
    } catch (cause) {
      this.failedSave(studentId, cause);
    } finally {
      this.inFlight.delete(studentId);
      this.inFlightSignature.delete(studentId);
      this.active -= 1;
      this.pump();
    }
  }

  private landed(
    studentId: string,
    sent: string,
    result: TermGradeSaveResult,
  ): void {
    const cell = this.cells.get(studentId);
    if (!cell) return;
    const base = baseOf(result);
    if (signatureOf(cell) === sent) {
      // Nothing changed while it was in flight: adopt the server's echo.
      this.replace(studentId, this.fromBase(studentId, base));
      return;
    }
    // Edited mid-save: keep the newer typing, take the fresh base, go again.
    this.replace(studentId, { ...cell, base, phase: "idle", problem: null });
    this.commit(studentId);
  }

  private failedSave(studentId: string, cause: unknown): void {
    const cell = this.cells.get(studentId);
    if (!cell) return;
    const described = this.options.describeError(cause);
    this.replace(studentId, {
      ...cell,
      phase: "failed",
      problem: {
        kind: described.conflict ? "conflict" : "server",
        message: described.message,
      },
    });
    if (described.conflict) this.options.onConflict?.(studentId);
  }
}

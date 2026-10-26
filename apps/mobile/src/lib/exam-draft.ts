import {
  checkMarks,
  displayMarks,
  normalizeGrade,
  sanitizeGradeText,
  sanitizeMarksText,
} from "./exams";

/**
 * The marks-entry draft store: one paper's cells, typed work and the save
 * queue, kept OUTSIDE React so that
 *
 *  - rows that scroll out of the list window never lose what was typed (RN's
 *    FlatList does not preserve row state),
 *  - one keystroke re-renders one row (rows subscribe to their own cell),
 *  - the rules that matter — "never lose typed work", "one in-flight save per
 *    cell", "chain `expectedUpdatedAt` so the app never conflicts with
 *    itself" — are plain code with plain tests.
 *
 * A cell is `(student, component)`. Its `base` is what the server last
 * confirmed; everything else is what the teacher has typed since. A cell is
 * DIRTY when its typed signature differs from the base's. Saving is by commit
 * (Next / Done / blur / a toggle), never per keystroke.
 */

export type ExemptionType = "medical" | "disability" | "board_approved" | "other";

export type CellBase = {
  rowId: string | null;
  /** `draft | entered | verified | published | locked`; `draft` for no row. */
  status: string;
  marks: string | null;
  grade: string | null;
  absent: boolean;
  exempt: boolean;
  /** Round-tripped verbatim as `expectedUpdatedAt` (never reformatted). */
  updatedAt: string | null;
};

export type CellProblem =
  | { kind: "range" }
  | { kind: "format" }
  | { kind: "negative" }
  | { kind: "server" | "conflict"; message: string };

export type Cell = {
  key: string;
  studentId: string;
  componentId: string;
  text: string;
  absent: boolean;
  exempt: boolean;
  exemptionType: ExemptionType | null;
  base: CellBase;
  phase: "idle" | "saving" | "failed";
  problem: CellProblem | null;
  /**
   * The server's VALUE for this cell moved (someone else saved) after the
   * screen had shown it. Set by `sync`, cleared by `acknowledge`. Review uses
   * it to keep a mark the reviewer never saw out of a verify batch.
   */
  remoteChange: boolean;
};

export type SaveInput = {
  studentId: string;
  componentId: string;
  marks: string | null;
  grade: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  exemptionType: ExemptionType | null;
  expectedUpdatedAt?: string;
};

export type SaveResult = {
  id: string;
  resultStatus: string;
  marksObtained: string | null;
  gradeObtained: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  /** ISO string at runtime; the contract types it `Date`. */
  updatedAt: string | Date;
};

export type ServerEntry = {
  id: string;
  studentId: string;
  componentId: string;
  resultStatus: string;
  marksObtained: string | null;
  gradeObtained: string | null;
  isAbsent: boolean;
  isExempted: boolean;
  updatedAt: string | Date;
};

export type PaperRules = {
  /** Max marks per component id. */
  maxByComponent: ReadonlyMap<string, number>;
  isGradedOnly: boolean;
  allowNegative: boolean;
};

export type DescribedError = { message: string; conflict: boolean };

export type DraftOptions = {
  save: (input: SaveInput) => Promise<SaveResult | null>;
  describeError: (cause: unknown) => DescribedError;
  /** Fired once per conflict so the screen can refetch the server's value. */
  onConflict?: (key: string) => void;
  /** Concurrent saves across DIFFERENT cells. One cell is always serial. */
  maxParallel?: number;
};

export function cellKey(studentId: string, componentId: string): string {
  return `${studentId}:${componentId}`;
}

export function toIsoVerbatim(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

const BLANK_BASE: CellBase = {
  rowId: null,
  status: "draft",
  marks: null,
  grade: null,
  absent: false,
  exempt: false,
  updatedAt: null,
};

/** Something is in the cell right now — typed, absent or exempt. */
export function hasTypedValue(cell: Cell): boolean {
  return cell.absent || cell.exempt || cell.text.trim() !== "";
}

/** The server holds a value for this cell (a typed-but-unsaved one does not count). */
export function hasSavedValue(cell: Cell): boolean {
  const { base } = cell;
  return (
    base.absent ||
    base.exempt ||
    base.marks !== null ||
    (base.grade !== null && base.grade !== "")
  );
}

/** Advisory only: a typed mark under the component's pass mark. */
export function isBelowPass(cell: Cell, pass: number): boolean {
  if (cell.absent || cell.exempt) return false;
  const text = cell.text.trim();
  if (text === "") return false;
  const value = Number(text);
  return Number.isFinite(value) && value < pass;
}

/** Verified and later rows can no longer be autosaved (server rule). */
export function isLockedStatus(status: string): boolean {
  return status === "verified" || status === "published" || status === "locked";
}

function baseOf(entry: ServerEntry | SaveResult): CellBase {
  return {
    rowId: entry.id,
    status: entry.resultStatus,
    marks: entry.marksObtained,
    grade: entry.gradeObtained,
    absent: entry.isAbsent,
    exempt: entry.isExempted,
    updatedAt: toIsoVerbatim(entry.updatedAt),
  };
}

export class PaperDraft {
  private cells = new Map<string, Cell>();
  private cellListeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private rules: PaperRules = {
    maxByComponent: new Map(),
    isGradedOnly: false,
    allowNegative: false,
  };
  private studentListeners = new Map<string, Set<() => void>>();
  private studentKeys = new Map<string, string[]>();
  private loadedFlag = false;
  private inFlight = new Set<string>();
  private inFlightSignature = new Map<string, string>();
  private waiting: string[] = [];
  private active = 0;
  private options: DraftOptions;
  private versionCounter = 0;

  constructor(options: DraftOptions) {
    this.options = options;
  }

  /**
   * Swap the collaborators after construction. The store outlives any single
   * render, but what `save` needs (the section the teacher has picked right
   * now) changes with renders; the screen rebinds from an effect rather than
   * threading a ref through the constructor.
   */
  bind(next: Partial<DraftOptions>): void {
    this.options = { ...this.options, ...next };
  }

  // -- subscription (useSyncExternalStore) ---------------------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  };

  readonly getVersion = (): number => this.versionCounter;

  subscribeCell(key: string, listener: () => void): () => void {
    let set = this.cellListeners.get(key);
    if (!set) {
      set = new Set();
      this.cellListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** A row subscribes to its student: every component cell of that student. */
  subscribeStudent(studentId: string, listener: () => void): () => void {
    let set = this.studentListeners.get(studentId);
    if (!set) {
      set = new Set();
      this.studentListeners.set(studentId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * A by-value snapshot of everything a row paints for one student. A string,
   * so `useSyncExternalStore` compares it by value and a row re-renders only
   * when its own cells actually changed.
   */
  studentSignature(studentId: string): string {
    const keys = this.studentKeys.get(studentId);
    if (!keys) return "";
    return keys
      .map((key) => {
        const cell = this.cells.get(key);
        if (!cell) return key;
        return [
          key,
          cell.text,
          cell.absent ? 1 : 0,
          cell.exempt ? 1 : 0,
          cell.phase,
          cell.problem ? cell.problem.kind : "",
          cell.base.status,
          cell.remoteChange ? 1 : 0,
        ].join("~");
      })
      .join("|");
  }

  private publish(key: string, global: boolean): void {
    this.cellListeners.get(key)?.forEach((listener) => listener());
    const studentId = this.cells.get(key)?.studentId;
    if (studentId) {
      this.studentListeners.get(studentId)?.forEach((listener) => listener());
    }
    if (global) {
      this.versionCounter += 1;
      this.globalListeners.forEach((listener) => listener());
    }
  }

  // -- reads ----------------------------------------------------------------

  get(key: string): Cell | undefined {
    return this.cells.get(key);
  }

  all(): Cell[] {
    return [...this.cells.values()];
  }

  /** A cell the teacher has not finished with: typed, saving, or failed. */
  unsaved(): Cell[] {
    return this.all().filter(
      (cell) => cell.phase !== "idle" || this.isDirty(cell) || cell.problem,
    );
  }

  failed(): Cell[] {
    return this.all().filter((cell) => cell.phase === "failed");
  }

  /**
   * The footer's one line: how much work is not yet safe on the server.
   * `typing` is typed-but-not-committed or invalid; `saving` is in flight;
   * `failed` needs a retry. `total` is their union — the unsaved-work guard.
   */
  status(version = 0): {
    saving: number;
    failed: number;
    typing: number;
    total: number;
  } {
    void version; // the change counter, passed so a memoizing caller recomputes
    let saving = 0;
    let failed = 0;
    let typing = 0;
    for (const cell of this.cells.values()) {
      if (cell.phase === "saving") saving += 1;
      else if (cell.phase === "failed") failed += 1;
      else if (this.isDirty(cell) || cell.problem) typing += 1;
    }
    return { saving, failed, typing, total: saving + failed + typing };
  }

  isDirty(cell: Cell): boolean {
    return signatureOf(cell, this.rules) !== baseSignature(cell.base, this.rules);
  }

  // -- configuration & server sync -----------------------------------------

  configure(rules: PaperRules): void {
    this.rules = rules;
  }

  ensure(studentId: string, componentId: string): Cell {
    const key = cellKey(studentId, componentId);
    const existing = this.cells.get(key);
    if (existing) return existing;
    const cell = this.fromBase(key, studentId, componentId, BLANK_BASE);
    this.cells.set(key, cell);
    const keys = this.studentKeys.get(studentId);
    if (keys) keys.push(key);
    else this.studentKeys.set(studentId, [key]);
    return cell;
  }

  /** True once `load` has run: rows may read their cells. */
  get loaded(): boolean {
    return this.loadedFlag;
  }

  /**
   * Configure, create every (student, component) cell and merge the server's
   * entries in ONE step, so a row never reads a cell that does not exist.
   * Safe to call again on every refetch.
   */
  load(
    rules: PaperRules,
    studentIds: readonly string[],
    componentIds: readonly string[],
    entries: readonly ServerEntry[],
  ): void {
    this.rules = rules;
    for (const studentId of studentIds) {
      for (const componentId of componentIds) this.ensure(studentId, componentId);
    }
    this.sync(entries);
    this.loadedFlag = true;
    this.versionCounter += 1;
    this.globalListeners.forEach((listener) => listener());
  }

  /**
   * Merge the server's entries without clobbering typed work: a cell with
   * nothing pending adopts the server's value; one with typed, saving or
   * failed work keeps what was typed and only refreshes its base (so a retry
   * carries the fresh `expectedUpdatedAt`).
   */
  sync(entries: readonly ServerEntry[]): void {
    let changed = false;
    for (const entry of entries) {
      const key = cellKey(entry.studentId, entry.componentId);
      const next = baseOf(entry);
      const cell = this.cells.get(key);
      if (!cell) {
        this.ensure(entry.studentId, entry.componentId);
        this.cells.set(
          key,
          this.fromBase(key, entry.studentId, entry.componentId, next),
        );
        this.publish(key, false);
        changed = true;
        continue;
      }
      // A refetch that was already in flight when a save landed carries the
      // OLDER row; adopting it would flip the cell back to the old value.
      if (isOlder(next.updatedAt, cell.base.updatedAt)) continue;
      const pending =
        cell.phase !== "idle" || this.isDirty(cell) || cell.problem !== null;
      if (pending) {
        if (cell.base.updatedAt !== next.updatedAt) {
          this.cells.set(key, { ...cell, base: next });
          this.publish(key, true);
          changed = true;
        }
        continue;
      }
      const adopted = this.fromBase(key, entry.studentId, entry.componentId, next);
      // A value the screen already showed has moved under it: flag it. The
      // first load (nothing shown yet) never flags, and our own saves arrive
      // through `landed`, not here.
      adopted.remoteChange =
        cell.remoteChange ||
        (this.loadedFlag &&
          baseSignature(cell.base, this.rules) !== baseSignature(next, this.rules));
      if (!sameCell(cell, adopted)) {
        this.cells.set(key, adopted);
        this.publish(key, false);
        changed = true;
      }
    }
    if (changed) {
      this.versionCounter += 1;
      this.globalListeners.forEach((listener) => listener());
    }
  }

  private fromBase(
    key: string,
    studentId: string,
    componentId: string,
    base: CellBase,
  ): Cell {
    return {
      key,
      studentId,
      componentId,
      text: this.rules.isGradedOnly ? (base.grade ?? "") : displayMarks(base.marks),
      absent: base.absent,
      exempt: base.exempt,
      exemptionType: null,
      base,
      phase: "idle",
      problem: null,
      remoteChange: false,
    };
  }

  // -- edits ------------------------------------------------------------------

  private replace(key: string, next: Cell, forceGlobal = false): void {
    const prev = this.cells.get(key);
    this.cells.set(key, next);
    const structural =
      forceGlobal ||
      !prev ||
      prev.phase !== next.phase ||
      prev.problem !== next.problem ||
      prev.absent !== next.absent ||
      prev.exempt !== next.exempt ||
      prev.base !== next.base ||
      this.isDirty(prev) !== this.isDirty(next);
    this.publish(key, structural);
  }

  /** Typing. Nothing is sent; a non-blank value cancels absent/exempt. */
  setText(studentId: string, componentId: string, raw: string): void {
    const cell = this.ensure(studentId, componentId);
    if (isLockedStatus(cell.base.status)) return;
    const text = this.rules.isGradedOnly
      ? sanitizeGradeText(raw)
      : sanitizeMarksText(raw, this.rules.allowNegative);
    const typed = text.trim() !== "";
    this.replace(cell.key, {
      ...cell,
      text,
      absent: typed ? false : cell.absent,
      exempt: typed ? false : cell.exempt,
      exemptionType: typed ? null : cell.exemptionType,
      // A fresh keystroke retires the old complaint; a failed save stays
      // failed until it is retried or discarded so the row keeps saying so.
      problem: cell.phase === "failed" ? cell.problem : null,
    });
  }

  /** The AB chip: set/clear absent and commit at once. */
  setAbsent(studentId: string, componentId: string, absent: boolean): void {
    const cell = this.ensure(studentId, componentId);
    if (isLockedStatus(cell.base.status)) return;
    this.replace(cell.key, {
      ...cell,
      text: absent ? "" : cell.text,
      absent,
      exempt: absent ? false : cell.exempt,
      exemptionType: absent ? null : cell.exemptionType,
      problem: null,
    });
    this.commit(studentId, componentId);
  }

  /** Exempt needs its type; clearing returns the cell to a blank draft. */
  setExempt(
    studentId: string,
    componentId: string,
    exempt: boolean,
    type: ExemptionType | null,
  ): void {
    const cell = this.ensure(studentId, componentId);
    if (isLockedStatus(cell.base.status)) return;
    if (exempt && type === null) return;
    this.replace(cell.key, {
      ...cell,
      text: "",
      absent: false,
      exempt,
      exemptionType: exempt ? type : null,
      problem: null,
    });
    this.commit(studentId, componentId);
  }

  /** Throw away what was typed and show the server's value again. */
  discard(studentId: string, componentId: string): void {
    const key = cellKey(studentId, componentId);
    const cell = this.cells.get(key);
    if (!cell || cell.phase === "saving") return;
    this.replace(
      key,
      {
        ...this.fromBase(key, studentId, componentId, cell.base),
        remoteChange: cell.remoteChange,
      },
      true,
    );
  }

  /** The reviewer has seen this cell's current value. */
  acknowledge(studentId: string, componentId: string): void {
    const key = cellKey(studentId, componentId);
    const cell = this.cells.get(key);
    if (!cell || !cell.remoteChange) return;
    this.replace(key, { ...cell, remoteChange: false }, true);
  }

  /** Everything on screen is, from now on, "as the reviewer saw it". */
  acknowledgeAll(): void {
    for (const cell of this.cells.values()) {
      if (cell.remoteChange) {
        this.replace(cell.key, { ...cell, remoteChange: false }, true);
      }
    }
  }

  // -- saving -------------------------------------------------------------------

  /**
   * Validate and queue a save. A clean cell is a no-op; an invalid one stays
   * dirty with a problem and sends nothing.
   */
  commit(studentId: string, componentId: string): void {
    const key = cellKey(studentId, componentId);
    const cell = this.cells.get(key);
    if (!cell) return;
    if (isLockedStatus(cell.base.status)) return;
    if (!this.isDirty(cell)) {
      if (cell.problem && cell.phase === "idle") {
        this.replace(key, { ...cell, problem: null });
      }
      return;
    }
    if (
      this.inFlight.has(key) &&
      this.inFlightSignature.get(key) === signatureOf(cell, this.rules)
    ) {
      return; // the save that is already out says exactly this
    }
    const problem = this.validate(cell);
    if (problem) {
      this.replace(key, { ...cell, problem, phase: "idle" });
      return;
    }
    if (cell.problem) this.replace(key, { ...cell, problem: null });
    this.enqueue(key);
  }

  retry(studentId: string, componentId: string): void {
    const key = cellKey(studentId, componentId);
    const cell = this.cells.get(key);
    if (!cell || cell.phase === "saving") return;
    this.replace(key, { ...cell, phase: "idle", problem: null });
    this.commit(studentId, componentId);
  }

  retryAll(): void {
    for (const cell of this.failed()) this.retry(cell.studentId, cell.componentId);
  }

  private validate(cell: Cell): CellProblem | null {
    if (cell.exempt) return cell.exemptionType ? null : { kind: "format" };
    if (cell.absent) return null;
    if (this.rules.isGradedOnly) return null;
    const max = this.rules.maxByComponent.get(cell.componentId) ?? Infinity;
    const result = checkMarks(cell.text, {
      max,
      allowNegative: this.rules.allowNegative,
    });
    return result.ok ? null : { kind: result.reason };
  }

  private enqueue(key: string): void {
    if (this.inFlight.has(key)) {
      // Serial per cell: run again when the current save lands, carrying the
      // updatedAt that save returns.
      if (!this.waiting.includes(key)) this.waiting.push(key);
      return;
    }
    if (!this.waiting.includes(key)) this.waiting.push(key);
    this.pump();
  }

  private pump(): void {
    const limit = this.options.maxParallel ?? 3;
    while (this.active < limit) {
      const index = this.waiting.findIndex((key) => !this.inFlight.has(key));
      if (index === -1) return;
      const [key] = this.waiting.splice(index, 1);
      if (key === undefined) return;
      void this.run(key);
    }
  }

  private async run(key: string): Promise<void> {
    const cell = this.cells.get(key);
    if (!cell || !this.isDirty(cell)) return this.pump();
    this.inFlight.add(key);
    this.active += 1;
    const sentSignature = signatureOf(cell, this.rules);
    this.inFlightSignature.set(key, sentSignature);
    const input = this.inputFor(cell);
    this.replace(key, { ...cell, phase: "saving", problem: null });
    try {
      const result = await this.options.save(input);
      if (!result) throw new Error("not-saved");
      this.landed(key, sentSignature, result);
    } catch (cause) {
      this.failedSave(key, cause);
    } finally {
      this.inFlight.delete(key);
      this.inFlightSignature.delete(key);
      this.active -= 1;
      this.pump();
    }
  }

  private inputFor(cell: Cell): SaveInput {
    const graded = this.rules.isGradedOnly;
    const withValue = !cell.absent && !cell.exempt;
    return {
      studentId: cell.studentId,
      componentId: cell.componentId,
      marks:
        withValue && !graded
          ? (checkMarksValue(cell.text, this.rules, cell.componentId))
          : null,
      grade: withValue && graded ? normalizeGrade(cell.text) : null,
      isAbsent: cell.absent,
      isExempted: cell.exempt,
      exemptionType: cell.exempt ? cell.exemptionType : null,
      ...(cell.base.updatedAt ? { expectedUpdatedAt: cell.base.updatedAt } : {}),
    };
  }

  private landed(key: string, sent: string, result: SaveResult): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    const base = baseOf(result);
    const current = signatureOf(cell, this.rules);
    if (current === sent) {
      // Nothing changed while it was in flight: adopt the server's echo.
      this.replace(
        key,
        this.fromBase(key, cell.studentId, cell.componentId, base),
        true,
      );
      return;
    }
    // Edited mid-save: keep the newer typing, take the fresh base, go again.
    this.replace(key, { ...cell, base, phase: "idle", problem: null }, true);
    this.commit(cell.studentId, cell.componentId);
  }

  private failedSave(key: string, cause: unknown): void {
    const cell = this.cells.get(key);
    if (!cell) return;
    const described = this.options.describeError(cause);
    this.replace(
      key,
      {
        ...cell,
        phase: "failed",
        problem: {
          kind: described.conflict ? "conflict" : "server",
          message: described.message,
        },
      },
      true,
    );
    if (described.conflict) this.options.onConflict?.(key);
  }
}

export type PaperFilter = "all" | "missing" | "absent" | "below";

export type PaperSummary = {
  total: number;
  /** Students whose every component the SERVER holds a value for. */
  entered: number;
  /** Active-component counts, for the filter chips. */
  missing: number;
  absent: number;
  below: number;
};

/**
 * Progress and chip counts for the entry list. "Entered" counts only what the
 * server has confirmed (typed-but-unsaved does not move the bar); "missing"
 * counts what still has nothing in it at all, typed or saved, because that is
 * where the teacher goes next. `version` is unused on purpose: it is the
 * draft's change counter, passed so a memoizing caller (the React Compiler)
 * sees the dependency and recomputes.
 */
export function summarizePaper(
  draft: PaperDraft,
  studentIds: readonly string[],
  components: readonly { id: string; pass: number }[],
  activeId: string | null,
  version: number,
): PaperSummary {
  void version;
  const active = components.find((component) => component.id === activeId);
  let entered = 0;
  let missing = 0;
  let absent = 0;
  let below = 0;
  for (const studentId of studentIds) {
    let complete = components.length > 0;
    for (const component of components) {
      const cell = draft.get(cellKey(studentId, component.id));
      if (!cell || !hasSavedValue(cell)) complete = false;
    }
    if (complete) entered += 1;
    if (!active) continue;
    const cell = draft.get(cellKey(studentId, active.id));
    if (!cell) continue;
    if (!hasTypedValue(cell)) missing += 1;
    if (cell.absent) absent += 1;
    if (isBelowPass(cell, active.pass)) below += 1;
  }
  return { total: studentIds.length, entered, missing, absent, below };
}

/** The students a filter chip selects, frozen at the moment of the tap. */
export function studentsMatching(
  draft: PaperDraft,
  studentIds: readonly string[],
  componentId: string,
  pass: number,
  filter: PaperFilter,
): Set<string> {
  const ids = new Set<string>();
  for (const studentId of studentIds) {
    const cell = draft.get(cellKey(studentId, componentId));
    if (!cell) continue;
    const match =
      filter === "all" ||
      (filter === "missing" && !hasTypedValue(cell)) ||
      (filter === "absent" && cell.absent) ||
      (filter === "below" && isBelowPass(cell, pass));
    if (match) ids.add(studentId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Review (7B) — what a verifier counts, filters and sends
// ---------------------------------------------------------------------------

/** Verified, or sealed past verification: nothing left to review. */
function isReviewed(status: string): boolean {
  return status === "verified" || status === "published" || status === "locked";
}

export type ReviewFilter = "toVerify" | "verified" | "missing" | "absent";

export type ReviewSummary = {
  /** Cells (students × components): the server's unit, and the verify batch's. */
  cells: number;
  verified: number;
  toVerify: number;
  missing: number;
  /** Entered cells whose server value moved while the reviewer was looking. */
  changed: number;
  /** Students, for the filter chips. */
  students: number;
  studentsToVerify: number;
  studentsVerified: number;
  studentsMissing: number;
  studentsAbsent: number;
};

/**
 * The numbers on the Review screen, from what the SERVER holds (`base`), never
 * from typed text. `version` is unused on purpose: the draft's change counter,
 * passed so a memoizing caller (the React Compiler) sees the dependency.
 */
export function reviewSummary(
  draft: PaperDraft,
  studentIds: readonly string[],
  componentIds: readonly string[],
  version: number,
): ReviewSummary {
  void version;
  const out: ReviewSummary = {
    cells: 0,
    verified: 0,
    toVerify: 0,
    missing: 0,
    changed: 0,
    students: studentIds.length,
    studentsToVerify: 0,
    studentsVerified: 0,
    studentsMissing: 0,
    studentsAbsent: 0,
  };
  for (const studentId of studentIds) {
    let anyEntered = false;
    let allReviewed = componentIds.length > 0;
    let anyMissing = false;
    let anyAbsent = false;
    for (const componentId of componentIds) {
      const cell = draft.get(cellKey(studentId, componentId));
      if (!cell) {
        allReviewed = false;
        anyMissing = true;
        out.cells += 1;
        out.missing += 1;
        continue;
      }
      out.cells += 1;
      if (cell.base.absent) anyAbsent = true;
      if (isReviewed(cell.base.status)) {
        out.verified += 1;
      } else if (cell.base.status === "entered") {
        out.toVerify += 1;
        anyEntered = true;
        allReviewed = false;
        if (cell.remoteChange) out.changed += 1;
      } else {
        out.missing += 1;
        anyMissing = true;
        allReviewed = false;
      }
    }
    if (anyEntered) out.studentsToVerify += 1;
    if (allReviewed) out.studentsVerified += 1;
    if (anyMissing) out.studentsMissing += 1;
    if (anyAbsent) out.studentsAbsent += 1;
  }
  return out;
}

/** The students a Review chip selects (membership frozen at the tap). */
export function studentsMatchingReview(
  draft: PaperDraft,
  studentIds: readonly string[],
  componentIds: readonly string[],
  filter: ReviewFilter,
  /** The draft's change counter, passed so a memoizing caller recomputes. */
  version = 0,
): Set<string> {
  void version;
  const ids = new Set<string>();
  for (const studentId of studentIds) {
    const cells = componentIds
      .map((componentId) => draft.get(cellKey(studentId, componentId)))
      .filter((cell): cell is Cell => cell !== undefined);
    const match =
      (filter === "toVerify" &&
        cells.some((cell) => cell.base.status === "entered")) ||
      (filter === "verified" &&
        cells.length > 0 &&
        cells.length === componentIds.length &&
        cells.every((cell) => isReviewed(cell.base.status))) ||
      (filter === "missing" &&
        (cells.length < componentIds.length ||
          cells.some(
            (cell) =>
              !isReviewed(cell.base.status) && cell.base.status !== "entered",
          ))) ||
      (filter === "absent" && cells.some((cell) => cell.base.absent));
    if (match) ids.add(studentId);
  }
  return ids;
}

export type VerifyItem = { key: string; rowId: string; updatedAt: string };

export type VerifyBatch = {
  items: VerifyItem[];
  /** Distinct students the items belong to. */
  students: number;
  /** Students with a cell that has no mark yet (excluded, and said so). */
  missingStudents: number;
  /** Entered cells held back because their value moved under the reviewer. */
  changedEntries: number;
};

/**
 * What a Verify tap would send: the rows whose SERVER status is `entered`,
 * with nothing typed on top, and not flagged as changed. Built from `base` so
 * a typed-but-unsaved value is never verified as its old self; a flagged row
 * is left out so the reviewer verifies only what they have seen.
 */
export function verifyBatch(
  draft: PaperDraft,
  studentIds: readonly string[],
  componentIds: readonly string[],
  /** The draft's change counter, passed so a memoizing caller recomputes. */
  version = 0,
): VerifyBatch {
  void version;
  const items: VerifyItem[] = [];
  const students = new Set<string>();
  let missingStudents = 0;
  let changedEntries = 0;
  for (const studentId of studentIds) {
    let missing = false;
    for (const componentId of componentIds) {
      const cell = draft.get(cellKey(studentId, componentId));
      if (!cell || (!isReviewed(cell.base.status) && cell.base.status !== "entered")) {
        missing = true;
        continue;
      }
      if (cell.base.status !== "entered") continue;
      if (cell.remoteChange) {
        changedEntries += 1;
        continue;
      }
      if (
        !cell.base.rowId ||
        !cell.base.updatedAt ||
        cell.phase !== "idle" ||
        cell.problem ||
        draft.isDirty(cell)
      ) {
        continue;
      }
      items.push({
        key: cell.key,
        rowId: cell.base.rowId,
        updatedAt: cell.base.updatedAt,
      });
      students.add(studentId);
    }
    if (missing) missingStudents += 1;
  }
  return { items, students: students.size, missingStudents, changedEntries };
}

/**
 * Rows of a verify batch whose server value is no longer what the batch was
 * built from — checked against a FRESH read right before the verify goes out.
 * The server has no per-row guard, so this is the only thing standing between
 * a reviewer and locking a value they never saw.
 */
export function staleItems(
  items: readonly VerifyItem[],
  fresh: readonly ServerEntry[],
): string[] {
  const byId = new Map(fresh.map((entry) => [entry.id, entry]));
  const stale: string[] = [];
  for (const item of items) {
    const entry = byId.get(item.rowId);
    if (
      !entry ||
      entry.resultStatus !== "entered" ||
      toIsoVerbatim(entry.updatedAt) !== item.updatedAt
    ) {
      stale.push(item.key);
    }
  }
  return stale;
}

/** Verified cells of one student (the Reopen batch), with their row ids. */
export function reopenItems(
  draft: PaperDraft,
  studentIds: readonly string[],
  componentIds: readonly string[],
): VerifyItem[] {
  const items: VerifyItem[] = [];
  for (const studentId of studentIds) {
    for (const componentId of componentIds) {
      const cell = draft.get(cellKey(studentId, componentId));
      if (
        cell &&
        cell.base.status === "verified" &&
        cell.base.rowId &&
        cell.base.updatedAt
      ) {
        items.push({
          key: cell.key,
          rowId: cell.base.rowId,
          updatedAt: cell.base.updatedAt,
        });
      }
    }
  }
  return items;
}

function isOlder(candidate: string | null, current: string | null): boolean {
  if (!candidate || !current) return false;
  const a = Date.parse(candidate);
  const b = Date.parse(current);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

function checkMarksValue(
  text: string,
  rules: PaperRules,
  componentId: string,
): string | null {
  const result = checkMarks(text, {
    max: rules.maxByComponent.get(componentId) ?? Infinity,
    allowNegative: rules.allowNegative,
  });
  return result.ok ? result.value : null;
}

/** What the cell currently says, comparable with `baseSignature`. */
function signatureOf(cell: Cell, rules: PaperRules): string {
  const value = cell.absent || cell.exempt ? "" : textValue(cell.text, rules);
  const exempt = cell.exempt ? (cell.exemptionType ?? "?") : "";
  return `${value}|${cell.absent ? 1 : 0}|${cell.exempt ? 1 : 0}|${exempt}`;
}

function baseSignature(base: CellBase, rules: PaperRules): string {
  const value =
    base.absent || base.exempt
      ? ""
      : rules.isGradedOnly
        ? (normalizeGrade(base.grade ?? "") ?? "")
        : displayMarks(base.marks);
  // The grid never says WHICH exemption an exempt row carries, so an exempt
  // base and an exempt cell with no type picked compare equal ("?").
  return `${value}|${base.absent ? 1 : 0}|${base.exempt ? 1 : 0}|${base.exempt ? "?" : ""}`;
}

function textValue(text: string, rules: PaperRules): string {
  if (rules.isGradedOnly) return normalizeGrade(text) ?? "";
  return displayMarks(text.trim() === "" ? null : text);
}

function sameCell(a: Cell, b: Cell): boolean {
  return (
    a.text === b.text &&
    a.absent === b.absent &&
    a.exempt === b.exempt &&
    a.base.updatedAt === b.base.updatedAt &&
    a.base.status === b.base.status &&
    a.base.rowId === b.base.rowId &&
    a.remoteChange === b.remoteChange
  );
}

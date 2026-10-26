/**
 * Pure exam logic for the staff exams surfaces (Step 7). No React, no native
 * imports: everything here is unit-tested and shared by the list, the hub and
 * the marks-entry screen.
 *
 * Three families live here: the exam lifecycle (stage order, the moves the
 * server allows, list segments), marks text (what a teacher may type and what
 * the server will accept), and roster/paper helpers (roll order, "my papers").
 * The server stays the referee for all of them — these are the same rules
 * mirrored so the UI never offers a move or a value the server will refuse.
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const EXAM_STATUSES = [
  "draft",
  "scheduled",
  "ongoing",
  "marks_entry",
  "under_verification",
  "published",
  "locked",
] as const;

export type ExamStatus = (typeof EXAM_STATUSES)[number];

export function isExamStatus(value: string): value is ExamStatus {
  return (EXAM_STATUSES as readonly string[]).includes(value);
}

/** 0-based position in the lifecycle; unknown statuses sort first. */
export function stageIndex(status: string): number {
  return isExamStatus(status) ? EXAM_STATUSES.indexOf(status) : -1;
}

/** Marks can be typed only in these two stages (`saveComponentResult`). */
export function isEntryOpen(status: string): boolean {
  return status === "marks_entry" || status === "under_verification";
}

/** Past this point results exist and entries are frozen behind a ledger. */
export function isResultsStage(status: string): boolean {
  return status === "published" || status === "locked";
}

/**
 * The service's transition map, mirrored for the buttons. Illegal moves are
 * refused server-side with their own wording; this only decides what is
 * offered.
 */
const NEXT_STATUSES: Record<ExamStatus, readonly ExamStatus[]> = {
  draft: ["scheduled"],
  scheduled: ["ongoing", "draft"],
  ongoing: ["marks_entry"],
  marks_entry: ["under_verification"],
  under_verification: ["marks_entry"],
  published: ["locked"],
  locked: [],
};

/**
 * The copy key for a move. `marks_entry` is a forward step from `ongoing` but a
 * BACK step from verification, and `draft` is always a back step — the label
 * and the consequence differ, so the key does too.
 */
export type TransitionKey =
  | "scheduled"
  | "ongoing"
  | "marks_entry"
  | "under_verification"
  | "back_to_entry"
  | "back_to_draft"
  | "locked";

export type StageMove = {
  target: ExamStatus;
  key: TransitionKey;
  /** The lock is the one irreversible act. */
  destructive: boolean;
};

function moveFor(from: ExamStatus, target: ExamStatus): StageMove {
  let key: TransitionKey;
  if (target === "marks_entry" && from === "under_verification") {
    key = "back_to_entry";
  } else if (target === "draft") {
    key = "back_to_draft";
  } else {
    key = target as TransitionKey;
  }
  return { target, key, destructive: target === "locked" };
}

/**
 * What the hub offers at a stage: ONE primary forward move (the stage's next
 * action) and everything else — back moves and the lock — in the overflow.
 * Locking is never the primary button: a published exam's main business is
 * its results, and the irreversible act should take a deliberate detour.
 */
export function stageMoves(status: string): {
  primary: StageMove | null;
  overflow: StageMove[];
} {
  if (!isExamStatus(status)) return { primary: null, overflow: [] };
  const here = stageIndex(status);
  const moves = NEXT_STATUSES[status].map((target) => moveFor(status, target));
  const forward = moves.filter(
    (move) => stageIndex(move.target) > here && !move.destructive,
  );
  const primary = forward[0] ?? null;
  const overflow = moves.filter((move) => move !== primary);
  return { primary, overflow };
}

export const EXAM_SEGMENTS = ["open", "upcoming", "published", "all"] as const;
export type ExamSegment = (typeof EXAM_SEGMENTS)[number];

export function segmentOf(status: string): Exclude<ExamSegment, "all"> {
  if (isEntryOpen(status)) return "open";
  if (isResultsStage(status)) return "published";
  return "upcoming";
}

export function matchesSegment(status: string, segment: ExamSegment): boolean {
  return segment === "all" || segmentOf(status) === segment;
}

export function countBySegment(
  rows: readonly { status: string }[],
): Record<ExamSegment, number> {
  const counts: Record<ExamSegment, number> = {
    open: 0,
    upcoming: 0,
    published: 0,
    all: rows.length,
  };
  for (const row of rows) counts[segmentOf(row.status)] += 1;
  return counts;
}

/**
 * Newest lifecycle stage of interest first: live entry, then what is coming,
 * then what is done; ties by name so the order is stable across refetches.
 */
export function sortExams<T extends { status: string; name: string }>(
  rows: readonly T[],
): T[] {
  const rank: Record<Exclude<ExamSegment, "all">, number> = {
    open: 0,
    upcoming: 1,
    published: 2,
  };
  return [...rows].sort(
    (a, b) =>
      rank[segmentOf(a.status)] - rank[segmentOf(b.status)] ||
      stageIndex(b.status) - stageIndex(a.status) ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Marks text
// ---------------------------------------------------------------------------

/** The contract's `marksString`: up to four integer digits, two decimals. */
const MAX_INTEGER_DIGITS = 4;
const MAX_DECIMALS = 2;

/**
 * What a teacher is allowed to have in the field while typing. A comma becomes
 * a dot (some decimal pads print one), a second dot and any other character
 * are dropped, the digits are capped at what the server will accept, and a
 * minus survives only when the exam allows negative marking.
 */
export function sanitizeMarksText(raw: string, allowNegative = false): string {
  let text = raw.replace(",", ".");
  let negative = false;
  if (allowNegative && text.startsWith("-")) negative = true;
  text = text.replace(/[^0-9.]/g, "");
  const dot = text.indexOf(".");
  if (dot !== -1) {
    const whole = text.slice(0, dot);
    const fraction = text.slice(dot + 1).replace(/\./g, "");
    text = `${whole.slice(0, MAX_INTEGER_DIGITS)}.${fraction.slice(0, MAX_DECIMALS)}`;
  } else {
    text = text.slice(0, MAX_INTEGER_DIGITS);
  }
  return negative ? `-${text}` : text;
}

/** Hundredths as an integer, so range checks never touch float rounding. */
function toHundredths(text: string): number | null {
  const match = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] ?? "";
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (whole === "" && (match[3] ?? "") === "") return null;
  return sign * (Number(whole || "0") * 100 + Number(fraction));
}

/** The canonical wire form: no leading zeros, no trailing dot ("05." → "5"). */
export function normalizeMarks(text: string): string {
  const trimmed = text.trim();
  const hundredths = toHundredths(trimmed);
  if (hundredths === null) return trimmed;
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  if (fraction === 0) return `${sign}${whole}`;
  const padded = String(fraction).padStart(2, "0").replace(/0$/, "");
  return `${sign}${whole}.${padded}`;
}

/** "17.00" → "17", "17.50" → "17.5", nothing → "". For display and diffing. */
export function displayMarks(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return normalizeMarks(value);
}

export function marksEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return displayMarks(a) === displayMarks(b);
}

export type MarksCheck =
  | { ok: true; value: string | null }
  | { ok: false; reason: "format" | "negative" | "range" };

/**
 * Judge a field's text at commit time. Blank is valid (an empty draft); an
 * unfinished "." or "-" is a format error; a value over the component's max or
 * a negative one the exam forbids is refused HERE because the server's answer
 * to both is the generic "Something went wrong" (plan gap #8).
 */
export function checkMarks(
  text: string,
  rule: { max: number; allowNegative: boolean },
): MarksCheck {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const hundredths = toHundredths(trimmed);
  if (hundredths === null) return { ok: false, reason: "format" };
  if (hundredths < 0 && !rule.allowNegative) {
    return { ok: false, reason: "negative" };
  }
  if (hundredths > Math.round(rule.max * 100)) {
    return { ok: false, reason: "range" };
  }
  return { ok: true, value: normalizeMarks(trimmed) };
}

/** Grades are short free text (≤10 chars); the server judges the vocabulary. */
export const MAX_GRADE_LENGTH = 10;

export function sanitizeGradeText(raw: string): string {
  return raw.replace(/\s+/g, " ").toUpperCase().slice(0, MAX_GRADE_LENGTH);
}

export function normalizeGrade(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Roster and papers
// ---------------------------------------------------------------------------

type RosterLike = {
  rollNumber: string | null;
  firstName: string;
  lastName: string;
};

/**
 * Roll order, the way a teacher reads the register: numeric rolls ascending,
 * non-numeric after them (natural order), no roll last, then by name.
 */
export function compareRoll(a: RosterLike, b: RosterLike): number {
  const ra = a.rollNumber?.trim() || null;
  const rb = b.rollNumber?.trim() || null;
  if (ra && rb) {
    const na = Number(ra);
    const nb = Number(rb);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (aNum && bNum && na !== nb) return na - nb;
    if (aNum !== bNum) return aNum ? -1 : 1;
    const byRoll = ra.localeCompare(rb, undefined, { numeric: true });
    if (byRoll !== 0) return byRoll;
  } else if (ra || rb) {
    return ra ? -1 : 1;
  }
  return fullName(a).localeCompare(fullName(b));
}

export function sortRosterByRoll<T extends RosterLike>(rows: readonly T[]): T[] {
  return [...rows].sort(compareRoll);
}

export function fullName(person: {
  firstName: string;
  lastName: string;
}): string {
  return [person.firstName, person.lastName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export type TeachingPair = {
  sectionId: string;
  classId: string;
  subjectId: string;
};

type PaperLike = {
  classId: string;
  sectionId: string | null;
  subjectId: string;
};

/**
 * Is this the caller's paper? A section paper matches a pair on that exact
 * section; a class-wide paper matches a pair on any section of the class.
 * Only meaningful for callers the subject gate constrains — everyone else
 * passes on scope and their pairs are `null` (unrestricted).
 */
export function isMyPaper(
  paper: PaperLike,
  pairs: readonly TeachingPair[],
): boolean {
  return pairs.some((pair) =>
    paper.sectionId
      ? pair.sectionId === paper.sectionId && pair.subjectId === paper.subjectId
      : pair.classId === paper.classId && pair.subjectId === paper.subjectId,
  );
}

/** Sections of a class-wide paper the caller may name when entering. */
export function sectionsForPaper<
  S extends { id: string; classId: string },
>(paper: PaperLike, sections: readonly S[], pairs: readonly TeachingPair[] | null): S[] {
  if (paper.sectionId) return sections.filter((s) => s.id === paper.sectionId);
  const inClass = sections.filter((s) => s.classId === paper.classId);
  if (!pairs) return inClass;
  const mine = new Set(
    pairs.filter((p) => p.subjectId === paper.subjectId).map((p) => p.sectionId),
  );
  return inClass.filter((s) => mine.has(s.id));
}

/**
 * Is the caller constrained by teaching assignments? ADR-029a: the ONE
 * constrained role is `subject_teacher`; holding any other role (admin,
 * principal, class teacher, a school's custom role) lifts it, because the union
 * of roles never means less capability. No other role name is special-cased.
 * A UI hint only: the paper screen asks the server (`canEnter`).
 */
export function isAssignmentConstrained(roleTypes: readonly string[]): boolean {
  return (
    roleTypes.includes("subject_teacher") &&
    roleTypes.every((role) => role === "subject_teacher")
  );
}

// ---------------------------------------------------------------------------
// Review (7B)
// ---------------------------------------------------------------------------

/**
 * Review is offered to `marks:verify` holders while entry is open. The server
 * does not gate verify by stage (it works in `marks_entry` too, for the "teacher
 * is absent" case); the web offers it only when entry is open, and so do we.
 */
export function canReview(status: string, canVerify: boolean): boolean {
  return canVerify && isEntryOpen(status);
}

/**
 * One batch = one paper AND one section (the server refuses a batch whose
 * students sit in another section). A student with no section yet is allowed
 * into any section's batch on a class-wide paper, so they go with whichever
 * section is being verified. A student the enrollment read does not know is
 * left out rather than guessed at.
 */
export function partitionBySection<T extends { studentId: string }>(
  students: readonly T[],
  sectionByStudent: ReadonlyMap<string, string | null>,
  sectionId: string,
): { inScope: T[]; outOfScope: T[]; sectionless: number } {
  const inScope: T[] = [];
  const outOfScope: T[] = [];
  let sectionless = 0;
  for (const student of students) {
    if (!sectionByStudent.has(student.studentId)) {
      outOfScope.push(student);
      continue;
    }
    const section = sectionByStudent.get(student.studentId);
    if (section === sectionId) {
      inScope.push(student);
    } else if (section === null) {
      sectionless += 1;
      inScope.push(student);
    } else {
      outOfScope.push(student);
    }
  }
  return { inScope, outOfScope, sectionless };
}

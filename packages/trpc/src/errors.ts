import { TRPCError } from "@trpc/server";

/**
 * FRIENDLY DATABASE AND SERVICE ERRORS (ADR-026).
 *
 * The academic and organization services deliberately do not pre-check the
 * rules Postgres already enforces (ADR-022): a SELECT-then-INSERT guard races
 * under concurrency and a constraint does not. The cost is that the refusal
 * arrives as a driver exception, and tRPC's default handling turns any unknown
 * throw into a 500 whose message is that exception's own — so the single most
 * likely first-run mistake, two sessions whose dates overlap, reached the user
 * as
 *
 *   conflicting key value violates exclusion constraint
 *   "academic_years_no_overlap_excl"
 *
 * This module is the one place that reads such a failure and answers in words
 * the person doing school setup can act on. It is pure: `translateError` takes
 * whatever was thrown and returns the `TRPCError` to send instead. The
 * middleware that calls it lives in `trpc.ts`, and both transports share it.
 *
 * Two rules for anything added here.
 *
 * **Key on the constraint NAME, never on the message text.** The name is ours —
 * it is written in `schema/academic.ts` or the `0001` migration — while the
 * wording around it belongs to Postgres and is localised by `lc_messages`.
 *
 * **Never let a developer-facing string through.** An unrecognised failure gets
 * the generic message below: a worse experience, never a leak. Every message
 * here is also written to survive a missing DETAIL line, because Postgres omits
 * it when the caller lacks SELECT on the indexed columns.
 */

type TrpcErrorCode = ConstructorParameters<typeof TRPCError>[0]["code"];

/** What the user is told when we cannot say anything more specific. */
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * A rule about the data refused the row: unique violation, exclusion
 * violation, check violation. An unmapped constraint in one of these is still
 * honestly a conflict, so it gets CONFLICT with the generic wording below
 * rather than a 500 — "something already exists" is actionable even when we
 * cannot say what.
 */
const CONSTRAINT_SQLSTATES = new Set(["23505", "23P01", "23514"]);

const UNMAPPED_CONSTRAINT_MESSAGE =
  "That conflicts with something already saved. Check the details and try again.";

// ---------------------------------------------------------------------------
// Reading a Postgres error
// ---------------------------------------------------------------------------

/**
 * The fields of a database error this module reads, normalised.
 *
 * Duck-typed rather than imported. `postgres` is a dependency of `@repo/db`,
 * not of this package, and which driver `@repo/db` chose is its own business —
 * importing `PostgresError` here would make a transport-layer file care. The
 * fields are not that driver's invention either: SQLSTATE, the constraint name
 * and the detail line are fields `C`, `n` and `D` of the wire protocol's
 * ErrorResponse, so every driver reports them under some spelling.
 */
type PostgresErrorFields = {
  /** SQLSTATE, e.g. `23505`. */
  code: string;
  /**
   * For a unique *index* this is the index name, not a `pg_constraint` row —
   * Postgres reports it in the same field either way, which is why the map
   * below can key on `academic_years_school_name_uq` alongside a real
   * EXCLUDE constraint.
   */
  constraintName?: string;
  detail?: string;
};

function asPostgresError(value: unknown): PostgresErrorFields | null {
  if (typeof value !== "object" || value === null) return null;

  const fields = value as Record<string, unknown>;

  // SQLSTATE is five alphanumerics and `severity` is present on every
  // ErrorResponse. Together they identify a database error without naming a
  // driver, and without matching some unrelated object that happens to carry a
  // `code`.
  if (typeof fields.code !== "string" || !/^[0-9A-Za-z]{5}$/.test(fields.code)) {
    return null;
  }
  if (typeof fields.severity !== "string") return null;

  // postgres.js spells it `constraint_name`; node-postgres spells it
  // `constraint`. Reading both costs one line and removes a reason for this
  // file to break on a driver change.
  const constraint = fields.constraint_name ?? fields.constraint;

  return {
    code: fields.code,
    constraintName: typeof constraint === "string" ? constraint : undefined,
    detail: typeof fields.detail === "string" ? fields.detail : undefined,
  };
}

/**
 * Finds the database error inside whatever was thrown.
 *
 * It is rarely at the top: drizzle wraps some failures in `DrizzleQueryError`,
 * and tRPC wraps whatever the resolver threw, so the driver exception can be
 * two or three `cause` links down. The walk is bounded rather than a `while`
 * loop because a self-referential `cause` would otherwise hang the request.
 */
function findPostgresError(thrown: unknown): PostgresErrorFields | null {
  let current: unknown = thrown;

  for (let depth = 0; depth < 5 && current; depth++) {
    const postgresError = asPostgresError(current);
    if (postgresError) return postgresError;
    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Reading the DETAIL line
// ---------------------------------------------------------------------------

/** ISO `2025-03-31` → `31/03/2025`, the format this console displays. */
function displayDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/**
 * The day before an ISO date, in UTC so the server's own timezone cannot shift
 * it across a boundary.
 */
function dayBefore(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

const ISO_DATE_RANGE = /\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)/g;

/**
 * The dates of the session already occupying the range, read from the DETAIL of
 * an exclusion violation.
 *
 * Postgres writes:
 *
 *   Key (school_id, daterange(start_date, end_date, '[]'))=(…, [2025-04-01,2026-04-01))
 *   conflicts with existing key (school_id, daterange(start_date, end_date, '[]'))=(…, [2024-04-01,2025-04-01)).
 *
 * The first range is the row being written, the second the row already there.
 * The second is the useful one — the user knows what they just typed; what they
 * do not know is what it collides with.
 *
 * `daterange` is canonicalised to `[)` for a discrete type, so the printed
 * upper bound is the day AFTER the session ends. Subtracting it back is not
 * cosmetic: telling someone their new session overlaps one ending 01/04/2025
 * when it ends 31/03/2025 sends them looking for a row that does not exist.
 *
 * Returns null when the shape is anything else, and the caller falls back to
 * wording that names no dates. That is the point of parsing defensively — a
 * future Postgres phrasing change costs detail, not a 500.
 */
function conflictingSessionDates(
  detail: string | undefined,
): { start: string; end: string } | null {
  if (!detail) return null;

  const ranges = [...detail.matchAll(ISO_DATE_RANGE)];
  const existing = ranges[1];
  const lower = existing?.[1];
  const upper = existing?.[2];

  if (!lower || !upper) return null;

  return { start: displayDate(lower), end: displayDate(dayBefore(upper)) };
}

const KEY_DETAIL = /Key \(([^)]+)\)=\((.*)\) already exists/;

/**
 * The values Postgres names in `Key (columns)=(values) already exists.`, keyed
 * by column.
 *
 * Only the LAST column of every unique index handled here is free text (`name`,
 * `code`); everything before it is a uuid. So when the value list splits into
 * more parts than there are columns — a class actually named "Class 6, Junior"
 * — the extra parts belong to that last column, and re-joining them is correct
 * rather than a guess.
 */
function keyValues(detail: string | undefined): Record<string, string> {
  const match = detail?.match(KEY_DETAIL);
  const columnList = match?.[1];
  const valueList = match?.[2];

  if (!columnList || valueList === undefined) return {};

  const columns = columnList.split(", ");
  const values = valueList.split(", ");
  const named: Record<string, string> = {};

  columns.forEach((column, index) => {
    named[column] =
      index === columns.length - 1
        ? values.slice(index).join(", ")
        : (values[index] ?? "");
  });

  return named;
}

/** One column's value from the DETAIL line, or undefined if it is not there. */
function keyValue(
  error: PostgresErrorFields,
  column: string,
): string | undefined {
  const value = keyValues(error.detail)[column];
  return value ? value : undefined;
}

// ---------------------------------------------------------------------------
// Constraint → message
// ---------------------------------------------------------------------------

type ConstraintTranslation = {
  code: TrpcErrorCode;
  message: (error: PostgresErrorFields) => string;
};

/**
 * Every constraint a caller can currently trip, in the words the UI shows.
 *
 * The wording follows the console's vocabulary — a school is a **branch**, an
 * academic year is a **session** — and each message says what happened *and*
 * what to do about it. Interpolated values come from the DETAIL line, so each
 * entry also has a form that reads correctly without them.
 */
const CONSTRAINT_TRANSLATIONS: Record<string, ConstraintTranslation> = {
  // academic_years -------------------------------------------------------
  academic_years_no_overlap_excl: {
    code: "CONFLICT",
    message: (error) => {
      const dates = conflictingSessionDates(error.detail);
      const overlapped = dates
        ? `another session at this branch (${dates.start} – ${dates.end})`
        : "another session at this branch";
      return `These dates overlap ${overlapped}. Change the start or end date so the two do not share a day.`;
    },
  },

  academic_years_school_name_uq: {
    code: "CONFLICT",
    message: (error) => {
      const name = keyValue(error, "name");
      return name
        ? `This branch already has a session named ${name}. Pick a different name.`
        : "This branch already has a session with that name. Pick a different name.";
    },
  },

  academic_years_one_current_excl: {
    code: "CONFLICT",
    // Reached when two people promote a session at the same moment: the flag is
    // cleared and set in one transaction, so the loser sees the winner's row.
    // Refreshing shows the current state, which is the only useful next step.
    message: () =>
      "Another session is already the running session. Refresh the page and try again.",
  },

  academic_years_end_after_start: {
    code: "CONFLICT",
    message: () => "A session cannot end before it starts. Check the end date.",
  },

  // classes --------------------------------------------------------------
  classes_school_name_uq: {
    code: "CONFLICT",
    message: (error) => {
      const name = keyValue(error, "name");
      return name
        ? `${name} already exists at this branch. Pick a different name.`
        : "A class with that name already exists at this branch. Pick a different name.";
    },
  },

  classes_school_order_uq: {
    code: "CONFLICT",
    // `numeric_order` is never shown to the user, so naming the colliding
    // number would explain nothing. The rule it enforces is what they need.
    message: () =>
      "Another class already uses that position in the class order. Each class can appear only once at a branch.",
  },

  // sections -------------------------------------------------------------
  sections_year_class_name_uq: {
    code: "CONFLICT",
    message: (error) => {
      const name = keyValue(error, "name");
      return name
        ? `This class already has a Section ${name} this session. Pick a different name.`
        : "This class already has a section with that name this session. Pick a different name.";
    },
  },

  // schools --------------------------------------------------------------
  schools_org_code_uq: {
    code: "CONFLICT",
    message: (error) => {
      const code = keyValue(error, "code");
      return code
        ? `Code ${code} is already used by another branch. Pick a different code.`
        : "That code is already used by another branch. Pick a different code.";
    },
  },

  // students -------------------------------------------------------------
  students_school_admission_number_uq: {
    code: "CONFLICT",
    message: (error) => {
      const admission = keyValue(error, "admission_number");
      return admission
        ? `Admission number ${admission} is already used at this branch. Admission numbers are never reused — check the record, or issue the next number.`
        : "That admission number is already used at this branch. Admission numbers are never reused.";
    },
  },

  // terms ----------------------------------------------------------------
  // A trigger, not a constraint — a CHECK cannot reference another table —
  // but it reports itself with this name via USING CONSTRAINT, so the same
  // map catches it.
  terms_dates_within_year_trg: {
    code: "CONFLICT",
    message: () =>
      "A term's dates must sit inside its session's dates. Check the term's start and end date against the session.",
  },
};

// ---------------------------------------------------------------------------
// Service Error → message
// ---------------------------------------------------------------------------

type ServiceTranslation = {
  match: RegExp;
  code: TrpcErrorCode;
  message: string;
};

/**
 * The plain `Error`s services throw for conditions no constraint can see.
 *
 * These are matched on message text, which is exactly what this file forbids
 * for constraints. The difference is ownership: these strings are ours, in
 * `packages/services`, and nothing connects them to this list but a regex. So
 * the failure mode is stated plainly — rewording a service message drops it
 * through to the generic 500, which is less helpful and still not a leak.
 *
 * A shared error type thrown by services and read here would remove the
 * matching altogether. The assignment layer took this list from three entries
 * to eight in one slice; the next domain that needs mapping should introduce
 * that type rather than appending again.
 */
const SERVICE_TRANSLATIONS: ServiceTranslation[] = [
  {
    // requireSchoolId (academic.service.ts). A write arrived with no schoolId,
    // so the caller's scope resolved to the whole organization and there is no
    // branch to attribute the row to. A 400 rather than a 500: the request is
    // answerable, it just did not say where.
    match: /needs a school/i,
    code: "BAD_REQUEST",
    message: "Choose a branch first — this has to be saved against one branch.",
  },
  {
    // createSection's parent guards. A foreign key proves the class exists, not
    // that it belongs to this branch, so the service re-reads both parents
    // inside the transaction and refuses a cross-branch link.
    match: /^Class not found in this school/i,
    code: "BAD_REQUEST",
    message:
      "That class is not at this branch. Choose a class from the branch you are working in.",
  },
  {
    match: /^Academic year not found in this school/i,
    code: "BAD_REQUEST",
    message:
      "That session is not at this branch. Choose a session from the branch you are working in.",
  },
  {
    // The assignment layer's parent guards (assignment.service.ts). Same shape
    // as createSection's: a foreign key proves the row exists, not that it
    // belongs to this branch, so the service re-reads every parent inside the
    // transaction and refuses a cross-branch link. One regex covers both the
    // mapping guard and the subject_teacher guard — same prefix, same answer.
    match: /^Subject not found in this school/i,
    code: "BAD_REQUEST",
    message:
      "That subject is not at this branch. Choose a subject from the branch you are working in.",
  },
  {
    match: /^Section not found in this school/i,
    code: "BAD_REQUEST",
    message:
      "That section is not at this branch. Choose a section from the branch you are working in.",
  },
  {
    // The enrollment layer's section-agreement guards: an enrollment claiming
    // a year its section did not run in, or a class its section does not
    // belong to, would pass every FK.
    match: /^The section's year does not match the enrollment's year/i,
    code: "BAD_REQUEST",
    message:
      "That section belongs to a different session. Enroll into the session the section belongs to.",
  },
  {
    match: /^The section belongs to a different class than the enrollment/i,
    code: "BAD_REQUEST",
    message:
      "That section belongs to a different class. Enroll under the class the section teaches.",
  },
  {
    // createSectionTeacherAssignment: an assignment claiming a year its section
    // did not run in would hang attendance and marks off the wrong session.
    match: /^Academic year does not match the section's year/i,
    code: "BAD_REQUEST",
    message:
      "That session does not match the section's session. Choose the session the section belongs to.",
  },
  {
    // endAssignment against a row someone else ended first — the double-click.
    match: /^Assignment is not currently open/i,
    code: "CONFLICT",
    message:
      "This assignment has already been ended. Refresh to see the current assignments.",
  },
  {
    // endAssignment addressing a row outside the caller's school. NOT_FOUND,
    // matching how every id-addressed read answers a row it cannot see.
    match: /^Assignment not found in this school/i,
    code: "NOT_FOUND",
    message: "That assignment could not be found.",
  },
  {
    // The enrollment layer's guards (enrollment.service.ts). Same shape as the
    // assignment layer's: the student/year/class/section FKs do not mention
    // school_id, so the service re-reads every parent through the caller's
    // scope and refuses a cross-branch link in words.
    match: /^Student not found in this school/i,
    code: "BAD_REQUEST",
    message:
      "That student is not at this branch. Choose a student from the branch you are working in.",
  },
  {
    match: /^Enrollment not found in this school/i,
    code: "NOT_FOUND",
    message: "That enrollment could not be found.",
  },
  {
    // The section-assignment boundary: the row already has a section, and
    // moving a student mid-year is a TRANSFER — section_transfer_log's job,
    // which does not exist yet. The service simply has no way to re-point an
    // assigned section, so this wording is the honest answer.
    match: /^This enrollment already has a section/i,
    code: "BAD_REQUEST",
    message:
      "This enrollment already has a section. Moving a student mid-year needs a transfer — that flow is not built yet.",
  },  {
    match: /^Only an admitted enrollment can be assigned a section/i,
    code: "BAD_REQUEST",
    message:
      "Only an enrollment still in the admission flow can be assigned a section. This one has already moved on.",
  },
  {
    // upsertCalendarDay (attendance.service.ts): the unique index would
    // happily accept a date filed under the wrong session, so the service
    // checks it against the parent year's own bounds and refuses.
    match: /^The date is outside the academic year/i,
    code: "BAD_REQUEST",
    message:
      "That date is outside the session's dates. Pick a date the session covers.",
  },
  {
    // The status machine's refusal (dynamic detail is in the thrown message;
    // this is the user-facing wording) and the two optimistic-update races —
    // both "a moment ago" messages are the same answer: refresh.
    match: /^An enrollment cannot move from|a moment ago/i,
    code: "BAD_REQUEST",
    message:
      "That status change is not allowed right now. Refresh to see the enrollment's current state.",
  },
];

// ---------------------------------------------------------------------------

/**
 * The error to send instead of whatever was thrown.
 *
 * Order matters: a deliberate `TRPCError` is already the answer, a database
 * error is read by constraint name, a known service `Error` by message, and
 * everything else becomes a 500 that says nothing.
 */
export function translateError(thrown: unknown): TRPCError {
  /**
   * NOT_FOUND from a router, FORBIDDEN from the permission gate, UNAUTHORIZED
   * from the session check — all chosen deliberately upstream, and re-deciding
   * them here would silently move authorization messaging into this file. Only
   * the INTERNAL_SERVER_ERROR tRPC manufactures around an unknown throw is ours
   * to reinterpret; that is the one carrying a driver exception or a service
   * `Error` as its cause.
   */
  if (thrown instanceof TRPCError && thrown.code !== "INTERNAL_SERVER_ERROR") {
    return thrown;
  }

  const cause = thrown instanceof TRPCError ? (thrown.cause ?? thrown) : thrown;

  const postgresError = findPostgresError(cause);

  if (postgresError) {
    const translation = postgresError.constraintName
      ? CONSTRAINT_TRANSLATIONS[postgresError.constraintName]
      : undefined;

    if (translation) {
      return new TRPCError({
        code: translation.code,
        message: translation.message(postgresError),
        cause,
      });
    }

    if (CONSTRAINT_SQLSTATES.has(postgresError.code)) {
      return new TRPCError({
        code: "CONFLICT",
        message: UNMAPPED_CONSTRAINT_MESSAGE,
        cause,
      });
    }

    // Any other SQLSTATE is infrastructure, not a rule about the data: a
    // dropped connection, a missing column after a bad deploy. The user cannot
    // act on it and must not read it.
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: GENERIC_MESSAGE,
      cause,
    });
  }

  const message = cause instanceof Error ? cause.message : "";
  const serviceTranslation = SERVICE_TRANSLATIONS.find((translation) =>
    translation.match.test(message),
  );

  if (serviceTranslation) {
    return new TRPCError({
      code: serviceTranslation.code,
      message: serviceTranslation.message,
      cause,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: GENERIC_MESSAGE,
    cause,
  });
}

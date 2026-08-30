import { atSchoolLevel, requireSchoolId, yearVisibilityWhere } from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  GenerateCalendarInput,
  GetDailyStatusInput,
  ListCalendarInput,
  ListSummariesInput,
  MarkAttendanceInput,
  UpsertCalendarDayInput,
  UpsertPolicyInput,
  CreatePeriodInput,
  UpdatePeriodInput,
} from "@repo/contracts";
import { db } from "@repo/db";
import {
  academicCalendar,
  academicYears,
  attendancePolicies,
  attendanceRecords,
  attendanceSummary,
  dailyAttendanceStatus,
  periods,
  sections,
  studentEnrollments,
  subjects,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

/**
 * ATTENDANCE — Phase 3. Configuration layer (C2): calendar, policy, periods.
 * Marking flow (C5): `markAttendance`, the daily-status derivation, and
 * `recomputeSummary`.
 *
 * Knows nothing about HTTP. Every read takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); input types come from
 * `@repo/contracts`.
 *
 * **HARD RULE 5 lives here.** `attendance_records` is write-only ground
 * truth; the ONLY table anything downstream may read is
 * `daily_attendance_status`. The summary is a derived read-model of the
 * status layer, recomputed at the end of every mark. No fee, exam, or report
 * query may ever touch `attendance_records` — the schema comments on both
 * tables say the same thing where the next author will meet them.
 *
 * **The marking gate.** `markAttendance` refuses any entry whose date the
 * calendar does not describe: no row → refused (strict — "generate the
 * calendar first"; the bulk generator makes this a non-event),
 * holiday/weekend → refused, working/half_day/exam_day → accepted. It is a
 * service rule because it is cross-table; no CHECK can hold it.
 *
 * **The snapshot rule.** Section + class are COPIED onto records and daily
 * status at INSERT time and never updated afterwards — an edit re-marks the
 * status but does not re-home the row, so a mid-year transfer cannot rewrite
 * which section last month's attendance belonged to.
 *
 * **ADR-030 — records edit in place.** No corrections table. An update
 * carries an optional `correctionReason`; an update WITHOUT one preserves
 * the stored reason (the don't-wipe rule, implemented in `markAttendance`).
 *
 * Scope levels, per entity — each justified by the entity's shape, the
 * reasoning documented on `atSchoolLevel`:
 *
 *   - **Calendar and policy are SCHOOL-level facts.** A day is a day for every
 *     class in the branch, and marking policy is set once per school. Neither
 *     table has a class column to filter on, so a section-scoped teacher
 *     asking "is 15 August a holiday?" is asking exactly what the principal
 *     asks — widen with `atSchoolLevel`.
 *   - **Periods are section-attached configuration**, and follow the
 *     assignment layer's pattern: the scope filters org+school and the
 *     section is narrowed by the addressed `sectionId`, with the parent
 *     re-read through the section's OWN table proving the section belongs to
 *     this school.
 *   - **Records and daily status carry all four scope columns** (org, school,
 *     class, section — snapshot columns are real columns), so their reads
 *     filter WITHOUT widening: a section teacher sees exactly her section's
 *     day, never her school's.
 *
 * **Parent verification (the section-service pattern).** The
 * `academic_years` FK is precisely the one that does not mention `school_id`,
 * so every calendar write re-reads the parent year through the caller's scope
 * INSIDE the transaction before inserting, and marking re-reads the section
 * the same way. A row pointing at another school's year would be a
 * cross-tenant lie every later read trusts.
 *
 * Scope columns are per-TABLE (the S2.4 lesson): `scopeWhere` compiles the
 * columns it is handed into that query's SQL, so a column set borrowed from
 * another table is a runtime "missing FROM-clause entry" error `tsc` cannot
 * see. Each table gets its own column set.
 */

const CALENDAR_SCOPE_COLUMNS = {
  organizationId: academicCalendar.organizationId,
  schoolId: academicCalendar.schoolId,
} as const;

const POLICY_SCOPE_COLUMNS = {
  organizationId: attendancePolicies.organizationId,
  schoolId: attendancePolicies.schoolId,
} as const;

const PERIOD_SCOPE_COLUMNS = {
  organizationId: periods.organizationId,
  schoolId: periods.schoolId,
} as const;

// The record/status tables carry all four scope columns (the snapshot makes
// class/section real columns), so their reads filter WITHOUT widening.
const STATUS_SCOPE_COLUMNS = {
  organizationId: dailyAttendanceStatus.organizationId,
  schoolId: dailyAttendanceStatus.schoolId,
  classId: dailyAttendanceStatus.classId,
  sectionId: dailyAttendanceStatus.sectionId,
} as const;

// The enrollment table's own columns — the scope carrier for the summary
// read, whose table has no class/section columns of its own.
const ENROLLMENT_SCOPE_COLUMNS = {
  organizationId: studentEnrollments.organizationId,
  schoolId: studentEnrollments.schoolId,
  classId: studentEnrollments.classId,
  sectionId: studentEnrollments.sectionId,
} as const;

// Parent tables — each re-read filters the parent's own columns.
const YEAR_SCOPE_COLUMNS = {
  organizationId: academicYears.organizationId,
  schoolId: academicYears.schoolId,
} as const;

const SECTION_SCOPE_COLUMNS = {
  organizationId: sections.organizationId,
  schoolId: sections.schoolId,
} as const;

const SUBJECT_SCOPE_COLUMNS = {
  organizationId: subjects.organizationId,
  schoolId: subjects.schoolId,
} as const;

export class AttendanceService {
  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------

  /**
   * Reads the year through the caller's scope and returns its date bounds.
   * The shared parent re-read for every calendar write — a year not in this
   * school is NOT_FOUND, worded for the caller rather than let through by the
   * FK and refused later by a constraint worded for the database.
   */
  private async yearForCalendar(
    scope: DataScope,
    academicYearId: string,
  ) {
    const schoolId = requireSchoolId(scope);
    const [year] = await db
      .select({
        id: academicYears.id,
        startDate: academicYears.startDate,
        endDate: academicYears.endDate,
      })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, academicYearId),
          eq(academicYears.schoolId, schoolId),
          scopeWhere(atSchoolLevel(scope), YEAR_SCOPE_COLUMNS),
        ),
      );
    if (!year) {
      throw new Error(
        "Academic year not found in this school. A calendar day cannot reference another school's year.",
      );
    }
    return year;
  }

  /**
   * Fills a year's calendar in bulk — one row per date from the year's start
   * to its end: `working` on the named weekdays, `weekend` on the rest.
   *
   * **Idempotent by construction**: `onConflictDoNothing` against the
   * `(school, year, date)` unique index fills MISSING dates only and never
   * touches a row that exists — an already-set holiday survives a re-run.
   * Overrides (Diwali, an exam day) are `upsertDay`'s job, not a re-run's
   * side effect. Holidays are NOT guessed here: the school names them one by
   * one, because no weekday arithmetic knows when Diwali falls.
   *
   * Every date gets a row — including weekends — so the calendar is COMPLETE
   * once generated. That completeness is what makes "working days" in the
   * attendance summary honest and the marking gate's no-row refusal a
   * non-event: an ungenerated year is visibly empty, not a minefield of
   * missing dates.
   */
  async generateYearCalendar(
    scope: DataScope,
    input: GenerateCalendarInput,
    actorId: string | null,
  ) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const working = new Set(input.workingWeekdays);

    // Walk the year in UTC. A calendar date has no zone; parsing with an
    // explicit T00:00:00Z and reading only UTC getters keeps the host's
    // timezone out of the arithmetic entirely.
    const rows: {
      organizationId: string;
      schoolId: string;
      academicYearId: string;
      date: string;
      dayType: "working" | "weekend";
      createdFromTemplate: boolean;
      createdBy: string | null;
    }[] = [];
    const cursor = new Date(`${year.startDate}T00:00:00Z`);
    const end = new Date(`${year.endDate}T00:00:00Z`);
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      rows.push({
        organizationId,
        schoolId,
        academicYearId: year.id,
        date: iso,
        dayType: working.has(cursor.getUTCDay()) ? "working" : "weekend",
        createdFromTemplate: true,
        createdBy: actorId,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    // ~365 rows, one statement, conflicts skipped. A batch that collided
    // loudly would make the generator fail on its second run — the opposite
    // of idempotent. Returns how many rows were actually INSERTED (re-runs
    // fill nothing and report 0), so the caller sees the effect, not the
    // intent.
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(academicCalendar)
        .values(rows)
        .onConflictDoNothing({
          target: [
            academicCalendar.schoolId,
            academicCalendar.academicYearId,
            academicCalendar.date,
          ],
        })
        .returning({ id: academicCalendar.id });
      return { generated: inserted.length };
    });
  }

  /**
   * Sets (or overrides) ONE date's day type. The single sanctioned way a
   * holiday, exam day, or half day enters the calendar.
   *
   * The date must fall INSIDE the year — the unique index would happily
   * accept 15 August 2031 filed under the 2030-31 year, and a stray row
   * outside the year's bounds would poison both the marking gate and the
   * working-days denominator. The parent re-read provides the bounds.
   *
   * The reason follows the don't-wipe rule the marking flow also obeys:
   * omitting `reason` preserves whatever is stored; an explicit `null`
   * clears it.
   */
  async upsertCalendarDay(
    scope: DataScope,
    input: UpsertCalendarDayInput,
    actorId: string | null,
  ) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    if (input.date < year.startDate || input.date > year.endDate) {
      throw new Error(
        `The date is outside the academic year (${year.startDate} to ${year.endDate}). A calendar day cannot be filed outside its year.`,
      );
    }

    return db.transaction(async (tx) => {
      const [day] = await tx
        .insert(academicCalendar)
        .values({
          organizationId,
          schoolId,
          academicYearId: year.id,
          date: input.date,
          dayType: input.dayType,
          reason: input.reason ?? null,
          createdFromTemplate: false,
          createdBy: actorId,
        })
        .onConflictDoUpdate({
          target: [
            academicCalendar.schoolId,
            academicCalendar.academicYearId,
            academicCalendar.date,
          ],
          set: {
            dayType: input.dayType,
            // undefined = not sent = keep what is stored; null = clear it.
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
          },
        })
        .returning();
      if (!day) {
        throw new Error("Failed to upsert the calendar day.");
      }
      return day;
    });
  }

  /**
   * One year's calendar, ascending by date, optionally clipped to a month.
   *
   * Year-scoped reads answer the read_history question (ADR-024):
   * `includeHistory` is REQUIRED — either default is wrong invisibly — and
   * `yearVisibilityWhere` pins a no-history caller to the current session,
   * so a stale id for a closed year returns nothing rather than rows.
   *
   * The month filter runs in SQL (`extract`) — a two-phase fetch-and-filter
   * would drag a year's rows over the wire to throw most of them away.
   */
  async listCalendar(
    scopes: DataScope[],
    input: ListCalendarInput,
    includeHistory: boolean,
  ) {
    const rows = await db
      .select({ day: academicCalendar })
      .from(academicCalendar)
      .innerJoin(
        academicYears,
        eq(academicCalendar.academicYearId, academicYears.id),
      )
      .where(
        and(
          eq(academicCalendar.academicYearId, input.academicYearId),
          input.month
            ? sql`extract(month from ${academicCalendar.date}) = ${input.month}`
            : undefined,
          scopeWhere(scopes.map(atSchoolLevel), CALENDAR_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      )
      .orderBy(asc(academicCalendar.date));

    return rows.map((r) => r.day);
  }

  // -------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------

  /**
   * The school's marking policy, or null before the first upsert — the
   * marking flow treats a missing policy as the DEFAULTS (daily mode), not
   * as an error, so a school can mark before it has ever opened the policy
   * screen.
   */
  async getPolicy(scope: DataScope) {
    const [policy] = await db
      .select()
      .from(attendancePolicies)
      .where(
        and(
          scopeWhere(atSchoolLevel(scope), POLICY_SCOPE_COLUMNS),
        ),
      );
    return policy ?? null;
  }

  /**
   * The same read on the PERMISSIVE track (ADR-017): the caller addresses a
   * school and ctx.scopes is clipped to whatever of their grants reach into
   * it. A section-scoped teacher does not COVER her school, yet the policy is
   * school-level config with no class dimension — `atSchoolLevel` widens her
   * clipped class scope to the school it belongs to, the same entity-shape
   * reasoning the terms list uses. A school outside every grant yields null.
   */
  async getPolicyForSchool(scopes: DataScope[], schoolId: string) {
    const [policy] = await db
      .select()
      .from(attendancePolicies)
      .where(
        and(
          eq(attendancePolicies.schoolId, schoolId),
          scopeWhere(scopes.map(atSchoolLevel), POLICY_SCOPE_COLUMNS),
        ),
      );
    return policy ?? null;
  }

  /**
   * Creates or updates the school's ONE policy row — the first upsert
   * creates, the rest update, keyed on the `attendance_policies_school_uq`
   * unique index. `updatedBy` is the caller's identity, set on both paths
   * the same way.
   */
  async upsertPolicy(
    scope: DataScope,
    input: UpsertPolicyInput,
    actorId: string | null,
  ) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [policy] = await tx
        .insert(attendancePolicies)
        .values({ ...input, organizationId, schoolId, updatedBy: actorId })
        .onConflictDoUpdate({
          target: attendancePolicies.schoolId,
          set: { ...input, updatedBy: actorId, updatedAt: new Date() },
        })
        .returning();
      if (!policy) {
        throw new Error("Failed to upsert the attendance policy.");
      }
      return policy;
    });
  }

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  /**
   * Creates a period for one section. The section is re-read through the
   * caller's scope INSIDE the transaction (its FK never mentions school_id),
   * and the input's year must EQUAL the section's own year — the STA
   * year-consistency pattern: a period filed under the wrong year would
   * detach it from every attendance row its section actually marks.
   */
  async createPeriod(
    scope: DataScope,
    sectionId: string,
    input: CreatePeriodInput,
    actorId: string | null,
  ) {
    const schoolId = atSchoolLevel(scope).schoolId;
    if (!schoolId) {
      throw new Error(
        "A school is required to create a period. The request must name a schoolId so the scope resolves to that school.",
      );
    }
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      const [section] = await tx
        .select({ id: sections.id, academicYearId: sections.academicYearId })
        .from(sections)
        .where(
          and(
            eq(sections.id, sectionId),
            eq(sections.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SECTION_SCOPE_COLUMNS),
          ),
        );
      if (!section) {
        throw new Error(
          "Section not found in this school. A period cannot be attached to another school's section.",
        );
      }

      if (input.academicYearId !== section.academicYearId) {
        throw new Error(
          "Academic year does not match the section's year. A period's year must equal its section's.",
        );
      }

      if (input.subjectId) {
        const [subject] = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            and(
              eq(subjects.id, input.subjectId),
              eq(subjects.schoolId, schoolId),
              scopeWhere(atSchoolLevel(scope), SUBJECT_SCOPE_COLUMNS),
            ),
          );
        if (!subject) {
          throw new Error(
            "Subject not found in this school. A period cannot cover another school's subject.",
          );
        }
      }

      const [period] = await tx
        .insert(periods)
        .values({
          ...input,
          sectionId,
          academicYearId: section.academicYearId,
          organizationId,
          schoolId,
        })
        .returning();
      if (!period) {
        throw new Error("Failed to create period.");
      }
      return period;
    });
  }

  /**
   * A section's periods in timetable order. The assignments layer's read
   * shape: org+school from the scope, the section narrowed by the addressed
   * id. A wrong-tenant sectionId returns an empty list — nothing here
   * confirms a section exists somewhere the caller may not look.
   */
  async listPeriods(scopes: DataScope[], sectionId: string) {
    return db
      .select()
      .from(periods)
      .where(
        and(
          eq(periods.sectionId, sectionId),
          scopeWhere(scopes.map(atSchoolLevel), PERIOD_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(periods.sequenceNumber));
  }

  /**
   * Reads one period. Out of scope, wrong tenant, and nonexistent all
   * collapse to null — the router makes them the same NOT_FOUND.
   */
  async getPeriodById(scope: DataScope, periodId: string) {
    const [period] = await db
      .select()
      .from(periods)
      .where(
        and(
          eq(periods.id, periodId),
          scopeWhere(atSchoolLevel(scope), PERIOD_SCOPE_COLUMNS),
        ),
      );
    return period ?? null;
  }

  /**
   * Renames, re-sequences, re-times, or re-points the subject/teacher. The
   * section and year are not patchable (see the contract); a colliding
   * sequence is the database's `periods_section_year_sequence_uq` (ADR-22's
   * let-Postgres-refuse rule).
   */
  async updatePeriod(scope: DataScope, periodId: string, input: UpdatePeriodInput) {
    const [period] = await db
      .update(periods)
      .set(input)
      .where(
        and(
          eq(periods.id, periodId),
          scopeWhere(atSchoolLevel(scope), PERIOD_SCOPE_COLUMNS),
        ),
      )
      .returning();

    return period ?? null;
  }

  /**
   * The owning branch of a period — the B6 resolution layer's adapter, same
   * shape as `getTermOwnerId`. Filtered by org so a cross-tenant id and a
   * nonexistent one are indistinguishable: both null, both NOT_FOUND
   * upstream. Authorization-neutral by design.
   */
  async getPeriodOwnerId(
    organizationId: string,
    periodId: string,
  ): Promise<string | null> {
    const [row] = await db
      .select({ schoolId: periods.schoolId })
      .from(periods)
      .where(and(eq(periods.id, periodId), eq(periods.organizationId, organizationId)));

    return row?.schoolId ?? null;
  }

  // -------------------------------------------------------------------------
  // Marking flow (C5)
  // -------------------------------------------------------------------------

  /**
   * Marks attendance for one section on one date — the whole flow in ONE
   * transaction: section re-read, policy, period agreement, the calendar
   * gate, the roster check, the record upsert (with the don't-wipe reason
   * rule), the daily-status derivation, and the summary recompute. A failure
   * anywhere rolls all of it back: there is no state where records moved but
   * the authoritative layer did not.
   *
   * Re-marking is an upsert, per the temporal rule (none): any calendar-valid
   * date, past or present. `markedBy` is set on insert; an edit sets
   * `updatedBy` and, only when the entry carries one, the `correctionReason`
   * — an update WITHOUT a reason never wipes a stored one (ADR-030's
   * don't-wipe micro-rule). Snapshot columns are written on INSERT only, so
   * re-marking a transferred student's old records re-marks the status
   * without re-homing the row.
   *
   * Concurrency: two simultaneous marks of the same student/day/period both
   * pass the SELECT and race the INSERT; the double-mark guard index refuses
   * the loser, which surfaces as a generic CONFLICT (ADR-022's
   * let-Postgres-refuse rule). The guard is an EXPRESSION index
   * (`COALESCE(period_id, sentinel)`), so it cannot be an ON CONFLICT target
   * — hence select-then-split rather than a single upsert statement.
   */
  async markAttendance(
    scope: DataScope,
    input: MarkAttendanceInput,
    actorId: string,
  ) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    return db.transaction(async (tx) => {
      // The section re-read through the caller's scope — its FKs never
      // mention school_id, so Postgres would happily accept marks for another
      // school's section.
      const [section] = await tx
        .select({
          id: sections.id,
          academicYearId: sections.academicYearId,
          classId: sections.classId,
        })
        .from(sections)
        .where(
          and(
            eq(sections.id, input.sectionId),
            eq(sections.schoolId, schoolId),
            scopeWhere(atSchoolLevel(scope), SECTION_SCOPE_COLUMNS),
          ),
        );
      if (!section) {
        throw new Error(
          "Section not found in this school. Attendance cannot be marked for another school's section.",
        );
      }
      const yearId = section.academicYearId;

      // The school's policy. A missing row is the daily-mode DEFAULTS, not an
      // error — a school can mark before ever opening the policy screen.
      const [policy] = await tx
        .select({
          markingMode: attendancePolicies.markingMode,
          dailyStatusRule: attendancePolicies.dailyStatusRule,
          thresholdPercentage: attendancePolicies.thresholdPercentage,
        })
        .from(attendancePolicies)
        .where(eq(attendancePolicies.schoolId, schoolId));
      const markingMode = policy?.markingMode ?? "daily";

      // Period agreement. Daily vs period-wise is a per-school policy, not a
      // schema fork; the mode decides what periodId means before anything is
      // written.
      if (markingMode === "daily" && input.periodId) {
        throw new Error(
          "This school marks attendance for the whole day. A period cannot be named in daily-mode marking.",
        );
      }
      if (markingMode === "period_wise" && !input.periodId) {
        throw new Error(
          "This school marks attendance period by period. Choose the period this marking is for.",
        );
      }
      if (input.periodId) {
        const [period] = await tx
          .select({ id: periods.id })
          .from(periods)
          .where(
            and(
              eq(periods.id, input.periodId),
              eq(periods.sectionId, section.id),
              eq(periods.academicYearId, yearId),
            ),
          );
        if (!period) {
          throw new Error(
            "The chosen period does not belong to the section being marked. Pick one of the section's own periods.",
          );
        }
      }

      // THE CALENDAR GATE. No row → refused (strict — the bulk generator
      // makes filling the calendar a non-event); holiday and weekend →
      // refused; working, half_day, exam_day → accepted. This is why the
      // calendar exists.
      const [calDay] = await tx
        .select({ dayType: academicCalendar.dayType })
        .from(academicCalendar)
        .where(
          and(
            eq(academicCalendar.schoolId, schoolId),
            eq(academicCalendar.academicYearId, yearId),
            eq(academicCalendar.date, input.date),
          ),
        );
      if (!calDay) {
        throw new Error(
          `No calendar entry exists for ${input.date}. Generate the year's calendar first — marking is refused on a date the calendar does not describe.`,
        );
      }
      if (calDay.dayType === "holiday") {
        throw new Error(
          `The date ${input.date} is marked as a holiday in the calendar. Attendance cannot be marked on a holiday.`,
        );
      }
      if (calDay.dayType === "weekend") {
        throw new Error(
          `The date ${input.date} is marked as a weekend in the calendar. Attendance cannot be marked on a weekend.`,
        );
      }

      // The roster check: entries must name students enrolled in THIS
      // section, still attending (section_assigned or active — not one who
      // transferred out or withdrew).
      const rosterRows = await tx
        .select({ studentId: studentEnrollments.studentId })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.sectionId, section.id),
            eq(studentEnrollments.academicYearId, yearId),
            inArray(studentEnrollments.enrollmentStatus, [
              "section_assigned",
              "active",
            ]),
          ),
        );
      const roster = new Set(rosterRows.map((r) => r.studentId));
      const stranger = input.entries.find((e) => !roster.has(e.studentId));
      if (stranger) {
        throw new Error(
          `Student ${stranger.studentId} is not enrolled in this section. Attendance can only be marked for the section's own roster.`,
        );
      }

      // Upsert the records. Duplicate studentIds in one submission collapse
      // (last entry wins) — two rows for one student/day/period are
      // unrepresentable anyway (the double-mark guard), and a batch insert
      // colliding with itself would be a self-inflicted CONFLICT.
      const entryByStudent = new Map(
        input.entries.map((e) => [e.studentId, e] as const),
      );
      const studentIds = [...entryByStudent.keys()];

      const existingRows = await tx
        .select({
          id: attendanceRecords.id,
          studentId: attendanceRecords.studentId,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.academicYearId, yearId),
            eq(attendanceRecords.date, input.date),
            inArray(attendanceRecords.studentId, studentIds),
            input.periodId
              ? eq(attendanceRecords.periodId, input.periodId)
              : isNull(attendanceRecords.periodId),
          ),
        );
      const existingByStudent = new Map(
        existingRows.map((r) => [r.studentId, r.id] as const),
      );

      const inserts: (typeof attendanceRecords.$inferInsert)[] = [];
      const updates: {
        id: string;
        status: (typeof attendanceRecords.$inferInsert)["status"];
        reason?: string;
      }[] = [];

      for (const [studentId, entry] of entryByStudent) {
        const existingId = existingByStudent.get(studentId);
        if (existingId) {
          updates.push({ id: existingId, status: entry.status, reason: entry.correctionReason });
        } else {
          inserts.push({
            organizationId,
            schoolId,
            studentId,
            academicYearId: yearId,
            date: input.date,
            // The snapshot — copied once, on insert, never updated.
            classId: section.classId,
            sectionId: section.id,
            periodId: input.periodId ?? null,
            status: entry.status,
            correctionReason: entry.correctionReason ?? null,
            markedBy: actorId,
          });
        }
      }

      if (inserts.length > 0) {
        await tx.insert(attendanceRecords).values(inserts);
      }
      for (const u of updates) {
        await tx
          .update(attendanceRecords)
          .set({
            status: u.status,
            updatedBy: actorId,
            // Don't-wipe: reason undefined = not sent = keep what is stored.
            ...(u.reason !== undefined ? { correctionReason: u.reason } : {}),
          })
          .where(eq(attendanceRecords.id, u.id));
      }

      // ---- the daily-status derivation, same transaction ----

      const derived = new Map<
        string,
        {
          status: (typeof attendanceRecords.$inferInsert)["status"];
          derivationMode: "direct" | "homeroom_authoritative" | "threshold_percentage";
          periodsPresent: number | null;
          periodsTotal: number | null;
        }
      >();

      if (markingMode === "daily") {
        // DIRECT: the single record IS the day.
        for (const [studentId, entry] of entryByStudent) {
          derived.set(studentId, {
            status: entry.status,
            derivationMode: "direct",
            periodsPresent: null,
            periodsTotal: null,
          });
        }
      } else {
        // A threshold weighs EVERY period of the day, not just the ones in
        // this submission — so re-read all of the day's records for the
        // touched students.
        const dayRecords = await tx
          .select({
            studentId: attendanceRecords.studentId,
            periodId: attendanceRecords.periodId,
            status: attendanceRecords.status,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.academicYearId, yearId),
              eq(attendanceRecords.date, input.date),
              inArray(attendanceRecords.studentId, studentIds),
            ),
          );

        const sectionPeriods = await tx
          .select({
            id: periods.id,
            isHomeroom: periods.isHomeroom,
            sequenceNumber: periods.sequenceNumber,
          })
          .from(periods)
          .where(
            and(
              eq(periods.sectionId, section.id),
              eq(periods.academicYearId, yearId),
            ),
          );
        const homeroom = sectionPeriods.find((p) => p.isHomeroom);
        const firstPeriod = sectionPeriods.length
          ? [...sectionPeriods].sort((a, b) => a.sequenceNumber - b.sequenceNumber)[0]
          : undefined;
        const threshold =
          policy?.dailyStatusRule === "threshold_percentage"
            ? policy?.thresholdPercentage
            : null;

        for (const studentId of studentIds) {
          const recs = dayRecords.filter((r) => r.studentId === studentId);

          if (threshold != null) {
            // THRESHOLD: present-like = present, late, half_day — statuses
            // meaning the child was there for some or all of it. At or above
            // the school's percentage, the day resolves to present.
            const total = recs.length;
            const presentLike = recs.filter(
              (r) => r.status === "present" || r.status === "late" || r.status === "half_day",
            ).length;
            const pct = total === 0 ? 0 : (presentLike / total) * 100;
            derived.set(studentId, {
              status: pct >= threshold ? "present" : "absent",
              derivationMode: "threshold_percentage",
              periodsPresent: presentLike,
              periodsTotal: total,
            });
          } else {
            // HOMEROOM-AUTHORITATIVE: the homeroom period's record decides;
            // with no homeroom period defined (or nothing marked for it), the
            // day's first period falls back to deciding.
            const authoritative = homeroom ?? firstPeriod;
            const deciding = authoritative
              ? recs.find((r) => r.periodId === authoritative.id)
              : undefined;
            derived.set(studentId, {
              status: deciding?.status ?? "absent",
              derivationMode: "homeroom_authoritative",
              periodsPresent: null,
              periodsTotal: null,
            });
          }
        }
      }

      // One answer per student per day. INSERT carries the snapshot; UPDATE
      // re-marks the answer only — the update path never touches class or
      // section, so history cannot be re-homed through a re-mark.
      for (const [studentId, s] of derived) {
        await tx
          .insert(dailyAttendanceStatus)
          .values({
            organizationId,
            schoolId,
            studentId,
            academicYearId: yearId,
            date: input.date,
            classId: section.classId,
            sectionId: section.id,
            status: s.status,
            periodsPresent: s.periodsPresent,
            periodsTotal: s.periodsTotal,
            derivationMode: s.derivationMode,
          })
          .onConflictDoUpdate({
            target: [
              dailyAttendanceStatus.studentId,
              dailyAttendanceStatus.academicYearId,
              dailyAttendanceStatus.date,
            ],
            set: {
              status: s.status,
              derivationMode: s.derivationMode,
              periodsPresent: s.periodsPresent,
              periodsTotal: s.periodsTotal,
              updatedAt: new Date(),
            },
          });
      }

      // Hard rule 5's read-model, kept in step inside the same transaction.
      await recomputeSummaries(tx, organizationId, schoolId, yearId, studentIds);

      return { marked: entryByStudent.size };
    });
  }

  /**
   * One section's day, from the authoritative layer — hard rule 5's only
   * read surface. Takes the PLURAL permissive scopes (ADR-017): ctx.scopes
   * is already clipped to the addressed subtree, and the status table
   * carries all four scope columns (the snapshot made them real), so this
   * filters WITHOUT widening — a section-scoped teacher gets exactly her
   * section's rows; addressing another section yields an empty list, never
   * the school's day.
   */
  async getDailyStatus(scopes: DataScope[], input: GetDailyStatusInput) {
    return db
      .select()
      .from(dailyAttendanceStatus)
      .where(
        and(
          eq(dailyAttendanceStatus.sectionId, input.sectionId),
          eq(dailyAttendanceStatus.date, input.date),
          scopeWhere(scopes, STATUS_SCOPE_COLUMNS),
        ),
      );
  }

  /**
   * Summary rows for a year — optionally one section's students or one
   * student. `attendance_summary` has NO class/section columns (it is
   * student-level), so the scope CANNOT filter it directly and widening
   * would hand a section teacher the whole school. The answer is the
   * atSchoolLevel docstring's own prescription: a JOIN, not a wider filter.
   * The scope applies to `student_enrollments` — which carries all four
   * columns — and the join pins each summary to its student's enrollment in
   * the SAME year, so a section teacher reads exactly her section's
   * students' summaries, named section or not.
   */
  async listSummaries(scopes: DataScope[], input: ListSummariesInput) {
    return db
      .select({ summary: attendanceSummary })
      .from(attendanceSummary)
      .innerJoin(
        studentEnrollments,
        and(
          eq(studentEnrollments.studentId, attendanceSummary.studentId),
          eq(studentEnrollments.academicYearId, attendanceSummary.academicYearId),
        ),
      )
      .where(
        and(
          eq(attendanceSummary.academicYearId, input.academicYearId),
          input.studentId
            ? eq(attendanceSummary.studentId, input.studentId)
            : undefined,
          input.sectionId
            ? eq(studentEnrollments.sectionId, input.sectionId)
            : undefined,
          scopeWhere(scopes, ENROLLMENT_SCOPE_COLUMNS),
        ),
      )
      .then((rows) => rows.map((r) => r.summary));
  }

  /**
   * The explicit summary recompute — the same internals the mark path runs,
   * covering EVERY month that has rows, every term, and the annual row for
   * the named students. The backfill op for corrections made outside
   * marking; the deferral note in the plan records that no automatic
   * scheduled backfill exists beyond this.
   */
  async recomputeSummary(
    scope: DataScope,
    academicYearId: string,
    studentIds: string[],
  ) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;

    // The year must be this school's, proven the same way every calendar
    // write proves it.
    await this.yearForCalendar(scope, academicYearId);

    return db.transaction((tx) =>
      recomputeSummaries(tx, organizationId, schoolId, academicYearId, studentIds),
    );
  }
}

// ---------------------------------------------------------------------------
// Summary recompute internals
// ---------------------------------------------------------------------------

/** The day types that count toward the working-days denominator. */
const WORKING_DAY_TYPES = new Set(["working", "exam_day", "half_day"]);

type SummaryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Recomputes the monthly, term, and annual summary rows for the given
 * students from daily status + the calendar. Called at the end of every
 * mark, INSIDE the mark's transaction (hard rule 5's read-model must not
 * drift from the status layer it summarizes), and by the explicit
 * `recomputeSummary` op for backfills.
 *
 * The working-days denominator is CALENDAR TRUTH — every working, exam, and
 * half day in the period, whether or not anyone was marked — never "days
 * someone happened to mark". No mid-period cap: a month half over shows its
 * full planned denominator, so a percentage can only rise as days fill in.
 * Counts come from `daily_attendance_status` (never records — hard rule 5);
 * a `half_day` status fills no count bucket, mirroring the reference's
 * columns.
 */
async function recomputeSummaries(
  tx: SummaryTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  studentIds: string[],
) {
  if (studentIds.length === 0) return;

  const calendarDays = await tx
    .select({ date: academicCalendar.date, dayType: academicCalendar.dayType })
    .from(academicCalendar)
    .where(
      and(
        eq(academicCalendar.schoolId, schoolId),
        eq(academicCalendar.academicYearId, academicYearId),
      ),
    );

  const statusRows = await tx
    .select({
      studentId: dailyAttendanceStatus.studentId,
      date: dailyAttendanceStatus.date,
      status: dailyAttendanceStatus.status,
    })
    .from(dailyAttendanceStatus)
    .where(
      and(
        eq(dailyAttendanceStatus.academicYearId, academicYearId),
        inArray(dailyAttendanceStatus.studentId, studentIds),
      ),
    );

  const yearTerms = await tx
    .select({ id: terms.id, startDate: terms.startDate, endDate: terms.endDate })
    .from(terms)
    .where(eq(terms.academicYearId, academicYearId));

  const rowsByStudent = new Map<string, typeof statusRows>();
  for (const row of statusRows) {
    const list = rowsByStudent.get(row.studentId);
    if (list) list.push(row);
    else rowsByStudent.set(row.studentId, [row]);
  }

  const countSlice = (rows: typeof statusRows, inRange: (iso: string) => boolean) => {
    const workingDays = calendarDays.filter(
      (c) => inRange(c.date) && WORKING_DAY_TYPES.has(c.dayType),
    ).length;
    return {
      workingDays,
      daysPresent: rows.filter((r) => r.status === "present").length,
      daysAbsent: rows.filter((r) => r.status === "absent").length,
      daysLate: rows.filter((r) => r.status === "late").length,
      daysOnLeave: rows.filter((r) => r.status === "on_leave").length,
    };
  };

  const countsSet = (c: ReturnType<typeof countSlice>) => ({
    workingDays: c.workingDays,
    daysPresent: c.daysPresent,
    daysAbsent: c.daysAbsent,
    daysLate: c.daysLate,
    daysOnLeave: c.daysOnLeave,
    updatedAt: new Date(),
  });

  for (const [studentId, rows] of rowsByStudent) {
    // MONTHLY — one row per calendar month the student has status rows in.
    // ISO dates sort lexicographically, so the "YYYY-MM" prefix is the month
    // test and no Date arithmetic is needed anywhere here.
    const months = new Set(rows.map((r) => r.date.slice(0, 7)));
    for (const ym of months) {
      const monthRows = rows.filter((r) => r.date.startsWith(ym));
      const counts = countSlice(monthRows, (iso) => iso.startsWith(ym));
      await tx
        .insert(attendanceSummary)
        .values({
          organizationId,
          schoolId,
          studentId,
          academicYearId,
          termId: null,
          periodType: "monthly",
          month: Number(ym.slice(5, 7)),
          year: Number(ym.slice(0, 4)),
          ...counts,
        })
        .onConflictDoUpdate({
          target: [
            attendanceSummary.studentId,
            attendanceSummary.academicYearId,
            attendanceSummary.month,
            attendanceSummary.year,
          ],
          targetWhere: sql`period_type = 'monthly'`,
          set: countsSet(counts),
        });
    }

    // ANNUAL — the year's one row.
    const annualCounts = countSlice(rows, () => true);
    await tx
      .insert(attendanceSummary)
      .values({
        organizationId,
        schoolId,
        studentId,
        academicYearId,
        termId: null,
        periodType: "annual",
        month: null,
        year: null,
        ...annualCounts,
      })
      .onConflictDoUpdate({
        target: [attendanceSummary.studentId, attendanceSummary.academicYearId],
        targetWhere: sql`period_type = 'annual'`,
        set: countsSet(annualCounts),
      });
  }

  // TERM — one row per term of the year, for every touched student. Recomputed
  // from the same source rows even when a term was not the one marked: the
  // summary is always a pure function of status + calendar, never an
  // increment, so recomputing more than needed is free of drift.
  for (const term of yearTerms) {
    for (const [studentId, rows] of rowsByStudent) {
      const termRows = rows.filter(
        (r) => r.date >= term.startDate && r.date <= term.endDate,
      );
      const counts = countSlice(
        termRows,
        (iso) => iso >= term.startDate && iso <= term.endDate,
      );
      await tx
        .insert(attendanceSummary)
        .values({
          organizationId,
          schoolId,
          studentId,
          academicYearId,
          termId: term.id,
          periodType: "term",
          month: null,
          year: null,
          ...counts,
        })
        .onConflictDoUpdate({
          target: [
            attendanceSummary.studentId,
            attendanceSummary.academicYearId,
            attendanceSummary.termId,
          ],
          targetWhere: sql`period_type = 'term'`,
          set: countsSet(counts),
        });
    }
  }
}

export const attendanceService = new AttendanceService();

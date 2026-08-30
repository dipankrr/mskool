import { atSchoolLevel, requireSchoolId, yearVisibilityWhere } from "./academic.service";
import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  GenerateCalendarInput,
  ListCalendarInput,
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
  periods,
  sections,
  subjects,
} from "@repo/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

/**
 * ATTENDANCE — Phase 3, configuration layer (C2): the calendar, the marking
 * policy, and the periods. The marking flow (C5) appends to this class.
 *
 * Knows nothing about HTTP. Every read takes a DataScope as a REQUIRED
 * argument and filters by it (hard rule 1); input types come from
 * `@repo/contracts`.
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
 *     assignment layer's pattern exactly: the scope filters org+school and the
 *     section is narrowed by the addressed `sectionId`, with the parent
 *     re-read through the section's OWN table proving the section belongs to
 *     this school.
 *
 * **Parent verification (the section-service pattern).** The
 * `academic_years` FK is precisely the one that does not mention `school_id`,
 * so every calendar write re-reads the parent year through the caller's scope
 * INSIDE the transaction before inserting. A calendar row pointing at another
 * school's year would be a cross-tenant lie every later read trusts.
 *
 * Scope columns are per-TABLE (the S2.4 lesson): `scopeWhere` compiles the
 * columns it is handed into that query's SQL, so a column set borrowed from
 * another table is a runtime "missing FROM-clause entry" error `tsc` cannot
 * see. Each parent table gets its own column set, as in assignment.service.ts.
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
}

export const attendanceService = new AttendanceService();

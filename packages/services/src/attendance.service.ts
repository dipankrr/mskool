import { atSchoolLevel, requireSchoolId, yearVisibilityWhere } from "./academic.service";
import { refuse } from "./service-error";
import { scopeWhere, type DataScope } from "@repo/authz";
import type {
  CalendarUsageInput,
  ChangePatternInput,
  RemovePatternRangeInput,
  CalendarYearInput,
  SessionDatesPreviewInput,
  SetCalendarDaysInput,
  SetupCalendarInput,
  WeekPattern,
  GenerateCalendarInput,
  GetDailyStatusInput,
  GetStatusHistoryInput,
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
  attendanceWeekPatterns,
  classes,
  dailyAttendanceStatus,
  periods,
  sections,
  studentEnrollments,
  subjects,
  terms,
} from "@repo/db/schema";
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { countAttendance, monthBounds } from "./attendance-counting";
import {
  SCHOOL_DAY_TYPES,
  applyRange,
  fitToSession,
  removeRange,
  weekAt,
  type WeekRange,
  datesBetween,
  isFixedDate,
  patternDayType,
  patternFromWeekdays,
  sessionDateDiff,
  shiftYears,
  type PatternDay,
} from "./calendar-tools";
import { loadCountingInputs } from "./attendance-to-date";
import { todayInIst } from "./enrollment-status";

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
   * to its end: `working` on the named weekdays (`half_day` on the subset
   * the school names — the every-Saturday-half-day shape), `weekend` on the
   * rest.
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
    // A half-day weekday must be a working weekday too (the contract's
    // refine); a set makes the per-date check one lookup.
    const halfDay = new Set(input.halfDayWeekdays ?? []);

    // Walk the year in UTC. A calendar date has no zone; parsing with an
    // explicit T00:00:00Z and reading only UTC getters keeps the host's
    // timezone out of the arithmetic entirely.
    const rows: {
      organizationId: string;
      schoolId: string;
      academicYearId: string;
      date: string;
      dayType: "working" | "weekend" | "half_day";
      createdFromTemplate: boolean;
      createdBy: string | null;
    }[] = [];
    // ISO dates compare as strings. A start outside the session is the caller's
    // mistake, not a date to quietly move.
    if (
      input.startFrom &&
      (input.startFrom < year.startDate || input.startFrom > year.endDate)
    ) {
      throw refuse("BAD_REQUEST", "Pick a start date inside this session.");
    }
    const cursor = new Date(`${input.startFrom ?? year.startDate}T00:00:00Z`);
    const end = new Date(`${year.endDate}T00:00:00Z`);
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      const weekday = cursor.getUTCDay();
      const dayType = working.has(weekday)
        ? halfDay.has(weekday)
          ? "half_day"
          : "working"
        : "weekend";
      rows.push({
        organizationId,
        schoolId,
        academicYearId: year.id,
        date: iso,
        dayType,
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
      await saveWeekPattern(
        tx,
        organizationId,
        schoolId,
        year,
        patternFromWeekdays(input.workingWeekdays, input.halfDayWeekdays ?? []),
        actorId,
      );
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
      if (inserted.length > 0) await recomputeMarkedInYear(tx, organizationId, schoolId, year.id);
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
      await recomputeMarkedInYear(tx, organizationId, schoolId, year.id, [input.date]);
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
  // Calendar set-up and editing (ADR-069)
  // -------------------------------------------------------------------------

  /**
   * One session's calendar at a glance: the saved normal week, the totals by
   * day type, and the dates inside the session that have no entry (from the
   * first entry on, so a school that joined mid-session is not flagged for
   * the days before it). An empty calendar has no entries and no gaps.
   */
  async calendarOverview(scopes: DataScope[], input: CalendarYearInput, includeHistory: boolean) {
    const [year] = await db
      .select({ id: academicYears.id, startDate: academicYears.startDate, endDate: academicYears.endDate })
      .from(academicYears)
      .where(
        and(
          eq(academicYears.id, input.academicYearId),
          scopeWhere(scopes.map(atSchoolLevel), YEAR_SCOPE_COLUMNS),
          yearVisibilityWhere(includeHistory),
        ),
      );
    if (!year) throw refuse("NOT_FOUND", "Session not found.");

    const rows = await db
      .select({ date: academicCalendar.date, dayType: academicCalendar.dayType })
      .from(academicCalendar)
      .where(
        and(
          eq(academicCalendar.academicYearId, year.id),
          scopeWhere(scopes.map(atSchoolLevel), CALENDAR_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(academicCalendar.date));
    const ranges = (
      await db
        .select({
          from: attendanceWeekPatterns.fromDate,
          to: attendanceWeekPatterns.toDate,
          weekdays: attendanceWeekPatterns.weekdays,
        })
        .from(attendanceWeekPatterns)
        .where(
          and(
            eq(attendanceWeekPatterns.academicYearId, year.id),
            scopeWhere(scopes.map(atSchoolLevel), {
              organizationId: attendanceWeekPatterns.organizationId,
              schoolId: attendanceWeekPatterns.schoolId,
            }),
          ),
        )
        .orderBy(asc(attendanceWeekPatterns.fromDate))
    ).map((row) => ({ ...row, weekdays: row.weekdays as PatternDay[] }));

    const counts = { working: 0, half_day: 0, exam_day: 0, holiday: 0, weekend: 0 };
    const inSession = rows.filter((row) => row.date >= year.startDate && row.date <= year.endDate);
    for (const row of inSession) counts[row.dayType] += 1;
    const have = new Set(inSession.map((row) => row.date));
    const first = inSession[0]?.date ?? null;
    const missing = first ? datesBetween(first, year.endDate).filter((iso) => !have.has(iso)) : [];

    return {
      startDate: year.startDate,
      endDate: year.endDate,
      // The week in force today (or at the session's edge), and every range.
      weekdays: weekAt(ranges, todayInIst()),
      ranges,
      entries: inSession.length,
      counts,
      schoolDays: counts.working + counts.half_day + counts.exam_day,
      missing,
    };
  }

  /**
   * The guided set-up in one transaction: save the normal week, fill every
   * missing date from it (from `startFrom` when the school joins mid-session),
   * then lay the holidays and exam days on top.
   */
  async setupCalendar(scope: DataScope, input: SetupCalendarInput, actorId: string | null) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    if (input.startFrom && (input.startFrom < year.startDate || input.startFrom > year.endDate)) {
      throw refuse("BAD_REQUEST", "Pick a start date inside this session.");
    }
    const entryDates = new Map<string, { dayType: SetCalendarDaysInput["dayType"]; reason: string | null }>();
    for (const entry of input.entries) {
      if (entry.from < year.startDate || entry.to > year.endDate) {
        throw refuse("BAD_REQUEST", `"${entry.reason ?? entry.from}" falls outside this session (${year.startDate} to ${year.endDate}).`);
      }
      for (const iso of datesBetween(entry.from, entry.to)) {
        entryDates.set(iso, { dayType: entry.dayType, reason: entry.reason ?? null });
      }
    }

    return db.transaction(async (tx) => {
      await saveWeekPattern(tx, organizationId, schoolId, year, input.weekdays, actorId);
      const generated = await fillFromPattern(
        tx,
        organizationId,
        schoolId,
        year.id,
        () => input.weekdays,
        datesBetween(input.startFrom ?? year.startDate, year.endDate),
        actorId,
      );
      const set = await writeDays(
        tx,
        organizationId,
        schoolId,
        year.id,
        [...entryDates].map(([date, v]) => ({ date, ...v })),
        actorId,
      );
      await recomputeMarkedInYear(tx, organizationId, schoolId, year.id);
      return { generated, set };
    });
  }

  /**
   * Several dates set to one type and name at once — a multi-select or a
   * from–to range. Every date must sit inside the session. Saved marks on
   * those dates stay; summaries are re-counted so a day that stops being a
   * school day stops counting (ADR-069).
   */
  async setCalendarDays(scope: DataScope, input: SetCalendarDaysInput, actorId: string | null) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const dates = [...new Set(input.dates)].sort();
    const outside = dates.filter((iso) => iso < year.startDate || iso > year.endDate);
    if (outside.length > 0) {
      throw refuse("BAD_REQUEST", `${outside[0]} is outside this session (${year.startDate} to ${year.endDate}).`);
    }
    return db.transaction(async (tx) => {
      const set = await writeDays(
        tx,
        organizationId,
        schoolId,
        year.id,
        dates.map((date) => ({ date, dayType: input.dayType, reason: input.reason ?? null })),
        actorId,
      );
      await recomputeMarkedInYear(tx, organizationId, schoolId, year.id, dates);
      return { set };
    });
  }

  /**
   * A new week structure over [from, to] (to = end of session when left
   * out). It is cut into the session's ranges; days in it that still follow
   * the week (no name, a working / half-day / off type) take the new type.
   * Named entries keep theirs; days with attendance are left and counted as
   * skipped. `dryRun` reports without writing.
   */
  async changeWeekPattern(scope: DataScope, input: ChangePatternInput, actorId: string | null) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const to = input.to ?? year.endDate;
    if (input.from < year.startDate || to > year.endDate || input.from > to) {
      throw refuse("BAD_REQUEST", "Pick dates inside this session, the end on or after the start.");
    }
    const schoolId = requireSchoolId(scope);
    const ranges = await loadRanges(db, schoolId, year.id);
    const next = fitToSession(
      applyRange(ranges, { from: input.from, to, weekdays: [...input.weekdays] }),
      year.startDate,
      year.endDate,
    );
    return this.restyleWeek(scope, year, next, input.from, to, input.dryRun ?? false, actorId);
  }

  /** Removes the structure starting on `from`; its days go back to the one before it. */
  async removeWeekRange(scope: DataScope, input: RemovePatternRangeInput, actorId: string | null) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const ranges = await loadRanges(db, schoolId, year.id);
    const index = ranges.findIndex((range) => range.from === input.from);
    if (index < 0) throw refuse("NOT_FOUND", "That week structure is not in this session.");
    if (ranges.length < 2) throw refuse("BAD_REQUEST", "A session always keeps one week structure.");
    const gone = ranges[index]!;
    const next = fitToSession(removeRange(ranges, index), year.startDate, year.endDate);
    return this.restyleWeek(scope, year, next, gone.from, gone.to, input.dryRun ?? false, actorId);
  }

  /** Saves new ranges and re-types the days in [from, to] that follow the week. */
  private async restyleWeek(
    scope: DataScope,
    year: { id: string; startDate: string; endDate: string },
    next: WeekRange[],
    from: string,
    to: string,
    dryRun: boolean,
    actorId: string | null,
  ) {
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const rows = await db
      .select({ date: academicCalendar.date, dayType: academicCalendar.dayType, reason: academicCalendar.reason })
      .from(academicCalendar)
      .where(
        and(
          eq(academicCalendar.schoolId, schoolId),
          eq(academicCalendar.academicYearId, year.id),
          gte(academicCalendar.date, from),
          lte(academicCalendar.date, to),
        ),
      );
    const marked = new Set(
      (
        await db
          .selectDistinct({ date: dailyAttendanceStatus.date })
          .from(dailyAttendanceStatus)
          .where(
            and(
              eq(dailyAttendanceStatus.schoolId, schoolId),
              eq(dailyAttendanceStatus.academicYearId, year.id),
              gte(dailyAttendanceStatus.date, from),
              lte(dailyAttendanceStatus.date, to),
            ),
          )
      ).map((m) => m.date),
    );
    const follows = (row: { dayType: string; reason: string | null }) =>
      row.reason === null && (row.dayType === "working" || row.dayType === "half_day" || row.dayType === "weekend");
    const changes: { date: string; dayType: PatternDay; was: string }[] = [];
    let skipped = 0;
    for (const row of rows) {
      if (!follows(row)) continue;
      const week = weekAt(next, row.date);
      if (!week) continue;
      const type = patternDayType(week, row.date);
      if (type === row.dayType) continue;
      if (marked.has(row.date)) {
        skipped += 1;
        continue;
      }
      changes.push({ date: row.date, dayType: type, was: row.dayType });
    }
    const schoolDelta = changes.reduce(
      (n, c) => n + (SCHOOL_DAY_TYPES.has(c.dayType) ? 1 : 0) - (SCHOOL_DAY_TYPES.has(c.was) ? 1 : 0),
      0,
    );
    if (dryRun) return { changed: changes.length, skipped, schoolDelta };

    return db.transaction(async (tx) => {
      await saveRanges(tx, organizationId, schoolId, year.id, next, actorId);
      if (changes.length > 0) {
        await writeDays(
          tx,
          organizationId,
          schoolId,
          year.id,
          changes.map((c) => ({ date: c.date, dayType: c.dayType, reason: null })),
          actorId,
        );
        await recomputeMarkedInYear(tx, organizationId, schoolId, year.id, changes.map((c) => c.date));
      }
      return { changed: changes.length, skipped, schoolDelta };
    });
  }

  /** Fills the session's missing dates from its saved normal week. */
  async fillCalendarGaps(scope: DataScope, input: CalendarYearInput, actorId: string | null) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const ranges = await loadRanges(db, schoolId, year.id);
    if (ranges.length === 0) {
      throw refuse("BAD_REQUEST", "This session has no week structure yet. Set up the calendar first.");
    }
    return db.transaction(async (tx) => {
      const generated = await fillFromPattern(
        tx,
        organizationId,
        schoolId,
        year.id,
        (iso) => weekAt(ranges, iso)!,
        datesBetween(year.startDate, year.endDate),
        actorId,
      );
      if (generated > 0) await recomputeMarkedInYear(tx, organizationId, schoolId, year.id);
      return { generated };
    });
  }

  /**
   * Which sections already have attendance on these dates, with how many
   * students — what an admin sees before changing such a day.
   */
  async calendarUsage(scopes: DataScope[], input: CalendarUsageInput) {
    const rows = await db
      .select({
        date: dailyAttendanceStatus.date,
        sectionId: dailyAttendanceStatus.sectionId,
        sectionName: sections.name,
        className: classes.name,
        students: sql<number>`count(*)::int`,
      })
      .from(dailyAttendanceStatus)
      .innerJoin(sections, eq(sections.id, dailyAttendanceStatus.sectionId))
      .innerJoin(classes, eq(classes.id, dailyAttendanceStatus.classId))
      .where(
        and(
          eq(dailyAttendanceStatus.academicYearId, input.academicYearId),
          inArray(dailyAttendanceStatus.date, [...new Set(input.dates)]),
          scopeWhere(scopes.map(atSchoolLevel), STATUS_SCOPE_COLUMNS),
        ),
      )
      .groupBy(
        dailyAttendanceStatus.date,
        dailyAttendanceStatus.sectionId,
        sections.name,
        classes.name,
      )
      .orderBy(asc(dailyAttendanceStatus.date), asc(classes.name), asc(sections.name));
    return rows.map((row) => ({
      date: row.date,
      sectionId: row.sectionId,
      label: `${row.className} · ${row.sectionName}`,
      students: row.students,
    }));
  }

  /**
   * Last session's holidays, exam days and named half days, moved into this
   * session by whole years — the set-up's "copy last session" draft. Dates
   * that are not fixed national ones (festivals) come back flagged to check.
   */
  async previousSessionEntries(scope: DataScope, input: CalendarYearInput) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    const [previous] = await db
      .select({ id: academicYears.id, startDate: academicYears.startDate })
      .from(academicYears)
      .where(and(eq(academicYears.schoolId, schoolId), sql`${academicYears.endDate} < ${year.startDate}`))
      .orderBy(sql`${academicYears.startDate} desc`)
      .limit(1);
    if (!previous) return { from: null, entries: [] };
    const shift = Number(year.startDate.slice(0, 4)) - Number(previous.startDate.slice(0, 4));
    const rows = await db
      .select({ date: academicCalendar.date, dayType: academicCalendar.dayType, reason: academicCalendar.reason })
      .from(academicCalendar)
      .where(
        and(
          eq(academicCalendar.schoolId, schoolId),
          eq(academicCalendar.academicYearId, previous.id),
          or(
            inArray(academicCalendar.dayType, ["holiday", "exam_day"]),
            and(eq(academicCalendar.dayType, "half_day"), sql`${academicCalendar.reason} is not null`),
          ),
        ),
      )
      .orderBy(asc(academicCalendar.date));
    const entries = rows
      .map((row) => ({
        date: shiftYears(row.date, shift),
        dayType: row.dayType,
        reason: row.reason,
        check: !isFixedDate(row.date),
      }))
      .filter((row) => row.date >= year.startDate && row.date <= year.endDate);
    return { from: previous.id, entries };
  }

  /**
   * What new session dates would do to the calendar, before saving (C1/C2):
   * days added (and how many become school days from the saved week), days
   * removed, and the removed days that already have attendance — those block
   * the change.
   */
  async previewSessionDates(scope: DataScope, input: SessionDatesPreviewInput) {
    const year = await this.yearForCalendar(scope, input.academicYearId);
    const schoolId = requireSchoolId(scope);
    return sessionChange(db, schoolId, year, input);
  }

  /**
   * Keeps the calendar in step after the session's dates changed: new days
   * are filled from the saved week (when the calendar was set up), days now
   * outside the session lose their entries. The caller has already refused a
   * change that would drop days with attendance.
   */
  async syncCalendarToSession(
    scope: DataScope,
    before: { id: string; startDate: string; endDate: string },
    actorId: string | null,
  ) {
    const year = await this.yearForCalendar(scope, before.id);
    const schoolId = requireSchoolId(scope);
    const organizationId = scope.organizationId;
    const { added, removed } = sessionDateDiff(before, year);
    if (added.length === 0 && removed.length === 0) return { added: 0, removed: 0 };
    return db.transaction(async (tx) => {
      const stored = await loadRanges(tx, schoolId, year.id);
      const ranges = stored.length > 0 ? fitToSession(stored, year.startDate, year.endDate) : [];
      if (ranges.length > 0) await saveRanges(tx, organizationId, schoolId, year.id, ranges, actorId);
      const [anyRow] = await tx
        .select({ id: academicCalendar.id })
        .from(academicCalendar)
        .where(and(eq(academicCalendar.schoolId, schoolId), eq(academicCalendar.academicYearId, year.id)))
        .limit(1);
      let filled = 0;
      if (ranges.length > 0 && anyRow && added.length > 0) {
        filled = await fillFromPattern(tx, organizationId, schoolId, year.id, (iso) => weekAt(ranges, iso)!, added, actorId);
      }
      let dropped = 0;
      if (removed.length > 0) {
        const gone = await tx
          .delete(academicCalendar)
          .where(
            and(
              eq(academicCalendar.schoolId, schoolId),
              eq(academicCalendar.academicYearId, year.id),
              or(sql`${academicCalendar.date} < ${year.startDate}`, sql`${academicCalendar.date} > ${year.endDate}`),
            ),
          )
          .returning({ id: academicCalendar.id });
        dropped = gone.length;
      }
      if (filled > 0 || dropped > 0) await recomputeMarkedInYear(tx, organizationId, schoolId, year.id);
      return { added: filled, removed: dropped };
    });
  }

  /** The year as stored, for a caller about to change its dates. */
  async yearBounds(scope: DataScope, academicYearId: string) {
    return this.yearForCalendar(scope, academicYearId);
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
      const [before] = await tx
        .select({ lateCountsAsPresent: attendancePolicies.lateCountsAsPresent })
        .from(attendancePolicies)
        .where(eq(attendancePolicies.schoolId, schoolId));
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
      // ADR-061: the late rule decides the percentage, so a change re-counts
      // the CURRENT session's summaries in the same transaction. Closed
      // sessions keep the figures they were run with.
      const wasLatePresent = before?.lateCountsAsPresent ?? true;
      if (policy.lateCountsAsPresent !== wasLatePresent) {
        await recomputeCurrentSession(tx, organizationId, schoolId);
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

      // The session's own dates (ADR-069): a calendar row left outside them
      // must not let a mark through.
      const [bounds] = await tx
        .select({ startDate: academicYears.startDate, endDate: academicYears.endDate })
        .from(academicYears)
        .where(eq(academicYears.id, yearId));
      if (bounds && (input.date < bounds.startDate || input.date > bounds.endDate)) {
        throw new Error(
          `${input.date} is outside this session (${bounds.startDate} to ${bounds.endDate}). Attendance can only be marked inside the session.`,
        );
      }

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

      // The roster check: entries must name students enrolled in THIS section
      // and still at the school on this date. Someone who left later can still
      // have an earlier day marked or corrected.
      const rosterRows = await tx
        .select({ studentId: studentEnrollments.studentId })
        .from(studentEnrollments)
        .where(
          and(
            eq(studentEnrollments.sectionId, section.id),
            eq(studentEnrollments.academicYearId, yearId),
            or(
              inArray(studentEnrollments.enrollmentStatus, ["studying", "completed"]),
              gt(studentEnrollments.leftOn, input.date),
            ),
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
      if (updates.length > 0) {
        // One statement for every re-marked row. Don't-wipe: a reason not
        // sent arrives as NULL and COALESCE keeps what is stored.
        const rows = sql.join(
          updates.map(
            (u) =>
              sql`(${u.id}::uuid, ${u.status}::attendance_status, ${u.reason ?? null}::varchar)`,
          ),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE ${attendanceRecords}
          SET status = v.status,
              updated_by = ${actorId},
              correction_reason = COALESCE(v.reason, ${attendanceRecords.correctionReason}),
              updated_at = now()
          FROM (VALUES ${rows}) AS v(id, status, reason)
          WHERE ${attendanceRecords.id} = v.id`);
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
      // One multi-row statement for the whole register.
      if (derived.size > 0) {
        await tx
          .insert(dailyAttendanceStatus)
          .values(
            [...derived].map(([studentId, s]) => ({
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
            })),
          )
          .onConflictDoUpdate({
            target: [
              dailyAttendanceStatus.studentId,
              dailyAttendanceStatus.academicYearId,
              dailyAttendanceStatus.date,
            ],
            set: {
              status: sql`excluded.status`,
              derivationMode: sql`excluded.derivation_mode`,
              periodsPresent: sql`excluded.periods_present`,
              periodsTotal: sql`excluded.periods_total`,
              updatedAt: new Date(),
            },
          });
      }

      // Hard rule 5's read-model, kept in step inside the same transaction.
      // Only this date's month, its term and the year can have moved.
      await recomputeSummaries(tx, organizationId, schoolId, yearId, studentIds, [input.date]);

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
   * A section's status rows across a bounded date range — the recent-register
   * strip on Mark. Same authoritative layer and the same no-widening scope
   * rule as `getDailyStatus`; the contract caps the window so this cannot
   * turn into an unbounded reporting query. Ascending by date keeps the
   * client's "last five marked days" fold deterministic.
   */
  async getStatusHistory(scopes: DataScope[], input: GetStatusHistoryInput) {
    return db
      .select()
      .from(dailyAttendanceStatus)
      .where(
        and(
          eq(dailyAttendanceStatus.sectionId, input.sectionId),
          gte(dailyAttendanceStatus.date, input.fromDate),
          lte(dailyAttendanceStatus.date, input.toDate),
          scopeWhere(scopes, STATUS_SCOPE_COLUMNS),
        ),
      )
      .orderBy(asc(dailyAttendanceStatus.date), asc(dailyAttendanceStatus.studentId));
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
// Calendar write internals (ADR-069)
// ---------------------------------------------------------------------------

type CalendarTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type RangeReader = Pick<typeof db, "select">;

/** The session's week structures, oldest first. */
async function loadRanges(reader: RangeReader, schoolId: string, academicYearId: string): Promise<WeekRange[]> {
  const rows = await reader
    .select({
      from: attendanceWeekPatterns.fromDate,
      to: attendanceWeekPatterns.toDate,
      weekdays: attendanceWeekPatterns.weekdays,
    })
    .from(attendanceWeekPatterns)
    .where(and(eq(attendanceWeekPatterns.schoolId, schoolId), eq(attendanceWeekPatterns.academicYearId, academicYearId)))
    .orderBy(asc(attendanceWeekPatterns.fromDate));
  return rows.map((row) => ({ ...row, weekdays: row.weekdays as PatternDay[] }));
}

/** Replaces the session's week structures. No history is kept (owner). */
async function saveRanges(
  tx: CalendarTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  ranges: readonly WeekRange[],
  actorId: string | null,
) {
  await tx
    .delete(attendanceWeekPatterns)
    .where(and(eq(attendanceWeekPatterns.schoolId, schoolId), eq(attendanceWeekPatterns.academicYearId, academicYearId)));
  if (ranges.length === 0) return;
  await tx.insert(attendanceWeekPatterns).values(
    ranges.map((range) => ({
      organizationId,
      schoolId,
      academicYearId,
      fromDate: range.from,
      toDate: range.to,
      weekdays: [...range.weekdays],
      updatedBy: actorId,
    })),
  );
}

/** One week structure for the whole session (generator, set-up). */
async function saveWeekPattern(
  tx: CalendarTx,
  organizationId: string,
  schoolId: string,
  year: { id: string; startDate: string; endDate: string },
  weekdays: WeekPattern | PatternDay[],
  actorId: string | null,
) {
  await saveRanges(
    tx,
    organizationId,
    schoolId,
    year.id,
    [{ from: year.startDate, to: year.endDate, weekdays: [...weekdays] }],
    actorId,
  );
}

/** Inserts the pattern's type for each date that has no row yet. */
async function fillFromPattern(
  tx: CalendarTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  weekFor: (iso: string) => readonly PatternDay[],
  dates: readonly string[],
  actorId: string | null,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < dates.length; i += 400) {
    const chunk = dates.slice(i, i + 400);
    const rows = await tx
      .insert(academicCalendar)
      .values(
        chunk.map((date) => ({
          organizationId,
          schoolId,
          academicYearId,
          date,
          dayType: patternDayType(weekFor(date), date),
          createdFromTemplate: true,
          createdBy: actorId,
        })),
      )
      .onConflictDoNothing({
        target: [academicCalendar.schoolId, academicCalendar.academicYearId, academicCalendar.date],
      })
      .returning({ id: academicCalendar.id });
    inserted += rows.length;
  }
  return inserted;
}

/** Creates or overwrites one row per date with its type and name. */
async function writeDays(
  tx: CalendarTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  days: readonly { date: string; dayType: SetCalendarDaysInput["dayType"]; reason: string | null }[],
  actorId: string | null,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < days.length; i += 400) {
    const chunk = days.slice(i, i + 400);
    const rows = await tx
      .insert(academicCalendar)
      .values(
        chunk.map((day) => ({
          organizationId,
          schoolId,
          academicYearId,
          date: day.date,
          dayType: day.dayType,
          reason: day.reason,
          createdFromTemplate: false,
          createdBy: actorId,
        })),
      )
      .onConflictDoUpdate({
        target: [academicCalendar.schoolId, academicCalendar.academicYearId, academicCalendar.date],
        set: { dayType: sql`excluded.day_type`, reason: sql`excluded.reason` },
      })
      .returning({ id: academicCalendar.id });
    written += rows.length;
  }
  return written;
}

type SessionReader = Pick<typeof db, "select">;

/** The preview behind C1/C2 (and the refusal in the session update). */
export async function sessionChange(
  reader: SessionReader,
  schoolId: string,
  year: { id: string; startDate: string; endDate: string },
  next: { startDate: string; endDate: string },
) {
  const { added, removed } = sessionDateDiff(year, next);
  const stored = await loadRanges(reader, schoolId, year.id);
  const fitted = stored.length > 0 ? fitToSession(stored, next.startDate, next.endDate) : [];
  const rows = await reader
    .select({ date: academicCalendar.date, dayType: academicCalendar.dayType })
    .from(academicCalendar)
    .where(and(eq(academicCalendar.schoolId, schoolId), eq(academicCalendar.academicYearId, year.id)));
  const typeOf = new Map(rows.map((row) => [row.date, row.dayType]));
  const isSchool = (t: string | undefined) => (t ? SCHOOL_DAY_TYPES.has(t) : false);
  const weekdays = weekAt(stored, year.startDate);
  const hasCalendar = rows.length > 0;

  const schoolDaysBefore = rows.filter(
    (row) => row.date >= year.startDate && row.date <= year.endDate && isSchool(row.dayType),
  ).length;
  const addedSchoolDays =
    weekdays && hasCalendar
      ? added.filter((iso) => isSchool(typeOf.get(iso) ?? patternDayType(weekAt(fitted, iso)!, iso))).length
      : 0;
  const removedSchoolDays = removed.filter((iso) => isSchool(typeOf.get(iso))).length;

  let blocked: { date: string; sections: number }[] = [];
  if (removed.length > 0) {
    const marks = await reader
      .select({
        date: dailyAttendanceStatus.date,
        sections: sql<number>`count(distinct ${dailyAttendanceStatus.sectionId})::int`,
      })
      .from(dailyAttendanceStatus)
      .where(
        and(
          eq(dailyAttendanceStatus.schoolId, schoolId),
          eq(dailyAttendanceStatus.academicYearId, year.id),
          inArray(dailyAttendanceStatus.date, removed),
        ),
      )
      .groupBy(dailyAttendanceStatus.date)
      .orderBy(asc(dailyAttendanceStatus.date));
    blocked = marks;
  }

  return {
    hasCalendar,
    weekdays,
    added: added.length,
    addedFrom: added[0] ?? null,
    addedTo: added[added.length - 1] ?? null,
    addedSchoolDays,
    removed: removed.length,
    removedFrom: removed[0] ?? null,
    removedTo: removed[removed.length - 1] ?? null,
    removedSchoolDays,
    blocked,
    schoolDaysBefore,
    schoolDaysAfter: schoolDaysBefore + addedSchoolDays - removedSchoolDays,
  };
}

/**
 * Re-counts everyone with a mark in this session — after a calendar change
 * moves the working-days count under them. `touchedDates` narrows it to the
 * months and terms those dates fall in.
 */
async function recomputeMarkedInYear(
  tx: SummaryTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  touchedDates?: readonly string[],
) {
  const marked = await tx
    .selectDistinct({ studentId: dailyAttendanceStatus.studentId })
    .from(dailyAttendanceStatus)
    .where(and(eq(dailyAttendanceStatus.schoolId, schoolId), eq(dailyAttendanceStatus.academicYearId, academicYearId)));
  const ids = marked.map((m) => m.studentId);
  for (let i = 0; i < ids.length; i += SESSION_BATCH) {
    await recomputeSummaries(tx, organizationId, schoolId, academicYearId, ids.slice(i, i + SESSION_BATCH), touchedDates);
  }
}

// ---------------------------------------------------------------------------
// Summary recompute internals
// ---------------------------------------------------------------------------

type SummaryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Students per recompute pass when a whole session is re-counted. */
const SESSION_BATCH = 300;

/**
 * Re-counts every summary of one school's current session: everyone with a
 * mark in it. Used when the late rule changes and by the one-time ADR-061
 * backfill. Returns how many students were re-counted (0 without a current
 * session).
 */
export async function recomputeCurrentSession(
  tx: SummaryTx,
  organizationId: string,
  schoolId: string,
): Promise<number> {
  const [year] = await tx
    .select({ id: academicYears.id })
    .from(academicYears)
    .where(and(eq(academicYears.schoolId, schoolId), eq(academicYears.isCurrent, true)));
  if (!year) return 0;
  const marked = await tx
    .selectDistinct({ studentId: dailyAttendanceStatus.studentId })
    .from(dailyAttendanceStatus)
    .where(
      and(
        eq(dailyAttendanceStatus.schoolId, schoolId),
        eq(dailyAttendanceStatus.academicYearId, year.id),
      ),
    );
  const ids = marked.map((m) => m.studentId);
  for (let i = 0; i < ids.length; i += SESSION_BATCH) {
    await recomputeSummaries(
      tx,
      organizationId,
      schoolId,
      year.id,
      ids.slice(i, i + SESSION_BATCH),
    );
  }
  return ids.length;
}

/** Rows per multi-row upsert: well under Postgres's bind-parameter limit. */
const SUMMARY_CHUNK = 400;

/**
 * Recomputes the monthly, term, and annual summary rows for the given
 * students from daily status + the calendar (ADR-061). Called at the end of
 * every mark, INSIDE the mark's transaction (hard rule 5's read-model must
 * not drift from the status layer it summarizes), by the explicit
 * `recomputeSummary` op, and when the school's late rule changes.
 *
 * The working-days denominator is CALENDAR TRUTH over the whole period —
 * every working, exam, and half day, whether or not anyone was marked — but
 * only the days the student was on the books (`attendance-counting.ts`). No
 * mid-period cap: this row is the "how much of the period is done" view; the
 * "so far" figure is `attendanceToDate`. Half day has its own bucket and is
 * never attended; late is attended when the school's policy says so.
 *
 * `touchedDates` narrows the work to what a save can change: those dates'
 * months, the terms containing them, and the year. Without it, every month
 * the student has marks in and every term.
 *
 * Every write is a multi-row upsert, a handful of statements whatever the
 * number of students (a one-row-at-a-time loop made a 15-student save take
 * 24 s on the remote database).
 */
async function recomputeSummaries(
  tx: SummaryTx,
  organizationId: string,
  schoolId: string,
  academicYearId: string,
  studentIds: string[],
  touchedDates?: readonly string[],
) {
  if (studentIds.length === 0) return;

  // One statement: calendar, late rule, year, terms, enrolments, statuses.
  const inputs = await loadCountingInputs(tx, { schoolId, academicYearId, studentIds });
  const year = inputs.year;
  const yearTerms = inputs.terms;
  if (!year) return;

  const touchedMonths = touchedDates ? new Set(touchedDates.map((d) => d.slice(0, 7))) : null;
  const termsToWrite = touchedDates
    ? yearTerms.filter((t) => touchedDates.some((d) => d >= t.startDate && d <= t.endDate))
    : yearTerms;

  const now = new Date();
  const base = { organizationId, schoolId, academicYearId };
  const monthly: (typeof attendanceSummary.$inferInsert)[] = [];
  const termRows: (typeof attendanceSummary.$inferInsert)[] = [];
  const annual: (typeof attendanceSummary.$inferInsert)[] = [];

  for (const studentId of new Set(studentIds)) {
    const statuses = inputs.statusesByStudent.get(studentId) ?? [];
    // A student with no marks this year has no rows (unchanged behaviour).
    if (statuses.length === 0) continue;
    const ranges = inputs.rangesByStudent.get(studentId) ?? [];
    const count = (from: string, to: string) =>
      countAttendance({
        workingDates: inputs.workingDates,
        statuses,
        ranges,
        from,
        to,
        lateCountsAsPresent: inputs.lateCountsAsPresent,
      });

    // MONTHLY — one row per calendar month the student has marks in.
    const months = new Set(statuses.map((s) => s.date.slice(0, 7)));
    for (const key of months) {
      if (touchedMonths && !touchedMonths.has(key)) continue;
      const { from, to } = monthBounds(key);
      monthly.push({
        ...base,
        studentId,
        termId: null,
        periodType: "monthly",
        month: Number(key.slice(5, 7)),
        year: Number(key.slice(0, 4)),
        ...count(from, to),
        updatedAt: now,
      });
    }

    for (const term of termsToWrite) {
      termRows.push({
        ...base,
        studentId,
        termId: term.id,
        periodType: "term",
        month: null,
        year: null,
        ...count(term.startDate, term.endDate),
        updatedAt: now,
      });
    }

    annual.push({
      ...base,
      studentId,
      termId: null,
      periodType: "annual",
      month: null,
      year: null,
      ...count(year.startDate, year.endDate),
      updatedAt: now,
    });
  }

  const countsFromExcluded = {
    workingDays: sql`excluded.working_days`,
    daysPresent: sql`excluded.days_present`,
    daysAbsent: sql`excluded.days_absent`,
    daysLate: sql`excluded.days_late`,
    daysHalfDay: sql`excluded.days_half_day`,
    daysOnLeave: sql`excluded.days_on_leave`,
    daysAttended: sql`excluded.days_attended`,
    updatedAt: sql`excluded.updated_at`,
  };

  // The three kinds of row touch disjoint rows, so their upserts go out
  // together. Sent through `execute`, which postgres-js pipelines on the
  // transaction's connection; the query builder's own await does not.
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < monthly.length; i += SUMMARY_CHUNK) {
    writes.push(
      tx.execute(
        tx
        .insert(attendanceSummary)
        .values(monthly.slice(i, i + SUMMARY_CHUNK))
        .onConflictDoUpdate({
          target: [
            attendanceSummary.studentId,
            attendanceSummary.academicYearId,
            attendanceSummary.month,
            attendanceSummary.year,
          ],
          targetWhere: sql`period_type = 'monthly'`,
          set: countsFromExcluded,
        })
        .getSQL(),
      ),
    );
  }
  for (let i = 0; i < termRows.length; i += SUMMARY_CHUNK) {
    writes.push(
      tx.execute(
        tx
        .insert(attendanceSummary)
        .values(termRows.slice(i, i + SUMMARY_CHUNK))
        .onConflictDoUpdate({
          target: [
            attendanceSummary.studentId,
            attendanceSummary.academicYearId,
            attendanceSummary.termId,
          ],
          targetWhere: sql`period_type = 'term'`,
          set: countsFromExcluded,
        })
        .getSQL(),
      ),
    );
  }
  for (let i = 0; i < annual.length; i += SUMMARY_CHUNK) {
    writes.push(
      tx.execute(
        tx
        .insert(attendanceSummary)
        .values(annual.slice(i, i + SUMMARY_CHUNK))
        .onConflictDoUpdate({
          target: [attendanceSummary.studentId, attendanceSummary.academicYearId],
          targetWhere: sql`period_type = 'annual'`,
          set: countsFromExcluded,
        })
        .getSQL(),
      ),
    );
  }
  await Promise.all(writes);
}

export const attendanceService = new AttendanceService();

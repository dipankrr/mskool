import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { academicYears, classes, sections, subjects, terms } from "./academic";
import { organizations, schools } from "./organization";
import { students } from "./people";

/**
 * ATTENDANCE — Phase 3.
 *
 * This file holds the calendar, the policy, and the periods: the three
 * configuration tables attendance marking reads. The record layer
 * (`attendance_records`, `daily_attendance_status`, `attendance_summary`)
 * lands in migration 0008 and lives here too.
 *
 * `academic_calendar` is filed under attendance rather than academic
 * structure because its only v1 consumer is marking: the service validates
 * the date's `day_type` before accepting an entry, and the summary's
 * "working days" denominator is derived from these rows. It was deferred
 * out of Phase 2 for exactly this coupling.
 *
 * Every table here carries BOTH `organizationId` and `schoolId` for
 * `scopeWhere` (hard rule 1), like every academic table — the S2.4 lesson:
 * scope columns are per-table, never borrowed through a join.
 */

export const calendarDayTypeEnum = pgEnum("calendar_day_type", [
  "working",
  "holiday",
  "half_day",
  "weekend",
  "exam_day",
]);

/**
 * One row per school per year per DATE: what kind of day it was.
 *
 * The marking gate. The service refuses an attendance entry unless a row
 * exists for that date AND its type is marking-eligible
 * (working/half_day/exam_day); a holiday, a weekend, or a missing row is a
 * refusal. That no-row-is-a-refusal strictness is deliberate — "working
 * days" in `attendance_summary` is only honest if the calendar is complete,
 * and a bulk generator (C2's `generateYearCalendar`) makes filling it a
 * non-event.
 *
 * The reference (table 8) capitalises the day types; lowercased to house
 * style like every enum here.
 */
export const academicCalendar = pgTable(
  "academic_calendar",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    date: date().notNull(),
    dayType: calendarDayTypeEnum().notNull(),
    // "Diwali", "Republic Day", "Local Holiday" — printed on reports, never
    // branched on.
    reason: varchar({ length: 255 }),

    // TRUE when the row came from the bulk year generator, not a hand edit.
    // An override (C2's `upsertDay`) does NOT clear this — it records where
    // the row was BORN, and the reason column carries the human's word.
    createdFromTemplate: boolean().notNull().default(false),

    createdBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One day-type per school per year per date — the generator's idempotency
    // anchor as much as a correctness rule.
    uniqueIndex("academic_calendar_school_year_date_uq").on(
      t.schoolId,
      t.academicYearId,
      t.date,
    ),
    index("academic_calendar_school_date_idx").on(t.schoolId, t.date),
    index("academic_calendar_org_idx").on(t.organizationId),
  ],
);

export const attendanceMarkingModeEnum = pgEnum("attendance_marking_mode", [
  "daily",
  "period_wise",
]);

export const attendanceDailyStatusRuleEnum = pgEnum("attendance_daily_status_rule", [
  "homeroom_authoritative",
  "threshold_percentage",
]);

/**
 * HOW THIS SCHOOL MARKS ATTENDANCE — one row per school, created lazily by
 * the first `upsertPolicy` (there is no seed-time default row to keep org
 * onboarding one step shorter).
 *
 * Daily vs period-wise is a PER-SCHOOL policy, not a schema fork: on a
 * daily-mode school every `attendance_records.period_id` is NULL and the
 * daily status is a direct copy; on a period-wise school the daily status is
 * DERIVED, by `daily_status_rule` — the homeroom period decides, or a
 * threshold percentage of periods present does.
 *
 * `can_mark_roles` / `can_correct_roles` from the reference are deliberately
 * ABSENT (ADR-012): `role_assignments` is the authorization authority, and a
 * second list here would be a second answer to "who may mark?" that could
 * drift from it. The smoke matrix pins who holds `attendance:create/update`.
 */
export const attendancePolicies = pgTable(
  "attendance_policies",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    markingMode: attendanceMarkingModeEnum().notNull().default("daily"),
    // Meaningful only when markingMode = 'period_wise'; a daily-mode school
    // never consults it.
    dailyStatusRule: attendanceDailyStatusRuleEnum()
      .notNull()
      .default("homeroom_authoritative"),
    // The X in "X% of periods present = Present". NULL on a daily-mode school
    // or a homeroom-authoritative one; CHECKed to 1–100 when set.
    thresholdPercentage: smallint(),
    // Minutes after the period's start time beyond which a mark is Late
    // rather than Present. Informational in v1 — the marker sees it.
    lateArrivalMinutes: smallint().notNull().default(15),

    updatedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // ONE policy per school. The unique index IS the "one per school" rule —
    // getPolicy reads through it, upsertPolicy relies on it.
    uniqueIndex("attendance_policies_school_uq").on(t.schoolId),
    index("attendance_policies_org_idx").on(t.organizationId),
    check(
      "attendance_policies_threshold_range",
      sql`"threshold_percentage" BETWEEN 1 AND 100`,
    ),
  ],
);

/**
 * The period structure of ONE SECTION for ONE YEAR: "Period 1" through
 * "Period 8", plus whatever homeroom/lunch rows the school models.
 *
 * Exists only for period-wise schools — a daily-mode school never populates
 * this table. NOT a scope node (hard rule 12 names school/class/section
 * only); a teacher's authority over a period rides on the same
 * section-scoped grant that lets her mark.
 *
 * `start_time`/`end_time` are informational until a timetable exists
 * (recorded deferral) — no CHECK ties them together yet, and `lateArrivalMinutes`
 * on the policy reads against them only as a UI hint.
 */
export const periods = pgTable(
  "periods",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),
    // Section implies the year (a section IS year-scoped); the year is kept
    // denormalised like every academic table so "6-A's periods in 2025-26"
    // needs no join.
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    // "Period 1", "Homeroom", "Lunch".
    name: varchar({ length: 50 }).notNull(),
    sequenceNumber: smallint().notNull(),
    // The authoritative period for daily-status derivation on a
    // homeroom_authoritative school. At most one per section is a service
    // invariant, not a constraint — "at most one TRUE per group" is not
    // expressible as a plain index and this is not worth an EXCLUDE.
    isHomeroom: boolean().notNull().default(false),

    // Which subject this period covers, and who usually takes it. Both
    // nullable — homeroom and lunch have neither, and the timetable layer
    // (deferred) is what would keep them current.
    subjectId: uuid().references(() => subjects.id),
    teacherId: text().references(() => user.id),

    startTime: time(),
    endTime: time(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("periods_section_year_sequence_uq").on(
      t.sectionId,
      t.academicYearId,
      t.sequenceNumber,
    ),
    index("periods_section_year_idx").on(t.sectionId, t.academicYearId),
    index("periods_school_idx").on(t.schoolId),
    index("periods_org_idx").on(t.organizationId),
  ],
);

export const academicCalendarRelations = relations(
  academicCalendar,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [academicCalendar.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [academicCalendar.schoolId],
      references: [schools.id],
    }),
    academicYear: one(academicYears, {
      fields: [academicCalendar.academicYearId],
      references: [academicYears.id],
    }),
  }),
);

export const attendancePolicyRelations = relations(
  attendancePolicies,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [attendancePolicies.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [attendancePolicies.schoolId],
      references: [schools.id],
    }),
  }),
);

export const periodRelations = relations(periods, ({ one }) => ({
  organization: one(organizations, {
    fields: [periods.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [periods.schoolId],
    references: [schools.id],
  }),
  section: one(sections, {
    fields: [periods.sectionId],
    references: [sections.id],
  }),
  academicYear: one(academicYears, {
    fields: [periods.academicYearId],
    references: [academicYears.id],
  }),
  subject: one(subjects, {
    fields: [periods.subjectId],
    references: [subjects.id],
  }),
}));

// ---------------------------------------------------------------------------
// The record layer — 0008
// ---------------------------------------------------------------------------

/**
 * The five markable statuses. The reference's `Holiday` guard value is
 * deliberately ABSENT: a holiday has no attendance records at all — the
 * calendar (the marking gate) refuses the entry before a row could exist,
 * so a status that means "no data" inside the data is a contradiction.
 * The same five are the only values `daily_attendance_status` may carry.
 */
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
]);

/**
 * GROUND TRUTH — one row per student per day (daily-mode schools) or per
 * student per period per day (period-wise schools). Write-only from the
 * marking flow's point of view.
 *
 * **HARD RULE 5: nothing downstream ever reads this table.** Fees, exam
 * eligibility, report cards, UDISE+ exports — everything reads
 * `daily_attendance_status`, which the marking flow keeps in step inside the
 * same transaction. This table is the audit-grade record of what was marked;
 * that layer is the resolved answer. Corollary: a reporting query joining
 * `attendance_records` is a bug even when its numbers look right.
 *
 * **The snapshot rule — section and class are COPIED at marking time, never
 * live-referenced.** `section_id`/`class_id` here are ordinary FK columns, but
 * their MEANING is frozen history: when a student transfers from 6-A to 6-B
 * mid-year, last month's rows must still say 6-A. Re-pointing them would
 * rewrite which section was responsible for a child's absences — the
 * historical integrity every report depends on. The live section lives on
 * `student_enrollments` and is never consulted for past records.
 *
 * `period_id` is NULL exactly on daily-mode schools (the policy decides);
 * every record of a period-wise school names its period.
 *
 * **The double-mark guard is HAND-WRITTEN SQL, not expressed here** (marked
 * in `0008_*.sql` like the academic_years EXCLUDEs): a plain unique index
 * treats NULL `period_id` values as distinct, so a daily-mode school could
 * mark the same student twice in one day. The guard is
 * `UNIQUE (student_id, date, COALESCE(period_id, sentinel))` — an expression
 * index that makes all of a day's daily-mode rows collide with each other
 * while leaving distinct periods alone. `pnpm db:verify` proves it bites;
 * re-check it after any migration regeneration.
 */
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    date: date().notNull(),

    // Snapshotted at marking time — see the table comment. NOT NULL: there is
    // no unsectioned attendance to mark.
    classId: uuid()
      .notNull()
      .references(() => classes.id),
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),

    // NULL for daily-mode schools; the guard index below depends on that.
    periodId: uuid().references(() => periods.id),

    status: attendanceStatusEnum().notNull(),

    // The owner's design (ADR-030): records edit in place, and the WHY for a
    // past-date edit rides on the record itself. The backend never requires
    // it — the frontend asks for a reason on past-date edits and not on
    // same-day ones; the backend stores what it receives. One micro-rule is
    // the service's: an update WITHOUT a reason never wipes an existing one.
    correctionReason: varchar({ length: 500 }),

    // WHO marked it first, and who last edited it. The pair answers "was this
    // row touched, by whom, when" (the timestamps answer when) without a
    // corrections table.
    markedBy: text()
      .notNull()
      .references(() => user.id),
    updatedBy: text().references(() => user.id),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("attendance_records_student_date_idx").on(t.studentId, t.date),
    index("attendance_records_section_date_idx").on(t.sectionId, t.date),
    index("attendance_records_school_date_idx").on(t.schoolId, t.date),
    index("attendance_records_org_idx").on(t.organizationId),
  ],
);

/**
 * Where a period-wise record sits in the derivation — the daily status's
 * `derivationMode` records which rule produced it. `manual_override` is the
 * principal's hand-winning answer over whatever the rule computed.
 */
export const attendanceDerivationModeEnum = pgEnum(
  "attendance_derivation_mode",
  ["direct", "homeroom_authoritative", "threshold_percentage", "manual_override"],
);

/**
 * THE AUTHORITATIVE DAILY LAYER — exactly one row per student per date, the
 * resolved answer whether the school marks daily or per period.
 *
 * **HARD RULE 5 lives on this table**: it is the ONLY attendance table any
 * downstream module may query. Daily-mode schools get a direct copy of the
 * record; period-wise schools get the policy's derivation
 * (homeroom-authoritative or threshold-percentage, with the counts filled).
 * The section/class snapshot rule applies here exactly as to records — this
 * is the table reports actually read, so it is the one that must not rewrite
 * history.
 *
 * The unique index (student, year, date) is what makes "one answer per
 * student per day" a fact rather than a discipline. A date can belong to only
 * one academic year of its school (the years' EXCLUDE constraint forbids
 * overlap), so the year in the key is the marking gate's own guarantee.
 */
export const dailyAttendanceStatus = pgTable(
  "daily_attendance_status",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),

    // Snapshotted at marking time, like the records' — this is the table
    // history is written FROM.
    classId: uuid()
      .notNull()
      .references(() => classes.id),
    sectionId: uuid()
      .notNull()
      .references(() => sections.id),

    date: date().notNull(),

    status: attendanceStatusEnum().notNull(),

    // Period-wise only: how the derivation weighed the day (3 of 4 present).
    // NULL on daily-mode rows, where there is nothing to count.
    periodsPresent: smallint(),
    periodsTotal: smallint(),

    derivationMode: attendanceDerivationModeEnum().notNull(),

    // WHO overrode the derived answer, and why — nullable, because almost
    // every row is derived, not overridden. `manual_override` rows are
    // expected to carry both.
    overriddenBy: text().references(() => user.id),
    overrideReason: varchar({ length: 500 }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("daily_attendance_status_student_year_date_uq").on(
      t.studentId,
      t.academicYearId,
      t.date,
    ),
    index("daily_attendance_status_school_date_idx").on(t.schoolId, t.date),
    index("daily_attendance_status_section_date_idx").on(t.sectionId, t.date),
    index("daily_attendance_status_org_idx").on(t.organizationId),
  ],
);

/**
 * Which slice of time a summary row aggregates: a calendar month, a term, or
 * the whole academic year. One row per student per slice.
 */
export const attendanceSummaryPeriodEnum = pgEnum("attendance_summary_period", [
  "monthly",
  "term",
  "annual",
]);

/**
 * PRE-AGGREGATED attendance — the read-model the report cards, fee fines,
 * and eligibility checks consume instead of COUNTing status rows on every
 * render. Recomputed by the service at the end of every mark (C5's
 * `recomputeSummary`); never written by anything else.
 *
 * The working-days denominator is CALENDAR TRUTH, not "days someone happened
 * to mark": `recomputeSummary` counts the year's `working`/`exam_day`/
 * `half_day` calendar rows, which is why the calendar had to land in this
 * phase.
 *
 * **Uniqueness is THREE partial unique indexes, not the reference's single
 * composite key.** The composite `(student, year, type, month, year)` puts
 * nullable columns (`month`, `term_id`) inside a unique key, and Postgres
 * treats NULLs as distinct — the same trap the records' double-mark guard
 * exists for, so two Term rows or two identical months would both insert.
 * One partial index per period type names each rule exactly, and the shape
 * CHECKs below pin which columns each type may fill:
 *
 *   - `monthly`:  (student, year, month, year-of-month) — month/year set, no term
 *   - `term`:     (student, year, term)                 — term set, month/year empty
 *   - `annual`:   (student, year)                       — one row, nothing else set
 *
 * `attendance_percentage` is a GENERATED STORED column — the database
 * computes it from the counts on every write, so no code path can store a
 * percentage that disagrees with its own numerator and denominator.
 */
export const attendanceSummary = pgTable(
  "attendance_summary",
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    schoolId: uuid()
      .notNull()
      .references(() => schools.id),

    studentId: uuid()
      .notNull()
      .references(() => students.id),
    academicYearId: uuid()
      .notNull()
      .references(() => academicYears.id),
    // Set exactly on `term` rows.
    termId: uuid().references(() => terms.id),

    periodType: attendanceSummaryPeriodEnum().notNull(),
    // Calendar month (1-12) and calendar year — set exactly on `monthly`
    // rows. Nullable because an annual row has neither.
    month: smallint(),
    year: smallint(),

    workingDays: smallint().notNull().default(0),
    daysPresent: smallint().notNull().default(0),
    daysAbsent: smallint().notNull().default(0),
    daysLate: smallint().notNull().default(0),
    daysOnLeave: smallint().notNull().default(0),

    // GENERATED ALWAYS AS — see the table comment. Never written by code.
    attendancePercentage: numeric({ precision: 5, scale: 2 }).generatedAlwaysAs(
      sql`CASE WHEN working_days = 0 THEN 0
          ELSE round((days_present::decimal / working_days) * 100, 2) END`,
    ),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("attendance_summary_monthly_uq")
      .on(t.studentId, t.academicYearId, t.month, t.year)
      .where(sql`period_type = 'monthly'`),
    uniqueIndex("attendance_summary_term_uq")
      .on(t.studentId, t.academicYearId, t.termId)
      .where(sql`period_type = 'term'`),
    uniqueIndex("attendance_summary_annual_uq")
      .on(t.studentId, t.academicYearId)
      .where(sql`period_type = 'annual'`),

    // The shape rules the partial indexes presuppose: each type fills
    // exactly its own columns. Without these, a "monthly" row with no month
    // would be unkeyable and an "annual" row carrying a term would be a
    // category error the indexes never see.
    check(
      "attendance_summary_monthly_shape",
      sql`period_type <> 'monthly' OR (month IS NOT NULL AND year IS NOT NULL AND term_id IS NULL)`,
    ),
    check(
      "attendance_summary_term_shape",
      sql`period_type <> 'term' OR (term_id IS NOT NULL AND month IS NULL AND year IS NULL)`,
    ),
    check(
      "attendance_summary_annual_shape",
      sql`period_type <> 'annual' OR (month IS NULL AND year IS NULL AND term_id IS NULL)`,
    ),
    check(
      "attendance_summary_month_range",
      sql`month IS NULL OR month BETWEEN 1 AND 12`,
    ),

    index("attendance_summary_student_year_idx").on(t.studentId, t.academicYearId),
    index("attendance_summary_school_idx").on(t.schoolId),
    index("attendance_summary_org_idx").on(t.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// Record-layer relations
// ---------------------------------------------------------------------------

export const attendanceRecordRelations = relations(attendanceRecords, ({ one }) => ({
  organization: one(organizations, {
    fields: [attendanceRecords.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [attendanceRecords.schoolId],
    references: [schools.id],
  }),
  student: one(students, {
    fields: [attendanceRecords.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [attendanceRecords.academicYearId],
    references: [academicYears.id],
  }),
  class: one(classes, {
    fields: [attendanceRecords.classId],
    references: [classes.id],
  }),
  section: one(sections, {
    fields: [attendanceRecords.sectionId],
    references: [sections.id],
  }),
  period: one(periods, {
    fields: [attendanceRecords.periodId],
    references: [periods.id],
  }),
}));

export const dailyAttendanceStatusRelations = relations(
  dailyAttendanceStatus,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [dailyAttendanceStatus.organizationId],
      references: [organizations.id],
    }),
    school: one(schools, {
      fields: [dailyAttendanceStatus.schoolId],
      references: [schools.id],
    }),
    student: one(students, {
      fields: [dailyAttendanceStatus.studentId],
      references: [students.id],
    }),
    academicYear: one(academicYears, {
      fields: [dailyAttendanceStatus.academicYearId],
      references: [academicYears.id],
    }),
    class: one(classes, {
      fields: [dailyAttendanceStatus.classId],
      references: [classes.id],
    }),
    section: one(sections, {
      fields: [dailyAttendanceStatus.sectionId],
      references: [sections.id],
    }),
  }),
);

export const attendanceSummaryRelations = relations(attendanceSummary, ({ one }) => ({
  organization: one(organizations, {
    fields: [attendanceSummary.organizationId],
    references: [organizations.id],
  }),
  school: one(schools, {
    fields: [attendanceSummary.schoolId],
    references: [schools.id],
  }),
  student: one(students, {
    fields: [attendanceSummary.studentId],
    references: [students.id],
  }),
  academicYear: one(academicYears, {
    fields: [attendanceSummary.academicYearId],
    references: [academicYears.id],
  }),
  term: one(terms, {
    fields: [attendanceSummary.termId],
    references: [terms.id],
  }),
}));

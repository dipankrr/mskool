import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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
import { academicYears, sections, subjects } from "./academic";
import { organizations, schools } from "./organization";

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

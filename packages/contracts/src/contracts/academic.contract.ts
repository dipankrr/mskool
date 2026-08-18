import { academicYears, classes, sections } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * ACADEMIC STRUCTURE — academic years, classes, sections.
 *
 * Zod schemas derived from the Drizzle tables, so a column change surfaces as a
 * validation-type error rather than drifting silently (the type chain in
 * AGENTS.md: db → contracts → services → trpc → web).
 *
 * Zod 4: `z.email()`, not `z.string().email()`.
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — no mode is set on these
 * columns, and a calendar date has no time or zone to preserve. Validated as
 * ISO `YYYY-MM-DD`, which is what Postgres accepts and what the client sends.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

export const academicYearSelectSchema = createSelectSchema(academicYears);
export type AcademicYear = z.infer<typeof academicYearSelectSchema>;

export const createAcademicYearSchema = createInsertSchema(academicYears, {
  // "2025-26". A display label — the dates below are the source of truth,
  // because Indian schools name sessions inconsistently.
  name: z.string().min(4).max(20),
  startDate: isoDate,
  endDate: isoDate,
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client. Accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    // Frozen at creation by the service so "was this year extended?" stays
    // answerable. Never client-supplied.
    originalEndDate: true,
    // At most one per school, so this is a transition between two rows rather
    // than a field on one. Use academic.setCurrent.
    isCurrent: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The year cannot end before it starts.",
    path: ["endDate"],
  });
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>;

/**
 * The same rule the database enforces (`academic_years_end_after_start`,
 * ADR-022), restated here so the caller gets a field-level message instead of a
 * constraint violation. The database stays the authority: this check cannot
 * hold under concurrency and the constraint can.
 *
 * String comparison is correct for ISO dates — `"2026-03-31" < "2026-04-01"`
 * lexically and chronologically agree, which is the whole point of the format.
 */
export const updateAcademicYearSchema = createInsertSchema(academicYears, {
  name: z.string().min(4).max(20),
  startDate: isoDate,
  endDate: isoDate,
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    originalEndDate: true,
    isCurrent: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial()
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "The year cannot end before it starts.",
    path: ["endDate"],
  });
export type UpdateAcademicYearInput = z.infer<typeof updateAcademicYearSchema>;

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export const classSelectSchema = createSelectSchema(classes);
export type Class = z.infer<typeof classSelectSchema>;

export const createClassSchema = createInsertSchema(classes, {
  // "Class 6", "Grade 6", "Standard VI" — schools disagree, so free text.
  name: z.string().min(1).max(100),
  /**
   * Sort key, and negatives are deliberate. Pre-primary years have no numeral —
   * Nursery, LKG, UKG — and numbering them 0,1,2 would push Class 1 to 3 and
   * break the obvious mapping everywhere else. They sit below zero instead:
   * Nursery -3, LKG -2, UKG -1, then Class 1 … 12 as themselves.
   */
  numericOrder: z.number().int().min(-10).max(20),
  description: z.string().max(255).optional(),
}).omit({
  id: true,
  organizationId: true,
  schoolId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

// isActive is absent: closing a class is `academic.deactivateClass`, not a
// patch, so that hard rule 2 is not bypassed by a generic update.
export const updateClassSchema = createClassSchema.partial();
export type UpdateClassInput = z.infer<typeof updateClassSchema>;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const sectionSelectSchema = createSelectSchema(sections);
export type Section = z.infer<typeof sectionSelectSchema>;

export const createSectionSchema = createInsertSchema(sections, {
  // "A", "B", "Morning", "Day".
  name: z.string().min(1).max(50),
  academicYearId: z.uuid(),
  classId: z.uuid(),
  stream: z.string().max(50).optional(),
  house: z.string().max(50).optional(),
  maxStudents: z.number().int().min(1).max(200).optional(),
  roomNumber: z.string().max(20).optional(),
}).omit({
  id: true,
  organizationId: true,
  schoolId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSectionInput = z.infer<typeof createSectionSchema>;

/**
 * `academicYearId` and `classId` are not patchable. Moving a section between
 * classes or years would relocate every student, attendance record, and result
 * already attached to it, and would leave its scope node's denormalised
 * ancestry pointing at the old class (ADR-015). A section in the wrong place is
 * deactivated and re-created.
 */
export const updateSectionSchema = createSectionSchema
  .omit({ academicYearId: true, classId: true })
  .partial();
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;

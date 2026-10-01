import { students } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * STUDENTS — the identity registry. Written once at admission, read through
 * the year anchor (enrollments) everywhere else: a student's class, section,
 * and roll number live on `student_enrollments`, never here.
 *
 * Same derivation as the academic contracts: schemas come from the Drizzle
 * table via drizzle-zod, so a column change surfaces as a validation-type
 * error rather than drifting silently (the type chain in AGENTS.md).
 */

/**
 * Drizzle's `date()` yields a `string`, not a `Date` — a calendar date has no
 * time or zone to preserve. Validated as ISO `YYYY-MM-DD`. (Shared with
 * academic.contract.ts, which owns the rationale.)
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date: YYYY-MM-DD.");

export const studentSelectSchema = createSelectSchema(students);
export type Student = z.infer<typeof studentSelectSchema>;

export const createStudentSchema = createInsertSchema(students, {
  // School-issued, permanent, never reused — and unique per school
  // (`students_school_admission_number_uq`, refused by the database per
  // ADR-022, not pre-checked here).
  admissionNumber: z.string().min(1).max(50),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDate,
  admissionDate: isoDate.optional(),
  // Contact shape is real: z.email() validates only when the school records one.
  email: z.email().nullish(),
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client. Accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    // The life-cycle state is the enrollment/TC flow's job (hard rule 2:
    // leaving students become inactive/transferred_out, never deleted).
    // Creation is always an admission.
    status: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

/**
 * Demographics and contact details are correctable; identity is not.
 *
 * `admissionNumber` is deliberately absent — school-issued and permanent, and
 * every document the school ever printed references it. `status` is
 * deliberately absent — a student leaving is a life-cycle transition owned by
 * the enrollment/TC flow (and the `deactivate` operation), not a free-form
 * field edit (hard rule 2).
 */
export const updateStudentSchema = createInsertSchema(students, {
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDate,
  admissionDate: isoDate,
  email: z.email().nullish(),
})
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    admissionNumber: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

/**
 * BULK PHOTO MATCHER (the review grid's read): active students whose
 * admission number is in the uploaded set, WITH their current enrollment
 * facts (class, section, roll) so the review grid can show who each file
 * is about. The zip itself never reaches the server — the browser matches
 * filenames against this read, and each confirmed photo goes through the
 * ordinary `uploadPhoto` mutation. Capped at 500 names per call; a bigger
 * zip is matched in pages.
 */
export const studentsByAdmissionsInput = z.object({
  academicYearId: z.uuid(),
  admissions: z.array(z.string().min(1).max(40)).min(1).max(500),
});
export const studentsByAdmissionsRow = z.object({
  student: studentSelectSchema,
  rollNumber: z.string().nullable(),
  className: z.string().nullable(),
  sectionName: z.string().nullable(),
});
export const studentsByAdmissionsOutput = z.array(studentsByAdmissionsRow);
export type StudentsByAdmissionsInput = z.infer<typeof studentsByAdmissionsInput>;
export type StudentsByAdmissionsRow = z.infer<typeof studentsByAdmissionsRow>;
export type StudentsByAdmissionsOutput = z.infer<typeof studentsByAdmissionsOutput>;

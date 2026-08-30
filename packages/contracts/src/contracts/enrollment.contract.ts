import { studentEnrollments } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * STUDENT ENROLLMENTS — the year anchor (one row per student per year).
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

export const enrollmentSelectSchema = createSelectSchema(studentEnrollments);
export type StudentEnrollment = z.infer<typeof enrollmentSelectSchema>;

export const createEnrollmentSchema = createInsertSchema(studentEnrollments, {
  // Admissions can be backdated (reference default is the DB's CURRENT_DATE).
  enrollmentDate: isoDate.optional(),
})
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client. Accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    // The status machine is the service's: creation DERIVES the status —
    // `admitted` when no section is named, `section_assigned` when one is —
    // and every later transition is a named operation, never a payload field.
    enrollmentStatus: true,
    // Set at year end by the exam chain (Phase 5), never at admission.
    promotionStatus: true,
    promotionPending: true,
    // The promotion rollover stamps this itself; a client cannot claim it.
    createdFromTemplate: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;

/**
 * Administrative labels only. Deliberately absent:
 *
 * - `studentId` / `academicYearId` / `classId` — the year anchor's identity.
 *   Rewriting any of them is the mutation hard rule 6 exists to prevent; the
 *   unique index on (student, year) is the structural half, and this omission
 *   is the interface half.
 * - `sectionId` — a mid-year section move is a TRANSFER, tracked in
 *   `section_transfer_log` precisely because the base row's section changes
 *   and history must survive it. First assignment is a named operation
 *   (`assignSection`); later moves wait for the transfer flow. A generic
 *   PATCH that could silently re-point a student's section would be the leak.
 * - `enrollmentStatus` — transitions are named operations with a legal-map
 *   (see the service), not free-form field edits.
 * - `enrollmentDate` — the admission record is history; it is not edited.
 */
export const updateEnrollmentSchema = createInsertSchema(studentEnrollments)
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    studentId: true,
    academicYearId: true,
    classId: true,
    sectionId: true,
    enrollmentDate: true,
    enrollmentStatus: true,
    promotionStatus: true,
    promotionPending: true,
    createdFromTemplate: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();
export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;

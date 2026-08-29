import { subjects } from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export const subjectSelectSchema = createSelectSchema(subjects);
export type Subject = z.infer<typeof subjectSelectSchema>;

export const createSubjectSchema = createInsertSchema(subjects, {
  // "Mathematics", "हिन्दी". The uniqueness rule (one name per school) is the
  // database's `subjects_school_name_uq` index (ADR-022) — restating it here
  // would pre-check and still race; the constraint holds under concurrency.
  name: z.string().min(1).max(150),
  shortName: z.string().max(20).optional(),
  code: z.string().max(20).optional(),
}).omit({
  id: true,
  // Both come from the authenticated scope, never from the client. Accepting
  // them as input would let a caller write into another tenant.
  organizationId: true,
  schoolId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

/**
 * Everything except `isActive` is patchable: a mislabelled category, a renamed
 * subject, a corrected flag are ordinary corrections with no row relocation.
 * `isActive` is absent on purpose — closing a subject is `subject.deactivate`,
 * not a patch, so hard rule 2 is not bypassable by a generic update (same shape
 * as the class contract).
 */
export const updateSubjectSchema = createSubjectSchema.partial();
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;

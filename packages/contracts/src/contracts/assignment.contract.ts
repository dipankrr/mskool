import {
  classSubjectMappings,
  sectionTeacherAssignments,
} from "@repo/db/schema";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Class-subject mappings (the template layer)
// ---------------------------------------------------------------------------

export const classSubjectMappingSelectSchema = createSelectSchema(classSubjectMappings);
export type ClassSubjectMapping = z.infer<typeof classSubjectMappingSelectSchema>;

export const createClassSubjectMappingSchema = createInsertSchema(classSubjectMappings)
  .omit({
    id: true,
    // Both come from the authenticated scope, never from the client — accepting
    // them as input would let a caller write into another tenant.
    organizationId: true,
    schoolId: true,
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateClassSubjectMappingInput = z.infer<
  typeof createClassSubjectMappingSchema
>;

// Everything is patchable EXCEPT the (year, class, subject) triple — re-pointing
// a mapping to a different subject would silently restate what this class
// studied. Fix a wrong mapping by ending it and creating the right one. The
// `isElective` / `sequenceNumber` are ordinary corrections, so those stay.
export const updateClassSubjectMappingSchema = createClassSubjectMappingSchema
  .omit({ academicYearId: true, classId: true, subjectId: true })
  .partial();
export type UpdateClassSubjectMappingInput = z.infer<
  typeof updateClassSubjectMappingSchema
>;

// ---------------------------------------------------------------------------
// Section-teacher assignments (the delivery layer, ADR-012's fact)
// ---------------------------------------------------------------------------

export const sectionTeacherAssignmentSelectSchema = createSelectSchema(
  sectionTeacherAssignments,
);
export type SectionTeacherAssignment = z.infer<typeof sectionTeacherAssignmentSelectSchema>;

export const createSectionTeacherAssignmentSchema = createInsertSchema(
  sectionTeacherAssignments,
)
  // The role/subject pairing is the DATABASE's CHECK (sta_subject_matches_role) —
  // restating it here would pre-check and still race, and the constraint holds
  // by construction. The schema just lets both through.
  .omit({
    id: true,
    organizationId: true,
    schoolId: true,
    effectiveFrom: true, // defaults to today; explicit backdating is a separate concern
    createdBy: true,
    createdAt: true,
    updatedAt: true,
  });
export type CreateSectionTeacherAssignmentInput = z.infer<
  typeof createSectionTeacherAssignmentSchema
>;

/**
 * Ending an assignment is NOT a generic PATCH — it is the one sanctioned
 * UPDATE, closing the open row (`effectiveTo` = today) and inserting the
 * successor. So there is no update schema for the assignment itself; the
 * dedicated `endAssignment` service operation owns that transition and hard
 * rule 2's spirit (append-on-change).
 */
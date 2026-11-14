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

export const createClassSubjectMappingSchema = createInsertSchema(classSubjectMappings, {
  // Required (ADR-055): exams skip a mapping without a type, silently. The
  // column stays nullable for older rows only.
  subjectTypeId: z.uuid(),
})
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

/** A row with who it is: the teacher's name and login, if they have joined (ADR-068). */
export const sectionTeacherAssignmentRowSchema = sectionTeacherAssignmentSelectSchema.extend({
  teacherName: z.string(),
  userId: z.string().nullable(),
});
export type SectionTeacherAssignmentRow = z.infer<typeof sectionTeacherAssignmentRowSchema>;

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
// ── Teaching read models (ADR-068) ─────────────────────────────────────────

const teacherRefSchema = z.object({
  assignmentId: z.uuid(),
  staffId: z.uuid(),
  name: z.string(),
  /** Exclusive end for a substitute; null when open-ended. */
  effectiveTo: z.string().nullable(),
});

/** Every section of a branch's session with its teachers and gaps. */
export const teachingOverviewSchema = z.object({
  classTeachersEnabled: z.boolean(),
  sections: z.array(
    z.object({
      sectionId: z.uuid(),
      sectionName: z.string(),
      classId: z.uuid(),
      className: z.string(),
      classTeacher: teacherRefSchema.nullable(),
      subjects: z.array(
        z.object({
          mappingId: z.uuid(),
          subjectId: z.uuid(),
          subjectName: z.string(),
          shortName: z.string().nullable(),
          teachers: z.array(teacherRefSchema),
        }),
      ),
      gaps: z.number().int(),
    }),
  ),
  totals: z.object({
    slots: z.number().int(),
    filled: z.number().int(),
    noClassTeacher: z.number().int(),
    noTeacher: z.number().int(),
  }),
});
export type TeachingOverview = z.infer<typeof teachingOverviewSchema>;

/** What the signed-in person teaches now (Home, Welcome). */
export const myTeachingSchema = z.array(
  z.object({
    assignmentId: z.uuid(),
    role: z.enum(["class_teacher", "subject_teacher"]),
    effectiveTo: z.string().nullable(),
    sectionId: z.uuid(),
    sectionName: z.string(),
    classId: z.uuid(),
    className: z.string(),
    subjectId: z.uuid().nullable(),
    subjectName: z.string().nullable(),
  }),
);
export type MyTeaching = z.infer<typeof myTeachingSchema>;

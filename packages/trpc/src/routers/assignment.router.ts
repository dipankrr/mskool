import {
  classSubjectMappingSelectSchema,
  createClassSubjectMappingSchema,
  createSectionTeacherAssignmentSchema,
  sectionTeacherAssignmentSelectSchema,
  updateClassSubjectMappingSchema,
} from "@repo/contracts";
import { assignmentService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure, type OwnerResolver } from "../trpc";

/**
 * THE TEACHING-ASSIGNMENT LAYER — Phase 2 slice 2.
 *
 * Two tables, one workflow: map subjects onto classes for a year
 * (`subject_mapping.*`) then staff the sections (`teacher_assignment.*`).
 * Knows nothing about HTTP; every read takes ctx.scope / ctx.scopes and
 * filters by it (hard rule 1). No `scope_nodes` writes — neither table is a
 * node in the authorization tree, so there is no transaction to insert one.
 *
 * Permission namespaces: `subject_mapping.*` and `teacher_assignment.*`. Both
 * are school-level management surfaces, so the principal manages them at school
 * scope; subject_mapping:read is granted to class_teacher/subject_teacher so
 * they can populate their class's subject pickers. teacher_assignment:read is
 * granted to subject_teacher so they can see their own assignments.
 * AUTHORITY over marks/content is enforced separately by checkSubjectAccess in
 * slice S4 — this layer only answers "who is assigned", not "may they act".
 *
 * B6 owner resolution: both tables are SCHOOL-level (denormalised schoolId,
 * not scope nodes), so the owner resolvers are single-column lookups exactly
 * like resolveSubjectOwner — a cross-tenant id and a nonexistent one are
 * indistinguishable, both NOT_FOUND. Single-resource reads ask overlap;
 * mutations stay on the default cover (ADR-017 strict).
 */

const resolveClassSubjectMappingOwner: OwnerResolver = async (orgId, id) => {
  const schoolId = await assignmentService.getClassSubjectMappingOwnerId(orgId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Subject mapping not found." });
  }
  return { type: "school", id: schoolId };
};

// ---------------------------------------------------------------------------
// Subject mappings (template layer)
// ---------------------------------------------------------------------------

const subjectMappingRouter = router({
  // Permissive list (ADR-017): a section-scoped teacher does not COVER the
  // school node they address to see their class's subjects, but must still get
  // those subjects. ctx.scopes is clipped to the addressed subtree.
  list: staffListProcedure("subject_mapping:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/subject-mappings",
        tags: ["subject-mappings"],
        summary: "List subject mappings for one academic year and class",
        protect: true,
      },
    })
    .input(z.object({ academicYearId: z.uuid(), classId: z.uuid() }))
    .output(z.array(classSubjectMappingSelectSchema))
    .query(async ({ ctx, input }) =>
      assignmentService.listClassSubjectMappings(
        ctx.scopes,
        input.academicYearId,
        input.classId,
      ),
    ),

  // B6: not a scope node, so the owning school comes from the resolver and
  // the gate asks overlap (ADR-028). A section-scoped teacher does not COVER
  // her school, but the mapping she reads belongs to it.
  byId: staffProcedure("subject_mapping:read", {
    resolveOwner: resolveClassSubjectMappingOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/subject-mappings/{id}",
        tags: ["subject-mappings"],
        summary: "Get one subject mapping",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(classSubjectMappingSelectSchema)
    .query(async ({ ctx, input }) => {
      const mapping = await assignmentService.getClassSubjectMappingById(
        ctx.scope,
        input.id,
      );
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject mapping not found." });
      }
      return mapping;
    }),

  // B5: year + class named in the input, not inherited. The service verifies
  // all three parents (year/class/subject) belong to the caller's school.
  create: staffProcedure("subject_mapping:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/subject-mappings",
        tags: ["subject-mappings"],
        summary: "Map a subject onto a class for a year",
        protect: true,
      },
    })
    .input(
      z.object({
        academicYearId: z.uuid(),
        classId: z.uuid(),
        subjectId: z.uuid(),
        data: createClassSubjectMappingSchema,
      }),
    )
    .output(classSubjectMappingSelectSchema)
    .mutation(async ({ ctx, input }) => {
      return assignmentService.createClassSubjectMapping(ctx.scope, {
        ...input.data,
        academicYearId: input.academicYearId,
        classId: input.classId,
        subjectId: input.subjectId,
      });
    }),

  // Only isElective/sequenceNumber are patchable — the update schema omits the
  // (year, class, subject) triple. B6: owner-resolved, cover gate (ADR-017
  // strict — mutations always cover).
  update: staffProcedure("subject_mapping:update", {
    resolveOwner: resolveClassSubjectMappingOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/subject-mappings/{id}",
        tags: ["subject-mappings"],
        summary: "Update a subject mapping (isElective, sequenceNumber only)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateClassSubjectMappingSchema }))
    .output(classSubjectMappingSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const mapping = await assignmentService.updateClassSubjectMapping(
        ctx.scope,
        input.id,
        input.data,
      );
      if (!mapping) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Subject mapping not found." });
      }
            return mapping;
    }),
});

// ---------------------------------------------------------------------------
// Teacher assignments (delivery layer)
// ---------------------------------------------------------------------------

const resolveTeacherAssignmentOwner: OwnerResolver = async (orgId, id) => {
  const schoolId = await assignmentService.getSectionTeacherAssignmentOwnerId(orgId, id);
  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Teacher assignment not found." });
  }
  return { type: "school", id: schoolId };
};

const teacherAssignmentRouter = router({
  // Permissive list: a section-scoped teacher does not COVER the school node
  // they address, but must still see their own assignments. ctx.scopes is
  // clipped to the addressed subtree — a subject_teacher gets only their
  // section's open assignments.
  list: staffListProcedure("teacher_assignment:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/teacher-assignments",
        tags: ["teacher-assignments"],
        summary: "List open teacher assignments for a section",
        protect: true,
      },
    })
    .input(z.object({ sectionId: z.uuid() }))
    .output(z.array(sectionTeacherAssignmentSelectSchema))
    .query(async ({ ctx, input }) =>
      assignmentService.listSectionTeacherAssignments(ctx.scopes, input.sectionId),
    ),

  // B7 (ADR-028): overlap read — a section-scoped teacher covers only her
  // section, but reads a row that belongs to one.
  byId: staffProcedure("teacher_assignment:read", {
    resolveOwner: resolveTeacherAssignmentOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/teacher-assignments/{id}",
        tags: ["teacher-assignments"],
        summary: "Get one teacher assignment",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(sectionTeacherAssignmentSelectSchema)
    .query(async ({ ctx, input }) => {
      const assignment = await assignmentService.getSectionTeacherAssignmentById(
        ctx.scope,
        input.id,
      );
      if (!assignment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Teacher assignment not found.",
        });
      }
      return assignment;
    }),

  // B5: sectionId names the parent; the service verifies it belongs to the
  // caller's school and that academicYearId matches the section's own.
  // subjectId is nullable-with-a-role-rule — the database CHECK enforces it.
  create: staffProcedure("teacher_assignment:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/teacher-assignments",
        tags: ["teacher-assignments"],
        summary: "Assign a teacher to a section",
        protect: true,
      },
    })
    .input(createSectionTeacherAssignmentSchema)
    .output(sectionTeacherAssignmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      return assignmentService.createSectionTeacherAssignment(ctx.scope, input);
    }),

  /**
   * The one sanctioned UPDATE — append-on-change. Closes the open row and
   * optionally inserts a successor atomically so the section is never left
   * unmanned mid-swap. Named `end`, not `update`, because PATCH semantics
   * would suggest partial field edits over the whole row. Cover gate (ADR-017
   * strict — mutations always cover).
   */
  end: staffProcedure("teacher_assignment:update", {
    resolveOwner: resolveTeacherAssignmentOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/teacher-assignments/{id}/end",
        tags: ["teacher-assignments"],
        summary: "End an open assignment (closes the row, optional successor)",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.uuid(),
        successor: z
          .object({
            sectionId: z.uuid(),
            academicYearId: z.uuid(),
            userId: z.string(),
            role: z.enum([
              "class_teacher",
              "subject_teacher",
              "co_teacher",
              "activity_teacher",
            ]),
            subjectId: z.uuid().nullable().optional(),
          })
          .optional(),
      }),
    )
    .output(
      z.object({
        closed: sectionTeacherAssignmentSelectSchema,
        successor: sectionTeacherAssignmentSelectSchema.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return assignmentService.endAssignment(ctx.scope, input.id, input.successor);
    }),
});

/**
 * Namespaced `subject_mapping.*` and `teacher_assignment.*` (AGENTS.md:
 * staff routers are `<domain>.*`). Each sub-router is flat so the tRPC
 * namespace matches the permission namespace. Wired under `assignment`;
 * REST paths are `/subject-mappings/*` and `/teacher-assignments/*`.
 */
export const assignmentRouter = router({
  subjectMapping: subjectMappingRouter,
  teacherAssignment: teacherAssignmentRouter,
});

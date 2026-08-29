import {
  createSubjectSchema,
  subjectSelectSchema,
  updateSubjectSchema,
} from "@repo/contracts";
import { subjectService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure, type OwnerResolver } from "../trpc";

/**
 * SUBJECTS — the school's subject catalogue (Phase 2 slice 1).
 *
 * Routers stay thin: validate, resolve the tenancy filter from ctx, call the
 * service, map an empty result to NOT_FOUND. No business logic, no db access.
 *
 * Subjects are SCHOOL-level like academic years, not scope nodes, so this
 * router copies the YEAR router's authorization shape and deliberately does
 * NOT have its read_history half:
 *
 *   - `resolveSubjectOwner` is the B6 adapter: a subject's owning node is its
 *     branch, looked up from the row. A cross-tenant id and a nonexistent one
 *     are deliberately indistinguishable — both throw the same NOT_FOUND the
 *     endpoint itself uses, so nothing here confirms an id exists anywhere.
 *   - single-resource reads ask the OVERLAP question (ADR-028): a section-
 *     scoped teacher does not COVER her school, but the subject she reads
 *     belongs to it. The service still filters by scope; the row-level filter
 *     is what keeps a school-B id out of a school-A answer.
 *   - mutations keep the default COVER gate (ADR-017 strict) — teachers hold
 *     no subject:update or subject:delete, so the overlap question never
 *     arises on a write.
 *   - NO read_history gate anywhere: subjects are not year-scoped. "Mathematics"
 *     is the same row every session; there is no history to gate. If a subject
 *     catalogue ever becomes year-differentiated, that is a new decision, not
 *     an optional flag here.
 *
 * A teacher's authority over subject CONTENT (marks, homework) is a different
 * mechanism entirely — `section_teacher_assignments` via `checkSubjectAccess`
 * (ADR-012), arriving in slice S4. Reading the catalogue is `subject:read`;
 * entering Chemistry marks is `marks:create` AND an assignment row.
 */

/**
 * The B6 owner resolver for subjects (ADR-028 context) — same shape as
 * `resolveYearOwner`. Null (no such subject in this org) and a cross-tenant id
 * are deliberately indistinguishable.
 */
const resolveSubjectOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await subjectService.getSubjectOwnerId(organizationId, id);

  if (!schoolId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Subject not found.",
    });
  }

  return { type: "school", id: schoolId };
};

/**
 * Namespaced `subject.*` (AGENTS.md: staff routers are `<domain>.*`): tRPC
 * names `subject.list`, `subject.byId`, … independent of the flat REST paths
 * in each `meta`.
 */
export const subjectRouter = router({
  // List: permissive builder (ADR-017). A branch principal does not COVER the
  // org node they address to see the school's catalogue, but must still get
  // their branch's rows. ctx.scopes is already clipped to the addressed
  // subtree. Active subjects only — the service documents why (pickers).
  list: staffListProcedure("subject:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/subjects",
        tags: ["subjects"],
        summary: "List active subjects the caller may see",
        protect: true,
      },
    })
    .output(z.array(subjectSelectSchema))
    .query(async ({ ctx }) => {
      return subjectService.listSubjects(ctx.scopes);
    }),

  // B6: not a scope node, so the owning branch comes from the resolver and the
  // gate asks the overlap question (ADR-028). The service still filters by
  // scope; a cross-tenant id and a nonexistent one are the same NOT_FOUND.
  byId: staffProcedure("subject:read", {
    resolveOwner: resolveSubjectOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/subjects/{id}",
        tags: ["subjects"],
        summary: "Get one subject",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(subjectSelectSchema)
    .query(async ({ ctx, input }) => {
      const subject = await subjectService.getSubjectById(ctx.scope, input.id);

      if (!subject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subject not found.",
        });
      }

      return subject;
    }),

  create: staffProcedure("subject:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/subjects",
        tags: ["subjects"],
        summary: "Create a subject",
        protect: true,
      },
    })
    // B5: the parent is named in the endpoint's own input, not inherited as an
    // optional scope field — omitting it is a compile error at the call site,
    // not a runtime 500 from requireSchoolId. The service still re-checks:
    // REST callers are not type-checked against this router.
    .input(z.object({ schoolId: z.uuid(), data: createSubjectSchema }))
    .output(subjectSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — subjects are not in the authorization tree. A
      // duplicate name within the school is refused by the unique index and
      // worded by translateErrors (ADR-022).
      return subjectService.createSubject(ctx.scope, input.data);
    }),

  update: staffProcedure("subject:update", {
    resolveOwner: resolveSubjectOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/subjects/{id}",
        tags: ["subjects"],
        summary: "Update a subject",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateSubjectSchema }))
    .output(subjectSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const subject = await subjectService.updateSubject(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!subject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subject not found.",
        });
      }

      return subject;
    }),

  /** Soft delete (hard rule 2) — results and fee structures point at it. */
  deactivate: staffProcedure("subject:delete", {
    resolveOwner: resolveSubjectOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/subjects/{id}/deactivate",
        tags: ["subjects"],
        summary: "Deactivate a subject (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(subjectSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const subject = await subjectService.deactivateSubject(
        ctx.scope,
        input.id,
      );

      if (!subject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subject not found.",
        });
      }

      return subject;
    }),
});



import {
  createStudentSchema,
  studentSelectSchema,
  updateStudentSchema,
} from "@repo/contracts";
import { studentService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  resolveStudentOwner,
  router,
  staffListProcedure,
  staffProcedure,
} from "../trpc";

/**
 * STUDENTS — the identity registry (the admission slice).
 *
 * Routers stay thin: validate, resolve the tenancy filter from ctx, call the
 * service, map an empty result to NOT_FOUND. No business logic, no db access.
 *
 * **Permission strings existed from day one** (`student:create/read/update/
 * delete` in RESOURCE_ACTIONS; principal and vice_principal hold the writes,
 * every staff role holds the read except staff_coordinator — pinned by the
 * smoke matrix). `student:delete` is in SENSITIVE_PERMISSIONS, so its gate
 * re-reads assignments fresh instead of trusting the five-minute snapshot —
 * deactivating a child's record is exactly the call a stale cache must not
 * wave through.
 *
 * B6 owner resolution: a student is not a scope node; `resolveStudentOwner`
 * (exported from trpc.ts, shared with the enrollment track) reads her school
 * from the row. Single-resource reads ask overlap (ADR-028); mutations stay
 * on the default cover. A cross-tenant id and a nonexistent one are the same
 * NOT_FOUND.
 *
 * NO `scope_nodes` writes — students are not in the authorization tree. No
 * delete: hard rule 2, the registry's soft delete is `deactivate` (status
 * `inactive`), and the enrollment/TC flow owns the richer departures.
 */
export const studentRouter = router({
  // Permissive list (ADR-017): a section teacher does not COVER the school
  // node she addresses to search the registry. Active students only — the
  // service documents why (an admission officer's picker must not surface
  // leaving children). `q` is the front-desk search across name parts and
  // admission number.
  list: staffListProcedure("student:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/students",
        tags: ["students"],
        summary: "Search the school's active students",
        protect: true,
      },
    })
    .input(z.object({ q: z.string().min(1).max(100).optional() }))
    .output(z.array(studentSelectSchema))
    .query(async ({ ctx, input }) => {
      return studentService.listStudents(ctx.scopes, input.q);
    }),

  // B6: not a scope node, so the owning branch comes from the resolver and
  // the gate asks overlap (ADR-028). A cross-tenant id and a nonexistent one
  // are the same NOT_FOUND.
  byId: staffProcedure("student:read", {
    resolveOwner: resolveStudentOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/students/{id}",
        tags: ["students"],
        summary: "Get one student",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(studentSelectSchema)
    .query(async ({ ctx, input }) => {
      const student = await studentService.getStudentById(ctx.scope, input.id);

      if (!student) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Student not found." });
      }

      return student;
    }),

  create: staffProcedure("student:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/students",
        tags: ["students"],
        summary: "Admit a student into the registry",
        protect: true,
      },
    })
    // B5: the parent is named in the endpoint's own input, not inherited as an
    // optional scope field — omitting it is a compile error at the call site,
    // not a runtime 500 from requireSchoolId. The service still re-checks:
    // REST callers are not type-checked against this router.
    .input(z.object({ schoolId: z.uuid(), data: createStudentSchema }))
    .output(studentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — students are not in the authorization tree. A
      // duplicate admission number is refused by the unique index and worded
      // by translateErrors (ADR-022).
      return studentService.createStudent(ctx.scope, input.data);
    }),

  // Labels and demographics — the contract omits the admission number and the
  // status (identity and life cycle are not PATCHable). Cover gate (ADR-017
  // strict): reads opt into overlap; writes never do.
  update: staffProcedure("student:update", {
    resolveOwner: resolveStudentOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/students/{id}",
        tags: ["students"],
        summary: "Update a student's details",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateStudentSchema }))
    .output(studentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const student = await studentService.updateStudent(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!student) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Student not found." });
      }

      return student;
    }),

  /**
   * The registry's soft delete (hard rule 2): status becomes `inactive`, and
   * every enrollment, fee row, and result keeps pointing at the child. The
   * richer departures — transferred out with a TC — are the enrollment/TC
   * flow's job.
   */
  deactivate: staffProcedure("student:delete", {
    resolveOwner: resolveStudentOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/students/{id}/deactivate",
        tags: ["students"],
        summary: "Deactivate a student (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(studentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const student = await studentService.deactivateStudent(
        ctx.scope,
        input.id,
      );

      if (!student) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Student not found." });
      }

      return student;
    }),
});

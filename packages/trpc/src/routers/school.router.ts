import { createSchoolSchema, schoolSelectSchema, updateSchoolSchema } from "@repo/contracts";
import { organizationService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * Schools — branches under the organization (ADR-001: the tenant is the org,
 * not the school).
 *
 * Routers stay thin: validate, call the service, return. No business logic and
 * no direct db access here.
 *
 * staffProcedure already contributes organizationId / schoolId / classId /
 * sectionId to the input, so `.input()` below only adds what is specific to the
 * endpoint. It also puts `scope` on ctx — the tenancy filter services require.
 *
 * Each procedure also carries `.meta({ openapi })` and `.output()`, which give
 * it a second life as a REST endpoint under /api and an entry in /docs. The
 * output schema is not decoration: trpc-to-openapi refuses to generate without
 * one, and unlike inference it is a promised shape — a column added to the
 * table later cannot leak into a response without someone widening the schema
 * here first.
 *
 * `protect: true` marks the endpoint as requiring a session in the spec. It
 * documents; it does not enforce. Enforcement is the staff/staffList builder,
 * which runs identically on both transports.
 */
export const schoolRouter = router({
  // A list, so the permissive builder: a principal scoped to one branch does
  // not "cover" the org node they address here, but must still see their own
  // branch. ctx.scopes is already clipped to the addressed subtree.
  list: staffListProcedure("school:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/schools",
        tags: ["schools"],
        summary: "List schools the caller may see",
        protect: true,
      },
    })
    .output(z.array(schoolSelectSchema))
    .query(async ({ ctx }) => {
      return organizationService.listSchools(ctx.scopes);
    }),

  byId: staffProcedure("school:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/schools/{id}",
        tags: ["schools"],
        summary: "Get one school",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(schoolSelectSchema)
    .query(async ({ ctx, input }) => {
      const school = await organizationService.getSchoolById(ctx.scope, input.id);

      // Out of scope and non-existent are both NOT_FOUND: telling them apart
      // would confirm that an id exists in another tenant.
      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),

  create: staffProcedure("school:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/schools",
        tags: ["schools"],
        summary: "Create a school",
        protect: true,
      },
    })
    .input(z.object({ data: createSchoolSchema }))
    .output(schoolSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // The service creates the school and its scope_nodes row in one
      // transaction (hard rule 12).
      return organizationService.createSchool(ctx.organizationId, input.data);
    }),

  update: staffProcedure("school:update")
    .meta({
      openapi: {
        method: "PATCH",
        path: "/schools/{id}",
        tags: ["schools"],
        summary: "Update a school",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateSchoolSchema }))
    .output(schoolSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const school = await organizationService.updateSchool(ctx.scope, input.id, input.data);

      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),

  /**
   * Soft delete (hard rule 2) — the school's records must stay reachable.
   *
   * POST to a sub-resource rather than DELETE /schools/{id}: the row survives,
   * and a REST client seeing DELETE would reasonably assume otherwise.
   */
  deactivate: staffProcedure("school:delete")
    .meta({
      openapi: {
        method: "POST",
        path: "/schools/{id}/deactivate",
        tags: ["schools"],
        summary: "Deactivate a school (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(schoolSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const school = await organizationService.deactivateSchool(ctx.scope, input.id);

      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),
});

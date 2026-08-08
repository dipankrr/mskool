import { createSchoolSchema, updateSchoolSchema } from "@repo/contracts";
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
 */
export const schoolRouter = router({
  // A list, so the permissive builder: a principal scoped to one branch does
  // not "cover" the org node they address here, but must still see their own
  // branch. ctx.scopes is already clipped to the addressed subtree.
  list: staffListProcedure("school:read").query(async ({ ctx }) => {
    return organizationService.listSchools(ctx.scopes);
  }),


  byId: staffProcedure("school:read")
    .input(z.object({ id: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const school = await organizationService.getSchoolById(
        ctx.scope,
        input.id,
      );

      // Out of scope and non-existent are both NOT_FOUND: telling them apart
      // would confirm that an id exists in another tenant.
      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),

  create: staffProcedure("school:create")
    .input(z.object({ data: createSchoolSchema }))
    .mutation(async ({ ctx, input }) => {
      // The service creates the school and its scope_nodes row in one
      // transaction (hard rule 12).
      return organizationService.createSchool(ctx.organizationId, input.data);
    }),

  update: staffProcedure("school:update")
    .input(z.object({ id: z.uuid(), data: updateSchoolSchema }))
    .mutation(async ({ ctx, input }) => {
      const school = await organizationService.updateSchool(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),

  /** Soft delete (hard rule 2) — the school's records must stay reachable. */
  deactivate: staffProcedure("school:delete")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const school = await organizationService.deactivateSchool(
        ctx.scope,
        input.id,
      );

      if (!school) {
        throw new TRPCError({ code: "NOT_FOUND", message: "School not found." });
      }

      return school;
    }),
});

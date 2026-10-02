import {
  addGuardianInput,
  detachGuardianInput,
  guardianViewSchema,
  updateGuardianInput,
} from "@repo/contracts";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { guardianService } from "@repo/services";
import { resolveStudentOwner, router, staffProcedure } from "../trpc";

/**
 * GUARDIANS — parents' contact truth on the staff track (ADR-037's
 * follow-up: the family login follows the contact record, so nobody types
 * digits into a credential UI).
 *
 * Gates are the STUDENT family's own permissions, not new ones: a guardian
 * is a student's contact record, so reading one is `student:read` and
 * writing one is `student:update`. No dedicated guardian resource exists in
 * `RESOURCE_ACTIONS`, and inventing one would leave orgs editing nothing.
 *
 * Every procedure addresses the STUDENT, not the guardian: a guardian has
 * no scope node of its own, so `resolveStudentOwner` resolves the owning
 * branch from the student row and a cross-tenant student id is the same
 * NOT_FOUND a nonexistent one is. The read is `gate: "overlap"` (ADR-028)
 * — the profile page legitimately reads a student whose grant does not
 * cover their posting.
 */
export const guardianRouter = router({
  list: staffProcedure("student:read", {
    resolveOwner: resolveStudentOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/students/{id}/guardians",
        tags: ["guardians"],
        summary: "A student's guardians, with each family's login state",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(z.array(guardianViewSchema))
    .query(({ ctx, input }) =>
      guardianService.listForStudent(ctx.scope, input.id),
    ),

  add: staffProcedure("student:update", { resolveOwner: resolveStudentOwner })
    .meta({
      openapi: {
        method: "POST",
        path: "/students/{id}/guardians",
        tags: ["guardians"],
        summary: "Add a guardian (links their phone automatically)",
        protect: true,
      },
    })
    .input(addGuardianInput.extend({ id: z.uuid() }))
    .output(guardianViewSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      const { id: studentId, ...data } = input;
      const row = await guardianService.addGuardian(ctx.scope, ctx.userId, {
        studentId,
        ...data,
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Student not found.",
        });
      }
      return row;
    }),

  update: staffProcedure("student:update", { resolveOwner: resolveStudentOwner })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/students/{id}/guardians/{guardianId}",
        tags: ["guardians"],
        summary: "Correct a guardian (phone moves the login)",
        protect: true,
      },
    })
    .input(updateGuardianInput.extend({ id: z.uuid() }))
    .output(guardianViewSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      const { id: studentId, ...data } = input;
      const row = await guardianService.updateGuardian(ctx.scope, ctx.userId, {
        studentId,
        ...data,
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That guardian is not linked to this student.",
        });
      }
      return row;
    }),

  /**
   * Closes the relation (custody change, correction): `endedOn` stamped,
   * portal access off, links revoked unless the digits are still shared.
   * Gated `student:update` — it is a correction of contact truth, and the
   * family-login consequence is the service's business.
   */
  detach: staffProcedure("student:update", { resolveOwner: resolveStudentOwner })
    .meta({
      openapi: {
        method: "POST",
        path: "/students/{id}/guardians/{guardianId}/detach",
        tags: ["guardians"],
        summary: "End a guardian relation (revokes the family login for this student)",
        protect: true,
      },
    })
    .input(detachGuardianInput.extend({ id: z.uuid() }))
    .output(guardianViewSchema.nullable())
    .mutation(async ({ ctx, input }) => {
      const { id: studentId, ...data } = input;
      const row = await guardianService.detachGuardian(ctx.scope, ctx.userId, {
        studentId,
        ...data,
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That guardian is not linked to this student.",
        });
      }
      return row;
    }),
});
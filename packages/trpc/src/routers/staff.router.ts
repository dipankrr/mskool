import {
  createStaffLoginInput,
  createStaffSchema,
  deactivateStaffSchema,
  resetStaffLoginInput,
  imageRefSchema,
  staffSelectSchema,
  staffWithPhotoSchema,
  updateStaffSchema,
  uploadRequestSchema,
  uploadTicketSchema,
} from "@repo/contracts";
import { staffPhotoService, staffService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * STAFF — the employment register and its login provisioning (ADR-008,
 * ADR-035).
 *
 * The register is CRUD in the students-slice shape; the login endpoints are
 * the one credential-shaped concern, and their gates are deliberately
 * `staff:update` — provisioning a login is an act on the EMPLOYMENT record
 * (an org hands its own staff a credential; it is not an authorization
 * change, which is `role_assignment`'s job and carries its own SENSITIVE
 * permissions). Every login act writes an audit row (ADR-035), and the
 * service owns `must_change_password` — never the client.
 *
 * NOT in the scope tree — no `scope_nodes` writes. `resolveStaffOwner` reads
 * the owning branch from the row; a cross-tenant id and a nonexistent one
 * are the same NOT_FOUND. No delete: hard rule 2, the register's soft
 * delete is `deactivate` with an honest leaving status.
 */
const resolveStaffOwner = async (organizationId: string, id: string) => {
  const schoolId = await staffService.getStaffOwnerId(organizationId, id);

  if (!schoolId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
  }

  return { type: "school", id: schoolId };
};

export const staffRouter = router({
  // Permissive list (ADR-017): an HR coordinator does not COVER the org node
  // she addresses to search the register. Active only unless the caller asks
  // for history explicitly.
  list: staffListProcedure("staff:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/staff",
        tags: ["staff"],
        summary: "Search the branch's staff register",
        protect: true,
      },
    })
    .input(
      z.object({
        q: z.string().min(1).max(100).optional(),
        includeInactive: z.boolean().optional(),
      }),
    )
    .output(z.array(staffWithPhotoSchema))
    .query(async ({ ctx, input }) => {
      const rows = await staffService.listStaff(ctx.scopes, input.q, input.includeInactive);
      const photos = await staffPhotoService.many(
        input.organizationId,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({ ...row, photo: photos.get(row.id) ?? null }));
    }),

  byId: staffProcedure("staff:read", {
    resolveOwner: resolveStaffOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/staff/{id}",
        tags: ["staff"],
        summary: "Get one staff member",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(staffWithPhotoSchema)
    .query(async ({ ctx, input }) => {
      const row = await staffService.getStaffById(ctx.scope, input.id);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return { ...row, photo: await staffPhotoService.get(ctx.scope.organizationId, row.id) };
    }),

  create: staffProcedure("staff:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/staff",
        tags: ["staff"],
        summary: "Add a staff member to the register",
        protect: true,
      },
    })
    // B5: the parent (the primary posting) is named in the endpoint's own
    // input. The service re-checks: REST callers are not type-checked
    // against this router.
    .input(z.object({ schoolId: z.uuid(), data: createStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — staff are not in the authorization tree. A
      // duplicate employee code is refused by the unique index and worded
      // by translateErrors (ADR-022). No login is created — ADR-035 keeps
      // the credential a separate, audited act.
      return staffService.createStaff(ctx.scope, input.data);
    }),

  update: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/staff/{id}",
        tags: ["staff"],
        summary: "Update a staff member's details",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.updateStaff(ctx.scope, input.id, input.data);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * The register's soft delete (hard rule 2): the status records WHY the
   * employment ends, and the service stamps `dateOfLeaving` for departures.
   * Role assignments are NOT touched here — revoking them is an explicit,
   * audited act (the UI warns; ADR-035 defers deprovisioning automation).
   */
  deactivate: staffProcedure("staff:delete", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/deactivate",
        tags: ["staff"],
        summary: "Deactivate a staff member (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: deactivateStaffSchema }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.deactivateStaff(ctx.scope, input.id, input.data);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * The way back from a deactivation (M7): suspension ends, a resignation
   * is withdrawn, a mistake is undone. Gated `staff:delete` like the
   * deactivation it reverses. Assignments and sessions are deliberately
   * untouched (ADR-035 defers deprovisioning automation) — the login card
   * says so where the credential lives.
   */
  reactivate: staffProcedure("staff:delete", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/reactivate",
        tags: ["staff"],
        summary: "Reactivate a staff member",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.reactivateStaff(ctx.scope, input.id);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * ADR-035: first credential. The initial password is a hand-off secret;
   * the service forces a change at first sign-in and audits the issue.
   * Gated on `staff:update` — see the file comment for why it is not its
   * own permission.
   */
  createLogin: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/login",
        tags: ["staff"],
        summary: "Provision a staff login (initial password, forced change)",
        protect: true,
      },
    })
    .input(createStaffLoginInput.extend({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.createLogin(ctx.scope, ctx.userId, input.id, input.password);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  /**
   * ADR-035: re-issue a credential. The forced-change flag returns and every
   * live session dies — the same takeover-closing discipline as the portal's
   * reset.
   */
  resetLogin: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/staff/{id}/login/reset",
        tags: ["staff"],
        summary: "Reset a staff login (forced change, sessions revoked)",
        protect: true,
      },
    })
    .input(resetStaffLoginInput.extend({ id: z.uuid() }))
    .output(staffSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const row = await staffService.resetLogin(ctx.scope, ctx.userId, input.id, input.password);

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Staff member not found." });
      }

      return row;
    }),

  // ── The staff member's photo (ADR-068) ──────────────────────────────────
  // The office's side, gated on the record like the student photo. The
  // staff member's own side lives on `me` (me.photoUpload / me.setPhoto).

  /** A link to PUT this staff member's new photo to (ADR-063). */
  photoUpload: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid(), file: uploadRequestSchema }))
    .output(uploadTicketSchema)
    .mutation(({ ctx, input }) =>
      staffPhotoService.upload(ctx.scope.organizationId, input.id, input.file, ctx.userId),
    ),

  /** Makes an uploaded file this staff member's photo. */
  setPhoto: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid(), objectId: z.uuid() }))
    .output(z.object({ photo: imageRefSchema.nullable() }))
    .mutation(async ({ ctx, input }) => ({
      photo: await staffPhotoService.set(ctx.scope.organizationId, input.id, input.objectId, ctx.userId),
    })),

  removePhoto: staffProcedure("staff:update", {
    resolveOwner: resolveStaffOwner,
  })
    .input(z.object({ id: z.uuid() }))
    .output(z.object({ removed: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      removed: await staffPhotoService.remove(ctx.scope.organizationId, input.id),
    })),
});

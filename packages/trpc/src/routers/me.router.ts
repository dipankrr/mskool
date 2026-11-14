import { getOwnedStudentIds, getUserAuthCache } from "@repo/authz";
import {
  imageRefSchema,
  meSchema,
  uploadRequestSchema,
  uploadTicketSchema,
} from "@repo/contracts";
import { identityService, staffPhotoService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * The caller's own identity and access. The client's first call after sign-in.
 *
 * Deliberately NOT a staffProcedure. That builder requires `organizationId` in
 * its input and resolves a scope node from it — but this endpoint is how the
 * client discovers which orgs it may name in the first place. Gating it behind
 * an org id would be circular, and inventing one client-side is precisely the
 * cross-tenant move the staff builders exist to prevent.
 *
 * protectedProcedure is the right level: a valid session and nothing more. It
 * is safe because the response is derived entirely from the caller's own
 * assignments — there is no input to tamper with, and a user with no roles gets
 * an empty list rather than someone else's org.
 */
export const meRouter = router({
  get: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/me",
        tags: ["me"],
        summary: "The signed-in user, their organizations and their access",
        protect: true,
      },
    })
    .input(z.undefined())
    .output(meSchema)
    .query(async ({ ctx }) => {
      const { user } = ctx.session;

      // Not skipCache: this runs on every page load, and a stale role here only
      // affects which menu items render. Every action the UI offers is
      // re-checked server-side by can(), where SENSITIVE_PERMISSIONS bypasses
      // the cache anyway.
      const authCache = await getUserAuthCache(user.id);

      // ADR-007/008: the portal identity. The same ownership list every
      // portal.* query filters by (getOwnedStudentIds) — surfaced once here so
      // the client can route a family login to the portal shell instead of the
      // staff one. No staff assignments does not mean "no access".
      const ownedStudentIds = await getOwnedStudentIds(user.id);

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email ?? null,
          image: user.image ?? null,
          // Column default is false but the column is nullable, so a row
          // predating the default reads as null rather than false.
          isSuperAdmin: user.isSuperAdmin ?? false,
          // ADR-007: the credential state, from the session (better-auth's
          // user row). Drives the forced first-login change screen.
          mustChangePassword: (user as { mustChangePassword?: boolean | null }).mustChangePassword ?? false,
        },
        memberships: await identityService.getMemberships(authCache),
        portal: ownedStudentIds.length > 0 ? { studentIds: ownedStudentIds } : null,
      };
    }),

  // ── My own photo (ADR-068) ────────────────────────────────────────────────
  // A staff member may set the photo on their OWN record, with no permission:
  // the record is found from the session's user id, never from the input, so
  // the only thing a caller can name is an organisation they work in.
  // Office edits go through staff.setPhoto (staff:update).

  photo: protectedProcedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.object({ photo: imageRefSchema.nullable() }))
    .query(async ({ ctx, input }) => {
      const staffId = await ownStaff(input.organizationId, ctx.session.user.id);
      return { photo: await staffPhotoService.get(input.organizationId, staffId) };
    }),

  photoUpload: protectedProcedure
    .input(z.object({ organizationId: z.uuid(), file: uploadRequestSchema }))
    .output(uploadTicketSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const staffId = await ownStaff(input.organizationId, userId);
      return staffPhotoService.upload(input.organizationId, staffId, input.file, userId);
    }),

  setPhoto: protectedProcedure
    .input(z.object({ organizationId: z.uuid(), objectId: z.uuid() }))
    .output(z.object({ photo: imageRefSchema.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const staffId = await ownStaff(input.organizationId, userId);
      return {
        photo: await staffPhotoService.set(input.organizationId, staffId, input.objectId, userId),
      };
    }),

  removePhoto: protectedProcedure
    .input(z.object({ organizationId: z.uuid() }))
    .output(z.object({ removed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const staffId = await ownStaff(input.organizationId, ctx.session.user.id);
      return { removed: await staffPhotoService.remove(input.organizationId, staffId) };
    }),
});

/** The caller's own staff record in this organisation, or NOT_FOUND. */
async function ownStaff(organizationId: string, userId: string): Promise<string> {
  const staffId = await staffPhotoService.ownStaffId(organizationId, userId);
  if (!staffId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "You have no staff record here." });
  }
  return staffId;
}

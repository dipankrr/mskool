import {
  activatePortalAccessInput,
  changePortalPhoneInput,
  portalAccessSelectSchema,
  resetPortalPasswordInput,
} from "@repo/contracts";
import { z } from "zod";

import { portalAccessService } from "@repo/services";
import { staffProcedure } from "../trpc";

/**
 * PORTAL ACCESS — staff administration of the family login's credential
 * (ADR-007). Each action is its OWN permission, because each is a
 * takeover-shaped act: activation mints the credential, a password reset
 * kills every session, and the phone change moves the login itself. All
 * three write audit rows and revoke sessions where a session could
 * outlive the change — the service owns the sequencing.
 *
 * No resolveOwner by the same reasoning as eligibility.override: the input
 * names a studentId, not one row id, and the permissions are SENSITIVE, so
 * the gate re-reads assignments fresh on every call. Tenancy is the
 * service's school check (accessForStudent) — a foreign studentId returns
 * null, never a credential.
 */
export const portalAccessRouter = {
  activate: staffProcedure("portal_access:activate")
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/activate",
        tags: ["portal"],
        summary: "Set a student's family login (phone + initial password)",
        protect: true,
      },
    })
    .input(activatePortalAccessInput)
    .output(portalAccessSelectSchema.nullable())
    .mutation(({ ctx, input }) =>
      portalAccessService.activate(ctx.scope, ctx.userId, input),
    ),

  resetPassword: staffProcedure("portal_access:reset_password")
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/reset-password",
        tags: ["portal"],
        summary: "Re-issue a family login's password (revokes sessions)",
        protect: true,
      },
    })
    .input(resetPortalPasswordInput)
    .output(z.boolean().nullable())
    .mutation(({ ctx, input }) =>
      portalAccessService.resetPassword(ctx.scope, ctx.userId, input),
    ),

  changePhone: staffProcedure("portal_access:change_phone")
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/change-phone",
        tags: ["portal"],
        summary:
          "Change a family login's phone credential (audit + session revocation)",
        protect: true,
      },
    })
    .input(changePortalPhoneInput)
    .output(z.boolean().nullable())
    .mutation(({ ctx, input }) =>
      portalAccessService.changePhone(ctx.scope, ctx.userId, input),
    ),
};

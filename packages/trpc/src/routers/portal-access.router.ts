import {
  activatePortalAccessInput,
  changePortalPhoneInput,
  ensurePortalLinkInput,
  portalAccessSelectSchema,
  portalLinkStatusSchema,
  resetPortalPasswordInput,
  revokePortalLinkInput,
  verifyPortalLinkInput,
} from "@repo/contracts";
import { z } from "zod";

import { portalAccessService } from "@repo/services";
import { protectedProcedure, staffProcedure } from "../trpc";

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

  /**
   * GLOBAL IDENTITY (ADR-037) — staff links a guardian phone, no secret.
   * The link starts pending; the parent activates it from home via the
   * public claim endpoint. Legacy activate/reset/changePhone above stay for
   * existing slug-username rows until the migration runbook runs.
   */
  ensureLink: staffProcedure("portal_access:activate")
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/ensure-link",
        tags: ["portal"],
        summary: "Link a guardian phone to a student (pending, no password)",
        protect: true,
      },
    })
    .input(ensurePortalLinkInput)
    .output(portalAccessSelectSchema.nullable())
    .mutation(({ ctx, input }) =>
      portalAccessService.ensureLink(ctx.scope, ctx.userId, input),
    ),

  /** One student's link rows: whose login, which state, secret or not. */
  status: staffProcedure("portal_access:activate")
    .meta({
      openapi: {
        method: "GET",
        path: "/portal-access/status",
        tags: ["portal"],
        summary: "Family login links for one student",
        protect: true,
      },
    })
    .input(z.object({ studentId: z.uuid() }))
    .output(z.array(portalLinkStatusSchema))
    .query(({ ctx, input }) =>
      portalAccessService.linkStatus(ctx.scope, input.studentId),
    ),

  /**
   * Second-kid proof for a signed-in login: activates the caller's own
   * pending link with that kid's pair. No password change, ever — a missing
   * link and a wrong pair are the same uniform refusal.
   */
  verifyLink: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/verify-link",
        tags: ["portal"],
        summary: "Activate one more linked child (admission-no proof)",
        protect: true,
      },
    })
    .input(verifyPortalLinkInput)
    .output(z.boolean())
    .mutation(({ ctx, input }) =>
      portalAccessService.verifyLink(ctx.session.user.id, input),
    ),

  /**
   * Staff revokes one login's access to one student (custody, correction).
   * Gated change_phone — the strictest family act — until a dedicated
   * permission exists (recorded, not silent).
   */
  revokeLink: staffProcedure("portal_access:change_phone")
    .meta({
      openapi: {
        method: "POST",
        path: "/portal-access/revoke-link",
        tags: ["portal"],
        summary: "Revoke one login's access to one student",
        protect: true,
      },
    })
    .input(revokePortalLinkInput)
    .output(z.boolean().nullable())
    .mutation(({ ctx, input }) =>
      portalAccessService.revokeLink(ctx.scope, ctx.userId, input),
    ),
};

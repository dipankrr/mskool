import {
  ensurePortalLinkInput,
  portalAccessSelectSchema,
  portalLinkStatusSchema,
  revokePortalLinkInput,
  verifyPortalLinkInput,
} from "@repo/contracts";
import { z } from "zod";

import { portalAccessService } from "@repo/services";
import { protectedProcedure, staffProcedure } from "../trpc";

/**
 * PORTAL ACCESS — the family login's links (ADR-007 + ADR-008, global
 * identity per ADR-037). One phone is one login across schools and trusts;
 * which kids it sees is one link row per child. Staff link phones (no
 * secrets — parents set their own passwords from home via the public
 * claim endpoint); the link lifecycle is pending → active → revoked.
 */
export const portalAccessRouter = {
  /**
   * Staff links a guardian phone: the global user on first sight, a PENDING
   * link otherwise. The parent activates it from home via the public claim
   * endpoint — no secret is ever typed or handed over here.
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

import { getUserAuthCache } from "@repo/authz";
import { meSchema } from "@repo/contracts";
import { identityService } from "@repo/services";
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

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email ?? null,
          image: user.image ?? null,
          // Column default is false but the column is nullable, so a row
          // predating the default reads as null rather than false.
          isSuperAdmin: user.isSuperAdmin ?? false,
        },
        memberships: await identityService.getMemberships(authCache),
      };
    }),
});

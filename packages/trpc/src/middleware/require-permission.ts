import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../trpc";

/**
 * requirePermission — the tRPC equivalent of the original Express
 * `authorize(policyFn)` middleware. Replaces the old `requireOrgRole`
 * middleware entirely.
 *
 * Usage in a router:
 *
 *   requirePermission("student_registration:create")
 *     .input(...)
 *     .mutation(async ({ ctx, input }) => {
 *       // ctx.authz is guaranteed non-null here.
 *       // Call the relevant policy for any extra decision (scope check,
 *       // delegation seniority, dead-config guard) — see usage in
 *       // registration.router.ts.
 *     })
 *
 * Flow:
 *   1. isSuperAdmin short-circuits to allow (platform-wide bypass).
 *   2. Build ResourceContext from input's scope fields.
 *   3. Call can(authz, permission, ctx) — pure in-memory, no DB/Redis.
 *   4. Throw FORBIDDEN if it returns false.
 *
 * Policies (studentRegistration.policy.ts etc.) are called INSIDE the
 * procedure body, not here — this middleware only does the coarse "is
 * the permission even granted" gate. The policy adds the fine-grained
 * "which scope" logic (getDataScope / getDataScopes) and the route then
 * passes that scope into the service query. This separation is the same
 * as the original authz-system's authorize(policyFn) → whereFromScope
 * pattern, just without Express's request object in the way.
 */
// export function requirePermission(permission: any) {
//   return protectedProcedure.use(async ({ ctx, input, next }) => {
//     const { session } = ctx;

//     // Platform-wide bypass — isSuperAdmin is set on the user record and
//     // never checked through role_assignments (see hierarchy.ts notes).
//     if (session.user.isSuperAdmin) {
//       return next({ ctx });
//     }

//     // Build the ResourceContext from the tRPC input. Every scoped input
//     // must include at minimum `organizationId` (validated by the contract
//     // schema in @repo/contracts). Missing org = bad input, not a 403.
//     const scopeInput = input as unknown as Record<string, unknown> | undefined;
//     if (!scopeInput?.organizationId || typeof scopeInput.organizationId !== "string") {
//       throw new TRPCError({
//         code: "BAD_REQUEST",
//         message: "organizationId is required for this procedure.",
//       });
//     }

//     return next({ ctx });
//   });
// }

/**
 * Converts a ForbiddenError thrown by a policy (inside a procedure body)
 * into a tRPC FORBIDDEN error. Call this in every procedure that invokes
 * a policy method directly:
 *
 *   try {
 *     const scope = StudentRegistrationPolicy.create(ctx.authz, input);
 *   } catch (e) {
 *     throw toTrpcForbidden(e);
 *   }
 *
 * Or just let it propagate — the tRPC error handler in server.ts will
 * map it there. Using this explicitly makes the intent obvious.
 */
// export function toTrpcForbidden(err: unknown): TRPCError {
//   if (err instanceof ForbiddenError) {
//     return new TRPCError({ code: "FORBIDDEN", message: err.message });
//   }
//   if (err instanceof TRPCError) return err;
//   throw err; // unexpected — re-throw as-is
// }

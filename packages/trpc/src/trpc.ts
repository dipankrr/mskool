import {
  can,
  getDataScope,
  getDataScopes,
  getOwnedStudentIds,
  getUserAuthCache,
  loadScopeNode,
  orgScopeNode,
  SENSITIVE_PERMISSIONS,
  type DataScope,
  type Permission,
  type ResourceContext,
} from "@repo/authz";
import { initTRPC, TRPCError } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z } from "zod";
import type { Context } from "./context";

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;

/**
 * A valid session, nothing more. Use this only where the caller may be either
 * staff or a student — "who am I", "sign out". Anything touching school data
 * must use staffProcedure or studentProcedure, which carry a tenancy filter.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/**
 * Every staff call names the org it is acting in, and optionally a narrower
 * node. The node is resolved from the most specific id present, which is why
 * URLs do not have to encode the whole hierarchy.
 */
const staffScopeInput = z.object({
  organizationId: z.uuid(),
  schoolId: z.uuid().optional(),
  classId: z.uuid().optional(),
  sectionId: z.uuid().optional(),
});

/**
 * The STAFF track (ADR-005). Resolves the request's scope node, checks the
 * permission, and puts a DataScope on the context.
 *
 *   staffProcedure("student:read").input(...).query(...)
 *
 * The procedure hands the handler `scope` (single-resource filter) and
 * `scopes` (list filter, for a teacher holding several non-overlapping
 * assignments). Services take these as required arguments, so a query without
 * a tenancy filter does not compile — hard rule 1 enforced by the type system
 * rather than by review.
 *
 * Permissions in SENSITIVE_PERMISSIONS bypass the Redis snapshot and re-read
 * from Postgres: a revoked approver must lose the ability to approve
 * immediately, not at the end of a cache TTL.
 */
export function staffProcedure(permission: Permission) {
  return t.procedure
    .input(staffScopeInput)
    .use(async ({ ctx, input, next }) => {
      if (!ctx.session) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Sign in required.",
        });
      }

      const userId = ctx.session.user.id;
      const { organizationId, schoolId, classId, sectionId } = input;

      // Most specific wins: a section id implies its class and school.
      const nodeId = sectionId ?? classId ?? schoolId ?? organizationId;

      const node =
        nodeId === organizationId
          ? orgScopeNode(organizationId)
          : await loadScopeNode(nodeId, organizationId);

      // Missing node and wrong-tenant node are the same 403 on purpose: a
      // different message would let a caller probe which ids exist elsewhere.
      if (!node) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this resource.",
        });
      }

      const authCache = await getUserAuthCache(userId, {
        skipCache: SENSITIVE_PERMISSIONS.has(permission),
      });

      const resourceCtx: ResourceContext = { organizationId, nodeId, node };

      if (!can(authCache, permission, resourceCtx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Missing permission: ${permission}`,
        });
      }

      const scope = getDataScope(authCache, permission, resourceCtx);
      if (!scope) {
        // can() said yes, so this is unreachable unless the two disagree.
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "No data scope for this permission.",
        });
      }

      return next({
        ctx: {
          ...ctx,
          session: ctx.session,
          userId,
          organizationId,
          authCache,
          /** Tenancy filter for single-resource reads and writes. */
          scope,
          /** All granting scopes, for list endpoints. OR these together. */
          scopes: getDataScopes(authCache, permission, organizationId),
        },
      });
    });
}

/**
 * The STUDENT track (ADR-005). No permission gate and no role lookup —
 * students hold no role_assignments and never reach can().
 *
 * Authorization is ownership: the requested studentId must appear in this
 * user's student_portal_access rows. One parent login may cover several
 * children, so `studentIds` is a list and the handler filters by it.
 *
 * Namespace these routers `portal.*`, and remember hard rule 8 — student-facing
 * results come from published_report_cards only.
 */
export const studentProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in required." });
  }

  const userId = ctx.session.user.id;
  const studentIds = await getOwnedStudentIds(userId);

  if (studentIds.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This account has no portal access.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      userId,
      /** Every student this login may act for. Filter all queries by this. */
      studentIds,
      /**
       * Confirms the requested student belongs to this login. Call it before
       * returning anything about a specific child — passing a studentId
       * straight from input to a query is the leak this prevents.
       */
      assertOwnsStudent(studentId: string) {
        if (!studentIds.includes(studentId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not have access to this student.",
          });
        }
      },
    },
  });
});

export type StaffDataScope = DataScope;

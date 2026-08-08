import {
  can,
  dataScopeFromNode,
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
 * must use a staff or student procedure, which carry a tenancy filter.
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
 * There are two different authorization questions, and mixing them up is how
 * a tenancy filter goes wrong:
 *
 *   staffProcedure      "may you act on THIS node?"        → ctx.scope
 *   staffListProcedure  "what may you see UNDER this node?" → ctx.scopes
 *
 * They are separate builders on purpose. A single builder that answered
 * whichever question the input happened to imply would let a mutation
 * addressed at the org node pass on the strength of a section-level grant.
 */

/** Resolves the addressed node, or 403s. Shared by both staff builders. */
async function resolveNode(organizationId: string, nodeId: string) {
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

  return node;
}

/** Most specific wins: a section id implies its class and school. */
function addressedNodeId(input: z.infer<typeof staffScopeInput>) {
  return input.sectionId ?? input.classId ?? input.schoolId ?? input.organizationId;
}

/**
 * STRICT staff track (ADR-005). For reads of a single resource and for all
 * mutations.
 *
 *   staffProcedure("school:update").input(...).mutation(...)
 *
 * Requires an assignment that COVERS the addressed node, so a section-scoped
 * teacher cannot act at org level. The handler receives `scope` — the addressed
 * node's own scope, not the granting assignment's.
 *
 * That distinction is the fix for a real bug: taking the filter from the
 * matching assignment meant a class-scoped teacher asking about section 7B got
 * a filter covering the whole of class 7, and every row in it.
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
      const { organizationId } = input;

      const node = await resolveNode(organizationId, addressedNodeId(input));

      const authCache = await getUserAuthCache(userId, {
        skipCache: SENSITIVE_PERMISSIONS.has(permission),
      });

      const resourceCtx: ResourceContext = {
        organizationId,
        nodeId: node.id,
        node,
      };

      if (!can(authCache, permission, resourceCtx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Missing permission: ${permission}`,
        });
      }

      return next({
        ctx: {
          ...ctx,
          session: ctx.session,
          userId,
          organizationId,
          authCache,
          /**
           * The addressed node's scope. can() has already confirmed the user
           * covers it, so this is the narrowest correct filter — narrower than
           * the grant, which is what the caller asked about.
           */
          scope: dataScopeFromNode(node),
        },
      });
    });
}

/**
 * PERMISSIVE staff track. For list endpoints only.
 *
 *   staffListProcedure("school:read").query(...)
 *
 * Asks the opposite question to staffProcedure: not "do you cover this node"
 * but "which of your grants fall inside it". A principal scoped to one branch
 * listing schools addresses the org node, which their grant does not cover —
 * under the strict check that is a 403, yet listing their own branch is
 * exactly what the school switcher needs.
 *
 * The handler receives `scopes`, already clipped to the addressed subtree, to
 * be ORed by scopeWhere(). Clipping happens in getDataScopes(); a grant in
 * another school cannot survive it, so it can never reach the OR.
 */
export function staffListProcedure(permission: Permission) {
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
      const { organizationId } = input;

      const node = await resolveNode(organizationId, addressedNodeId(input));

      const authCache = await getUserAuthCache(userId, {
        skipCache: SENSITIVE_PERMISSIONS.has(permission),
      });

      const scopes = getDataScopes(
        authCache,
        permission,
        dataScopeFromNode(node),
      );

      // Empty means no grant overlaps the addressed subtree. It must never be
      // read as "unfiltered" — scopeWhere() throws on an empty list for the
      // same reason.
      if (scopes.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Missing permission: ${permission}`,
        });
      }

      return next({
        ctx: {
          ...ctx,
          session: ctx.session,
          userId,
          organizationId,
          authCache,
          /** Granted subtrees within the addressed node. OR these. */
          scopes,
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

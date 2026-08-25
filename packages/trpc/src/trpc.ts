import {
  can,
  dataScopeFromNode,
  getDataScopes,
  getOwnedStudentIds,
  getUserAuthCache,
  loadScopeNode,
  orgScopeNode,
  permissionsInOrg,
  SENSITIVE_PERMISSIONS,
  type DataScope,
  type Permission,
  type ResourceContext,
  type UserAuthCache,
} from "@repo/authz";
import { initTRPC, TRPCError } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import { z } from "zod";
import type { Context } from "./context";
import { translateError } from "./errors";

const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();

export const router = t.router;
export const middleware = t.middleware;

/**
 * Turns a database or service failure into something the user can act on
 * (ADR-026). The mapping itself is in `errors.ts`; this is only the seam.
 *
 * Applied FIRST on both staff builders, so it wraps the authorization
 * middleware as well as the resolver. That is deliberate: `getUserAuthCache`
 * talks to Redis and `loadScopeNode` to Postgres, and an outage in either
 * currently reaches the client as a connection string.
 *
 * **This reads a return value rather than using try/catch, and that is not a
 * style choice.** tRPC does not rethrow out of `next()`. It catches whatever the
 * resolver threw, wraps it in an INTERNAL_SERVER_ERROR `TRPCError` whose message
 * is the original exception's, and hands it back as `{ ok: false }`. A
 * try/catch here would compile, read correctly, and never fire.
 *
 * Not on `protectedProcedure` or `studentProcedure`. Every write that can trip a
 * constraint is a staff call, and both of those tracks only read today; ADR-026
 * records the boundary and when widening it becomes worthwhile.
 */
const translateErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;

  const error = translateError(result.error);

  // The client now gets deliberately vague wording, so the detail has to land
  // somewhere or an untranslated failure becomes invisible — worse than the
  // leak this replaces. There is no logger in this package yet; when there is,
  // this is the call site.
  if (error.code === "INTERNAL_SERVER_ERROR") {
    console.error("[trpc] untranslated error:", error.cause ?? result.error);
  }

  throw error;
});

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
 * THE TWO 403s, DISTINGUISHED (ADR-026 amendment).
 *
 * "May not act on this node" has two different causes with two different fixes:
 * the caller's role lacks the permission entirely — a role change for an admin —
 * or their role has it but their grant does not reach this node — usually an
 * addressing or assignment-scope problem, and the single most common real-world
 * support question ("why can she see Class 6 but not Class 7?"). Both used to
 * read `Missing permission: X`, which told the reader to fix the wrong thing.
 *
 * The out-of-scope wording names the NODE TYPE rather than its id: the id is
 * meaningless to the reader and the type is the actionable part. Both messages
 * disclose only the caller's own grant state, which `/me` already shows them.
 *
 * The distinction costs nothing extra at the gate: `can()` already ran, and
 * this asks the org-level question the cache can answer without I/O.
 */
function forbiddenMessage(
  authCache: UserAuthCache,
  organizationId: string,
  permission: Permission,
  nodeType: string,
): string {
  const heldInOrg = permissionsInOrg(authCache, organizationId).includes(permission);

  return heldInOrg
    ? `A role you hold has ${permission} but not at this ${nodeType}.`
    : `Missing permission: ${permission}`;
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
    .use(translateErrors)
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
          message: forbiddenMessage(authCache, organizationId, permission, node.type),
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
          /**
           * Re-runs the STRICT check against this same node for a SECOND
           * permission, beyond the one that gated entry. The academic router
           * uses it to fold `academic_year:read_history` into a row filter: the
           * endpoint is gated on `academic_year:read`, and whether the caller
           * ALSO holds read_history decides if a non-current session is
           * addressable (ADR-024). Bound to the already-resolved node so a
           * caller cannot smuggle in a different one.
           */
          can: (p: Permission) => can(authCache, p, resourceCtx),
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
    .use(translateErrors)
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
          message: forbiddenMessage(authCache, organizationId, permission, node.type),
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
          /**
           * The PERMISSIVE counterpart of staffProcedure's `can`: does any
           * grant within the addressed subtree carry `p`? The academic list
           * endpoints gate on `academic_year:read` and use this to decide
           * whether `read_history` widens the query to closed sessions
           * (ADR-024). A school principal holds read_history at their branch,
           * not at the org node they address to list years, so the strict
           * question would wrongly deny them — this asks the one the list needs.
           */
          canWithin: (p: Permission) =>
            getDataScopes(authCache, p, dataScopeFromNode(node)).length > 0,
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

// ---------------------------------------------------------------------------
// The health check
// ---------------------------------------------------------------------------

/**
 * Lives HERE, inside the builder module, and that placement is the point.
 *
 * The health check is the one route that must run on a valid session alone —
 * gating "is the API up" behind a role would make monitoring depend on
 * credentials. But an exported ungated builder (`publicProcedure = t.procedure`)
 * offered every future router an authorization-free starting point, reachable
 * by reflex from muscle memory. Deleting the export makes such a procedure
 * unconstructible outside this file: there is no longer a bare builder on the
 * package's surface to reach for, and `scripts/check:builders` keeps routers/
 * free of both `t.procedure` and local re-creations.
 *
 * So the single legitimate consumer moved in with the builders rather than the
 * builders moving out. If a second genuinely ungated route ever appears, do not
 * export `t` or rename this one — give the route its own explicit gated
 * builder, or reopen this decision in an ADR.
 */
export const healthRouter = router({
  health: t.procedure
    .meta({
      openapi: {
        method: "GET",
        path: "/health",
        tags: ["health"],
        summary: "Liveness check",
        protect: false,
      },
    })
    .input(z.undefined())
    .output(z.string())
    .query(() => "Healthy"),
});

import {
  createTermSchema,
  termSelectSchema,
  updateTermSchema,
} from "@repo/contracts";
import { termService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  router,
  staffListProcedure,
  staffProcedure,
  type OwnerResolver,
} from "../trpc";

/**
 * TERMS — the subdivisions of an academic year (Phase 2 slice 3).
 *
 * Routers stay thin: validate, resolve the tenancy filter from ctx, call the
 * service, map an empty result to NOT_FOUND. No business logic, no db access.
 *
 * **Permissions: terms reuse the `academic_year:*` family, deliberately.**
 * Terms are the session structure itself — same screens, same managers — and
 * a separate `term` resource would be two names for one concept (the
 * `portal_access` precedent recorded in TASKS.md). Whoever holds
 * `academic_year:read` lists terms, `academic_year:create` creates them,
 * `academic_year:update` edits them. No authz changes were needed.
 *
 * **`read_history` composes exactly as the year router's does** (ADR-024):
 * terms are year-scoped, so a caller without `academic_year:read_history`
 * must not reach a closed year's terms by naming the year's id or a term id.
 * Single-resource reads ask `ctx.can` (strict), lists ask `ctx.canWithin`
 * (permissive) — the ADR-017 split — and the service pins the query to the
 * current year via `yearVisibilityWhere`.
 *
 * B6 owner resolution: terms are not scope nodes; `resolveTermOwner` looks the
 * owning branch up from the row, and a cross-tenant id is the resolver's own
 * NOT_FOUND — indistinguishable from a nonexistent one. Single-resource reads
 * ask overlap (ADR-028); the mutation stays on the default cover (ADR-017
 * strict — teachers hold no academic_year:update, so the overlap question
 * never arises on a write). NO `scope_nodes` writes — terms are not in the
 * authorization tree (hard rule 12 names school/class/section only).
 */

const READ_HISTORY = "academic_year:read_history" as const;

/**
 * The B6 owner resolver for terms — same shape as `resolveYearOwner`.
 */
const resolveTermOwner: OwnerResolver = async (organizationId, id) => {
  const schoolId = await termService.getTermOwnerId(organizationId, id);

  if (!schoolId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Term not found.",
    });
  }

  return { type: "school", id: schoolId };
};

/**
 * Namespaced under `academic` (the router composes it as `academic.term.*`);
 * the flat REST paths live in each `meta`.
 */
export const termRouter = router({
  // Permissive list (ADR-017): a branch principal does not COVER the org node
  // they address to see the school's terms. The year input pins the school,
  // like the section list's.
  list: staffListProcedure("academic_year:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/terms",
        tags: ["terms"],
        summary: "List one academic year's terms, in report-card order",
        protect: true,
      },
    })
    .input(z.object({ academicYearId: z.uuid() }))
    .output(z.array(termSelectSchema))
    .query(async ({ ctx, input }) => {
      return termService.listTerms(
        ctx.scopes,
        input.academicYearId,
        ctx.canWithin(READ_HISTORY),
      );
    }),

  // B6: not a scope node, so the owning branch comes from the resolver and
  // the gate asks overlap (ADR-028). The service still filters by scope and
  // history; out of scope, wrong tenant, and closed-year-without-read_history
  // are the same NOT_FOUND.
  byId: staffProcedure("academic_year:read", {
    resolveOwner: resolveTermOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/terms/{id}",
        tags: ["terms"],
        summary: "Get one term",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(termSelectSchema)
    .query(async ({ ctx, input }) => {
      const term = await termService.getTermById(
        ctx.scope,
        input.id,
        ctx.can(READ_HISTORY),
      );

      if (!term) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." });
      }

      return term;
    }),

  create: staffProcedure("academic_year:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/terms",
        tags: ["terms"],
        summary: "Create a term for an academic year",
        protect: true,
      },
    })
    // B5: the parent is named in the endpoint's own input, not inherited as an
    // optional scope field — omitting it is a compile error at the call site,
    // not a runtime 500 from requireSchoolId. The service still re-checks:
    // REST callers are not type-checked against this router.
    .input(z.object({ schoolId: z.uuid(), data: createTermSchema }))
    .output(termSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — terms are not in the authorization tree. A
      // foreign year is refused by the service's in-transaction re-read; dates
      // outside the year are refused by `terms_dates_within_year_trg` and
      // worded by translateErrors.
      return termService.createTerm(ctx.scope, input.data);
    }),

  // B6: owner-resolved like byId, but a MUTATION — the gate stays "cover"
  // (ADR-017 strict). Teachers hold no academic_year:update, so the overlap
  // question never arises here. No delete: a term is childless for exactly
  // one phase, and a wrong term is corrected by update while it is empty.
  update: staffProcedure("academic_year:update", {
    resolveOwner: resolveTermOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/terms/{id}",
        tags: ["terms"],
        summary: "Update a term (name, sequence, dates, result mode, weightage)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateTermSchema }))
    .output(termSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const term = await termService.updateTerm(ctx.scope, input.id, input.data);

      if (!term) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Term not found." });
      }

      return term;
    }),
});

import {
  academicYearSelectSchema,
  classSelectSchema,
  createAcademicYearSchema,
  createClassSchema,
  createSectionSchema,
  sectionSelectSchema,
  updateAcademicYearSchema,
  updateClassSchema,
  updateSectionSchema,
} from "@repo/contracts";
import { academicService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * ACADEMIC STRUCTURE — years, classes, sections (Phase 2 slice 1).
 *
 * Routers stay thin: validate, resolve the tenancy filter from ctx, call the
 * service, map an empty result to NOT_FOUND. No business logic, no db access.
 *
 * **The one thing this router decides that others do not: year visibility.**
 * Every year-scoped read takes an `includeHistory` boolean, and this is where
 * it is computed — from the `academic_year:read_history` permission, asked
 * against the addressed node (ADR-024). It is asked the two ways ADR-017 draws:
 *
 *   single-resource read → ctx.can("academic_year:read_history")   (STRICT)
 *   list                 → ctx.canWithin("academic_year:read_history") (PERMISSIVE)
 *
 * The split is not cosmetic. A school principal holds read_history at their
 * branch, not at the org node they must address to LIST years across the
 * school; the strict question would deny them a list they are entitled to,
 * while the permissive one — "does any grant in this subtree carry it?" —
 * answers correctly. For a single year addressed by id, strict is right: you
 * either cover that node with read_history or you do not.
 *
 * `read_history` is false → the service pins the query to the current session,
 * so a stale or guessed id for a closed year returns nothing (enforced in the
 * service's year/section joins, not here).
 */

const READ_HISTORY = "academic_year:read_history" as const;

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

const academicYearRouter = router({
  // List: permissive builder. A branch principal does not COVER the org node
  // they address to see the school's years, but must still get their branch's.
  // ctx.scopes is already clipped to the addressed subtree.
  list: staffListProcedure("academic_year:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/academic-years",
        tags: ["academic-years"],
        summary: "List academic years the caller may see",
        protect: true,
      },
    })
    .output(z.array(academicYearSelectSchema))
    .query(async ({ ctx }) => {
      return academicService.listAcademicYears(
        ctx.scopes,
        ctx.canWithin(READ_HISTORY),
      );
    }),

  // Registered before `byId` so the static segment is matched first: "current"
  // is not a UUID, and the id route validates one, but routing precedes
  // validation. The current year is visible to every scope, so no read_history.
  //
  // Org scope is REFUSED. `isCurrent` is per school — the exclusion constraint
  // is (school_id) WHERE is_current — so "the current year" is only a question
  // with an answer once a branch is named. Asked at org scope this used to
  // return whichever school's row the database ordered first: a wrong answer
  // wearing a 200.
  //
  // A class or section id is accepted alongside a school id, deliberately: a
  // class- or section-scoped teacher does not COVER the school node, so a bare
  // `schoolId` requirement would 403 the modal user out of the one question
  // their whole screen depends on. Their node implies its school, and the
  // service widens to exactly that school — one row, never an arbitrary one.
  current: staffProcedure("academic_year:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/academic-years/current",
        tags: ["academic-years"],
        summary: "The current academic year of the addressed branch",
        protect: true,
      },
    })
    .input(
      z
        .object({
          organizationId: z.uuid(),
          schoolId: z.uuid().optional(),
          classId: z.uuid().optional(),
          sectionId: z.uuid().optional(),
        })
        .refine(
          (v) => Boolean(v.schoolId ?? v.classId ?? v.sectionId),
          "Name a branch (a schoolId, or a classId/sectionId inside one): " +
            "the current session is per branch.",
        ),
    )
    .output(academicYearSelectSchema)
    .query(async ({ ctx }) => {
      const year = await academicService.getCurrentAcademicYear(ctx.scope);

      // No current year set is a real state during school setup, but there is
      // no row to return; NOT_FOUND is the honest answer to "get the current
      // year" when none is flagged.
      if (!year) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No current academic year is set for this school.",
        });
      }

      return year;
    }),

  byId: staffProcedure("academic_year:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/academic-years/{id}",
        tags: ["academic-years"],
        summary: "Get one academic year",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(academicYearSelectSchema)
    .query(async ({ ctx, input }) => {
      const year = await academicService.getAcademicYearById(
        ctx.scope,
        input.id,
        ctx.can(READ_HISTORY),
      );

      // Out of scope, wrong tenant, and closed-year-without-read_history all
      // collapse to the same NOT_FOUND: distinguishing them would confirm an id
      // exists somewhere the caller may not look.
      if (!year) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Academic year not found.",
        });
      }

      return year;
    }),

  create: staffProcedure("academic_year:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/academic-years",
        tags: ["academic-years"],
        summary: "Create an academic year",
        protect: true,
      },
    })
    .input(z.object({ data: createAcademicYearSchema }))
    .output(academicYearSelectSchema)
    .mutation(async ({ ctx, input }) => {
      return academicService.createAcademicYear(ctx.scope, input.data);
    }),

  update: staffProcedure("academic_year:update")
    .meta({
      openapi: {
        method: "PATCH",
        path: "/academic-years/{id}",
        tags: ["academic-years"],
        summary: "Update an academic year",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateAcademicYearSchema }))
    .output(academicYearSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const year = await academicService.updateAcademicYear(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!year) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Academic year not found.",
        });
      }

      return year;
    }),

  /**
   * Promotes a year to the school's current session — an org-level act, since
   * one row moving reassigns what every current-only caller can see. POST to a
   * sub-resource rather than a PATCH of `is_current`: the flag is a transition
   * between two rows (at most one current per school), not a field to set.
   */
  setCurrent: staffProcedure("academic_year:update")
    .meta({
      openapi: {
        method: "POST",
        path: "/academic-years/{id}/set-current",
        tags: ["academic-years"],
        summary: "Make this the school's current academic year",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(academicYearSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const year = await academicService.setCurrentAcademicYear(
        ctx.scope,
        input.id,
      );

      if (!year) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Academic year not found.",
        });
      }

      return year;
    }),
});

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

const classRouter = router({
  // Classes are not year-scoped (Class 6 is the same rung every year), so no
  // read_history here — there is no history to gate.
  list: staffListProcedure("class:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/classes",
        tags: ["classes"],
        summary: "List classes the caller may see",
        protect: true,
      },
    })
    .output(z.array(classSelectSchema))
    .query(async ({ ctx }) => {
      return academicService.listClasses(ctx.scopes);
    }),

  byId: staffProcedure("class:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/classes/{id}",
        tags: ["classes"],
        summary: "Get one class",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(classSelectSchema)
    .query(async ({ ctx, input }) => {
      const cls = await academicService.getClassById(ctx.scope, input.id);

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      return cls;
    }),

  create: staffProcedure("class:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/classes",
        tags: ["classes"],
        summary: "Create a class",
        protect: true,
      },
    })
    .input(z.object({ data: createClassSchema }))
    .output(classSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // The service creates the class and its scope_nodes row in one
      // transaction (hard rule 12).
      return academicService.createClass(ctx.scope, input.data);
    }),

  update: staffProcedure("class:update")
    .meta({
      openapi: {
        method: "PATCH",
        path: "/classes/{id}",
        tags: ["classes"],
        summary: "Update a class",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateClassSchema }))
    .output(classSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const cls = await academicService.updateClass(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      return cls;
    }),

  /** Soft delete (hard rule 2) — enrollments, fee structures and results point here. */
  deactivate: staffProcedure("class:delete")
    .meta({
      openapi: {
        method: "POST",
        path: "/classes/{id}/deactivate",
        tags: ["classes"],
        summary: "Deactivate a class (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(classSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const cls = await academicService.deactivateClass(ctx.scope, input.id);

      if (!cls) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Class not found." });
      }

      return cls;
    }),
});

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionRouter = router({
  /**
   * Sections for one academic year, optionally narrowed to one class.
   * `academicYearId` is required — sections are re-created every year, so an
   * unfiltered list would mix sessions. `classId` is optional: omit it for the
   * school-wide roster (timetable grid, teacher-assignment picker), pass it for
   * a single class's sections on a class detail page. Year visibility applies
   * (a section is the entry point to a year's students), so the permissive
   * read_history question decides whether a closed year's sections are reachable.
   */
  list: staffListProcedure("section:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/sections",
        tags: ["sections"],
        summary: "List sections for one academic year (optionally one class)",
        protect: true,
      },
    })
    .input(
      z.object({
        academicYearId: z.uuid(),
        classId: z.uuid().optional(),
      }),
    )
    .output(z.array(sectionSelectSchema))
    .query(async ({ ctx, input }) => {
      return academicService.listSections(
        ctx.scopes,
        input.academicYearId,
        ctx.canWithin(READ_HISTORY),
        input.classId,
      );
    }),


  byId: staffProcedure("section:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/sections/{id}",
        tags: ["sections"],
        summary: "Get one section",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(sectionSelectSchema)
    .query(async ({ ctx, input }) => {
      const section = await academicService.getSectionById(
        ctx.scope,
        input.id,
        ctx.can(READ_HISTORY),
      );

      if (!section) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Section not found.",
        });
      }

      return section;
    }),

  create: staffProcedure("section:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/sections",
        tags: ["sections"],
        summary: "Create a section",
        protect: true,
      },
    })
    .input(z.object({ data: createSectionSchema }))
    .output(sectionSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // The service verifies both parents belong to the caller's school and
      // creates the section with its scope_nodes row in one transaction
      // (hard rule 12).
      return academicService.createSection(ctx.scope, input.data);
    }),

  update: staffProcedure("section:update")
    .meta({
      openapi: {
        method: "PATCH",
        path: "/sections/{id}",
        tags: ["sections"],
        summary: "Update a section",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateSectionSchema }))
    .output(sectionSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const section = await academicService.updateSection(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!section) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Section not found.",
        });
      }

      return section;
    }),

  /** Soft delete (hard rule 2) — a year's attendance and results hang off it. */
  deactivate: staffProcedure("section:delete")
    .meta({
      openapi: {
        method: "POST",
        path: "/sections/{id}/deactivate",
        tags: ["sections"],
        summary: "Deactivate a section (soft delete)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(sectionSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const section = await academicService.deactivateSection(
        ctx.scope,
        input.id,
      );

      if (!section) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Section not found.",
        });
      }

      return section;
    }),
});

/**
 * Namespaced `academic.*` (AGENTS.md: staff routers are `<domain>.*`). Gives
 * `academic.year.list`, `academic.class.list`, `academic.section.list` — the
 * tRPC namespace is independent of the flat REST paths in each `meta`.
 */
export const academicRouter = router({
  year: academicYearRouter,
  class: classRouter,
  section: sectionRouter,
});

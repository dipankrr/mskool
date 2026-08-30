import {
  createEnrollmentSchema,
  enrollmentSelectSchema,
  updateEnrollmentSchema,
} from "@repo/contracts";
import { enrollmentService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  assertStudentOwnership,
  router,
  staffListProcedure,
  staffProcedure,
  studentProcedure,
  type OwnerResolver,
} from "../trpc";

/**
 * ENROLLMENTS — the year anchor (Phase 2 slice 5), in both tracks.
 *
 * Routers stay thin: validate, resolve the tenancy filter from ctx, call the
 * service, map an empty result to NOT_FOUND. No business logic, no db access.
 *
 * **Staff track (`enrollment.*`)** — permissions exist already
 * (`enrollment:create/read/update` in RESOURCE_ACTIONS; principal and
 * org_admin hold the writes, class_teacher/subject_teacher hold `read`), so
 * no authz changes. Reads are B6 owner-resolved with the overlap gate
 * (ADR-028), mutations keep strict cover. **The owner is the row's SECTION
 * (or its CLASS before assignment)** — the deepest node the row lives under —
 * so the overlap question is row-level: a section teacher reads her students'
 * enrollments; the neighbouring section's are NOT_FOUND, indistinguishable
 * from a made-up id. Resolving to the school here would hand every
 * enrollment:read holder the whole branch's rows by id.
 *
 * **One list, not three.** `enrollment.list` takes `academicYearId`
 * (required) with optional `classId` / `sectionId` narrowing. The filters are
 * convenience, not authorization: the list does NO scope widening, so the
 * caller's own grants decide what survives — a section teacher passing no
 * filter still sees only her section. Separate byClass/bySection endpoints
 * would be the same query with a narrower input; the class detail page passes
 * `classId`, the section roster passes `sectionId`, the year roster passes
 * neither (the `academic.section.list` shape, reused).
 *
 * **Hard rule 6 at the surface:** no delete endpoint exists and the update
 * schema is labels-only (the contract owns the omissions); section moves
 * wait for `section_transfer_log`. `assignSection` and `transition` are
 * named POST-to-sub-resource operations — PATCH semantics would suggest the
 * status and the section are editable fields, which is the exact thing the
 * status machine and the transfer log exist to prevent.
 *
 * **Portal track (`portal.enrollment.*`)** — `studentProcedure`, no
 * permission gate: ownership only. The handler never sees a client-supplied
 * studentId — the list is derived from the session's OWNED student ids, and
 * `assertStudentOwnership` stands guard for any future per-student portal
 * read. This is the student track's first live consumer.
 */

const resolveEnrollmentOwner: OwnerResolver = async (organizationId, id) => {
  const owner = await enrollmentService.getEnrollmentOwnerNode(organizationId, id);

  if (!owner) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Enrollment not found.",
    });
  }

  return owner;
};

// ---------------------------------------------------------------------------
// Staff track
// ---------------------------------------------------------------------------

export const enrollmentRouter = router({
  // Permissive list (ADR-017): a class teacher does not COVER the school node
  // she addresses to see her class's roster. The year is required (enrollments
  // are year-scoped); class/section narrow an already-clipped answer.
  list: staffListProcedure("enrollment:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/enrollments",
        tags: ["enrollments"],
        summary: "List one academic year's enrollments (optionally one class or section)",
        protect: true,
      },
    })
    .input(
      z.object({
        academicYearId: z.uuid(),
        classId: z.uuid().optional(),
        sectionId: z.uuid().optional(),
      }),
    )
    .output(z.array(enrollmentSelectSchema))
    .query(async ({ ctx, input }) => {
      return enrollmentService.listEnrollments(
        ctx.scopes,
        input.academicYearId,
        input.classId,
        input.sectionId,
      );
    }),

  // B6: the owner is the row's section (or class), so the overlap gate is
  // row-level — a section teacher reads her own students; the neighbouring
  // section's enrollment is the generic NOT_FOUND.
  byId: staffProcedure("enrollment:read", {
    resolveOwner: resolveEnrollmentOwner,
    gate: "overlap",
  })
    .meta({
      openapi: {
        method: "GET",
        path: "/enrollments/{id}",
        tags: ["enrollments"],
        summary: "Get one enrollment",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid() }))
    .output(enrollmentSelectSchema)
    .query(async ({ ctx, input }) => {
      const enrollment = await enrollmentService.getEnrollmentById(
        ctx.scope,
        input.id,
      );

      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Enrollment not found.",
        });
      }

      return enrollment;
    }),

  create: staffProcedure("enrollment:create")
    .meta({
      openapi: {
        method: "POST",
        path: "/enrollments",
        tags: ["enrollments"],
        summary: "Admit a student into an academic year",
        protect: true,
      },
    })
    // B5: the parent is named in the endpoint's own input, not inherited as an
    // optional scope field — omitting it is a compile error at the call site,
    // not a runtime 500 from the service's school check. The service still
    // re-checks: REST callers are not type-checked against this router.
    .input(z.object({ schoolId: z.uuid(), data: createEnrollmentSchema }))
    .output(enrollmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      // No scope_nodes row — enrollments are not in the authorization tree.
      // A duplicate (student, year) is refused by the unique index and worded
      // by translateErrors (ADR-022); foreign parents by the service's
      // in-transaction re-reads.
      return enrollmentService.createEnrollment(ctx.scope, input.data);
    }),

  // Labels only — the contract omits everything the status machine and hard
  // rule 6 own. Cover gate (ADR-017 strict): reads opt into overlap; writes
  // never do.
  update: staffProcedure("enrollment:update", {
    resolveOwner: resolveEnrollmentOwner,
  })
    .meta({
      openapi: {
        method: "PATCH",
        path: "/enrollments/{id}",
        tags: ["enrollments"],
        summary: "Update an enrollment's labels (roll number, stream, house)",
        protect: true,
      },
    })
    .input(z.object({ id: z.uuid(), data: updateEnrollmentSchema }))
    .output(enrollmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentService.updateEnrollment(
        ctx.scope,
        input.id,
        input.data,
      );

      if (!enrollment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Enrollment not found.",
        });
      }

      return enrollment;
    }),

  /**
   * FIRST section assignment — the service refuses a row that already has a
   * section, because moving one mid-year is a transfer and the transfer log
   * does not exist yet. POST to a sub-resource, not a PATCH of `sectionId`:
   * the section is not an editable field on this row (hard rule 6's surface
   * half).
   */
  assignSection: staffProcedure("enrollment:update", {
    resolveOwner: resolveEnrollmentOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/enrollments/{id}/assign-section",
        tags: ["enrollments"],
        summary: "Assign the enrollment's first section",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.uuid(),
        sectionId: z.uuid(),
        rollNumber: z.string().min(1).max(20).optional(),
      }),
    )
    .output(enrollmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentService.assignSection(
        ctx.scope,
        input.id,
        { sectionId: input.sectionId, rollNumber: input.rollNumber },
      );

      return enrollment;
    }),

  /**
   * Moves the enrollment through the status machine
   * (`ENROLLMENT_TRANSITIONS`). Named operation, not a PATCH of the status:
   * the legal moves are the map's, and an illegal one is refused in words.
   */
  transition: staffProcedure("enrollment:update", {
    resolveOwner: resolveEnrollmentOwner,
  })
    .meta({
      openapi: {
        method: "POST",
        path: "/enrollments/{id}/transition",
        tags: ["enrollments"],
        summary: "Move an enrollment through its status machine",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.uuid(),
        to: z.enum([
          "admitted",
          "section_assigned",
          "active",
          "transferred_out",
          "withdrawn",
          "passed_out",
        ]),
      }),
    )
    .output(enrollmentSelectSchema)
    .mutation(async ({ ctx, input }) => {
      const enrollment = await enrollmentService.transitionEnrollment(
        ctx.scope,
        input.id,
        input.to,
      );

      return enrollment;
    }),
});

// ---------------------------------------------------------------------------
// Portal track — the student's own view. Ownership only, never can().
// ---------------------------------------------------------------------------

export const portalEnrollmentRouter = router({
  // The signed-in login's OWNED students' enrollments. There is no input and
  // there must never be one on this path: the student ids come from the
  // session's portal-access rows, and a client-supplied filter would be the
  // leak `assertStudentOwnership` exists to prevent. When a single-child view
  // is needed, it asserts ownership of the requested id FIRST.
  list: studentProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/portal/enrollments",
        tags: ["portal"],
        summary: "The signed-in student's enrollments, across years",
        protect: true,
      },
    })
    .output(z.array(enrollmentSelectSchema))
    .query(({ ctx }) => {
      // The service filters by the OWNED list and nothing else — no
      // organizationId is available on this track and none is needed: the
      // student ids are already the tenancy boundary (ADR-005).
      return enrollmentService.listEnrollmentsForStudents(ctx.studentIds);
    }),
});

import {
  cloneIdCardTemplateInput,
  createIdCardTemplateInput,
  idCardDataRequestShape,
  idCardStudentCardSchema,
  idCardTemplateSelectSchema,
  publishedIdCardTemplateSchema,
  updateIdCardTemplateInput,
  uploadStudentPhotoInput,
  uploadedTemplateAssetSchema,
} from "@repo/contracts";
import { idCardService } from "@repo/services";
import { db } from "@repo/db";
import { idCardTemplates } from "@repo/db/schema";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, staffListProcedure, staffProcedure } from "../trpc";

/**
 * ID CARDS (slice 2a) — the template surface and the card-data resolver.
 *
 * Two permissions, split by the act:
 *   - `id_card:manage` owns WRITES — create/update/adopt/set-default (the 2b
 *     designer's surface; this slice ships the endpoints).
 *   - `id_card:print` owns the broad READ — listing/resolving templates and
 *     the card data itself. The print page runs on `print`; the principals
 *     who manage also print, so the defaults carry both.
 *
 * A template is NOT a scope node (hard rule 12 does not apply — it hangs off
 * a school that already has one), so single-row reads and writes go through
 * the B6 owner resolution: `resolveTemplateOwner` finds the template's school
 * node, org-filtered, and a cross-branch id is the same NOT_FOUND as a
 * made-up one. Reads ask overlap (ADR-028); writes stay on the strict cover
 * (never overlap — CONVENTIONS.md).
 */
export const idCardRouter = router({
  template: router({
    list: staffListProcedure("id_card:print")
      .meta({
        openapi: {
          method: "GET",
          path: "/id-cards/templates",
          tags: ["id_cards"],
          summary: "List the branch's ID card templates",
          protect: true,
        },
      })
      .output(z.array(idCardTemplateSelectSchema))
      .query(({ ctx }) => idCardService.listTemplates(ctx.scopes)),

    byId: staffProcedure("id_card:print", {
      resolveOwner: resolveTemplateOwner,
      gate: "overlap",
    })
      .meta({
        openapi: {
          method: "GET",
          path: "/id-cards/templates/{id}",
          tags: ["id_cards"],
          summary: "Get one ID card template",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid() }))
      .output(idCardTemplateSelectSchema)
      .query(async ({ ctx, input }) => {
        const row = await idCardService.getTemplateById(ctx.scope, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Template not found.",
          });
        }
        return row;
      }),

    create: staffProcedure("id_card:manage")
      .meta({
        openapi: {
          method: "POST",
          path: "/id-cards/templates",
          tags: ["id_cards"],
          summary: "Create an ID card template",
          protect: true,
        },
      })
      // B5: the parent branch is named in the endpoint's own input.
      .input(
        z.object({
          schoolId: z.uuid(),
          data: createIdCardTemplateInput,
        }),
      )
      .output(idCardTemplateSelectSchema)
      .mutation(({ ctx, input }) =>
        idCardService.createTemplate(ctx.scope, input.data, ctx.userId),
      ),

    update: staffProcedure("id_card:manage", {
      resolveOwner: resolveTemplateOwner,
    })
      .meta({
        openapi: {
          method: "PATCH",
          path: "/id-cards/templates/{id}",
          tags: ["id_cards"],
          summary: "Update an ID card template",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid(), data: updateIdCardTemplateInput }))
      .output(idCardTemplateSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const row = await idCardService.updateTemplate(
          ctx.scope,
          input.id,
          input.data,
        );
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Template not found.",
          });
        }
        return row;
      }),

    /**
     * Clones a STARTER design (a code constant in apps/web — the client
     * gallery's source of truth) into a school-owned row. The payload is the
     * same validated shape a designer save carries, so the server needs no
     * copy of the constants and the web never lies about what it adopted.
     * Duplicate names are refused by the unique index and worded by
     * translateErrors.
     */
    adopt: staffProcedure("id_card:manage")
      .meta({
        openapi: {
          method: "POST",
          path: "/id-cards/templates/adopt",
          tags: ["id_cards"],
          summary: "Adopt a starter ID card design into the branch",
          protect: true,
        },
      })
      .input(
        z.object({
          schoolId: z.uuid(),
          /** Provenance only — which starter this clone came from. */
          prebuiltId: z.string().min(1).max(64),
          data: createIdCardTemplateInput,
        }),
      )
      .output(idCardTemplateSelectSchema)
      .mutation(({ ctx, input }) =>
        idCardService.createTemplate(ctx.scope, input.data, ctx.userId),
      ),

    setDefault: staffProcedure("id_card:manage", {
      resolveOwner: resolveTemplateOwner,
    })
      .meta({
        openapi: {
          method: "POST",
          path: "/id-cards/templates/{id}/default",
          tags: ["id_cards"],
          summary: "Make this template the branch's default",
          protect: true,
        },
      })
      .input(z.object({ id: z.uuid() }))
      .output(idCardTemplateSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const row = await idCardService.setDefault(ctx.scope, input.id);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Template not found.",
          });
        }
        return row;
      }),

    /**
     * Stores a template asset (card background, school logo) and returns the
     * object id — the designer re-points `canvas.backgroundAssetId` / a logo
     * element at it with an ordinary update. Same cap and allowlist as the
     * photo upload; the contract note records why removing a reference does
     * not delete the bytes.
     */
    uploadAsset: staffProcedure("id_card:manage")
      .meta({
        openapi: {
          method: "POST",
          path: "/id-cards/templates/asset",
          tags: ["id_cards"],
          summary: "Upload an ID card template asset (background or logo)",
          protect: true,
        },
      })
      // The photo shape, reused verbatim — same ceiling, same allowlist.
      .input(uploadStudentPhotoInput)
      .output(uploadedTemplateAssetSchema)
      .mutation(({ ctx, input }) =>
        idCardService
          .uploadTemplateAsset(ctx.scope, input, ctx.userId)
          .then((objectId) => ({ objectId })),
      ),
  }),

  /**
   * THE COMMUNITY GALLERY (slice 2b) — cross-school template sharing.
   *
   * ⚠️ THE DELIBERATE TENANCY EXCEPTION, stated where a reviewer will look
   * for a missing filter: `gallery.list` reads PUBLISHED templates from EVERY
   * org with no scope filter. This is the one place the hard rule bends, and
   * it bends on purpose — a published design is tenant-agnostic data (name,
   * orientation, canvas, elements; the service's payload provably carries no
   * org identity and no student data), and sharing it is the owner's explicit
   * act (`isPublished` + the publishedAt stamp). The permission gate is still
   * `id_card:manage`, the output schema still strips to the design fields,
   * and nothing here weakens the serving route: a listed design's asset ids
   * answer bytes only to members of the OWNING org — `gallery.clone` byte-
   * copies assets into the cloner's org instead of ever exposing them.
   * Documented in the TASKS 2b entry as well, so it cannot look forgotten.
   */
  gallery: router({
    list: staffListProcedure("id_card:manage")
      .meta({
        openapi: {
          method: "GET",
          path: "/id-cards/gallery",
          tags: ["id_cards"],
          summary: "List every org's published ID card designs",
          protect: true,
        },
      })
      .output(z.array(publishedIdCardTemplateSchema))
      .query(() => idCardService.listPublishedTemplates()),

    /**
     * Clones a PUBLISHED design (any org's) into the caller's school as a new
     * owned, PRIVATE row — the adopt flow's cross-org sibling. The branch is
     * named in the input (B5); an unpublished or foreign-PRIVATE source id is
     * the same NOT_FOUND as a made-up one, so the endpoint never reveals
     * which private ids exist.
     */
    clone: staffProcedure("id_card:manage")
      .meta({
        openapi: {
          method: "POST",
          path: "/id-cards/gallery/clone",
          tags: ["id_cards"],
          summary: "Clone a published ID card design into the branch",
          protect: true,
        },
      })
      .input(cloneIdCardTemplateInput)
      .output(idCardTemplateSelectSchema)
      .mutation(async ({ ctx, input }) => {
        const row = await idCardService.clonePublishedTemplate(
          ctx.scope,
          input,
          ctx.userId,
        );
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Template not found.",
          });
        }
        return row;
      }),
  }),

  /**
   * THE PAYLOAD the print page renders against — names, roll numbers,
   * guardians, photos, resolved entirely server-side per the caller's own
   * scope. The client never invents card data (the fees principle).
   */
  cardData: staffProcedure("id_card:print")
    .input(
      z.object({
        schoolId: z.uuid(),
        ...idCardDataRequestShape,
      }),
    )
    .output(z.array(idCardStudentCardSchema))
    .query(({ ctx, input }) =>
      idCardService.cardData(ctx.scope, {
        academicYearId: input.academicYearId,
        classId: input.classId,
        sectionId: input.sectionId,
        studentIds: input.studentIds,
      }),
    ),
});

/**
 * B6 owner resolver for TEMPLATES — org-filtered school lookup, null on a
 * miss, same shape as resolveStudentOwner (trpc.ts).
 */
function resolveTemplateOwner(
  organizationId: string,
  id: string,
): Promise<{ type: string; id: string } | null> {
  return db
    .select({ schoolId: idCardTemplates.schoolId })
    .from(idCardTemplates)
    .where(
      and(
        eq(idCardTemplates.id, id),
        eq(idCardTemplates.organizationId, organizationId),
      ),
    )
    .limit(1)
    .then((rows) => {
      const schoolId = rows[0]?.schoolId;
      return schoolId ? { type: "school", id: schoolId } : null;
    });
}

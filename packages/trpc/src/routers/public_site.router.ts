import {
  publicSitePayloadSchema,
  publicSiteContentInputSchema,
  uploadRequestSchema,
  uploadTicketSchema,
  type PublicSiteContentInput,
} from "@repo/contracts";
import { publicSiteService } from "@repo/services";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router, staffProcedure } from "../trpc";

/**
 * PUBLIC SITES (ADR-041). Two tracks, one router:
 *
 *  - `bySlug` is the anonymous door `{slug}.mskool.in` renders through —
 *    publicProcedure, published snapshot only. Unknown/unpublished/inactive
 *    are one null.
 *  - the rest is the staff editor: `public_site:read` to open it, `edit` for
 *    the draft, `publish` for the snapshot flip. All org-level, so they
 *    address the org node and staffProcedure contributes the scope.
 */
export const publicSiteRouter = router({
  bySlug: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/public/site/{slug}",
        tags: ["public-site"],
        summary: "The published website snapshot for an org slug",
        protect: false,
      },
    })
    .input(z.object({ slug: z.string().min(2).max(100) }))
    .output(publicSitePayloadSchema.nullable())
    .query(async ({ input }) => {
      return publicSiteService.getPublishedBySlug(input.slug);
    }),

  draft: staffProcedure("public_site:read")
    .meta({
      openapi: {
        method: "GET",
        path: "/public-site/draft",
        tags: ["public-site"],
        summary: "The org's site draft for the editor",
        protect: true,
      },
    })
    .output(
      z.object({
        id: z.uuid(),
        organizationId: z.uuid(),
        preset: z.string(),
        presetVersion: z.number(),
        draftContent: publicSiteContentInputSchema.nullable(),
        publishedContent: publicSiteContentInputSchema.nullable(),
        publishedAt: z.date().nullable(),
        isActive: z.boolean(),
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const site = await publicSiteService.getForOrg(ctx.scope, input.organizationId);
      if (!site) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No site provisioned yet." });
      }
      return {
        ...site,
        // jsonb columns type as unknown; the output schema re-validates them.
        draftContent: (site.draftContent ?? null) as PublicSiteContentInput | null,
        publishedContent: (site.publishedContent ?? null) as PublicSiteContentInput | null,
      };
    }),

  ensure: staffProcedure("public_site:edit")
    .meta({
      openapi: {
        method: "POST",
        path: "/public-site/ensure",
        tags: ["public-site"],
        summary: "Provision the org's site row, optionally with starter content",
        protect: true,
      },
    })
    .input(
      z.object({
        preset: z.string().min(2).max(50).optional(),
        presetVersion: z.number().int().min(1).max(1000).optional(),
        content: publicSiteContentInputSchema.optional(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      await publicSiteService.ensureForOrg(
        input.organizationId,
        input.preset ?? "ujjwal-kids",
        input.content,
        input.presetVersion ?? 1,
      );
      return { ok: true };
    }),

  saveDraft: staffProcedure("public_site:edit")
    .meta({
      openapi: {
        method: "PUT",
        path: "/public-site/draft",
        tags: ["public-site"],
        summary: "Replace the org's site draft",
        protect: true,
      },
    })
    .input(
      z.object({
        preset: z.string().min(2).max(50).optional(),
        content: publicSiteContentInputSchema,
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await publicSiteService.saveDraft({
        scope: ctx.scope,
        organizationId: input.organizationId,
        preset: input.preset,
        content: input.content,
      });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No site provisioned yet." });
      }
      return { ok: true };
    }),

  publish: staffProcedure("public_site:publish")
    .meta({
      openapi: {
        method: "POST",
        path: "/public-site/publish",
        tags: ["public-site"],
        summary: "Publish the draft to the live site",
        protect: true,
      },
    })
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await publicSiteService.publish({
          scope: ctx.scope,
          organizationId: input.organizationId,
        });
      } catch {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Save a draft before publishing.",
        });
      }
      return { ok: true };
    }),

  unpublish: staffProcedure("public_site:publish")
    .meta({
      openapi: {
        method: "POST",
        path: "/public-site/unpublish",
        tags: ["public-site"],
        summary: "Take the site off the public host",
        protect: true,
      },
    })
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await publicSiteService.unpublish({
        scope: ctx.scope,
        organizationId: input.organizationId,
      });
      return { ok: true };
    }),

  /**
   * THE EDITOR'S UPLOAD (ADR-063), straight to the public bucket:
   * `imageUpload` hands out the link, the browser PUTs the file, and
   * `imageReady` checks it, links it to the site and answers its public link
   * for the draft. Saving the draft stores it as a token, never a URL.
   */
  imageUpload: staffProcedure("public_site:edit")
    .input(z.object({ file: uploadRequestSchema }))
    .output(uploadTicketSchema)
    .mutation(({ ctx, input }) =>
      publicSiteService.imageUpload(ctx.scope, input.organizationId, input.file, ctx.userId),
    ),

  imageReady: staffProcedure("public_site:edit")
    .meta({
      openapi: {
        method: "POST",
        path: "/public-site/images",
        tags: ["public-site"],
        summary: "Check an uploaded public site image and get its link",
        protect: true,
      },
    })
    .input(z.object({ objectId: z.uuid() }))
    .output(z.object({ url: z.string() }))
    .mutation(({ ctx, input }) =>
      publicSiteService.imageReady(ctx.scope, input.organizationId, input.objectId, ctx.userId),
    ),
});

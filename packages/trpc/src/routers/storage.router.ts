import { completedUploadSchema, completeUploadsInput } from "@repo/contracts";
import { storageService } from "@repo/services";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * STORAGE (ADR-063) — the one step every upload shares.
 *
 * Upload links come from each domain's own endpoint, behind that domain's
 * permission gate (who may upload a student's photo is a student question).
 * Completing an upload needs no such gate: only the person who was handed
 * the link can complete it, and the service checks exactly that. So this is
 * a protectedProcedure, open to staff and family logins alike, and the
 * input is nothing but object ids the caller uploaded.
 */
export const storageRouter = router({
  complete: protectedProcedure
    .input(completeUploadsInput)
    .output(z.array(completedUploadSchema))
    .mutation(({ ctx, input }) => storageService.complete(ctx.session.user.id, input.objectIds)),
});

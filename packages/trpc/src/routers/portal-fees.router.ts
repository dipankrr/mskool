import {
  portalChildInputSchema,
  portalFeeDocumentSchema,
  portalFeePaymentInputSchema,
  portalFeePaymentSchema,
  portalFeeSummarySchema,
} from "@repo/contracts";
import { portalFeesService } from "@repo/services";

import { router, studentProcedure } from "../trpc";

/**
 * FAMILY FEES (ADR-062) — `portalFees.*`. Ownership only, never can(). A
 * read-only mirror of the admin student fee page and the counter's printed
 * receipt and statement, in narrow family shapes; the school comes from the
 * child and every payment id is checked against the child.
 */
export const portalFeesRouter = router({
  summary: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/fees/summary", tags: ["portal"], summary: "A child's fees for the session: totals, months, dues, payments", protect: true } })
    .input(portalChildInputSchema)
    .output(portalFeeSummarySchema)
    .query(({ ctx, input }) => portalFeesService.summary(ctx.studentIds, input)),

  payment: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/fees/payments/{paymentId}", tags: ["portal"], summary: "One payment and the dues it paid", protect: true } })
    .input(portalFeePaymentInputSchema)
    .output(portalFeePaymentSchema)
    .query(({ ctx, input }) => portalFeesService.payment(ctx.studentIds, input)),

  receipt: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/fees/payments/{paymentId}/receipt", tags: ["portal"], summary: "The printed receipt for one payment", protect: true } })
    .input(portalFeePaymentInputSchema)
    .output(portalFeeDocumentSchema)
    .query(({ ctx, input }) => portalFeesService.receipt(ctx.studentIds, input)),

  statement: studentProcedure
    .meta({ openapi: { method: "GET", path: "/portal/fees/statement", tags: ["portal"], summary: "The child's fee statement for the session", protect: true } })
    .input(portalChildInputSchema)
    .output(portalFeeDocumentSchema)
    .query(({ ctx, input }) => portalFeesService.statement(ctx.studentIds, input)),
});

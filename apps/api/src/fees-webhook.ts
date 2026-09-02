import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { feesCollectionService } from "@repo/services";
import { gatewayPaymentSchema } from "@repo/contracts";
import { env } from "./env";

/**
 * THE ADR-009 WEBHOOK SEAM — POST /api/webhooks/fees.
 *
 * A gateway notification is not a session, and it must never be one: the
 * authorization here is an HMAC-SHA256 signature over the RAW request body,
 * keyed by FEE_WEBHOOK_SECRET, delivered in `x-fee-webhook-signature` (hex).
 * This is the `kind: 'system'` context: the ONLY path permitted to write
 * `fee_payments` without a human at the counter, because the notification
 * itself is the fact that money arrived.
 *
 * Mounted BEFORE `express.json()` (see server.ts) so the raw body is what
 * the signature covers — signing the parsed-and-restringified JSON would be
 * signing a representation the provider never produced, and key ordering
 * would break every other client.
 *
 * Replay protection rides on the DOMAIN, not the transport: the gateway's
 * order id is `fee_payments.client_reference`, unique per school, and
 * `recordGatewayPayment` returns the ORIGINAL receipt for a replayed
 * notification instead of writing a second one. Webhooks replay; this is
 * the discipline the plan's money-safety layer 7 exists for.
 *
 * There is no real gateway yet (the recorded deferral): this seam is what a
 * provider integration plugs into, and the test harness posts to it exactly
 * as a provider would — signed payload and all.
 */
export const feesWebhookRouter: express.Router = express.Router();

function signatureIsValid(rawBody: Buffer, provided: string | undefined): boolean {
  if (!provided) return false;
  const expected = createHmac("sha256", env.FEE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

feesWebhookRouter.post(
  "/api/webhooks/fees",
  express.raw({ type: "application/json", limit: "256kb" }),
  async (req: Request, res: Response) => {
    const raw = req.body as Buffer;
    if (!signatureIsValid(raw, req.header("x-fee-webhook-signature"))) {
      // Deliberately generic: confirming whether the signature or the payload
      // was wrong only helps someone forging one.
      res.status(401).json({ error: "Invalid webhook signature." });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Malformed JSON." });
      return;
    }

    const result = gatewayPaymentSchema.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({ error: "Invalid webhook payload." });
      return;
    }

    try {
      const payment = await feesCollectionService.recordGatewayPayment(result.data);
      res.status(200).json({
        receiptNumber: payment.receiptNumber,
        paymentStatus: payment.paymentStatus,
      });
    } catch (error) {
      // The gateway retries on 5xx; a deterministic business refusal (dues
      // exceeded, student unknown) must be a 422 so it does not retry
      // forever, but the wording stays internal.
      console.error("[fees-webhook] rejected:", error);
      res.status(422).json({ error: "Payment could not be recorded." });
    }
  },
);

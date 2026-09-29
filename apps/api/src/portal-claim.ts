import rateLimit from "express-rate-limit";
import { Router, type Express, type Request, type Response } from "express";
import { claimPortalAccessInput } from "@repo/contracts";
import { portalAccessService } from "@repo/services";
import { env } from "./env";

/**
 * PUBLIC claim endpoint (ADR-037) — the only credential-shaped route that
 * runs without a session, so it cannot live in packages/trpc (whose
 * routers/ must stay gated; see scripts/check-builders.ts).
 *
 * One shape for first claim and forgot-reset: no credential yet → sets the
 * first password and activates the trio-matching pending links; credential
 * exists → the same trio re-sets it (sessions revoked). Every mismatch —
 * unknown phone, no link, wrong admission number, wrong DOB — gets the same
 * 400 and the same sentence, so no response tells which half missed.
 *
 * Abuse control is rate-limit only (owner call): per-IP hourly cap here on
 * top of the global limiter, plus the service never enumerates.
 */
const claimLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

export const portalClaimRouter: Router = Router();

async function handleClaim(req: Request, res: Response) {
  const parsed = claimPortalAccessInput.safeParse(req.body);
  if (!parsed.success) {
    // Validation shape failures get the uniform refusal too — a missing
    // field must not read differently from a wrong one.
    res.status(400).json({
      error:
        "Those details do not match our records. Check the phone number, admission number, and date of birth.",
    });
    return;
  }
  try {
    const result = await portalAccessService.claim(parsed.data);
    res.json({ ok: true, students: result.activatedStudentIds.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    // setUserPassword's own length refusal is safe to surface (it names no
    // record); everything else from the claim is already uniform.
    if (/between \d+ and \d+ characters/.test(message)) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(400).json({ error: message });
  }
}

export function mountPortalClaim(app: Express) {
  if (env.DISABLE_RATE_LIMIT !== "true") {
    portalClaimRouter.use(claimLimiter);
  }
  portalClaimRouter.post("/portal/claim", handleClaim);
  app.use("/api", portalClaimRouter);
}

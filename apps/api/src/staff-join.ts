import rateLimit from "express-rate-limit";
import { Router, type Express, type Request, type Response } from "express";
import { joinStaffInput } from "@repo/contracts";
import { JOIN_MISMATCH, staffLoginService } from "@repo/services";
import { env } from "./env";

/**
 * PUBLIC staff sign-in routes (ADR-068), beside the family claim (ADR-037)
 * and for the same reason: they run without a session, so they cannot live
 * in packages/trpc, whose routers must stay gated.
 *
 * - `POST /api/staff/account-status` { phone } → { state: "password" | "code" }.
 *   Unknown numbers answer "code", so the only thing it reveals is "has
 *   joined", never a name or a school.
 * - `POST /api/staff/join` { phone, code, password } sets the password (first
 *   join or a reset). Every mismatch is the same 400 and sentence.
 *
 * Abuse control: per-IP hourly caps on top of the global limiter, plus the
 * 5-wrong-tries limit on each code.
 */
const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const statusLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

export const staffJoinRouter: Router = Router();

async function handleJoin(req: Request, res: Response) {
  const parsed = joinStaffInput.safeParse(req.body);
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === "password");
    res.status(400).json({ error: passwordIssue ? passwordIssue.message : JOIN_MISMATCH });
    return;
  }
  try {
    const result = await staffLoginService.join(parsed.data);
    res.json({ ok: true, firstJoin: result.firstJoin });
  } catch (error) {
    const message = error instanceof Error ? error.message : JOIN_MISMATCH;
    // The password length refusal names no record; everything else from the
    // join is already the uniform sentence.
    res.status(400).json({
      error: /between \d+ and \d+ characters/.test(message) ? message : JOIN_MISMATCH,
    });
  }
}

export function mountStaffJoin(app: Express) {
  if (env.DISABLE_RATE_LIMIT !== "true") {
    staffJoinRouter.use("/staff/join", joinLimiter);
    staffJoinRouter.use("/staff/account-status", statusLimiter);
  }
  staffJoinRouter.post("/staff/join", handleJoin);
  staffJoinRouter.post("/staff/account-status", async (req: Request, res: Response) => {
    const phone = typeof req.body?.phone === "string" ? req.body.phone : "";
    res.json({ state: await staffLoginService.accountState(phone) });
  });
  app.use("/api", staffJoinRouter);
}

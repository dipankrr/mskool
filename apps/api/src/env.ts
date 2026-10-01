import { createEnv } from "@repo/env";
import { z } from "zod";

export const env = createEnv({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().url(),
  // REDIS_URL is consumed by @repo/authz directly via its own env.ts,
  // but listed here too so turbo's cache key is aware of it for this app.
  REDIS_URL: z.url(),
  /**
   * ADR-009: the fee webhook is authorized by an HMAC signature over the raw
   * body, not a session. The secret must be set in production; the default
   * exists so a development environment boots without it. Rotating it is the
   * provider's job to match.
   */
  FEE_WEBHOOK_SECRET: z.string().min(16).default("dev-fee-webhook-secret"),
  /**
   * Testing escape hatch for the express-rate-limit middlewares in server.ts.
   * Default keeps production protected; set DISABLE_RATE_LIMIT=true in the
   * root .env (plus a restart) to turn both limiters off locally while
   * running smoke/integration/e2e suites that sign in and burst requests.
   */
  DISABLE_RATE_LIMIT: z.enum(["true", "false"]).default("false"),
});

import { createEnv } from "@repo/env";
import { z } from "zod";

export const env = createEnv({
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().url(),
  // REDIS_URL is consumed by @repo/authz directly via its own env.ts,
  // but listed here too so turbo's cache key is aware of it for this app.
  REDIS_URL: z.url(),
});

import { createEnv } from "@repo/env";
import { z } from "zod";

export const env = createEnv({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1),
  // Dev-only `exp://` trusted origins below ride on this; production must set
  // NODE_ENV=production or boot fails loudly (never silently trust dev origins).
  NODE_ENV: z.enum(["development", "production", "test"]),
});

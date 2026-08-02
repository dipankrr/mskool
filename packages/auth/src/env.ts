import { createEnv } from "@repo/env";
import { z } from "zod";

export const env = createEnv({
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGIN: z.string().url(),
});

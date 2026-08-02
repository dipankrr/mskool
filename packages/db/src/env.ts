import { createEnv } from "@repo/env";
import { z } from "zod";

// The ONLY file in this package allowed to touch process.env directly.
export const env = createEnv({
  DATABASE_URL: z.url(),
});

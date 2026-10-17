import { createEnv } from "@repo/env";
import { z } from "zod";

// Only EXPO_PUBLIC_* vars belong here — everything in this object is inlined
// into the native bundle at build time. Secrets never go here; this app talks
// to apps/api over HTTP and never touches the database or BETTER_AUTH_SECRET.
//
// runtimeEnv mirrors apps/web's NEXT_PUBLIC_* rule: Metro inlines only a
// literal `process.env.EXPO_PUBLIC_*` member expression, so each variable is
// listed a second time for the client bundle. A missing URL fails loudly at
// boot, never as requests to nowhere.
export const env = createEnv(
  {
    EXPO_PUBLIC_API_URL: z.url(),
  },
  {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  },
);

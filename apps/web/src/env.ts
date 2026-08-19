import { createEnv } from "@repo/env";
import { z } from "zod";

// Only NEXT_PUBLIC_* vars belong here — anything in this object is
// readable from the browser bundle. Server-only secrets never go in
// apps/web at all; this app talks to apps/api over HTTP, it doesn't
// touch the database or BETTER_AUTH_SECRET directly.

// The values are listed a second time on purpose, and the duplication is
// load-bearing. This module is imported by client components — `auth-client.ts`
// and `trpc/client.ts` both read it — and in the browser bundle only a literal
// `process.env.NEXT_PUBLIC_*` member expression is replaced with its value. A
// whole-object read, which is what `createEnv` does by default, sees none of
// them there, so validation failed and this module threw during hydration while
// working perfectly on the server. See the note on `createEnv`'s runtimeEnv.
export const env = createEnv(
  {
    NEXT_PUBLIC_API_URL: z.url(),
  },
  {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
);

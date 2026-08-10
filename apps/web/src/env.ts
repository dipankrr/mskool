import { createEnv } from "@repo/env";
import { z } from "zod";

// Only NEXT_PUBLIC_* vars belong here — anything in this object is
// readable from the browser bundle. Server-only secrets never go in
// apps/web at all; this app talks to apps/api over HTTP, it doesn't
// touch the database or BETTER_AUTH_SECRET directly.

export const env = createEnv({

  NEXT_PUBLIC_API_URL: z.url(),
});

import { z } from "zod";

/**
 * Every app/package that reads `process.env` does it through this helper,
 * never directly. The pattern:
 *
 *   // packages/db/src/env.ts
 *   import { createEnv } from "@repo/env";
 *   import { z } from "zod";
 *
 *   export const env = createEnv({
 *     DATABASE_URL: z.string().url(),
 *   });
 *
 * Why this matters in a monorepo:
 * - `dotenv -e .env` (run once, at the ROOT) only loads raw strings into
 *   process.env — it does not validate or transform anything.
 * - turbo then runs each app/package's dev/build script as a child process
 *   that inherits process.env, but turbo ALSO needs to know which env vars
 *   a task depends on for caching to be correct — that's the "env": [...]
 *   array you see per-task in turbo.json.
 * - Each package/app defines its OWN env.ts with ONLY the variables it
 *   actually needs, validated with zod. If a var is missing or malformed,
 *   you get a loud, immediate, typed error at startup — not a silent
 *   `undefined` three files deep at 11pm.
 * - apps/web is the one exception: only NEXT_PUBLIC_* vars are readable in
 *   the browser bundle, so its env.ts validates those separately from any
 *   server-only vars used in Next.js server components/route handlers.
 */
export function createEnv<TShape extends z.ZodRawShape>(shape: TShape) {
  const schema = z.object(shape);
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:\n", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables — see above.");
  }

  return parsed.data as z.infer<typeof schema>;
}

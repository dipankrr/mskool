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
 *   It must also pass `runtimeEnv` — see below.
 */
export function createEnv<TShape extends z.ZodRawShape>(
  shape: TShape,
  /**
   * The values to validate. Defaults to `process.env`, which is correct
   * everywhere that runs in Node.
   *
   * **The browser is not one of those places.** A bundler cannot know which keys
   * a whole-object read of `process.env` will touch, so it cannot inline them;
   * Next replaces literal `process.env.NEXT_PUBLIC_FOO` member expressions and
   * nothing else. Handing this function `process.env` from a module that reaches
   * the browser therefore validates an object with no NEXT_PUBLIC_* keys in it,
   * fails, and throws at module evaluation — taking down whichever component
   * imported it, while the identical code passes on the server.
   *
   * So a client-reachable env.ts passes the values explicitly, one literal
   * member expression per variable, which is the form the bundler can see:
   *
   *   createEnv(
   *     { NEXT_PUBLIC_API_URL: z.url() },
   *     { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL },
   *   );
   */
  runtimeEnv: Record<string, string | undefined> = process.env,
) {
  const schema = z.object(shape);
  const parsed = schema.safeParse(runtimeEnv);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:\n", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables — see above.");
  }

  return parsed.data as z.infer<typeof schema>;
}

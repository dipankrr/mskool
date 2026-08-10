import { createClient } from "@repo/auth/client";
import { env } from "@/env";

// env, not a literal: this app is deployed against a different API host per
// environment, and a hardcoded localhost silently works in dev while breaking
// production. `env` is validated at startup, so a missing value fails loudly
// rather than producing requests to nowhere.
export const authClient = createClient(env.NEXT_PUBLIC_API_URL);

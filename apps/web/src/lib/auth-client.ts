import { createClient } from "@repo/auth/client";
import { env } from "@/env";

export const authClient = createClient(`http://localhost:4000`);

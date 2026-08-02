import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@repo/db";
import { env } from "./env";

/**
 * Server-side better-auth instance — authentication ONLY (who is this
 * user, is their session valid). It does NOT manage organizations, roles,
 * or permissions; that's entirely @repo/authz's job now (role_assignments
 * + org_role_permissions, see packages/db/src/schema/authz.ts).
 *
 * Why no organization plugin: better-auth's org plugin ships its own
 * `member` table with its own `role` column — running that alongside
 * role_assignments would mean two independent systems both claiming to
 * answer "what can this user do," which can silently drift out of sync.
 * One system, one source of truth.
 *
 * Mounted by apps/api at /api/auth/* (see apps/api/src/server.ts).
 */
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.CORS_ORIGIN],

  database: drizzleAdapter(db, { provider: "pg" }),

  emailAndPassword: {
    enabled: true,
  },

  user: {
    additionalFields: {
      isSuperAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false, // never settable by the client
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

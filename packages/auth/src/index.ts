import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
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
 * The username plugin IS ADR-007: families have no email, so the portal
 * credential is a phone number stored as `{org_slug}-{phone}` (globally
 * unique because the phone alone is not). The default validator rejects
 * the hyphen in the slug, so a custom one accepts the exact shape we
 * mint — nothing broader.
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
      // ADR-007: staff set the initial (or reset) password — the flag
      // forces a change on first login. Server-set only (input: false);
      // it is cleared by @repo/services' credential flows, never by a
      // client mutation.
      mustChangePassword: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },

  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 64,
      usernameValidator: (username) => /^[a-z0-9._-]+$/.test(username),
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;

import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "@repo/db";
import { user as userTable } from "@repo/db/schema";
import { env } from "./env";

/**
 * ADR-007's flag clearer, shared by the databaseHooks below and importable
 * by the credential flows (the reset re-arms it deliberately). Direct db
 * write rather than the internal adapter: this is a custom column outside
 * better-auth's model, and the adapter's `updateUser` would pass it
 * through its own validation round-trip for no benefit.
 */
export async function clearMustChangePassword(userId: string): Promise<void> {
  await db
    .update(userTable)
    .set({ mustChangePassword: false })
    .where(eq(userTable.id, userId));
}

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

  // ADR-007's must_change_password is OUR field, so better-auth does not
  // clear it — but its /change-password endpoint is exactly the act that
  // should. The endpoint updates the credential ACCOUNT row (not the user
  // row), so the hook rides the account update that every password change
  // performs; it then clears the flag on the owning user. This runs inside
  // better-auth's own flow (the password was verified and re-hashed by
  // then), wherever the change came from. Hard rule 9 still holds — this is
  // configuration of better-auth, not code beside it.
  databaseHooks: {
    user: {
      update: {
        after: async (user) => {
          if (user.mustChangePassword === false) return;
          await clearMustChangePassword(user.id);
        },
      },
    },
    account: {
      update: {
        after: async (account) => {
          // Only a password change carries a hash; the flag clears for the
          // account's OWNER, whose id the account row carries.
          if (!account.userId || !account.password) return;
          await clearMustChangePassword(account.userId);
        },
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

import { auth } from "./index";

/**
 * THE CREDENTIAL SEAM (ADR-007) — the only place outside better-auth's own
 * routes that touches passwords, usernames, or sessions.
 *
 * Hard rule 9 says better-auth owns passwords, sessions, and tokens. The
 * portal's credential lifecycle (staff activation, password reset, phone
 * change) therefore does not write the `account` / `session` tables and
 * does not hash anything itself: it goes through better-auth's internal
 * adapter — the same code the admin plugin's setUserPassword and
 * revokeUserSessions endpoints run — reached via `auth.$context`, which is
 * the sanctioned server-side seam.
 *
 * Callers are the tRPC-gated staff flows in @repo/services; nothing here
 * reads client input before that gate.
 */

/**
 * Server-side better-auth context (resolves once per call site).
 *
 * The `auth` instance is imported DYNAMICALLY: importing it evaluates
 * better-auth's env contract, and this module sits on the import chain of
 * packages (trpc → services) whose pure unit tests must stay hermetic —
 * no env at import time, only when a credential flow actually runs.
 */
async function authContext() {
  const { auth } = await import("./index.js");
  return auth.$context;
}

/** better-auth's configured minimum — enforced again at the seam. */
export async function minPasswordLength(): Promise<number> {
  const ctx = await authContext();
  return ctx.password.config.minPasswordLength;
}

/**
 * Set (or re-set) a user's password. Hashes with better-auth's own hasher
 * and upserts the `credential` account exactly as the admin plugin does.
 */
export async function setUserPassword(userId: string, newPassword: string): Promise<void> {
  const ctx = await authContext();
  const minLength = ctx.password.config.minPasswordLength;
  const maxLength = ctx.password.config.maxPasswordLength;
  if (newPassword.length < minLength || newPassword.length > maxLength) {
    throw new Error(
      `Password must be between ${minLength} and ${maxLength} characters.`,
    );
  }
  const hashedPassword = await ctx.password.hash(newPassword);
  const credential = (await ctx.internalAdapter.findAccounts(userId)).find(
    (account) => account.providerId === "credential",
  );
  if (credential) {
    await ctx.internalAdapter.updatePassword(userId, hashedPassword);
  } else {
    await ctx.internalAdapter.createAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hashedPassword,
    });
  }
}

/**
 * Kill every session the user holds. The mandatory half of any credential
 * change (ADR-007): a password reset or phone change that leaves the old
 * session alive is a half-done takeover.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  const ctx = await authContext();
  await ctx.internalAdapter.deleteUserSessions(userId);
}

"use client";

import { authClient } from "@/lib/auth-client";

export function useAuth() {
  const session = authClient.useSession();

  // No register(): self-registration is closed (ADR-021). Accounts are
  // provisioned by the organization, and the sign-up route is blocked at the
  // API edge, so a caller here would only get a 404.

  /** Staff sign-in: email + password (better-auth's emailAndPassword core). */
  async function login(email: string, password: string) {
    return authClient.signIn.email({
      email,
      password,
    });
  }

  /**
   * Family sign-in (ADR-007): the phone IS the credential. The parent types
   * 10 digits; the stored username is `{org_slug}-{phone}` (globally unique
   * because the phone alone is not), so the slug has to be resolved before
   * the call. The login page owns that resolution — this hook only speaks
   * the final username.
   */
  async function loginByPhone(username: string, password: string) {
    return authClient.signIn.username({
      username,
      password,
    });
  }

  async function logout() {
    return authClient.signOut();
  }

  /**
   * The first-login change (ADR-007). better-auth's own changePassword
   * endpoint: it verifies the CURRENT (temporary) password, so the change
   * is a proof of possession, not a takeover. The route clears
   * must_change_password server-side; the caller refetches the session to
   * pick that up.
   */
  async function changePassword(currentPassword: string, newPassword: string) {
    return authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
  }

  return {
    ...session,
    login,
    loginByPhone,
    logout,
    changePassword,
  };
}

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

/**
 * Used by apps/web only. Points at the api's mounted auth routes.
 * No organization-client plugin — there's no better-auth org concept to
 * mirror on the client; org/role state comes from @repo/authz endpoints
 * instead (see RoleAssignment/RolePermission routers in apps/api).
 *
 * The username CLIENT plugin mirrors the server one (ADR-007): it adds the
 * `signIn.username()` path families use to authenticate by phone, and keeps
 * the session atom in sync with it.
 */
export function createClient(apiUrl: string) {
  return createAuthClient({
    baseURL: apiUrl,
    plugins: [usernameClient()],
    fetchOptions: {
      credentials: "include",
    },
  });
}

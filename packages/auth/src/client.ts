import { createAuthClient } from "better-auth/react";

/**
 * Used by apps/web only. Points at the api's mounted auth routes.
 * No organization-client plugin — there's no better-auth org concept to
 * mirror on the client; org/role state comes from @repo/authz endpoints
 * instead (see RoleAssignment/RolePermission routers in apps/api).
 */
export function createClient(apiUrl: string) {
  return createAuthClient({
    baseURL: apiUrl,
    fetchOptions: {
      credentials: "include",
    },
  });
}

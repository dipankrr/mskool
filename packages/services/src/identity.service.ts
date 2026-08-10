import {
  getDataScopes,
  permissionsInOrg,
  type UserAuthCache,
} from "@repo/authz";
import type { Membership } from "@repo/contracts";
import { db } from "@repo/db";
import { organizations } from "@repo/db/schema";
import { inArray } from "drizzle-orm";
import { organizationService } from "./organization.service";

/**
 * Who the caller is, and what they may reach — the client's first call after
 * sign-in.
 *
 * This exists because a better-auth session names only the user, while every
 * staff procedure requires an `organizationId`. Something has to tell the
 * browser which orgs it may legitimately name, and that answer has to come from
 * the server: a client that picks its own org id is trivially cross-tenant.
 */
export class IdentityService {
  /**
   * Builds the caller's memberships from an already-loaded auth cache.
   *
   * Takes the cache rather than a userId on purpose. The caller (a tRPC
   * procedure) has already loaded it for the permission check, so re-reading it
   * here would double the Redis round-trips on the request that runs on every
   * page load. It also keeps this service honest about not knowing how sessions
   * are resolved.
   *
   * No DataScope argument, unlike the rest of @repo/services. That is not an
   * exemption from hard rule 1: the scope IS the return value here. The orgs
   * come from the user's own assignments, and the schools inside each are read
   * through listSchools() with scopes derived from those same assignments, so
   * nothing reaches this result that the user does not already hold a grant on.
   */
  async getMemberships(authCache: UserAuthCache): Promise<Membership[]> {
    const orgIds = [
      ...new Set(authCache.assignments.map((a) => a.organizationId)),
    ];

    if (orgIds.length === 0) return [];

    const orgRows = await db
      .select()
      .from(organizations)
      .where(inArray(organizations.id, orgIds));

    const memberships: Membership[] = [];

    for (const organization of orgRows) {
      const assignments = authCache.assignments.filter(
        (a) => a.organizationId === organization.id,
      );

      // "Which schools may this user see in this org" is the list question, so
      // it takes the permissive path: a branch-scoped principal does not cover
      // the org node, yet must still see their own branch. Reusing
      // listSchools() keeps the tenancy filter in exactly one place.
      const scopes = getDataScopes(authCache, "school:read", {
        organizationId: organization.id,
        schoolId: null,
        classId: null,
        sectionId: null,
      });

      // A role that lacks school:read is legitimate — an accountant, say. They
      // get the org with no schools rather than a 403, because the session and
      // the membership are both valid; only that one list is empty.
      const schools = scopes.length > 0
        ? await organizationService.listSchools(scopes)
        : [];

      memberships.push({
        organization,
        scopeTypes: [...new Set(assignments.map((a) => a.scopeType))],
        roleTypes: [...new Set(assignments.map((a) => a.roleType))],
        permissions: permissionsInOrg(authCache, organization.id),
        schools,
      });
    }

    return memberships;
  }
}

export const identityService = new IdentityService();

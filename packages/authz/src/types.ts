import type { Permission } from "./permissions";
import type { RoleType, ScopeType } from "./roles";

/**
 * One row from scope_nodes, carrying the full ancestry of a school / class /
 * section. Org nodes are synthetic — there is no row for them, they are built
 * inline, because an org has no ancestry to record.
 */
export interface ScopeNode {
  id: string;
  type: ScopeType;
  organizationId: string;
  /** null when type is 'org' or 'school' — for a school node, `id` IS the school id. */
  schoolId: string | null;
  /** null unless type is 'section' — for a class node, `id` IS the class id. */
  classId: string | null;
}

/**
 * One row from role_assignments with its scope already resolved.
 *
 * resolvedDataScope is computed once when the cache is built, so can() and
 * getDataScope() are pure in-memory functions with no I/O on the hot path.
 */
export interface RoleAssignment {
  id: string;
  userId: string;
  roleType: RoleType;
  organizationId: string;
  scopeType: ScopeType;
  scopeId: string;
  expiresAt: Date | null;
  resolvedDataScope: DataScope;
}

/**
 * What the request is asking about: an org, and the most specific node named
 * in the input (section > class > school > org).
 */
export interface ResourceContext {
  organizationId: string;
  nodeId: string;
  node: ScopeNode;
}

/**
 * The tenancy filter a service must apply to every query (hard rule 1).
 *
 * null at a level means "not restricted here" — the user covers everything at
 * and below it. A principal scoped to one school gets
 * { organizationId, schoolId, classId: null, sectionId: null }: every class in
 * that school, nothing outside it.
 *
 * Services take this as a REQUIRED argument so that forgetting the filter is a
 * compile error rather than a data leak.
 */
export interface DataScope {
  organizationId: string;
  schoolId: string | null;
  classId: string | null;
  sectionId: string | null;
}

/**
 * Everything needed to authorize a staff request, cached in Redis.
 *
 * orgPermissions is keyed by org then role type, because a user may hold roles
 * in several orgs of the same trust group and the permission sets differ per
 * org (ADR-011).
 */
export interface UserAuthCache {
  userId: string;
  assignments: RoleAssignment[];
  /** organizationId → roleType → the permissions that role holds in that org. */
  orgPermissions: Record<string, Record<RoleType, Permission[]>>;
  builtAt: number;
}

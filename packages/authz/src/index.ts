/**
 * @repo/authz — authorization. Who may do what, to which records.
 *
 * Authentication (is this a valid session) belongs to @repo/auth. This package
 * only answers the question that comes after: given a valid user, what are they
 * allowed to touch.
 *
 * The two tracks (ADR-005), and which one you are in matters:
 *
 *   STAFF    role_assignments → org_role_permissions → can() → DataScope
 *   STUDENT  session → student_portal_access → owned studentIds
 *
 * Students hold no role_assignments and never reach can(). Their access is
 * ownership, filtered by getOwnedStudentIds().
 */

// The permission vocabulary. RESOURCE_ACTIONS is the source of truth; the
// Permission type is derived from it, so invalid pairs do not compile.
export {
  ALL_PERMISSIONS,
  isPermission,
  RESOURCE_ACTIONS,
  RESOURCE_CATEGORIES,
  SENSITIVE_PERMISSIONS,
  type Permission,
  type Resource,
} from "./permissions";

// Fixed role types and the scope hierarchy they are granted at.
export {
  DEFAULT_SCOPE_LEVEL,
  isBroaderOrEqual,
  isRoleType,
  isScopeType,
  RESOURCE_MIN_SCOPE,
  resourcesForScope,
  ROLE_LABELS,
  ROLE_TYPES,
  SCOPE_TYPES,
  scopeDepth,
  type RoleType,
  type ScopeType,
} from "./roles";

export type {
  DataScope,
  ResourceContext,
  RoleAssignment,
  ScopeNode,
  UserAuthCache,
} from "./types";

// The decision functions. Pure and synchronous — no I/O on the hot path.
//
// There is no getDataScope(): once can() approves a node, the filter is that
// node's own scope via dataScopeFromNode(). Deriving it from the granting
// assignment instead widened the filter to the whole grant (ADR-017).
export { can, getDataScopes, permissionsInOrg } from "./can";

// Scope maths and the query filter every service must apply (hard rule 1).
export {
  dataScopeFromNode,
  intersectScopes,
  isAssignmentExpired,
  orgScopeNode,
  scopeCovers,
  scopeWhere,
  type ScopeColumns,
} from "./scope";


// Loading and invalidating the cached picture of a user's access.
export {
  buildUserAuthCache,
  getOwnedStudentIds,
  getRedis,
  getUserAuthCache,
  invalidateOrgAuthCache,
  invalidateScopeNode,
  invalidateUserAuthCache,
  loadScopeNode,
} from "./cache";

// Hard rule 12 — creating a school/class/section inserts its scope node.
export { insertScopeNode } from "./scopeNode";

// Seed matrix copied into a new org's org_role_permissions.
export { DEFAULT_ROLE_PERMISSIONS } from "./defaultPermissions";

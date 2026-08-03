import type { Permission } from '../types/permissions';
import type { RoleType } from '../types/roles';
import type { ScopeType } from '../types/hierarchy';

// ── ScopeNode — one row from scope_nodes, loaded per request ──────────────
// Contains the full ancestry of a school/class/section.
// Org nodes are synthetic (not in DB), created inline.
export interface ScopeNode {
  id:       string;
  type:     ScopeType;
  orgId:    string;
  schoolId: string | null;  // null when type='school' (id IS the schoolId)
  classId:  string | null;  // null when type='school' or 'class' (id IS the classId)
}

// ── RoleAssignment — one row from role_assignments, with resolved scope ───
// resolvedDataScope is computed at cache-build time from the scope_node,
// so can() and getDataScope() never need an extra lookup at request time.
export interface RoleAssignment {
  id:                string;
  userId:            string;
  roleType:          RoleType;
  orgId:             string;
  scopeType:         ScopeType;
  scopeId:           string;
  expiresAt:         Date | null;
  resolvedDataScope: DataScope;  // pre-computed at cache build time
}

// ── ResourceContext — built from the request for every authorization check ─
// nodeId:   the most specific resource identifier in the URL
//           (sectionId if present, else classId, else schoolId, else orgId)
// node:     the loaded ScopeNode for that nodeId (loaded once per request)
export interface ResourceContext {
  orgId:  string;
  nodeId: string;
  node:   ScopeNode;
}

// ── DataScope — what the route handler uses to build the WHERE clause ──────
// null at a level means "not restricted here" (user covers everything at/below).
// Route handlers use buildScopeWhere(scope) to convert this to Drizzle conditions.
export interface DataScope {
  orgId:     string;
  schoolId:  string | null;  // null = all schools
  classId:   string | null;  // null = all classes
  sectionId: string | null;  // null = all sections
}

// ── UserAuthCache — the full picture, stored in Redis, rebuilt every 5 min ─
export interface UserAuthCache {
  userId:      string;
  authVersion: number;  // snapshot of users.auth_version at build time
  assignments: RoleAssignment[];
  // orgId → roleType → Set<Permission>
  // No parent-chain expansion needed: each role type has its own explicit set.
  orgPermissions: Record<string, Map<RoleType, Set<Permission>>>;
  builtAt: number;
}

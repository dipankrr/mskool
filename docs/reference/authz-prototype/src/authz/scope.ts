import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { db } from '../db/client';
import { getRedis } from '../db/redis';
import { scopeNodes } from '../db/schema';
import type { RoleAssignment, ScopeNode, ResourceContext, DataScope } from './types';
import { ForbiddenError } from '../middleware/authorize';

const NODE_CACHE_TTL = 60 * 60 * 24; // 24 hours — school structure rarely changes

// ── scopeCovers ─────────────────────────────────────────────────────────────
//
// Does this assignment's scope cover the requested resource node?
//
// The clean version of the old nullable-columns check.
// Old: if (assignment.schoolId !== null && assignment.schoolId !== ctx.schoolId) return false
// New: one switch, one comparison. Unambiguous, no invalid states possible.
//
// 'org'     assignment covers everything in that org
// 'school'  covers everything whose schoolId matches (all classes, all sections in S1)
// 'class'   covers everything whose classId matches (all sections of C3)
// 'section' covers only that exact section
export function scopeCovers(assignment: RoleAssignment, node: ScopeNode): boolean {
  if (node.orgId !== assignment.orgId) return false; // cross-tenant guard

  switch (assignment.scopeType) {
    case 'org':
      return node.orgId === assignment.scopeId;
    case 'school':
      // For school-type nodes, the node's id IS the schoolId
      return (node.type === 'school' ? node.id : node.schoolId) === assignment.scopeId;
    case 'class':
      return (node.type === 'class' ? node.id : node.classId) === assignment.scopeId;
    case 'section':
      return node.id === assignment.scopeId && node.type === 'section';
  }
}

export function isAssignmentExpired(assignment: RoleAssignment, now = new Date()): boolean {
  return assignment.expiresAt !== null && assignment.expiresAt <= now;
}

// ── dataScopeFromNode ────────────────────────────────────────────────────────
//
// Converts an assignment's scope node into the DataScope shape that route
// handlers use for WHERE clauses.
// null at a level means "don't filter here" (user covers everything below).
export function dataScopeFromNode(node: ScopeNode): DataScope {
  switch (node.type) {
    case 'org':
      return { orgId: node.orgId, schoolId: null, classId: null, sectionId: null };
    case 'school':
      return { orgId: node.orgId, schoolId: node.id, classId: null, sectionId: null };
    case 'class':
      return { orgId: node.orgId, schoolId: node.schoolId, classId: node.id, sectionId: null };
    case 'section':
      return { orgId: node.orgId, schoolId: node.schoolId, classId: node.classId, sectionId: node.id };
  }
}

// ── loadScopeNode ────────────────────────────────────────────────────────────
// Redis-first lookup. Falls back to DB on miss.
// Verifies the node belongs to the expected org (cross-tenant guard).
export async function loadScopeNode(nodeId: string, expectedOrgId: string): Promise<ScopeNode> {
  const cacheKey = `scope_node:${nodeId}`;
  const cached = await getRedis().get(cacheKey);

  if (cached) {
    const node = JSON.parse(cached) as ScopeNode;
    if (node.orgId !== expectedOrgId) throw new ForbiddenError('Resource belongs to a different organisation');
    return node;
  }

  const [row] = await db.select().from(scopeNodes).where(eq(scopeNodes.id, nodeId));
  if (!row) throw new ForbiddenError('Resource not found');
  if (row.orgId !== expectedOrgId) throw new ForbiddenError('Resource belongs to a different organisation');

  const node: ScopeNode = {
    id:       row.id,
    type:     row.type,
    orgId:    row.orgId,
    schoolId: row.schoolId,
    classId:  row.classId,
  };

  await getRedis().set(cacheKey, JSON.stringify(node), 'EX', NODE_CACHE_TTL);
  return node;
}

// ── resolveCtx ───────────────────────────────────────────────────────────────
//
// Builds the ResourceContext for a request by loading the most specific
// scope node available in the URL params.
//
// Priority: sectionId > classId > schoolId > orgId
// For org-level resources (e.g. /orgs/:orgId/settings), a synthetic node
// is created without a DB lookup.
//
// This is the function that lets us use short URLs. Instead of encoding
// the full hierarchy in the URL (/orgs/:orgId/schools/:schoolId/classes/:classId/...),
// we just need the most specific ID and resolve everything else from scope_nodes.
export async function resolveCtx(req: Request): Promise<ResourceContext> {
  const orgId = req.params.orgId;
  if (!orgId) throw new Error('resolveCtx: orgId missing from request');

  const nodeId = (
    req.params.sectionId ??
    req.params.classId ??
    req.params.schoolId ??
    orgId
  );

  if (nodeId === orgId) {
    // Org-level resource — synthetic node, no DB lookup
    const node: ScopeNode = { id: orgId, type: 'org', orgId, schoolId: null, classId: null };
    return { orgId, nodeId: orgId, node };
  }

  const node = await loadScopeNode(nodeId, orgId);
  return { orgId, nodeId, node };
}

// ── buildScopeWhere ──────────────────────────────────────────────────────────
//
// Converts a DataScope into a list of Drizzle eq() conditions for a table
// that has orgId / schoolId / classId / sectionId columns.
//
// The caller does: .where(and(...buildScopeWhere(scope, table)))
// null at a level means "no filter" — the user covers everything there.
//
// IMPORTANT: always call this for every read/write query. Forgetting it is
// the classic data-leak bug (teacher reads another section's data).
export function buildScopeWhere(
  scope: DataScope,
  table: { orgId: any; schoolId?: any; classId?: any; sectionId?: any }
) {
  const conditions = [eq(table.orgId, scope.orgId)];
  if (scope.schoolId  && table.schoolId)  conditions.push(eq(table.schoolId,  scope.schoolId));
  if (scope.classId   && table.classId)   conditions.push(eq(table.classId,   scope.classId));
  if (scope.sectionId && table.sectionId) conditions.push(eq(table.sectionId, scope.sectionId));
  return conditions;
}

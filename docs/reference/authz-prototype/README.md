# School Management SaaS — Authorization System v2

**Stack:** TypeScript · Drizzle ORM (PostgreSQL) · Redis · Express  
**Wire up `DATABASE_URL` and `REDIS_URL` before running.**

---

## What changed from v1 (and why)

The v1 system was heavily influenced by the exam platform we started from. Three of its design choices didn't actually fit the school problem:

### 1. Nullable columns → scope_type + scope_id

**v1:**
```
role_assignments (userId, roleId, orgId, schoolId?, classId?, sectionId?)
```
The nullable column model had a structural bug: `{ classId: 'C3', schoolId: null }` is an invalid scope but the DB accepts it. The bug was caught by a security review.

**v2:**
```
role_assignments (userId, roleType, orgId, scope_type, scope_id)
```
One column says what level. One column says which thing. Invalid states are impossible.
`scopeCovers()` is now a 4-line switch statement instead of three null-guarded comparisons.

---

### 2. Fully dynamic roles → fixed role types

**v1:** Roles were rows in `org_roles`. Orgs could create arbitrary role types. This required:
- Cycle detection (parent chains could loop)
- `expandPermissions()` to walk parent chains at cache-build time
- `detectCycle()` guard
- An `org_roles` table with complex self-referential FK

**v2:** Role types are a fixed TypeScript `const` array (`ROLE_TYPES`). Orgs configure *permissions* per type — not the types themselves. This removes:
- The `org_roles` table entirely
- `expandPermissions()` — no chains to walk
- `detectCycle()` — no cycles possible
- All parent chain logic from the cache builder

The actual variability that schools need (different permissions for the same role) is preserved through `org_role_permissions`. "Can our principal see fee data?" is a permission toggle, not a new role type.

---

### 3. Scope nodes table

A `scope_nodes` table stores the ancestry of every school, class, and section as a single flat row. When class C3 is created, its row is `{ id: C3, type: 'class', orgId, schoolId: S1, classId: null }`. When section SA is created: `{ id: SA, type: 'section', orgId, schoolId: S1, classId: C3 }`.

This lets `scopeCovers()` answer "does this section belong to this class?" with one lookup and no recursion. It also enables short URLs — you only need the most specific ID in the URL, not the full hierarchy.

---

## File map

```
src/types/
  permissions.ts       RESOURCE_ACTIONS map, Permission type, SENSITIVE_PERMISSIONS
  roles.ts             ROLE_TYPES, DEFAULT_SCOPE_LEVEL, ROLE_LABELS
  hierarchy.ts         ScopeType, scopeDepth(), resourcesForScope()

src/db/
  schema.ts            5 tables: organisations, users, scope_nodes,
                                 org_role_permissions, role_assignments, authz_audit_log
  schema.app.ts        Domain stubs + insertScopeNode() contract
  client.ts            Drizzle + pg
  redis.ts             ioredis singleton

src/authz/
  types.ts             ScopeNode, RoleAssignment, ResourceContext, DataScope, UserAuthCache
  scope.ts             scopeCovers(), dataScopeFromNode(), loadScopeNode(),
                       resolveCtx(), buildScopeWhere()
  can.ts               can(), getDataScope(), getDataScopes()
  cache.ts             buildAuthCache(), getOrBuildAuthCache(), invalidateAuthCache(),
                       invalidateOrgCache(), checkAndRefreshCache()

src/middleware/
  authenticate.ts      JWT verify → load cache → attach to req
  authorize.ts         ForbiddenError, authorize() factory, requirePlatformAdmin()

src/policies/
  index.ts             p.one(), p.list(), p.sensitive() — the policy factory
                       checkSubjectAccess() — subject-level business logic helper
  roleAssignment.policy.ts  Scope-seniority enforcement + audit side-effects

src/routes/
  attendance.routes.ts Short URLs, buildScopeWhere() pattern
  marks.routes.ts      Subject check on create/update, p.sensitive() on publish/delete
  fee.routes.ts        Sub-resource split (fee_head, fee_payment), p.sensitive() on approve
  role.routes.ts       Permission grant/revoke for role types per org
  roleAssignment.routes.ts  Assign/revoke with scope seniority
  catalog.routes.ts    GET /permissions/catalog for the permissions editor UI

src/seeds/
  defaultPermissions.ts  Default permission sets per role type + seedOrg()

src/app.ts             Express entrypoint
```

---

## Three-line mental model

```
scope_nodes          = the school hierarchy (section → class → school → org)
org_role_permissions = WHAT each role type can do, per org (dynamic, org-editable)
role_assignments     = WHERE each user can act (scope_type + scope_id)
```

`can()` reads all three — from an in-memory Redis cache. Zero DB calls at request time.

---

## The scope model

Every role assignment has `(scope_type, scope_id)`:

| scope_type | scope_id points to | Covers |
|---|---|---|
| `org` | org UUID | Everything in the org |
| `school` | school UUID | All classes and sections in that school |
| `class` | class UUID | All sections of that class |
| `section` | section UUID | Exactly one section |

`scopeCovers(assignment, node)` checks:
- `org`: does the node's `orgId` match?
- `school`: does the node's `schoolId` match?
- `class`: does the node's `classId` match?
- `section`: is the node's `id` exactly the scope_id, and type is 'section'?

---

## Request flow

```
1. HTTP request arrives
   POST /orgs/ORG1/sections/SA/attendance

2. authenticate middleware
   JWT → load UserAuthCache from Redis (or build from DB)
   Attaches to req.authz

3. authorize(p.one('attendance:create'))
   Calls p.one() which:
   a. resolveCtx(req) — loads scope_node for SA from Redis (one key lookup)
   b. getDataScope(cache, 'attendance:create', ctx)
      - Loops over assignments
      - For each: check orgId, expiry, scopeCovers(), permission Set.has()
      - Returns DataScope of first match
   c. Throws ForbiddenError if null → 403
   d. Attaches DataScope to req.dataScope

4. Route handler runs
   Writes attendance using scope values (not body values).
   buildScopeWhere(req.dataScope, attendance) → WHERE conditions
   Teacher cannot write to a different section by changing the request body.
```

---

## Policy factory

Three variants cover ~90% of routes:

```typescript
// Standard single-resource gate
authorize(p.one('attendance:create'))

// List gate — returns all scopes the user can see
authorize(p.list('attendance:read'))

// Sensitive gate — checks auth_version in DB before proceeding
authorize(p.sensitive('fee_payment:approve'))
```

Use a custom `PolicyFn` only when you need extra logic:
```typescript
// Scope seniority check for role assignment
authorize(RoleAssignmentPolicy.assign())
```

---

## URL design

Include `orgId` always (multi-tenant isolation). Then the most specific scope ID available. Everything else is resolved from `scope_nodes`.

```
✓  POST /orgs/:orgId/sections/:sectionId/attendance
✓  GET  /orgs/:orgId/schools/:schoolId/fee-payments
✓  GET  /orgs/:orgId/attendance             (list — all sections I can see)

✗  POST /orgs/:orgId/schools/:schoolId/classes/:classId/sections/:sectionId/attendance
   (too much — sectionId alone is sufficient, resolveCtx() gets the rest)
```

**Never take orgId from the request body or token for resource identification.** The URL param is the resource identifier. The token is a claim about who the user is.

---

## Edge cases handled

### Auth version / race condition
`users.auth_version` is bumped on every `invalidateAuthCache()` call. Sensitive routes call `checkAndRefreshCache()` which does a single PK lookup to compare the cached version against the DB. If they differ, the cache is rebuilt before the permission check runs.

```typescript
// Sequence that would have been a bug in v1:
// 10:00:00 — John's request starts, cache loaded (has fee_payment:approve)
// 10:00:05 — Admin revokes fee_payment:approve, auth_version bumped to 7
// 10:00:10 — John reaches p.sensitive('fee_payment:approve')
//            checkAndRefreshCache: cache has version 6, DB has 7 → REBUILD
//            New cache: no fee_payment:approve → 403
```

### Scope hierarchy validation (structurally prevented)
Invalid states like `classId set, schoolId null` cannot be created because scope is `(scope_type, scope_id)`, not nullable columns. `scope_type='class'` + `scope_id=C3` is always valid — the class knows its school.

### Cross-tenant isolation (defence in depth)
`resolveCtx()` calls `loadScopeNode(nodeId, expectedOrgId)` which verifies the node's `orgId` matches the URL's `orgId`. A request with `orgId=B` and a scope node that belongs to `orgId=A` is rejected before `can()` even runs. `can()` also checks `ctx.node.orgId === ctx.orgId` as a second layer.

### Confused deputy (scope-pinned writes)
Route handlers always write using `req.dataScope` values, never raw body values. A teacher cannot mark attendance for a different section by sending `sectionId: 'SomeOtherSection'` in the body — the scope from the authorization check is what gets written.

### Batch operation loophole
Not implemented in these routes (batches would need per-record scope checks), but the pattern is: after the initial `can()` gate, loop over batch items and call `buildScopeWhere()` in the WHERE clause for each one. Never check once and apply to all.

### TOCTOU for financial operations
Fee approval routes use `p.sensitive()` which refreshes the auth cache. For the data itself (e.g., amount changed between read and update), wrap financial writes in a DB transaction with a `FOR UPDATE` lock on the payment row.

### Audit log
Every permission grant/revoke and role assignment change writes to `authz_audit_log`. Columns: actor, org, action, target user, target role, scope, timestamp, JSON details snapshot. Answers: "who changed what, when?"

---

## Subject-level access (marks and homework)

Subject restriction (Math teacher only enters marks for Math) is **not in the authz scope system**. It's business logic in a `staff_subject_assignments` table.

Why: subject is a data-level concept, not a scope-level concept. Adding `subjectId` as a scope column would break attendance checks (attendance has no subject). Teachers would need two separate assignments per subject.

How it works:
1. `p.one('marks:create')` checks the authz gate (can this user enter marks for this section at all?)
2. `checkSubjectAccess(scope, userId, sectionId, subjectId)` checks the subject table
3. Step 2 is **skipped** if `scope.sectionId === null` (user has class/school/org scope — no subject restriction)

```
Principal (scope.sectionId = null) → no subject check, can see/edit all subjects
Class teacher (scope.sectionId = null) → no subject check
Subject teacher (scope.sectionId = SA) → must have subject assignment row
```

---

## How to add a new resource

1. Add the resource and its valid actions to `RESOURCE_ACTIONS` in `types/permissions.ts`
2. Add it to `RESOURCE_MIN_SCOPE` in `types/hierarchy.ts`
3. Add it to the appropriate category in `RESOURCE_CATEGORIES` in `types/permissions.ts`
4. Add relevant permissions to role types in `seeds/defaultPermissions.ts`
5. Create `routes/yourresource.routes.ts` following the attendance route pattern
6. Register the router in `app.ts`

The `Permission` type updates automatically. Typos are compile errors.

---

## How to add a new scope node (when creating schools/classes/sections)

Domain routes that create schools, classes, or sections MUST call `insertScopeNode()`:

```typescript
// When creating a school:
await insertScopeNode({ id: school.id, type: 'school', orgId, schoolId: null, classId: null });

// When creating a class:
await insertScopeNode({ id: class_.id, type: 'class', orgId, schoolId: school.id, classId: null });

// When creating a section:
await insertScopeNode({ id: section.id, type: 'section', orgId, schoolId: school.id, classId: class_.id });
```

Without this, `resolveCtx()` will return 403 for any request targeting that school/class/section.

---

## How to provision a new org

```typescript
import { seedOrg } from './seeds/defaultPermissions';
await seedOrg(newOrgId);
```

This seeds `org_role_permissions` with the default permission sets for all 8 role types. The org admin can then customise via the permissions editor.

---

## Known intentional gaps

- **Role type display names per org** — orgs may want to rename "Subject Teacher" to "Form Teacher". This is a UI configuration (a `display_name` column on a settings table), not an authz concern.
- **Academic year scoping on assignments** — role assignments are structural and don't auto-expire per year. At year rollover, the admin team revokes and recreates assignments. The `staff_subject_assignments` table has an `academic_year` column for the subject-level rotation.
- **Session / academic year as a scope level** — deliberately not added. It's a data filter, not an authz boundary.
- **Deny permissions** — not supported. Modelling as two separate resources is cleaner (e.g., `fee_payment:read` vs `payroll:read` rather than `employee:read` + `deny:salary:view`).

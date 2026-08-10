# Architecture Decision Record

Append-only log. Never edit an accepted ADR to mean something new — add a superseding
ADR that references it. When `docs/reference/` SQL conflicts with this file, this wins.

---

## ADR-001 — The tenant is the Organization, not the school

**Accepted.** Indian private schools are owned by a Trust/Society that frequently runs
multiple branches. Billing, staff, and academic-year rollout happen at org level.

`organizations` is the top entity; `schools` are branches under it. Every operational
table carries `school_id`; org-wide operations join through it. A staff member can hold
roles at org scope (all branches) or school scope (one branch).

Making the school the tenant would force duplicate accounts per branch and make
cross-branch reporting impossible.

---

## ADR-002 — UUID primary keys, not BIGSERIAL + public_id

**Accepted. Supersedes the hybrid-ID strategy in `docs/reference/sql/`.**

The reference SQL uses `BIGSERIAL id` for FKs plus `public_id UUID` for external
exposure. We use a single `uuid` PK everywhere.

Two ID columns per table means every query must know which one it holds, and a mistake
leaks sequential internal ids (enumerable) or breaks a join. One column, one meaning.
Cost is index size and slightly larger indexes; worth it. Exception: better-auth owns
its own tables (`user`, `session`, `account`, `verification`) and their ids are `text`.
Any FK to a user is therefore `text`, not `uuid`.

---

## ADR-003 — better-auth for authentication only; authorization is ours

**Accepted.** better-auth owns credentials, sessions, and tokens. It does **not** own
roles, permissions, or organizations.

We do not install better-auth's organization plugin. It ships its own `member` table with
its own `role` column; running that beside `role_assignments` means two systems both
answering "what can this user do", drifting apart silently. One source of truth.

---

## ADR-004 — Drop `users` and `user_school_assignments` from the reference SQL

**Accepted. Supersedes reference SQL tables 3 and 4.**

- `users` (with `password_hash`) → better-auth's `user` table. Hand-rolling password
  storage next to a library that does it correctly is indefensible.
- `users.full_name / legal_name / phone / date_of_birth` → move to `staff` and
  `guardians`. better-auth's `user` holds auth fields only.
- `user_school_assignments` → `role_assignments` (from the authz prototype). Its
  `scope_type` + `scope_id` pair expresses org-level and school-level roles uniformly,
  replacing the reference SQL's nullable-`school_id`-plus-CHECK-constraint approach,
  which permits invalid states the type system cannot see.

New tables this forces into existence:

- **`staff`** — the reference SQL has nowhere to put `employee_code`, `designation`,
  or `date_of_joining`.
- **`guardians`** — guardian identity needs a home once guardians are not user rows
  (see ADR-006).

---

## ADR-005 — Two authorization tracks: staff by role, student by ownership

**Accepted.** Staff and students are authorized by different mechanisms.

```
STAFF   → role_assignments → org_role_permissions → can() → DataScope filter
STUDENT → session → student_portal_access → owned studentIds → ownership filter
```

Students get **no** `role_assignments` rows and never invoke `can()`. Reason: every
student has an identical permission set. Storing thousands of rows to express one
invariant, and building a Redis permission cache per student for zero variability, is
pure cost. What a student may see is not configurable, so it is code, not data.

Enforcement: `AuthContext` is a **discriminated union**, not a record with optional
fields.

```ts
type AuthContext =
  | { kind: 'platform_admin' }
  | { kind: 'staff';   userId: string; authz: UserAuthCache }
  | { kind: 'student'; userId: string; studentIds: string[]; activeStudentId: string }
  | { kind: 'system' }   // see ADR-009
```

Discriminated so a student reaching a staff procedure is a **compile error**
(`ctx.auth.activeStudentId` does not exist on the staff variant). With optional fields it
is a runtime check someone forgets in month four.

Where staff and students need the same data, the **service takes a scope discriminator**
as a required argument:

```ts
FeeService.listInstallments(scope:
  | { kind: 'staff';   dataScope: DataScope }
  | { kind: 'student'; studentId: string }
)
```

One query builder, two callers, and the compiler rejects an unfiltered call.

---

## ADR-006 — Guardians have no login; the student account is the family account

**Accepted. Supersedes reference SQL `student_guardians.user_id → users(id)`.**

`student_guardians.user_id` becomes `guardian_id → guardians.id`. Guardians are contact
records, not principals.

Consequence to accept deliberately: the fee and results screens in the student portal are
used by **parents**. Write that UI for an adult, not a nine-year-old. One login per
family; siblings appear under it.

---

## ADR-007 — Student credentials: phone number + password

**Accepted.** Students have no email, so email/password cannot be the credential.

Rejected alternatives:

- **Admission number** — schools re-issue and correct these; a login identifier must
  never be school-mutable. It stays a *display* identifier on documents.
- **OTP** — no per-login SMS cost, and no OTP infrastructure in v1.

Implementation: better-auth's **username plugin**, with the phone number as the
username — not the phoneNumber plugin, which is built around the OTP flows we rejected.

Follow-on details:

- better-auth usernames are globally unique but a phone is not unique across orgs, so
  the stored username is `{org_slug}-{phone}`. The login page resolves the org from
  subdomain or picker; the parent still types only their phone. Judged rare enough to
  accept.
- `user.email` must become nullable. Synthetic emails get mistaken for real ones by a
  notification job eventually.
- No email means no self-service reset. School staff set an initial password at portal
  activation, with `must_change_password` forcing a change on first login. Requires
  `student_portal:activate` and `student_portal:reset_password` in `RESOURCE_ACTIONS`.
- Changing a phone number is changing a credential: own permission, audit row, and
  session revocation. Otherwise it is a quiet account-takeover path. **Deferred, but
  must land before the portal ships.**

---

## ADR-008 — `student_portal_access` join table; drop `students.user_id`

**Accepted. Supersedes reference SQL `students.user_id BIGINT NOT NULL UNIQUE`.**

That constraint contradicts two decisions:

- `NOT NULL` — a student exists from admission day; portal access is activated later.
- `UNIQUE` — one user ↔ one student, but ADR-007 gives a family one phone login, and
  siblings share it. Three children under one number is impossible under `UNIQUE`.

Replaced by:

```
student_portal_access (id, user_id → user.id, student_id → students.id,
                       is_active, granted_at, granted_by)
```

One login → N students → an `activeStudentId` switcher, mirroring the staff
school-switcher. Every `portal.*` query verifies the requested `studentId` is in the
caller's set before filtering. Also handles a parent with children in two branches of
the same org.

---

## ADR-009 — A `system` auth context for payment webhooks

**Accepted.** A student tapping "Pay" must not be what writes
`fee_payments.payment_status = 'cleared'` — that lets the client decide money arrived.

```
1. studentProcedure  read own fee_installments (ownership filter)
2. studentProcedure  create payment intent → gateway (no fee_payments row yet)
3. gateway webhook   kind: 'system' → writes fee_payments + payment_allocations
                     + financial_transactions, row-locks the receipt sequence
```

`{ kind: 'system' }` is authenticated by webhook signature, not session, and is the only
path permitted to write the ledger. Built in Phase 1 rather than discovered in Phase 4.

---

## ADR-010 — Student UI is a route group, not a separate app

**Accepted.** `apps/web/src/app/(admin)/` and `(student)/` — separate layouts, navs, and
`features/` trees, sharing the tRPC client, `components/ui`, build, and deploy.
`middleware.ts` redirects each `kind` to its own root.

A separate app would only pay off with an independent deploy cadence or a different
domain. Neither applies. For a future native app, the generated REST surface
(`trpc-to-openapi`) is already there.

Router namespaces mirror this: `portal.*` for students, `<domain>.*` for staff, so
"is this endpoint student-reachable?" is answerable at a glance.

---

## ADR-011 — Owner is `org_admin` at org scope, not a separate role type

**Accepted.** Owner and Principal are distinct to *sales*, not to the permission system:
an Owner is org-scoped with full access, which `org_admin` at `scope_type='org'` already
expresses exactly. Labelled "Owner" in the UI. `ROLE_TYPES` stays at 8 values.

---

## ADR-012 — `section_teacher_assignments` is the subject-access source of truth

**Accepted.** The authz prototype's README describes a `staff_subject_assignments` table;
reference SQL table 11 `section_teacher_assignments` already carries `user_id`,
`subject_id`, `role`, and date-ranging. Same table. We keep the SQL one and point
`checkSubjectAccess` at it rather than creating a second.

Related overlap, resolved: `section_teacher_assignments.role`
(`ClassTeacher`/`SubjectTeacher`) vs `role_assignments.roleType`
(`class_teacher`/`subject_teacher`). `role_assignments` is the **authorization**
authority; `section_teacher_assignments` records the **timetable/subject** fact. Do not
read the latter to answer a permission question.

Also dropped for the same reason: `attendance_policies.can_mark_roles` and
`can_correct_roles` (reference SQL table 24). `org_role_permissions` owns who may mark
attendance. Two sources of truth for one question is how a permissions bug ships.

---

## ADR-013 — Postgres-only constructs stay, as hand-written migration SQL

**Accepted.** Several reference-SQL constructs cannot be expressed in Drizzle and are
appended to generated migrations by hand:

- `EXCLUDE USING gist` / `USING btree` on `academic_years` (no overlapping years, one
  current year per school) — needs `CREATE EXTENSION btree_gist`
- `DEFERRABLE INITIALLY DEFERRED` on `uq_attendance_daily`
- the three triggers: marks ≤ `max_marks`, lock grading scale on first use, and the
  `DO $$` block applying `trg_set_updated_at` across 25 tables

`generated always as` columns (`fee_installments.balance_amount`,
`fee_payments.total_amount`, `opening_balances.balance_amount`,
`attendance_summary.attendance_percentage`) **are** expressible, via
`.generatedAlwaysAs()`. Keep them. `BIGINT[]` array columns become `uuid[]`.

---

## ADR-014 — Homework deferred

**Accepted.** The authz prototype references `homework` permissions and subject-level
access for it, but no such table exists in the reference SQL. It is a genuine
student-portal feature (`homework`, `homework_submissions`), scheduled after the five
core domains. Recorded so the permission references are understood as forward-looking,
not as a missing table.

---

## ADR-015 — `scope_nodes` denormalises ancestry; the node id IS the entity id

**Accepted.** Two choices made while implementing `@repo/authz` in Phase 1.

Each `scope_nodes` row carries its own `school_id` and `class_id` rather than a
`parent_id`. "Does this school-scoped role cover section 7B?" is then one equality
check — `node.school_id = assignment.scope_id` — instead of a recursive CTE walking to
the root. This runs on every staff request, so the cost matters. The trade is that
re-parenting a node (moving a class between schools) means rewriting its descendants'
denormalised columns; that is a rare administrative act, and a recursive walk on every
request is not.

The node's primary key is also **not** generated: it is the id of the school, class, or
section it represents. A request carrying `sectionId` resolves its scope node directly,
with no lookup to translate entity id → node id. The cost is that `scope_nodes.id` has
no FK to any one table, since it points at three; the compensating rule is hard rule 12
— create the entity and its node in the same transaction, or the entity is invisible to
authorization.

---

## ADR-016 — Cache authorization for 5 minutes, except where it would be dangerous

**Accepted.** A user's assignments and their org's permission matrix are cached in Redis
for 5 minutes, so `can()` is pure and synchronous with no I/O.

This means a revoked role can keep working for up to 5 minutes. That is acceptable for
`student:read`; it is not acceptable for `fee_payment:approve`. So
`SENSITIVE_PERMISSIONS` — financial approvals, publication, and anything that grants
access — bypasses the cache and re-reads from Postgres. Those endpoints are rare enough
that the extra query costs nothing.

Explicit invalidation on role change is the normal path; the 5-minute window is the
failure mode when invalidation is missed, not the expected behaviour. Assignment expiry
is deliberately checked against the current clock on every call rather than filtered at
cache-build time, so a time-boxed delegation cannot outlive its `expires_at` by sitting
in a warm cache entry.

---

## ADR-017 — Two authorization questions: covering a node vs. overlapping it

**Accepted. Refines the `DataScope` contract described in ADR-005.**

Authorization asks one of two questions, and the first implementation conflated them.

```
STRICT      "does a grant COVER the node you addressed?"        staffProcedure
            scopeCovers(assignment, node) → ctx.scope: DataScope

PERMISSIVE  "which grants fall INSIDE the node you addressed?"  staffListProcedure
            intersectScopes(requested, granted) → ctx.scopes: DataScope[]
```

Strict is right for mutations and single-resource reads: a section-scoped teacher must
not act at org level, and `scopeCovers` correctly refuses. But it is wrong for lists — a
principal scoped to one branch addresses the *org* node to list schools, does not cover
it, and would get a 403 while trying to see their own branch. The school switcher needs
the permissive question.

Three consequences, each fixing a real defect found in review:

**`getDataScope` is deleted.** It returned the *granting assignment's* scope, so a
class-scoped teacher asking about section 7B received a filter spanning all of class 7
and every row in it. Once `can()` has approved the node, the correct filter is the node's
own scope — `dataScopeFromNode(ctx.node)` — which is always narrower or equal. There is
nothing left for the function to do.

**`getDataScopes` takes the requested scope and clips to it.** It previously returned
every grant held anywhere in the org, and its own docstring instructed callers to OR them
together; doing so on a request addressed at school A emitted rows from school B.
Intersecting first makes that leak structurally impossible rather than a rule to
remember.

**`scopeWhere` throws instead of silently widening.** It matched table columns by name
and skipped any level it could not find. `schools` has no `school_id` column — a school
*is* its id — so the school restriction was quietly dropped and a branch-scoped principal
listed every school in the trust. Columns are now mapped explicitly (`ScopeColumns`), and
a scope that restricts a level the table cannot express raises an error. A loud failure
in development is strictly better than an over-broad result in production, and the remedy
is to write the join.

The two builders stay separate entry points rather than one procedure with a flag.
Permissive with a section-level node degenerates to strict anyway, so the split is not
about mechanism — it is about making "this is a list" an explicit choice at the call
site, so a mutation cannot quietly acquire list semantics.

---

## ADR-018 — Managed Postgres and Redis; pooled and direct connections are different URLs

**Status:** accepted

**Context.** Development has no Docker and no local Postgres, so `localhost:5432` was
never going to work. We use Neon for Postgres and Upstash for Redis.

Neon exposes two hostnames for the same database. The **pooled** one (`-pooler` in the
host) is PgBouncer in transaction mode; the **direct** one is a normal Postgres session.
Transaction pooling is the right default for an API — connections are cheap and
short-lived — but it withholds two things we depend on elsewhere:

1. **Named prepared statements.** postgres.js uses them by default. Under transaction
   pooling the prepare and the execute can land on different backend connections, so
   queries fail with `prepared statement "s1" already exists` — intermittently, only
   under concurrency, looking exactly like a flaky network.
2. **Session-scoped DDL and advisory locks**, which drizzle-kit uses to serialise
   migrations.

**Decision.**

- `DATABASE_URL` is the **pooled** endpoint and is what the app uses. `client.ts` passes
  `prepare: false`, which is mandatory, not tuning.
- `DIRECT_DATABASE_URL` is the **direct** endpoint and is used by drizzle-kit alone.
  It is **optional** in `packages/db/src/env.ts` and falls back to `DATABASE_URL`:
  a running API never migrates, so requiring it would break a production boot that
  legitimately only has the pooled URL. The fallback is also the correct behaviour on
  any Postgres without a pooler in front of it.
- Redis is Upstash over TLS — `rediss://`, not `redis://`. ioredis needs no other change.

**Consequences.**

- Losing prepared statements costs a little per-query planning. Irrelevant at our scale.
- Neon's free tier auto-suspends after ~5 minutes idle; the first query afterwards takes
  roughly half a second. In development that reads as a hang in your own code, which is
  worth knowing before you go hunting for one.
- Upstash bills per command, which raises the stakes on the 5-minute auth cache TTL
  (ADR-016) and on the `buildUserAuthCache` N+1 still open in `docs/TASKS.md`.
- **Hard rule 3's `SELECT … FOR UPDATE` on receipt sequences (Phase 4) is unaffected** —
  row locks live inside a transaction, and transaction pooling keeps a transaction on one
  backend. Worth stating because it is the obvious thing to worry about here.
- If anyone later adds a `docker-compose.yml` for local Postgres, that supersedes this
  ADR rather than sitting alongside it: two sources of truth for connection strings is
  how staging data gets written to a developer's laptop.

---

## ADR-019 — Scope invariants are enforced by CHECK constraints, not convention

**Accepted.** Extends ADR-013 (Postgres-only constructs as hand-written migration SQL)
and ADR-015 (`scope_nodes` denormalises ancestry; the node id IS the entity id).

`packages/authz` already *assumes* two invariants. Until now nothing enforced them:

1. For an org-scoped `role_assignments` row, `scope_id` must equal `organization_id`.
   `scopeCovers()` answers such a grant with `node.organizationId === assignment.scopeId`.
2. A `scope_nodes` row must carry the ancestry its `type` implies — a class node needs
   `school_id`, a section node needs `school_id` and `class_id`.

Both are now `CHECK` constraints appended to `drizzle/0000_*.sql`:
`role_assignments_org_scope_id_matches_org` and `scope_nodes_shape_matches_type`.

**Why the database and not a service guard.** A violating row does not raise an error —
it silently changes an authorization answer. A class node missing `school_id` produces a
`DataScope` whose `schoolId` is `null`, i.e. a filter that spans the entire org: a
class teacher reading every student in the trust. That is indistinguishable from correct
behaviour in logs, and no test that does not specifically construct the malformed row
will catch it. Service-layer guards protect the paths that remember to call them;
a constraint also covers the seed script, a support engineer's manual `UPDATE`, and the
import tooling in Phase 5.

**Cost.** Drizzle does not model these, so they are re-applied by hand if `0000` is ever
regenerated (the usual ADR-013 tax). `pnpm db:verify` exists so that tax is visible
rather than discovered later: it asserts each constraint rejects the row it targets *and*
still accepts the legitimate row that most resembles it — a school-scoped grant, whose
`scope_id` legitimately differs from `organization_id`.

**Deliberately not constrained.** That an org node has no `scope_nodes` row at all
(`orgScopeNode()` synthesises it). The constraint only fixes the *shape* if one is ever
written, because forbidding the row outright would break `insertScopeNode()`, whose
`type` parameter includes `'org'`.

---

## ADR-020 — The seed is an application script in `apps/api`, not a `@repo/db` export

**Accepted.** Follows from the type chain in `AGENTS.md`
(`db → contracts → services → trpc → web`).

`packages/db/src/seed.ts` was the obvious home and is the wrong one. A useful seed needs
three things `@repo/db` cannot reach:

- `@repo/auth`, to create a login. Hard rule 9 — better-auth owns password hashing and
  the paired `account` row, and a hand-rolled `INSERT` into `user` yields an account that
  cannot sign in.
- `@repo/services`, to create a school *and* its `scope_nodes` row in one transaction
  (hard rule 12) and to copy `DEFAULT_ROLE_PERMISSIONS` into a new org.
- `@repo/authz`, to invalidate the auth cache after granting roles.

All three already depend on `@repo/db`. Seeding from inside it would point those arrows
backwards and put a cycle in turbo's graph. The alternative — duplicating the inserts with
raw Drizzle — is worse: the seed would stop exercising the code paths it exists to prove,
and the two copies would drift, with the *seed* being the one that quietly stops
enforcing hard rule 12.

So the seed lives at `apps/api/scripts/seed.ts`, alongside `smoke-authz.ts`. `apps/api` is
already the composition root — the only place that legitimately depends on everything.
`pnpm db:seed` still works from the repo root; it now delegates to `@repo/api`.

**Consequence for `apps/api/tsconfig.json`:** `include` is `["src", "scripts"]`, so these
scripts are type-checked with everything else, and `rootDir` is gone (it would reject
`scripts/` as outside the root). Nothing is lost — builds go through tsup, which has its
own entry points, and `tsc` here only ever runs with `--noEmit`. A seed that silently
stops compiling is a seed nobody runs until the day they need it.

**Cost.** `packages/db` no longer owns any executable data-authoring step, which is mildly
surprising if you go looking there first. `pnpm db:check` and `pnpm db:verify` stay in
`@repo/db`, because both are pure schema/connectivity assertions with no service
dependencies.







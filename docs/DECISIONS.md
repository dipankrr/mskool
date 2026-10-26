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

---

## ADR-021 — There is no public sign-up; accounts are provisioned

**Status:** accepted

**Context.** `apps/web` shipped a `/register` page wired to `authClient.signUp.email()`.
On a multi-tenant school system that is not a missing feature, it is an open door: anyone
on the internet could mint a `user` row against our better-auth instance. The account
would land with no `role_assignments` and no `student_portal_access`, so `can()` would
deny everything and it could read no data — but it is still an unauthenticated writer
creating rows in our identity table, which is a spam and enumeration surface at best.

Accounts in this product are *issued*, never self-claimed. Staff are invited by an org
admin; students are provisioned from the enrolment record (ADR-006, ADR-007). Both flows
already require an authenticated, authorized actor.

**Decision.** Remove the registration UI, and block the underlying endpoint at the HTTP
edge in `apps/api/src/server.ts`: a middleware mounted before the better-auth handler
answers **404** to anything under `/api/auth/sign-up`. 404 rather than 403 because a 403
confirms the endpoint exists and is merely switched off, which is a hint worth denying;
to a scanner the route simply is not there. It matches on `req.path` with a regex rather
than `app.all("/api/auth/sign-up", …)` — Express 5 changed path matching, and a pattern
that silently fails to match would leave the endpoint open while looking closed. The
prefix covers any sibling route a future better-auth version adds, so an upgrade cannot
quietly reopen registration. It must stay above the better-auth mount; Express matches in
registration order.


**Why not `emailAndPassword.disableSignUp`?** Because better-auth checks that flag inside
the sign-up handler itself, and `auth.api.signUpEmail()` runs that same handler. Setting
it would disable *server-side* provisioning too — breaking `pnpm db:seed` today and the
staff-invite flow tomorrow. Blocking at the transport layer stops the untrusted path (an
HTTP request from a browser) while leaving the trusted path (a server-side function call
by already-authorized code) intact. The distinction we care about is who is asking, and
that is exactly what the two paths encode.

**Consequences.** Deleting the UI alone would not have been enough — the endpoint was the
actual hole, and the page was only the signpost pointing at it. `RegisterUserInput` stays
in `@repo/contracts`: the staff-invite flow will validate the same shape, just behind
`staffProcedure`. There is deliberately no self-service path back in; if we ever want
parent-initiated onboarding it must go through an invitation token, and it supersedes
this ADR explicitly.

---

## ADR-022 — The academic-year invariants live in the database, and `db:verify` is what keeps them honest

**Status:** accepted

**Context.** Two rules about `academic_years` cannot be expressed as a UNIQUE index. A
school must not run two overlapping years — but the collision is between *date ranges*,
not values, so two rows with different names and different start dates are individually
unique and still overlap by five months. And a school must have at most one `is_current`
year, which is a uniqueness rule that applies to only the subset of rows where the flag is
true.

Both are the kind of rule that application code appears to enforce right up until two
requests interleave. "Close the old year, open the new one" is two statements; between
them, a concurrent transaction sees a consistent-looking database and writes the row that
makes it inconsistent. The damage is not theoretical — a student enrolled in two
overlapping years has attendance for a date with two homes and fees assessed twice.

**Decision.** Both become `EXCLUDE` constraints in the migration, per ADR-013's general
rule that Postgres owns invariants Drizzle cannot express:

- `academic_years_no_overlap_excl` — `EXCLUDE USING gist (school_id WITH =, daterange(start_date, end_date, '[]') WITH &&)`.
- `academic_years_one_current_excl` — `EXCLUDE USING btree (school_id WITH =) WHERE (is_current)`.

The range bound is `'[]'`, inclusive at both ends, so a year ending 2026-03-31 and the
next starting 2026-03-31 is a **conflict**, not a clean handover. That is deliberate: a
student cannot be enrolled in two years on the same day. It is also the single most
likely thing for a future edit to get wrong, so `db:verify` asserts that exact boundary
case — rewriting it as `'[)'` fails the run rather than silently permitting a one-day
overlap.

`EXCLUDE … WHERE (is_current)` rather than a partial unique index because the rule reads
as "no two rows may collide", not "this column is a key", and keeping both constraints in
the same idiom means one mental model instead of two.

**A third invariant, and it goes somewhere else.** `end_date >= start_date` is also a
rule about this table, and it is *already* enforced today — but only by accident. The
no-overlap constraint calls `daterange()`, and `daterange()` throws when the lower bound
exceeds the upper. So the row is refused, with a message that names neither the table nor
the rule: *"range lower bound must be less than or equal to range upper bound"*. Two
problems with relying on that. It sends the reader into Postgres internals instead of at
the row they just wrote; and it is incidental, so narrowing or rewriting the EXCLUDE
constraint later removes a guard nobody knew they were depending on.

It is therefore stated explicitly as `academic_years_end_after_start` — but as a Drizzle
`check()` in `schema/academic.ts`, **not** as hand-written SQL. Everything above is
hand-written because drizzle-kit cannot represent it; `check()` it can, so this constraint
appears in a generated migration (`0002`) and survives regeneration like any other column.
The ADR-013 tax is worth paying only where it buys something, and here it buys nothing.

The bound is `>=`, not `>`. A one-day academic year is absurd, but absurd is not the same
as corrupting, and a constraint that refuses rows outside its stated rule is as much a
defect as one that lets bad rows through. `db:verify` asserts the single-day year is
accepted for exactly that reason.

Both need `CREATE EXTENSION IF NOT EXISTS btree_gist`, which the migration does first. A
gist index over scalar `uuid` or `boolean` does not work without it, and the failure
message — *data type uuid has no default operator class for access method gist* — does
not obviously point at a missing extension.

**Consequences.** **drizzle-kit cannot see `EXCLUDE` constraints at all.** This cuts both
ways: it will never drop them on a diff, because it does not know they are there — but a
regenerated `0001` will not contain them either. The block is fenced with a comment in
the SQL saying so. Since a constraint that is trusted but absent is worse than one that
was never written, `pnpm db:verify` queries `pg_constraint` for `contype = 'x'` directly:
their disappearance fails loudly on the next run.

Verification asserts behaviour, not existence. For each constraint there is a rejection
test *and* an acceptance test for the legitimate row that most resembles the rejected one
— the same dates in a different school, a second non-current year. A constraint that is
too broad passes a rejection-only suite while quietly breaking real usage, and the second
school in each pair is what makes over-reach visible.

It also asserts the rejecting constraint **by name**, and the date check is why that
matters rather than being pedantry. An inverted range is refused whether or not
`academic_years_end_after_start` exists, so an assertion that only asked "was this
rejected?" would pass against a database where our rule had never been applied. Comparing
`constraint_name` is what distinguishes *our stated rule fired* from *something fired*.
Postgres evaluates CHECK constraints before exclusion constraints, so the name that comes
back is the specific one, not the daterange error.

One trap this shook out: the "no rows leaked" assertion originally counted all
`organizations`. `pnpm db:seed` legitimately leaves rows there, so that check failed on
any seeded database for a reason having nothing to do with the schema — the sort of
failure that gets a suite ignored. It now keys on the `verify-trust` slug the script
itself inserts, which is the invariant actually worth asserting: nothing *this script*
wrote survived its rollback.


---

## ADR-023 — Only org-level roles see past academic years; everyone else sees the current one

**Status:** superseded by ADR-024.
**Context:** Phase 2 slice 1, `academic.service.ts`. Qualifies ADR-017.
The reasoning below stands except for its third bullet ("It is not a permission"). Wiring
the router revealed that bullet's premise was wrong; ADR-024 replaces the `YearAccess`
mechanism with an `academic_year:read_history` permission and records why. Read ADR-024
for the current rule.

A school accumulates a session every year, and almost nobody working inside it has any
business reading a closed one. A class teacher, a principal, an accountant all work in the
present: their questions are about the children in front of them now. The Trust is the
exception — comparing this year's collections to last year's, or auditing a session after
it closed, is exactly what an org-level role exists to do.

**Decision.** Reads of `academic_years` and `sections` take a `YearAccess` argument.
`all-years` returns everything; `current-only` adds `academic_years.is_current = true` to
the predicate. `yearAccessFor(authCache, orgId)` derives it: a caller holding any
unexpired **org-scoped** assignment in that org gets `all-years`, everyone else
`current-only`.

Four things about the shape, each of which was the alternative considered first:

- **It is a required argument, not an option with a default.** Either default is wrong in
  a way that is invisible at the call site: `all-years` quietly hands a section teacher
  the school's history, `current-only` quietly hides it from the admin who came for it.
  Requiring it means a new read method cannot forget the question exists.
- **It cannot be derived from the `DataScope`, which is the counter-intuitive part.** An
  org admin addressing one school gets `schoolId: <that school>` — *identical* to what a
  principal at that school gets — because a DataScope describes the addressed node, not
  the caller's standing. Deriving from `scope.schoolId === null` would strip the org admin
  of history the moment they opened a branch, and the bug would look like flaky
  permissions. The answer only exists in the caller's assignments.
- **It is not a permission.** `academic_year:read` answers *may you read years*, and both
  roles may. This is about *which rows*, which is what `can()` deliberately does not
  model. Adding an `academic_year:read_history` permission would be the more conventional
  move, and was rejected: permissions are per-org editable (ADR-011), so an admin could
  grant it to a class teacher and silently undo the containment. Row visibility that a
  tenant can toggle is not a rule, it is a preference.
- **The section join is where it actually bites.** Filtering `listAcademicYears` alone is
  theatre — a `current-only` caller with a stale year id from a browser tab or a bookmark
  can still list that year's sections, and from a section id reach its students,
  attendance, and marks. So `listSections` and `getSectionById` join `academic_years` and
  put `is_current` in the predicate, making a non-current id return nothing regardless of
  where it came from. Every later domain reaches its rows through a section or a year, so
  the containment is inherited rather than reimplemented per domain.

**Consequences.** A principal cannot read last year's sections. That is a real
restriction, and the mitigations are deliberate rather than accidental: the current year
is always readable by everyone, `getCurrentAcademicYear` takes no `YearAccess` at all, and
promoting a school to a new session is `setCurrentAcademicYear`, an org-level act. If a
school later needs "the principal may see the year they were principal for", the natural
implementation is a grant with `valid_from` / `valid_to` covering that session rather than
a widening of this rule.

The other half of the trade sits in `atSchoolLevel` / `atClassLevel` in the same file:
ADR-017 makes `scopeWhere` throw when a scope restricts a level the table cannot express,
which would give a class-scoped teacher a 500 for asking which year their school is in.
Those helpers widen the scope before the call, justified by a property of the entity — an
academic year has no class dimension, so "my class's years" and "my school's years" are
the same set, not a narrower one. **That argument does not transfer to students,
attendance, marks, or fees**, all of which have a real class dimension where widening
would hand a class teacher the whole school. The comments there say so at the point
someone would copy them.


---

## ADR-024 — Reading history is a permission (`academic_year:read_history`), asked strict-or-permissive like every other

**Status:** accepted. Supersedes ADR-023.
**Context:** Phase 2 slice 1, wiring `academic.router.ts` onto the service ADR-023 built.

ADR-023 got the *rule* right — most people inside a school work in the present, the Trust
audits the past — and the *mechanism* wrong. It derived year visibility from whether the
caller held any org-scoped assignment, computed by a bespoke `yearAccessFor()` helper
living in the service, deliberately outside the permission system. Connecting it to tRPC
made three faults in that choice concrete rather than hypothetical.

**The rejected-alternative bullet in ADR-023 was answering a question nobody had asked.**
It rejected an `academic_year:read_history` permission on the grounds that an org admin
could then grant it to a class teacher and "silently undo the containment". But that is
true of *every* permission — an admin can grant `student:read` at org scope too — and it
is not a loss of containment, it is the org exercising the per-org editability ADR-011
made a deliberate feature. The thing being protected against was a tenant configuring
their own instance, which is not a threat. Meanwhile the bespoke mechanism had a real cost
the bullet did not weigh: it put an authorization decision somewhere `can()` could not see
it, so the one audit surface that is supposed to answer "who can do what" was blind to it.

**"Org-scoped assignment" was a proxy for the wrong thing, and it excluded the people the
rule is actually about.** Under ADR-023 a principal — school-scoped by definition — could
never read a closed session, not even the one they ran last year. An accountant chasing
last year's unpaid fees, also school-scoped, was locked out of exactly the records the job
requires. The Trust/branch line is not the same line as present/past access, and hard-coding
the first as a stand-in for the second denied history to the roles most likely to need it.
A permission seeded to principal, vice-principal, and accountant (see
`defaultPermissions.ts`) draws the line where it actually falls, and leaves it where a
school can adjust it.

**Decision.** `read_history` becomes a real action on `academic_year` in
`RESOURCE_ACTIONS`. The service no longer knows how the answer is reached: `YearAccess`
and `yearAccessFor()` are deleted, and every year-scoped read
(`listAcademicYears`, `getAcademicYearById`, `listSections`, `getSectionById`) takes a
plain `includeHistory: boolean`. The router computes it and passes it down — services stay
HTTP- and policy-agnostic, which is the type chain's whole point.

**The subtlety is which authorization question the router asks, and it is not one question.**
ADR-017 established that "may you act on this node?" (strict, `can()`) and "what may you see
under it?" (permissive, `getDataScopes()`) are different, and `read_history` inherits the
split intact:

- A **single-year read** addresses that year's node. Strict is right — `ctx.can(READ_HISTORY)`.
- A **list** addresses a parent node (the school, often the org) and asks what is visible
  beneath it. Strict is wrong here for the exact reason ADR-017 gives: a principal holds
  `read_history` at their *branch*, not at the org node they must name to list years across
  the school, so `can()` would deny them a list they are entitled to. The permissive
  question — does any grant in the addressed subtree carry it? — is the correct one:
  `ctx.canWithin(READ_HISTORY)`.

Both are exposed as bound helpers on the staff ctx (`can` on `staffProcedure`, `canWithin`
on `staffListProcedure`), closed over the already-resolved node so a handler cannot ask
about a different one. Asking the strict question on a list was tried first and produced
precisely the false 403 ADR-017 warned about; the bug reproduced ADR-017's own example,
which is what made the fix obvious.

**Consequences.** The `is_current` join in `listSections` / `getSectionById` is unchanged
and remains load-bearing for exactly ADR-023's reason: it is what stops a `includeHistory:false`
caller reaching a closed year's sections with a stale or guessed id, and every later domain
inherits that containment through the section edge. What changed is only *who* gets
`includeHistory: true` and *how the router decides* — the row-level enforcement ADR-023
designed is kept wholesale. `getCurrentAcademicYear` still takes no flag: the current year
is visible to every scope, so there is no question to ask. The mitigation ADR-023 imagined
for "let the principal see the year they ran" — a time-boxed grant — is no longer needed
for the common case, since the permission now covers it directly; it remains the right tool
for genuinely temporary access, such as an external auditor.

---

## ADR-025 — The dev seed keeps the fixture org's permission matrix current; real orgs stay frozen

**Status:** accepted.
**Context:** Phase 2 slice 1, extending `smoke-authz.ts` to prove the
`academic_year:read_history` gate (ADR-024) end to end against the live database.

`org_role_permissions` is a per-org snapshot: `createOrganization` copies
`DEFAULT_ROLE_PERMISSIONS` once, and from then on the org owns its rows — editing the
defaults file never touches an existing org (`defaultPermissions.ts`; the per-org
editability ADR-011 calls a feature). Correct for a real tenant, which may have
deliberately diverged.

Wrong for the **demo fixture**. `demo-trust` was first seeded before ADR-024 added
`academic_year:read_history` (and the class teacher's `academic_year:read`), so its stored
matrix lacked both. The new smoke assertions then failed for a reason that had nothing to
do with the gate: the principal held no `read_history` and the class teacher no `read`, so
each got the wrong answer from correct code. A green run against a stale fixture would be a
false negative; the red run we got is a false alarm that buries the real signal. Either way
the fixture, not the code, was the variable.

**Decision.** `seed.ts` gains `syncDefaultPermissions(orgId)`, run for the demo org on
every seed. It re-derives the `DEFAULT_ROLE_PERMISSIONS` pairs and inserts them with
`onConflictDoNothing`. It is **insert-only**: it backfills what the matrix lacks and never
deletes, so it cannot clobber a deliberate edit and is a no-op on a fresh org that
`createOrganization` already filled.

This does **not** contradict ADR-011. The frozen-snapshot rule governs *real tenants*,
which are never seeded — ADR-020 keeps the seed a dev-only script and it refuses
`NODE_ENV=production`. The fixture is test scaffolding whose whole purpose is to exercise
the current code; keeping it aligned to the defaults is maintenance of scaffolding, not a
change to tenant semantics.

**Consequences.** Adding a permission to `defaultPermissions.ts` now flows into the demo
org the next time anyone seeds, so a smoke test for it works without a manual matrix edit
or a database reset. Real orgs are untouched: whatever drift a live tenant has from the
defaults is theirs to keep. The trade-off is that `demo-trust` can no longer be used to
test *divergence* from the defaults — a test that needs an org which has deliberately
dropped a default permission must create a second org, because this seed re-adds anything
removed.

---

## ADR-026 — Database and service failures become user-facing errors at the transport, not in the service or the client

**Status:** accepted.
**Context:** Phase 2, building the admin console. Follows ADR-022; does not change it.

ADR-022 put the academic-year invariants in the database and said, correctly, that
application code must not re-check them: a SELECT-then-INSERT guard races, and a
constraint does not. Nothing was ever written to handle the *other* half of that bargain.
When Postgres refuses a row, somebody has to say so in words.

Nobody did. There is no `errorFormatter`, and tRPC's default handling of an unknown throw
is to wrap it in an `INTERNAL_SERVER_ERROR` whose message is the original exception's. So
the most likely mistake anyone makes on their first day — entering a session whose dates
overlap the one already there — arrived as HTTP 500 reading *conflicting key value
violates exclusion constraint "academic_years_no_overlap_excl"*. A second failure mode was
worse because it looked like a bug in us: `requireSchoolId` throws a plain `Error`, so a
create that simply forgot to name a branch returned 500 with a paragraph of internal
explanation, when the honest answer is 400 and "choose a branch".

**Decision.** A middleware on both staff builders, `translateErrors` in `trpc.ts`, calling
a pure `translateError()` in `errors.ts`:

- A Postgres error is looked up **by constraint name** and becomes `CONFLICT` with a
  written-out message. Eight names are mapped today, covering every constraint a caller
  can currently trip across `academic_years`, `classes`, `sections` and `schools`.
- A known service `Error` — `requireSchoolId`, `createSection`'s two cross-branch parent
  guards — becomes `BAD_REQUEST` with user-safe wording.
- Everything else becomes `INTERNAL_SERVER_ERROR` with a fixed generic message.

**Why the transport rather than the service.** A constraint name is a database fact; a
`CONFLICT` is a transport fact. The service is the only layer that must know nothing about
either the caller or HTTP — that is what makes it callable from a script, a job, or a test
— so mapping there would mean teaching it about status codes. The transport is where both
facts are already in view.

**Why not in the web client.** Because the routers have two transports. Every procedure
with `.meta({ openapi })` is also a REST endpoint under `/api`, reached by curl, a future
mobile app, or a partner integration, none of which will import our error mapper. Doing it
server-side means one implementation and identical behaviour on both. The web client still
maps *codes* to copy for the cases it owns (expired session, forbidden, offline) — that is
presentation of an outcome, not interpretation of a database failure.

**Why a middleware and not an `errorFormatter`.** The formatter can rewrite the response
shape but not the error code, and the code is what is wrong here: a duplicate name has to
stop being a 500 and start being a 409. The HTTP status is derived from the `TRPCError`
code before any formatter runs.

**Why constraint names and not message text.** The name is ours — written in
`schema/academic.ts` or the `0001` migration — and changing one is a migration somebody
notices. The sentence wrapped around it belongs to Postgres and is localised by
`lc_messages`, so matching on it would make our error handling depend on a server setting
nobody in this repo controls.

Interpolated values (`2025-26`, the code `MAIN`, the overlapped session's dates) come from
the error's DETAIL line, which Postgres omits when the caller lacks SELECT on the indexed
columns. Every message therefore has a second wording that reads correctly without them.
The dates are rendered `DD/MM/YYYY` here rather than as ISO, because these strings are
shown to the user verbatim; and the printed upper bound of a `daterange` is the day *after*
the session ends, so it is decremented — reporting 01/04/2025 for a session ending
31/03/2025 sends someone hunting for a row that does not exist.

**Consequences.** Adding a constraint without adding a map entry degrades rather than
breaks: an unmapped `23505`/`23P01`/`23514` still becomes `CONFLICT`, with generic wording,
because "something already exists" is actionable even when we cannot say what. Any other
SQLSTATE is infrastructure — a dropped connection, a column missing after a bad deploy —
and becomes the generic 500.

**The service-error half is matched on message text, which is exactly what the paragraph
above forbids.** The difference is ownership: those strings are ours, in
`packages/services`, and nothing but a regex connects them to the map. Rewording one drops
it through to the generic 500 — less helpful, still not a leak, which is the right way for
this to fail. A shared error type thrown by services and read here removes the matching
altogether, and is worth introducing the first time a fourth condition needs it; three
entries do not pay for a new cross-package vocabulary.

Because an untranslated failure no longer reaches the client, it is `console.error`'d with
its cause. Without that the change would trade a leak for a blind spot, which is not an
improvement. Deliberate `TRPCError`s pass through untouched — a router's `NOT_FOUND`, the
permission gate's `FORBIDDEN` — so authorization messaging stays where it was decided and
`smoke-authz.ts` still asserts the same codes.

The boundary is the two staff builders, not `protectedProcedure` or `studentProcedure`.
Every write that can trip a constraint is a staff call today, and the other two tracks only
read. When the student portal gains writes, the same middleware goes on that builder; the
mapping is already independent of which builder calls it.

There is no unit-test harness in `@repo/trpc`, so this is verified by tripping the
constraints through `/docs` or curl and confirming a 409 with a human message and a 400 for
a missing branch. `pnpm check-types` cannot see any of it.

**Amendment (authz API-shape refactor, chunk B1).** The permission gate's `FORBIDDEN` now
carries two wordings instead of one: a caller who holds the permission *somewhere* in the
organization but not covering the addressed node gets *"A role you hold has X but not at
this {org|school|class|section}."*, while a caller who does not hold it at all keeps the
plain *"Missing permission: X."* This deliberately narrows this ADR's vagueness principle
for exactly one case, because the two failures have different fixes — a role change versus
an addressing change — and support could not tell them apart. It stays inside the leak
rule: both messages describe only the caller's own grant state, which `/me` already
enumerates for them, so nothing about other tenants or other users is disclosed. Note
that `trpc-to-openapi` puts tRPC error `message`s on the wire verbatim, so REST consumers
see these strings raw; that is acceptable for the same reason. Codes are unchanged
(`FORBIDDEN` either way), so every existing assertion and the web client's kind-mapping
are unaffected.

**Amendment (2026-08-26, security review).** The boundary moves: `translateErrors` now
runs on `protectedProcedure` and `studentProcedure` as well. The original reasoning —
those tracks only read — missed that reading is exactly where infrastructure lives: `/me`
talks to Redis and Postgres on every page load, and an outage there used to hand the
browser the driver's connection error verbatim. The student track is included before its
first router exists so the convention never has to be remembered under pressure later.
The mapping itself is unchanged and independent of which builder calls it; deliberate
`TRPCError`s still pass through untouched, so all existing codes and wordings hold.

---

## ADR-027 — A single-resource endpoint addresses its own resource

**Status:** accepted.

**Context.** Both staff builders derive the *addressed node* from whatever scope fields the
client chose to send — `sectionId ?? classId ?? schoolId ?? organizationId`
(`addressedNodeId`, `trpc.ts`) — and ignore `input.id`. For `byId`, `update` and `deactivate`,
that means authorization is evaluated against **a different node than the row being touched**.
The client must guess which node to name, and the gate checks an answer to a question nobody
asked. Two concrete failures fall out of the decoupling:

- A section-scoped teacher who belongs to Class 6-A is refused `class.byId` for Class 6 unless
  she thinks to name her section in the input — the row is inside her grant, but she addressed
  something else and was judged on that.
- Conversely, a caller may authorize against a node their grant covers while mutating a row
  somewhere else entirely; nothing ties the checked node to the written one.

This was an oversight of assembly, not a decision: no ADR ever weighed "authorize on the
claimed node" against "authorize on the target row". Recording it now so B4 implements a
decision rather than a reflex.

**Decision.** A single-resource endpoint addresses its own resource: when the input carries
`id`, the addressed node IS that id's node. Implemented as an `addressedBy: "id"` option on
the existing `staffProcedure` — not a third builder — which attaches
`staffScopeInput.extend({ id: z.uuid() })` itself, because tRPC middleware only sees input
that was parsed *before* it was attached; the validated id must exist by the time the gate
runs.

`organizationId` deliberately stays in the input. It is what gives `can()`'s cross-tenant
check (`ctx.node.organizationId !== ctx.organizationId`, `can.ts`) something to compare: a
row id from another trust fails it even though the node lookup would have succeeded. If a
later refinement derives the organization from the resolved node instead — dropping
`organizationId` from these inputs — that check becomes vacuous and the surviving tenant
guard is the belt-and-braces comparison in `scopeCovers` (`scope.ts`: assignment org vs node
org). That trade is noted here so whoever makes it makes it knowingly.

**Rejected alternative — keep deriving from scope fields.** It is the status quo that
motivated this ADR: it forces every client to know addressing rules per endpoint (the web
app carries a comment-length explanation per hook), and it authorizes a different node than
the one mutated, which is a correctness hole wearing a usability problem.

**Consequences.** Clients stop sending `schoolId` on update/deactivate calls; REST paths are
unchanged; the smoke matrix's addressing choices stop being part of the contract for these
nine endpoints, and its cells are updated accordingly, one router at a time. `useClass`'s
list-based workaround stays until ADR-028 lands (see there).

---

## ADR-028 — Permissive single-row reads: the row asks the grants, in memory

**Status:** accepted. **Amends ADR-017's read half** — strict stays authoritative for
mutations, and `getDataScopes` clipping stays authoritative for lists. Nothing else in
ADR-017 changes.

**Context.** ADR-017 routed single-resource reads through the strict question with the
addressed node taken from the client's scope fields, then filtered the fetch with that
node's `scopeWhere`. Three things break when the reader's grant sits *below* the table's
shallowest column:

- `classes` has no section column and `schools` has none at all, so a section-scoped teacher
  either trips the loud throw ADR-017 added or needs hand-written widening per service —
  each one an invitation to widen too far.
- The web app already carries the workaround: `useClass` reads `class.list` (permissive,
  widened) and picks the row, because the strict read cannot be addressed reliably (ADR-027).
  A workaround living in application code is a decision made by accident.
- The real question a single-row read asks is not "do you cover a node you named" but "**is
  this row inside one of my grants?**" — a property of the row and the cache, computable
  without asking SQL to express scope at all.

**Decision.** For reads of an existing row, the fetch is filtered by organization alone
(the tenant clip), and authorization is the in-memory coverage test:

```
getDataScopes(cache, permission, dataScopeFromRow(row)).length > 0
```

No `scopeWhere` on the resource table, no per-service widening helper for reads. This reuses
the function ADR-017 built for lists, asked once about one row; the clipping semantics are
already decided and tested there.

**Rejected alternative — stricter single-row reads** (cover-the-named-node only). It blinds
a section teacher to the class she belongs to and the sections she teaches in, which is the
exact defect the frontend workaround papers over. Strictness here buys nothing: the row is
one already-fetched record, not a filter that could over-reach.

**Sub-node grants and `read_history`, decided in writing.** The permissive computation
admits a grant *narrower* than the row's node when the role holds the permission at that
grant — a class-scoped grant answers a school-row question. That is deliberate, and the
codebase already says so: `defaultPermissions.ts` grants `academic_year:read` to the
class-scoped teacher with the comment *"Sees the year list to switch context; without
read_history the switcher offers the current session only."* The principle this fixes:
**the grant limits which school; the permission gates the capability.** Scope narrows where
in the tree you work; it does not silently subtract capabilities the role was given. For the
seeded roles nothing observable changes — `class_teacher` holds no `read_history` at any
scope — but the widening is structural and would otherwise be decided by implementation
accident during B7.

**Reconciling `RESOURCE_MIN_SCOPE`.** The map says `academic_year: "school"`, yet the default
matrix deliberately grants year permissions to class-scoped roles — the map contradicts the
matrix. Resolution, in order:

1. Min-scope stays **advisory**, as its own doc comment states ("Advisory only, never
   enforced in `can()`", `roles.ts`). It exists to hide noise in the permissions editor, not
   to second-grant the matrix.
2. The `academic_year` entry is annotated (not deleted) to say sub-school grants are valid
   for this resource, citing this ADR. Deleting it would also drop academic-year rows from
   `resourcesForScope("section")` editor views; annotating keeps the editor helpful while
   ending the contradiction.
3. **Enforcing min-scope inside `can()` is recorded as rejected.** It contradicts the map's
   stated contract, regresses ADR-024's direction — year visibility moved from scope
   mechanics into permissions precisely because scope-keying locked legitimate users out —
   and would break the seeded, commented session-picker grant.

**Consequences.** B7 replaces the strict-read calls in the academic services with the
coverage test and deletes the per-service widening-for-reads paths; `useClass` drops its
list workaround and returns to `byId`; the smoke matrix flips both subject_teacher cells
deliberately. Mutations and lists are untouched, so A2's other cells hold.







## ADR-029 — Subject-level access is a second fact, checked beside `can()`, never inside it

**Status:** accepted (2026-08-30, owner review — no amendments). Gates slice S4.3: the
implementation chunk moves on this basis.

**Context.** ADR-012 fixed the boundary: `role_assignments` is the **authorization**
authority; `section_teacher_assignments` records the **timetable fact** — "do not read the
latter to answer a permission question." But the scope tree has no subject axis, so `can()`
cannot express the question marks entry actually asks: *may this teacher enter CHEMISTRY
marks in 6-A?* The Phase-1 authorization review left this open and marked it **blocking
marks entry**: a `subject_teacher` scoped to a section can currently write every subject in
it — the Physics teacher can enter Chemistry marks. With S2 landed, the fact table exists,
is populated (seed + fixtures), and carries the `sta_subject_matches_role` CHECK binding
`subject_id` to `subject_teacher` rows only. The check is now implementable; nothing
consumes it yet, so this ADR fixes the mechanism, its failure shape, and its enforcement —
not any endpoint.

**Decision.**

1. **The fact lives in `@repo/services`, on the service that owns the table.**
   `assignmentService.hasSubjectAssignment(organizationId, userId, sectionId, subjectId):
   Promise<boolean>` — org-filtered, open rows only (`effectiveTo IS NULL`), role
   `subject_teacher`. An authz-side implementation is rejected: `@repo/authz` is imported
   by everyone and must stay free of domain tables; a DB query there inverts the dependency
   arrow (the ADR-020 argument, one level down) and would make `can()` impure.

2. **Procedures compose it through the builder, not a hand-rolled second check per
   endpoint.** `staffProcedure(permission, { subjectGate: true })`: the builder requires
   `sectionId` and `subjectId` in the procedure input (runtime-extended per ADR-027's
   mechanism, so omitting them is a validation failure, not a silent skip), and after the
   normal gate runs the assignment fact check. The phase-1 lesson is the rationale — a
   permission bug was found by clicking a link, and subject-content endpoints are exactly
   where a forgotten inline check is invisible. `check:builders` gains the matching static
   rule: a procedure whose permission writes subject-scoped content MUST set `subjectGate`
   (the list starts with `marks:*` writes and lives in `@repo/authz`'s `permissions.ts` —
   the vocabulary home, and the only env-free module the hermetic static guard can import
   without executing the runtime graph; re-exported from `@repo/authz`'s index;
   `homework:*` joins when its slice lands). Derived-section inputs (section resolved
   from a student's enrollment rather than named) are a recorded future amendment, not
   v1: marks entry is section-scoped in the UI, and the client names the section it is
   working in.

3. **Failure mode: NOT_FOUND, generic wording — an unassigned pair is indistinguishable
   from a nonexistent one.** `FORBIDDEN` would confirm the section+subject exist and the
   caller is merely unassigned; probing (section, subject) combinations must reveal
   nothing. The two refusal shapes are therefore: permission missing entirely →
   `FORBIDDEN` by the main gate (unchanged, ADR-017); permission held but no assignment
   fact → `NOT_FOUND` "Resource not found." (the gate's generic wording, not the
   endpoint's own). The teacher's own (section, subject) resolves — the non-vacuity
   control S4.4 pins.

4. **One indexed query per request, no cache.** `section_teacher_assignments_active_idx`
   (partial, `effectiveTo IS NULL`) serves the check. The Redis auth cache caches ROLE
   grants precisely because they are slow-changing; assignment facts are timetable data
   that changes mid-term (a teacher swapped periods must lose access immediately, not in
   five minutes). A short-TTL fact cache is recorded as rejected-for-now — revisit only if
   profiling ever says otherwise.

**The boundary stands, re-affirmed.** `can()` never consults assignments;
`hasSubjectAssignment` never consults roles. The builder composes both in order:
permission first (the FORBIDDEN shapes), fact second (the NOT_FOUND shape). A role grant
without an assignment row is a subject_teacher who teaches nothing here; an assignment row
without the grant is a timetable fact authorization refuses — the existing matrix already
covers that side.

**Rejected alternatives.** Subjects as scope nodes (hard rule 12 names school/class/
section; a subject axis would multiply per-year nodes and re-litigate ADR-011). The check
inside `can()` (inverts `@repo/authz`'s dependency direction; `can()` is deliberately pure
and synchronous). A second fact table (ADR-012 already resolved: one table, the SQL's).
`FORBIDDEN` failure (leaks which assignments exist). Inline per-endpoint checks (a
forgotten one is invisible — the exact failure the builders exist to make unrepresentable).

**Consequences.** S4.2 (the student owner-resolver) lands independently. S4.3 implements
`hasSubjectAssignment` + the `subjectGate` option + unit tests for its pure parts, and
extends `check:builders`. S4.4 pins the denials in integration + smoke: a subject_teacher
scoped to one section is denied the adjacent section's subject AND her own section's
adjacent subject — each indistinguishable from a nonexistent pair — while her own pair
resolves. The Phase-1 leftover "Subject-level access is not enforced" ticks when S4.4
lands. No endpoint consumes the gate yet; the marks slice (Phase 5) MUST use the builder,
and `check:builders` enforces that.

---

## ADR-029a — ADR-029 amendment: the subject fact constrains only the teaching role; permission + scope decide for everyone else

**Accepted (2026-09-11), superseding ADR-029's gate behavior.** The owner found the
original gate's collateral by clicking: an org admin holding `marks:create` (via
`ALL_PERMISSIONS`) opened the marks grid, typed, and was told "This record is no longer
available. It may have been closed or moved." — the UI's NOT_FOUND translation of the
gate's deliberately generic refusal. Nothing was closed; the gate had frozen every
non-teaching holder of the permission out of the entire feature.

**The amended rule (the owner's words, made precise):**

1. *Permission + scope decide.* If the caller holds the gated permission through any
   role other than `subject_teacher` — org_admin, principal, class_teacher, any custom
   role a school invents — the assignment check never applies. Their `DataScope` is the
   bound, exactly as for every other write. No role names are special-cased to bypass;
   the ONE constrained role is the teaching role the timetable fact belongs to.
2. *The union rule wins for dual hats.* A caller who holds the permission through BOTH
   the teaching role and another role passes everywhere their scope covers — more
   authority never means less capability, matching `can()`'s union semantics everywhere
   else. (The initial amendment draft constrained "anyone with subject-scoped
   assignment rows in the section"; the owner rejected that: the admin who also teaches
   Math would have had LESS power in their own section than in every other one.)
3. *The teaching role is constrained by its assignments.* Only `subject_teacher` grants
   are assignment-checked: the (section, subject) must be theirs, open. This is the
   original ADR-029 population — the Physics teacher entering Chemistry marks — and the
   swapped-out teacher whose assignment ended mid-term.

**The refusal is honest now:** `FORBIDDEN` — "You are not the assigned teacher for
this paper." The original's indistinguishable-from-nonexistent `NOT_FOUND` protected
against probing which (section, subject) assignments exist; under the amendment the
only callers reaching the refusal are teaching-role holders being told their OWN fact,
which reveals nothing about anyone else. The web error layer allowlists exactly this
message (its FORBIDDEN branch otherwise hides server wording — resolveNode's
missing-vs-not-yours conflation is load-bearing).

**Default matrix:** principal and vice_principal gain `marks:create` (data, per-org
editable as always) — the "teacher absent, principal enters marks" small-school case.

**UX twin (the bug that exposed all this):** the marks entry grid response now carries
`canEnter`/`canEnterReason` computed by the same `evaluateSubjectGate`; the page renders
read-only with the honest line for callers who cannot save, instead of editable cells
that refuse on typing. A grid that accepts typing but no-ops every save is the BUG-9
pattern wearing a different coat.

**Why not scope-based instead of role-based (the design tried first):** "anyone with
no subject-scoped rows in the section passes" reopens the teacher-swap hole — a
subject_teacher whose assignment ended but whose section-scoped role grant remains has
no rows, and would pass as "non-teaching staff." Keying on the role closes that hole
and matches the owner's framing exactly. The one role-name coupling is on the
CONSTRAINING side (the role whose meaning is the timetable), never on the bypass side.

**Consequences.** `evaluateSubjectGate` (exported from the trpc builders) implements
the rule; the `subjectGate` middleware consumes it; the marks entry read consumes it
for `canEnter`. The smoke's negative proof re-casts on a seeded Math-only teacher
(the demo teacher now teaches both subjects); its class-teacher and principal checks
flip to positives. The old smoke "principal is FORBIDDEN on the autosave" check
passed for a WRONG reason (a revocation experiment left the principal's grants
revoked through the exam section) — the experiment now restores immediately after its
own assertion. Truth table pinned at unit level (35), integration level (the authz
suite's gate describe, re-expectations), conformance level (router-shaped payloads),
and smoke level (HTTP).

## ADR-030 — Attendance records edit in place; the corrections table is dropped for a reason column

**Status:** accepted (2026-08-31, owner decision during Phase 3 planning; implemented in C5).

**Context.** The reference SQL (table 27) carries `attendance_corrections`: an append-only
audit trail where every change inserts a new row and flips the record's `record_status` to
`Corrected`. It is the attendance sibling of hard rule 3's financial ledger. But the two
domains are not equally exposed: money disputes are inevitable and legally load-bearing;
attendance disputes at this product stage are not. The reference itself hedges — five
statuses (`late`, `on_leave`, …) already let a teacher *record* reality rather than a bare
present/absent, which is most of what a corrections flow exists to capture. The five-status
model was already locked for Phase 3; a second table whose only job was to re-describe a
status change the statuses could hold directly was a structure looking for a dispute to
justify it.

**Decision.**

1. **`attendance_corrections` does not exist.** Records edit in place; nothing is appended.
2. **The "why" rides on the record when the editor says it:**
   `attendance_records.correction_reason` varchar(500), nullable. This is a FRONTEND
   convention the backend stores but never enforces — the UI asks for a reason when editing
   a PAST date and does not ask on same-day marking; the backend validates neither rule.
   A reason is data about the edit, not a precondition for it.
3. **The don't-wipe micro-rule is backend-enforced:** an update sent WITHOUT a
   `correctionReason` never clears a stored one (only an explicit reason overwrites). A
   reason-less re-mark of an already-edited row keeps the old note.
4. **The audit-lite trio is backend-owned:** `updatedAt` + `updatedBy` answer "was it
   edited, when, by whom"; `correctionReason` answers "why (if said)". Together they cover
   what a school actually asks of an attendance row; what they cannot answer is the full
   before/after diff.
5. **Hard rule 3 is untouched:** financial transactions remain append-only. This ADR
   creates no exception — attendance records are not money.

**Rejected alternatives.** Keeping the corrections table "for later" (a dead table with
live FKs constrains every query that touches records and has no reader). `record_status`
(`Marked`/`Corrected`/`Voided`) — a lifecycle flag nothing branches on in an edit-in-place
model; Voided would also collide with the double-mark guard (a voided row still occupies
the student/day/period key). Backend-enforced reason-on-past-edit (a "past date" rule
belongs to the school's clock and the UI's question, not to a tenant-agnostic API).

**Consequences.** The history a corrections table would have preserved — the SEQUENCE of
statuses a row passed through — is genuinely lost. If a school ever needs it, the retrofit
is additive: a new append-only table keyed on the record id, populated by the marking
service alongside the in-place edit (the service is the single write path, so the seam is
one place). No migration of existing rows would be required. The deferral is recorded in
the Phase 3 plan's "recorded deferrals" list; the C7 integration suite pins the don't-wipe
rule and the reason-preserving re-mark so the convention cannot silently erode.

## ADR-031 — Result flags (`counts_toward_result`, `is_graded_only`) live on `class_subject_mappings`, not on `subjects`

**Status:** accepted (2026-09-03, owner decision; implemented same day, migration 0009).

**Context.** The reference SQL (table 13) puts both flags on `subjects` with an
inheritance note on `exam_subject_schedules` (table 48): "inherited from subject but can
be overridden per schedule". That answers neither of two real questions. First, the flag
factually answers "does THIS class's Maths count toward the result THIS year?" — Class 1
Maths is commonly activity-based and excluded while Class 4 Maths is a numeric scholastic
subject, and a school can change its mind year to year. A subject-level flag is too
coarse; expressing the difference required duplicating the subject row ("Mathematics
Activity"), the very hack the school-level catalogue exists to prevent. Second, the
schedule-level override is too fine: Term 1's schedule saying `true` and Term 2's saying
`false` leaves the annual rollup (`student_final_results`) without a defined answer —
every reconciliation rule (all terms agree? any? majority?) surprises a school at
report-card time. The reference resolves none of this.

**Decision.**

1. **Both flags move to `class_subject_mappings`** — the per-(year, class, subject)
   template row. Their granularity (differs per class, per year) and lifetime (a change
   for next year is a new year's rows, never a mutation of shared state, per hard rule
   6's philosophy) match the layer exactly.
2. **`exam_subject_schedules` gets NO override columns** — the exam chain reads the
   mapping, and only the mapping. One row per (year, class, subject) means the annual
   computation always reads one unambiguous value. This explicitly supersedes the
   reference SQL's schedule-level override; if section-level variation (6-A activity
   Maths, 6-B numeric) ever proves real, it returns as its own ADR with a defined
   rollup rule.
3. **`category` stays on `subjects` as a CREATION-TIME seed only** — the mapping
   create flow prefills from it (`coscholastic` → excluded/graded-only;
   `scholastic` → counted/numeric), the school edits per class. It is never a read-time
   source: Class 1 Maths is scholastic yet excluded from totals.
4. **The flags are two INDEPENDENT booleans** — all four combinations are legitimate
   (Class 1 Maths: numeric but excluded; Art: counted but graded-only). Never collapse
   them into a mode enum.
5. **Narrow meaning, enforced:** `countsTowardResult = false` means "excluded from
   totals and pass calculation for every student taking this offering". It is NOT the
   CBSE best-5/elective counting rule (per-student selection — an exams-phase
   aggregation policy) and NOT per-student exemption
   (`student_subject_results.is_exempted`). Those mechanisms stay separate.

**Exams-phase obligations** (binding on whoever builds the exam chain; recorded here
because the phase does not exist yet):

- **Snapshot at computation.** Result computation copies both flags into
  `student_subject_results` alongside the existing `pass_marks` / `grading_scale_id`
  snapshots. A mid-year template edit then affects only future computations; Term 1's
  rows keep the values they were computed with.
- **Flip guard.** Once any `student_component_results` exist for a (year, class,
  subject), the mapping's `isGradedOnly` may not change — a mixed numeric/graded year
  would give the final rollup marks *and* a grade for one subject. Service-level, not a
  CHECK (cross-table). Until that table exists the guard is vacuous; write it when the
  exam chain lands.
- **Pass computation skips graded-only subjects** — they have no `pass_marks` to fail
  against; the pass/fail and compartment logic must read the mapping flag before
  comparing.
- **Year rollover copies the flags** — rollover recreates next year's mappings from
  this year's; it copies whole rows, and a test pins that the flags ride along.

**Rejected alternatives.** Keeping the flags on `subjects` (cannot express Class 1 vs
Class 4 without duplicating subject rows, fragmenting marks history). Moving them to the
exam schedule wholesale (hundreds of re-declared facts whose single mis-set value
silently changes a report card's total; and no answer exists before an exam is
scheduled, which report-card layout and the co-scholastic pipeline need). Subject-level
default + nullable per-class override (two sources of truth; every consumer learns a
COALESCE rule — more machinery than a two-flag problem earns).

**Consequences.** Migration 0009 copies each existing mapping's flags from its subject,
so no school's result behaviour changes as a side effect. Nothing consumed the flags
before the move (verified: zero references outside the schema), so no downstream code
changed. DOMAIN.md's report-card note now points at the mapping. When the exams phase
builds `exam_subject_schedules`, it builds WITHOUT the two override columns the
reference SQL shows there.

## ADR-032 — Board-neutral subject typing, and the publication / correction / eligibility model for exams

**Status:** accepted (2026-09-06, owner decision after a full design review; **supersedes ADR-031's storage location** and the reference SQL's subject/area design; implemented from migration 0013 onward).

**Context.** The reference SQL carries a CBSE-flavored 4-value `category` on `subjects`
(scholastic/coscholastic/vocational/language) and a fixed area enum on `coscholastic_assessments`.
Three failures surface under review. First, the vocabulary is CBSE CCE terminology the PRD's
ICSE/state/unaffiliated schools do not share, and behaviorally three of the four values are pure
labels — the real behavior decomposes into the two result flags plus one bit neither the flags nor
the enum captures: *does the subject get examined at all, or is it assessed by term-end grade?*
Second, schools experience subject "types" as report-card **widgets** ("Main Subjects",
"Co-curricular", "Personality") whose membership varies per class per year — the same subject is a
graded activity in class 3 and a marked elective in class 9 — and some schools split an all-scoring
marksheet into several widgets. Third, the design review surfaced independent gaps: mock exams
cannot coexist with the weightage CHECK `(0,100]` + sum-to-100; the subject-level pass mark has a
snapshot column but no config home; `terms.result_mode` conflates "standalone term card" with
"feeds the annual"; graded-only subjects have no entry path; publication was all-or-nothing across
a school; post-publication corrections had no batch story; and attendance eligibility risked
over-enforcement for schools that never hard-detain.

**Decision.**

1. **`subject_types` — school-defined, board-neutral.** New table: `name` (unique per school),
   `counts_toward_result`, `is_graded_only`, `assessment_mode` (`exam` | `term_grade`), `sequence`
   (report-card widget order), `is_active`. `class_subject_mappings` carries `subject_type_id` +
   `is_elective` + sequence. The flags live ON the type — one source of truth, edits lock once any
   referencing (class, year, subject) has assessment data (name/sequence stay editable), and
   reassignment to a type with different `is_graded_only` is the ADR-031 flip-guard flowing through
   the type. **This supersedes ADR-031's storage location** while preserving its principle: two
   independent booleans, never a mode enum, any combination allowed (including counted+graded for
   GPA-mode primary classes). The `category` enum and the `coscholastic_assessments` area enum die;
   a CBSE preset (`subjectTypes.applyPreset`) seeds the standard types; deactivate never delete.

2. **`assessment_mode` — how assessment data enters.** `exam`: full pipeline (schedules,
   components, marks entry; graded-only subjects get an implicit single "Overall" component, grade
   via `grade_obtained`, which the component-results CHECK already permits). `term_grade`: no exam;
   the (class) teacher enters grade + remarks per term in `term_assessments` — the reshaped
   coscholastic table, keyed `(student, term, mapping)` instead of an area enum. Class teacher is
   the default entry role (no subject-teacher assignment exists for areas).

3. **All-gradedOnly classes → GPA branch.** When every counted subject of a class is graded-only
   (lower primary), term/final aggregates are the grade-point average; percentage is suppressed;
   ranks order by GPA; pass/fail counting is skipped.

4. **Exam blueprint rules.** `exams.counts_toward_term_result` (mocks/practice run the full
   pipeline, exempt from the term sum-to-100). `exam_subject_schedules.pass_marks` — the subject
   pass mark configured per exam×class×subject, defaulting to Σ component pass marks (expresses
   "≥50/100 in total" alongside component-level `pass_marks`/`is_mandatory_pass`). Strict coverage
   validation (every counted subject scheduled in every counting exam) — relaxable later only
   additively. Template/config edits refused once assessment data exists. Lifecycle
   Draft→Scheduled→Ongoing→Marks_Entry→Under_Verification→Published→Locked as an explicit
   transition map with preconditions (→Under_Verification: all cohort rows ≥Entered; publish:
   freshness + readiness; exam Published when last class publishes).

5. **Scales.** `grading_scales.is_default` (one per school; per-component override remains the
   ICSE case). Bands are percentages, contiguous 0–100, validated gap/overlap-free.
   `Percentile_Rank` rejected in v1.

6. **Annual policy.** `terms.result_mode` = `weighted` (Σ term% × term weightage, weights sum to
   100) | `last_term` (annual = last term verbatim). Every term ALWAYS gets a standalone result.

7. **Publication.** Per-class `exam_class_publication` records; whole-exam publish is a loop.
   Verification optional: publish requires all cohort rows ≥Entered (no Drafts); Entered rows
   tolerated with a visible warning. New `marks:verify` permission — defaults class teacher /
   VP / principal, subject teacher excluded (no self-verify); schools adjust via roles. The verify
   UI is the review view of the entry grid, not a separate subsystem.

8. **Corrections.** Revision windows on `exam_class_publication` (`published → revision_open →
   re_issued`): during a window, each edit writes its `student_component_result_revisions` row
   first (hard rule 7) but no recompute/re-version; at close, ONE recompute, ranks once, and every
   rank-affected `published_report_cards` row re-versioned (`replaces_version`) atomically. A
   single-mark quick edit is an invisible auto-window of size one: one approval dialog with live
   impact preview. `computed_at` freshness gates publish and re-issue.

9. **Attendance eligibility — advisory only.** `exam_eligibility` never blocks entry or
   publication; it appears once on the readiness screen (below-bar list, one-click allow) and the
   decision + reason are recorded. Recompute on exam state transitions + manually; missing row =
   computed on demand.

10. **Ratified compute rules.** Grace order: must-pass subjects first, then largest deficit,
    never overshooting the pass line, caps respected. Compartment boundary evaluated after grace.
    Decimal library throughout; round half-up only at storage boundaries; percentage from stored
    totals. Resolved pass-policy snapshotted onto term/final results.

11. **Portal & product philosophy.** Admin = efficient ERP; parent = narrative layer rendered
    from published snapshots (type widgets, remarks, attendance ribbon, client-side print incl.
    class-set; server-side PDF deferred). **Rule 8 clarification:** the portal may derive analytics
    from PUBLISHED data only, never unpublished marks. Comparison privacy: aggregates/bands/
    percentiles yes, other students' identities or exact marks never, school-level opt-in. Marks
    entry autosaves per cell (single-row upsert, optimistic `updatedAt`).

12. **Elective seam.** Compute resolves each student's subject set through a resolver. v1 resolver
    = all counted exam-mode mappings of the class (roster from `student_enrollments`). The
    reference's `student_subject_enrollments` (table 23 — the resolved layer: "Exams,
    Attendance-per-subject, and Report Cards always read from here") remains the future source of
    truth; landing it later is additive (tables + resolver swap + backfill of exact Auto rows +
    generation/override workflow). Snapshots already freeze per-student subject lists per compute.

**Consequences.** The schema grows 15 → 17 (`subject_types`, `exam_class_publication` added;
`coscholastic_assessments` reshaped into `term_assessments`; `subjects.category` dropped; no
schedule-level override columns — ADR-031's prohibition stands). `exams` gains
`counts_toward_term_result`; schedules gain `pass_marks`. The reference's `subject_group_id`
columns and table are deferred with the elective machinery. Migration numbering starts at `0013`
(fees ended at `0012`). The owner authorized the build model: complete tested backbone before any
UI; view endpoints designed only with their screens
(`.kilo/plans/1788637674191-phase5-exams.md`).

## ADR-033 — Subject mappings can be ENDED (removed) with a guarded delete

**Context.** ADR-032's era left mappings immutable by design ("no DELETE, ever"): a
wrong mapping was to be structurally corrected, and `isElective` was a flag, not a
tombstone. In practice a wrongly mapped subject lingers in every picker that reads
mappings — the exam papers editor ("Add subject"), term-grade entry, the coverage
gate — and the only fix was the database. Mappings are TEMPLATE data (what this
class takes this year), not the ledger; the immutability stance over-applied the
append-only discipline that hard rule 3 reserves for money and hard rule 7 for
published results.

**Decision.** `subject_mapping:delete` exists and ENDs a mapping (a real row
delete, `assignment.subjectMapping.end` / `endClassSubjectMapping`). One guard
carries the whole decision: a mapping with `term_assessments` rows REFUSES —
those entries FK the mapping directly, so removing it would orphan assessment
data; the record is not the template. Everything else that references the
SUBJECT (exam papers, teaching assignments, computed results) survives by
construction. The principal holds the permission by default. This supersedes the
"no DELETE" comment in the assignment service explicitly.

**Consequences.** No schema change (no `is_active`/`effective_to` column — a
removed mapping can be re-added, which is the honest undo). The class curriculum
section gains a per-row Remove with a confirm dialog stating the consequence.
e2e/conformance pins: end works on a clean mapping; refuses on an entered one.

## ADR-034 — The student/parent-facing surface is mobile-only; the web app is staff-only

**Context.** The Phase 5 portal shipped as a web route group (`apps/web`
`(portal)`: phone sign-in, forced password change, published results,
print). The owner has decided families will never be served a web
frontend — the student/parent surface will be a mobile application.

**Decision.** The web app serves STAFF only. The family-facing product is
mobile, to be built as its own app (natively or cross-platform) in the
monorepo (`apps/mobile`), consuming the SAME API surface that exists
today: `studentProcedure` ownership authorization, the phone-credential
lifecycle (better-auth username plugin, must-change-password,
reset/change-phone), `published_report_cards` as the only
portal-readable store (hard rule 8 — unchanged), and the `portalExam`
router. Nothing backend moves.

**Consequences.** The web `(portal)` route group becomes a STOPGAP — keep
it working until the mobile app exists (it is finished, tested, and is
the living reference for the mobile app's API usage); delete it when the
app ships. Portal attendance/fees slices and any portal IA/
notifications/gamification work move to the MOBILE backlog — the web
stubs stay honest "coming next" placeholders or die with the route
group. The staff-side Portal Access management (activate / reset /
change-phone) is console work and stays on web untouched.

## ADR-035 — Staff logins are provisioned by the org, one password hand-off, forced change at first sign-in

**Context.** The `staff` table exists (ADR-008: employment identity,
`staff.userId` nullable, distinct from `user`), but no staff member can
be created or given a login through the product — the demo seed is the
only writer. Building the Staff & role management slice (contract →
service → router → UI) raises one real design decision: how does a staff
member acquire a credential?

**Decision.**

1. **A staff record and a login are separate acts.** Creating a staff row
   does NOT create a `user`. A login is provisioned later from the staff
   detail page ("Create login"), because a school may employ someone
   before they need console access, and deactivating a staff row must not
   silently decide what happens to a live credential.
2. **Provisioning = initial password + `must_change_password`.** The admin
   who creates the login sets an initial password and hands it to the
   staff member (in person or by phone). The user row is created with
   `mustChangePassword: true`, so the FIRST sign-in is forced through
   better-auth's change-password flow (the ADR-007 rider machinery,
   already proven for the portal). After that hand-off, exactly one
   person knows the credential — the audit trail stays attributable.
   Resetting a login re-arms the flag and revokes every live session,
   identical to the portal's `resetPassword`.
3. **The credential seam is the ONLY writer (hard rule 9).** User rows are
   created with `email: null` (no synthetic emails, ADR-007), the
   username is the `{org_slug}-{employee_code}` shape validated by the
   existing username plugin, and all password/session work goes through
   `@repo/auth/credentials` (`setUserPassword`, `revokeUserSessions`).
4. **Every grant, revoke, and credential act writes `authz_audit_log`** —
   `role_granted` / `role_revoked` (enum values that already exist) for
   assignments, `staff_login_created` / `staff_password_reset` (new enum
   values, one migration) for credentials. The Phase 1 debt "the audit
   table has no writer" closes here, with the first real callers.
5. **Deferred from v1** (recorded, not silently dropped): editing the
   role→permission matrix (`role_permission:update` stays
   display-only — orgs use `DEFAULT_ROLE_PERMISSIONS` until a real
   tenant asks), `staff:export`, staff invite-by-email, deprovisioning
   automation on staff deactivation (the UI warns; the credential stays
   until separately reset).

**Consequences.** Staff CRUD and role assignment follow the established
vertical-slice pattern (`school.router.ts` shape; role assignment
mutations are SENSITIVE permissions, so they bypass the Redis auth cache
and take effect immediately; assignment changes invalidate the affected
user's cache entry). Self-registration stays closed (ADR-021) — the org
is still the only identity issuer. The forced-change flow needs no new
machinery: the flag, the hook that clears it, and the console redirect
all exist from the portal work.

## ADR-036 — The permission matrix is editable, with two hard locks: never the org_admin role, never a role you hold

**Context.** Every org runs on `DEFAULT_ROLE_PERMISSIONS`, seeded once at
provisioning (ADR-011). `role_permission:update` existed in the vocabulary
and the SENSITIVE list from day one with no write path. The staff slice
(ADR-035) shipped the matrix as read-only and deferred editing. The owner
has now asked for it, with one explicit rule of their own: **an admin must
not edit their own role's permissions.**

**Decision.**

1. **Two server-enforced locks, refused with honest words:**
   - **The `org_admin` role is never editable** — it is the bootstrap role.
     An org that can strip it can brick itself: no user could grant anything
     back. The lock is on the ROLE, not the caller, so not even an
     org_admin can edit it.
   - **A caller cannot edit a role they personally hold.** The actor's own
     role types are resolved from their auth cache in the router; a match is
     a BAD_REQUEST naming the fix ("have a colleague make this change"). No
     self-lockout, even accidentally.
2. **Editing is batched, not per-click.** One procedure,
   `role.permissionUpdate`, takes `{ roleType, add: string[], remove:
   string[] }` and applies the whole diff in one call — the UI collects
   checkbox toggles behind a dirty bar and saves once. One mutation for a
   matrix change, one confirm for its blast radius ("every accountant in
   this trust gains 2 and loses 1, immediately"). Added permissions are
   validated with `isPermission` — an invalid permission cannot be named,
   still less stored; the unique index absorbs duplicate adds idempotently.
   `role.permissionReset` restores one role to the shipped defaults — the
   safety hatch, under the same two locks.
3. **Every changed permission writes its own audit row**
   (`permission_added` / `permission_removed` — enum values that existed
   from Phase 1), and the change ends with `invalidateOrgAuthCache(org)`:
   a matrix change affects EVERY holder of the role, so per-user
   invalidation is not enough. `role_permission:update` is SENSITIVE, so
   the gate reads fresh.
4. **The editor's vocabulary is served, not imported.** The web never
   imports `@repo/authz` runtime code; `role.permissionDefaults` returns
   both the org's current matrix rows AND the full catalog
   (resource → actions, grouped by display category) derived from
   `RESOURCE_ACTIONS`/`RESOURCE_CATEGORIES`. The UI renders resources
   grouped by category, each resource's actions as checkboxes.

**Consequences.** The matrix card gains an Edit affordance per editable
role; locked roles explain themselves (bootstrap role / you hold this
role). `syncDefaultPermissions` stays insert-only — editing an org's
matrix makes it DIVERGE from the defaults deliberately, and the "modified"
badge plus reset is how an admin sees and undoes that divergence. Only
org-level roles are editable as data; nobody edits a scope-specific
matrix because there is no such table.

---

## ADR-037 — Global phone identity for family logins (claim, not hand-off)

**Accepted.** Supersedes ADR-007's `{org_slug}-{phone}` username shape for all
*new* family logins (legacy slug usernames keep working until the migration
runbook below is executed — no silent break).

Context from the login review: per-student staff-typed passwords plus a
school-name picker fail on every axis — O(students) admin typing, paper/whisper
hand-off, exact-match picker, one login per org so cross-trust siblings need
two accounts, and `guardians`/`canAccessPortal`/`guardianId` all dead (nothing
reads them).

Decision:

1. **Identity is the 10-digit guardian phone, globally unique**
   (`user.username`, plain `^\d{10}$`). One phone = one `user` across schools
   and trusts. Schools create *links*, never accounts: first sight of digits
   creates the user (locked, no credential), every later sighting attaches
   another `(user → student)` link row. `guardianId` is written on each link
   so father/mother stay distinguishable; shared household digits dedupe to
   one login by the `(userId, studentId)` unique index.
2. **Parents set their own passwords via claim, staff type none.** Pending
   link + `phone + admission-no + DOB` (all already known at home) → sets the
   password. Same trio re-sets it when forgotten (sessions revoked, audit
   row). A second kid is link-only: signed-in parent proves *that* kid's pair
   (`verifyLink`), the password is never touched again. Claim/verify answer
   every mismatch with one uniform refusal (no field hints); abuse control is
   rate-limit only (per phone + per IP, lockout counts) — no breach-list, no
   OTP (cost), no fee-payment step-up (owner call, audit + receipts carry it).
3. **No school picker.** Phone lookup is global, so login is phone +
   password on web and the future app alike — same routers, no subdomain, no
   remembered school name.
4. **Staff lose credential buttons.** `activate/reset with password` and
   `changePhone` stay for legacy rows only; the supported acts are link
   status (pending/active), re-open claim (after ID check) and revoke link
   (`isActive=false` + `revokedAt`, never delete). A global rename by one
   org's staff would hijack other orgs' access, so no staff endpoint touches
   `user.username` at all — phone corrections edit the *guardian* contact and
   re-verify. `canAccessPortal=false` (or student deactivation) hides/revokes
   the link.
5. **Future student self-login** (`name+digits`) shares the same
   `user.username` column (all-digits vs contains-letters are disjoint, no
   prefix, no second column) — reserved, not built.

Non-goals: OTP/passwordless (SMS bill), per-student usernames now, portal web
screens (mobile-only per ADR-034 — the web stopgap only shrinks to phone-only
login), guardian-contact CRUD (no API exists; office verification stays
procedural until it does).

Migration runbook (EXECUTED on dev 2026-10-02 via
`apps/api/scripts/migrate-phone-usernames.ts`: dry-run counts, merge dupes
per digits with guardian backfill, strip to digits, revoke sessions once —
password-preserving, nobody re-claimed; 10 strips, 0 merges). The legacy
`activate/resetPassword/changePhone` stack, the slug fallback, and the
school picker were deleted in the same cutover; no coexistence remains.

---

## ADR-038 — Object storage behind a driver seam; URLs are stable app routes

**Status:** accepted (2026-09-29). First consumers: student photos and ID-card
backgrounds/logos (slice 2a).

**Context.** ID cards need full-card background images, school logos, and a
per-student photo; nothing in the stack stores binary objects yet. The owner is
getting an R2 (Cloudflare) account soon, but v1 must ship before that. Whichever
place the bytes live in, every consumer — an `<img>` tag, the print page, the
future designer — wants a URL that does not change when the backend does.

**Decision.**

1. **One storage service, two seams.** `packages/services/storage.service.ts`
   owns objects; its driver interface is `put / get / delete (+meta)`. Driver A
   (v1) is `postgres`: bytes live in `storage_objects.data` (`bytea`). Driver B
   (`r2`) is *declared, not built*: `STORAGE_DRIVER=r2` fails loudly with a
   named error until the R2 driver lands. The swap is a config flip plus a
   copy-the-bytes migration — no call-site changes, because nothing outside the
   driver knows where bytes live.

2. **Object URLs are stable app routes, never driver URLs.** Objects are served
   at `GET /api/storage/:id` from apps/api — session-authenticated, tenancy
   checked against the object's owning organization via the caller's active
   (non-revoked, unexpired) role assignments. Because every reference
   (`student_photos.object_id`, template `backgroundAssetId`, logo `assetId`)
   stores the *object id*, not a location, migrating to R2 later means copying
   bytes and flipping `STORAGE_DRIVER` — zero URL churn, zero data migration on
   the referencing tables. The route answers `image/*` only and marks responses
   `Cache-Control: private, max-age=31536000, immutable` — object ids are
   uuids, replacement writes a NEW id, so an id's bytes never change.

3. **Uploads are tRPC mutations carrying base64, capped hard.** No multipart
   infrastructure exists and none is needed at photo scale: the client resizes
   (~300×400 JPEG) before upload, the contract caps the base64 at
   ~512 KB of decoded bytes with an `image/jpeg | image/png | image/webp`
   allowlist, and the service re-checks the decoded size. The cap is
   deliberately inside the API's existing 1 MB JSON body limit, so no body-parser
   change rides on this feature. Larger media (PDFs, video) would want real
   object-store direct uploads — an R2-era concern, out of scope.

4. **Photos are one-per-student.** `student_photos` has a unique
   `student_id`; a re-upload upserts and the replaced object's bytes are
   deleted. Storage rows themselves are NOT under hard rule 2 (they are not
   user/student/payment/attendance/result records), and a dead bytes row behind
   a live pointer is worse than a hard delete: `deleteObject` is a real DELETE,
   and only ever called on objects nothing references any more.

**Non-goals / deferrals:** the R2 driver itself (seam only, per §1), public or
signed object URLs (everything is session-authenticated), the school logo
upload surface (the `logo` element accepts an `assetId`; the screen that
uploads a school logo is a 2b+ concern), and any quota/usage accounting.

## ADR-039 — The homework/assignments domain: resolution, snapshots, and the answer-key boundary

Date: 2026-10-03. Status: accepted. Ported from `docs/reference/assignment/06+07`.

The daily homework-diary domain lands as the `homework.*` tRPC namespace (the
`assignment.*` namespace was already taken by the teaching-assignment layer of
Phase 2 — subject mappings and teacher staffing are a DIFFERENT domain; the
shared `homework:*` permission vocabulary predates both). Two slices: A
(settings, rubrics, the assignment lifecycle, submissions, evaluations,
comments, acknowledgements, the family door) and B (question bank, the
per-assignment snapshot, attempts, auto-grading).

**1. The resolution moment.** `assignments` (authored) never reaches a student
directly. Publishing resolves the target sections' ACTIVE enrollments into
`student_assignments` rows with deadlines snapshotted — and that table is THE
authoritative per-student record; every other module (portal, future summary
jobs) reads only it. Resolution happens once, at publish: late joiners do NOT
get rows (the elective/backfill machinery of the reference's
`student_subject_enrollments` does not exist yet — `is_backfilled` /
`counts_toward_stats` are reserved in the schema). Publish-time caps
(`max_assignments_per_day`, weekends) are checked against the class's
EFFECTIVE settings (class override wins WHOLE over the school default — an
override row is a complete config row, not a field patch; a field-by-field
merge would mix the override with stale defaults).

**2. The snapshot and the lock.** Question sets are FROZEN COPIES
(`assignment_questions`), written when attached; editing the bank never
changes a live assignment. The set locks (`assignments.is_locked`) on the
FIRST attempt — after that, not even the author can swap questions. Material
edits to a published assignment (title/body/dates/resources/question set)
snapshot the pre-image into `assignment_revisions` first; drafts edit freely.

**3. The answer-key boundary.** `correct_answer` and option `is_correct`
never cross into a student session. Every family-facing read goes through an
explicit stripping step (`getStudentQuestionSet`), and correctness/marks reach
the family only through the attempt-result view, gated by the assignment's
`show_score` / `show_answers` / `show_explanations` policies (column defaults
are the policy when a school never saved a settings row). This is enforced by
SHAPE, not by discipline: the student read model's schema has no key fields.

**4. Grading.** Auto-grading covers mcq_single/mcq_multi, true_false, numeric
(tolerance), fill_blank (accepted-answer list), match (order-insensitive
pairs); short/long answers and file uploads always flag
`needs_manual_review`. When nothing needs a human, the submitted attempt
writes its own `is_auto` evaluation immediately (the family sees the score at
once); otherwise the teacher's per-answer grades finalize the attempt, and
the evaluation is written through the attempt-scoring policy's selection
(best/latest/first). Evaluations are append-only with `is_current` flipping;
the denormalised columns on `student_assignments` always mirror the current
row. Scores here NEVER feed exams or report cards. Submissions (the
free-form text/file/link channel) are versioned and immutable; the late rule
is exactly two sentences: past `effective_close_at` is never submittable,
past `effective_due_at` only when the policy allows.

**5. Permissions.** `homework:create/update/delete` were already
subject-gated (ADR-029) — the teaching role must hold the (section, subject)
fact; admin roles pass on scope. Two actions joined the vocabulary:
`homework:grade` (evaluating a student — subject-gated for the same reason)
and `homework:comment` (the Q&A threads — conversation, NOT subject content,
so not gated). Settings and rubrics are school configuration and ride the
existing `school_settings:read/update`. Row-addressed subject-gated routes
ALSO carry `sectionId`+`subjectId`, and the service verifies the pair
describes the row — otherwise a teacher's legitimate gate fact on one pair
could edit or grade a stranger's row on another.

**6. Adaptations from the reference SQL** (deviations, all deliberate):
uuid PKs; `organizationId` + `schoolId` on every table for `scopeWhere` (hard
rule 1); file references point at `storage_objects` (ADR-038), not a `files`
table; statuses are pgEnums in lowercase house style; v1 targeting is one
section per assignment at the ROUTER (the `assignment_targets` table already
supports multi-section and individual students); group projects, the
`student_assignment_summary` aggregation job, the background worker (Missing
sweeping, scheduled publishing, reminders), and recurring series remain
schema-only deferrals.

## ADR-040 — The homework sweeper: time-driven transitions without a queue

Date: 2026-10-03. Status: accepted. Amends ADR-039 (implements its recorded
worker deferral).

Three of the homework domain's state changes are TIME-driven, not
event-driven: a `scheduled` assignment must publish when `publish_at`
arrives; rows of a published/closed assignment past `effective_close_at`
must become `missing`; (later) summaries must rebuild. No HTTP request
exists to run them, so a sweeper runs on a fixed interval in the Express
host (`setInterval`, default 60s, `HOMEWORK_WORKER_DISABLED` kill switch —
disabled by default so test suites that build their own late rows and drive
the sweeper function directly never race a live tick).

**Design rules, each bought by a proof:**

1. **The sweeper is domain logic in `@repo/services`**, driven by a dumb
   host loop. The loop owns only the clock, the in-flight guard, and
   graceful shutdown; every transition lives where the domain lives and is
   integration-testable without waiting on a timer.
2. **Idempotency replaces job bookkeeping.** Every transition is a
   set-based `UPDATE ... WHERE state-and-time clause` (and scheduled
   publish re-runs the exact `publishAssignment` service, so clock-publish
   and button-publish are one behavior). Running twice, or after a week of
   downtime, is correct by construction — the database is the queue.
3. **The clock is the database's `now()`**, never the app's: the deadline
   columns were written by Postgres, and N app instances must not disagree
   about "past due".
4. **Mutual exclusion is a REDIS LEASE** (`SET NX PX 4min`), not a Postgres
   advisory lock — this deployment's Postgres sits behind a
   transaction-pooling proxy where session state (advisory locks included)
   is not per-client, which a probe proved before the design was chosen.
   The lease is best-effort BY DESIGN: the sweep is safe to run twice, so a
   Redis outage degrades to a harmless duplicate sweep, never a skipped
   sweep. A dead instance's lease lapses; a slow sweep releases only its
   own holder value.
5. **Human decisions are inviolable.** The Missing sweep's WHERE touches
   only `assigned`/`in_progress` rows of PUBLISHED **or CLOSED**
   assignments (a cancelled assignment's rows are not missed work; a
   teacher-closed window still is) and excludes `is_backfilled` view-only
   rows. An extension that outlives the sweep moves `effective_close_at`
   past the sweep's clock — and `grantExtension` revives a just-missed row
   anyway.
6. **Failures degrade.** A refused scheduled publish (per-day cap, vanished
   section) is logged and retried next tick without poisoning its siblings
   (each publishes in its own transaction, capped per tick). A failed tick
   is logged and retried. `/health` carries the sweeper's heartbeat
   (`lastSweepAt`) because a worker that silently stops is worse than no
   worker.

---

## ADR-041 — The public site engine: section library over published snapshots at `{org-slug}.mskool.in`

Date: 2026-10-05. Status: accepted. First tenant: Ujjwal Kids World
(`ujjwalkidsworld.com` port; content inventory in
`docs/reference/ujjwal-content-inventory.md`).

**Context.** Orgs want a public website at `{org-slug}.mskool.in` without
each becoming a bespoke build. Private-school sites in this market share one
skeleton (hero, stats, programs, campuses, gallery, faculty, FAQ, contact)
and differ in content and skin, not in structure.

**Decision.**

1. **A section library, not per-org sites.** The unit of composition is a
   typed *section* (hero, stats, card-grid, gallery, faculty, faq, contact,
   …) with a Zod content schema in `@repo/contracts` and a React renderer in
   `apps/web/src/components/sites/`. A *preset* ("template") is data: a
   default section order + theme token values. No per-org code is ever
   written; bespoke demand ships as a new section variant or a new preset
   (optionally org-exclusive via the preset's visibility). Section order is
   an ordered array of section keys on the site row — an org drops,
   reorders, or repeats a section without code; a truly new section type is
   new code in the library.

2. **Draft/published split; the public path reads the snapshot only.**
   `org_public_sites` keeps `draft_content` (what the staff editor edits) and
   `published_content` (what `{slug}.mskool.in` serves). Publishing copies
   draft over published wholesale — the public side never reads a
   half-edited state, mirroring hard rule 8's spirit. Unauthenticated
   `publicSite.*` routes read `published_content` ONLY, and never join
   toward staff/student/operational tables.

3. **Faculty is content-copy in v1; opt-in live projection is the declared
   upgrade.** The public router must not query `staff` (an unauthenticated
   reader near operational tables is a leak by accretion). v1 renders
   faculty from the published content list, curated in the editor. When the
   staff module is populated for a tenant, a projection follow-up (a
   whitelisted-column read of `is_public_profile` staff rows) may replace
   the copy; the section's content shape does not change.

4. **The tenant is the site owner (ADR-001).** The site hangs off
   `organizations` (one row per org, slug-keyed), not off schools; a school
   is content inside the site (e.g. the campuses section), which is why the
   `scope_nodes` rule (hard rule 12) does not apply here — nothing here is
   staff-authorizable.

5. **Routing is a middleware rewrite, one Next.js app.** `apps/web/src/middleware.ts`
   maps `{slug}.mskool.in` (and a `?org=slug` dev override) onto the
   `(public)` route group. Wildcard DNS + wildcard TLS are deploy-time
   prerequisites, not code. Unknown slugs render a branded not-found page.

6. **Public media is static, not the ADR-038 store — for now.** ADR-038's
   object route is session-authenticated by design, which an anonymous
   visitor cannot present. v1 ships public-site images as static files under
   `apps/web/public/sites/{slug}/` referenced by URL from the content JSON.
   When ADR-038 grows a public-serving story (signed or public objects), the
   URLs migrate and this clause is superseded — content shape is unaffected.

7. **The staff editor is a `publicsite` domain.** Editing goes through
   `staffProcedure('public_site:edit')`-gated tRPC routes calling
   `PublicSiteService` in `@repo/services` (organizationId is a required
   argument per hard rule 1). `public_site` joins `RESOURCE_ACTIONS`
   (`read`, `edit`, `publish`) so grants stay fine-grained.

**Non-goals / deferrals:** the admission enquiry form (CTA points at
contact/tel until it exists; recorded as its own future domain), the
drag-drop page builder, custom domains, per-branch sites, theme
user-interfaces beyond token fields, and a canvas/free-layout block.

---

## ADR-042 — Object visibility: a public read path inside the ADR-038 store

Date: 2026-10-05. Status: accepted. Amends ADR-038 (adds a public read path);
supersedes ADR-041 §6 (public-site media no longer static files).

**Context.** ADR-041 shipped landing-page media as static files under
`apps/web/public/` because ADR-038's object route is session-authenticated and
an anonymous visitor cannot present a session. That decision aged badly within
a day: 150 binaries committed to the repo, and the future site editor has no
upload/delete story, since its media would need the very store the public site
cannot read from.

**Decision.**

1. **`storage_objects.visibility`** (`private` default / `public` enum column).
   A row is never public by accident: the default is private and the flag
   flips only through an explicit write at upload time.
2. **`GET /api/public/storage/:id`** serves ONLY `public` rows, unauthenticated,
   `Cache-Control: public, max-age=31536000, immutable` (ids are never
   re-pointed; replacement mints a new id). A private object and a missing id
   are the same 404 — the route cannot probe existence. Images only, own rate
   limiter so anonymous scraping cannot consume the general limiter's budget.
3. **Public-site media moves into the store.** Site content references URLs of
   the form `/api/public/storage/{id}`; the seed (and later the editor's
   upload flow) puts objects with `visibility: public` and writes the returned
   id into the content JSON. `apps/web/public/sites/` is purged from the repo;
   the files remain on disk only as seed input. ADR-041 §6's static-file
   arrangement is dead.
4. **R2 unchanged.** This is orthogonal to the driver seam: when the R2 driver
   lands, public and private bytes migrate the same way (copy the bytes, flip
   `STORAGE_DRIVER`), and the two routes keep answering.

**Non-goals:** signed URLs with expiry (nothing needs time-boxed access yet),
a public listing/discovery endpoint (never — enumeration is the leak),
per-object ACLs beyond the binary flag.

---

## ADR-043 — The mobile app: one Expo binary, staff shell first, same API surface

Date: 2026-10-12. Status: accepted. Refines ADR-034 (fixes "natively or
cross-platform" to Expo, one binary, two shells); amends ADR-010 (route
groups gain a native counterpart).

**Context.** The owner has set the product direction: a fully mobile-operative
SMS, built staff-side first on Expo, family-side later with a deliberately
different, richer UI. The homework backend (ADR-039/040) is complete with no
client; attendance, fees, exams, and staff backends are complete with a web
console client. The question is how the mobile client is shaped so the whole
admin surface can land on it step by step without rewiring, and the family
surface later without a second app.

**Decision.**

1. **One Expo app, `apps/mobile`, two shells.** `(staff)` (org/branch/session
   context, permission-gated tabs) ships first; `(family)` (child switcher,
   bottom tabs) lands with the family phase. Post-login routing reads
   `me.get`: staff-kind → staff shell, student-kind → family shell. No
   separate staff/family store listings; that split stays available later
   with no backend change.
2. **One additive backend exception: auth.** Mobile consumes the same
   routers — staff namespaces with `organizationId` in inputs, `portal.*`
   under ownership — and imports `type AppRouter` only, exactly like
   `apps/web`. A column rename breaks mobile at compile time. No
   mobile-only endpoints unless a measured performance case forces an
   aggregation; dashboards compose queries client-side. The single exception
   is better-auth transport: the server gains the `expo()` plugin plus the
   app scheme in `trustedOrigins` (additive — web's cookie flow is
   untouched), because native has no cookie jar and the tRPC link must
   attach `authClient.getCookie()` as a `Cookie` header itself.
3. **Login mirrors the web's two doors, minus the dead one.** Staff:
   email + password. Family (with the family shell): ADR-037's phone-only
   claim flow — digits → account-status → password or first-claim trio — no
   school picker, no org slug. Any description of `{org_slug}-{phone}` plus
   picker is stale since the ADR-037 cutover and must not be copied into
   mobile.
4. **Online-only with retry.** No offline queue, no conflict resolution; a
   dead network is a retry state. Money paths keep the web's discipline: no
   optimistic updates, idempotency key per attempt, server receipt as the
   success story.
5. **One token system, two brand packs.** Spacing/type/radius/motion scales
   are shared; `(staff)` resolves a restrained palette, `(family)` a rich
   one, through the same component API. Components promote
   inline → screen-colocated → `components/` only on second use.
6. **i18n keys from day one, English strings only.** `t("domain.key")`
   everywhere; `expo-localization` + `i18next`, `en` fallback, persisted
   override. Later locales add files, never touch screens.
7. **Phases are build order, and endpoint tables are the completion
   record.** Each domain phase ticks every procedure in its namespace
   (staff door in the admin phase; the portal door with the family shell).
   Unticked rows are the resume point. See `docs/MOBILE_PLAN.md`.
8. **Forms are the contracts; rows are the router outputs.** Row shapes from
   `inferRouterOutputs<AppRouter>`; no runtime contract import — mobile
   validates on the server and imports `@repo/contracts` as types only
   (superseded by ADR-048). The wire stays the web's (no superjson:
   timestamps as strings, money as decimal strings).

**Non-goals for the admin build:** timetable (reaffirms the PRD refusal —
no tables exist, only forward-references in comments); push/WhatsApp
delivery (in-app feed first, delivery its own later phase); gateway
payments (read-only fees first; ADR-009 webhook with live keys later);
EAS/store setup and Sentry (at store-build time, not before).

**Consequences.** `apps/web` `(portal)` stays the stopgap until the family
shell ships, then dies per ADR-034. Teachers' "stay on responsive web"
interim stance is superseded: the staff shell is the operative surface.
`EXPO_PUBLIC_*` env discipline mirrors the web's `NEXT_PUBLIC_*` rule
(CONVENTIONS.md).

---

## ADR-044 — Every in-school staff role holds `school:read` by default

Date: 2026-10-18. Status: accepted. Clarifies ADR-011 (defaults vs org-owned
matrix); supports ADR-043 (mobile context).

**Context.** The mobile walk (2026-10-18) found the class-teacher persona
resolving no branch: `me.get`'s `memberships[].schools[]` is computed under
`school:read`, and the teacher roles did not hold it. The branch chip, the
school-scoped attendance-policy read, and the web Branches list are all the
same read: the identity of the school the caller already works in.
Withholding it forced a client-side org fallback or a `memberships`
extension — both would route around the scoping model instead of through it.

**Decision.** The DEFAULT matrix grants `school:read` to every operational
in-school role: `class_teacher`, `subject_teacher`, and `librarian` join
`principal`, `vice_principal`, `accountant`, and `staff_coordinator`
(`org_admin` holds it via ALL_PERMISSIONS). Owner direction: "every role in
the school should get school:read." The read stays scope-clipped — a caller
resolves only schools their assignments already reach (a section-scoped
teacher resolves exactly her school) — and the school record is branch
identity (name/code/board/address/contact/logo), not academic or financial
reach. Defaults only: an org may still revoke it per role (ADR-011). One
service adjustment rides with the grant: `organizationService.listSchools`
was the single caller still handing raw class/section-depth scopes to a
school-level table, so the new grant made `me.get` throw for a class teacher;
it now clamps with `atSchoolLevel`, the documented rule for entities with no
class dimension. No router, contract, or client change.

**Consequences.** Class teachers and subject teachers get the branch chip and
branch-scoped reads in the mobile app; the web Branches navigation item
appears for those roles, scoped to their school. Demo fixtures are backfilled
by the seed's INSERT-only `syncDefaultPermissions`; production orgs are
untouched by construction (defaults are copied once at provisioning).

---

## ADR-045 — Mobile server state is never cached by the HTTP layer; offline requests fail honestly

Date: 2026-10-20. Status: accepted. Extends ADR-043 (mobile server state).

**Context.** The attendance management walk (2026-10-19/20) found two
transport-level failures. (1) Expo's native fetch keeps a disk HTTP cache
(`cache/http-cache`); tRPC queries travel as GET, so after a save the
invalidated refetch was answered from the stored body — the DB changed, the
screen kept the old row, and the API never saw the request. (2) React Query's
`onlineManager` (wired to `expo-network`) paused queries while offline: a
screen with no cache showed a skeleton indefinitely, and a paused mutation
would sit on “Saving…” and fire later, after the user thought it failed. The
chunk-2 walk had already flagged the paused-offline path as unverified.

**Decision.** Treat server state as uncacheable by the transport and make
offline behaviour explicit at the request layer:

- the API sets `Cache-Control: no-store` on every `/trpc` response;
- the mobile tRPC link sends a per-request `cache-control: no-store` header
  (belt for entries stored before the API change);
- the mobile `QueryClient` uses `networkMode: "always"` for queries **and**
  mutations. Reads attempt, fail into the existing connection copy + Retry,
  and recover on reconnect; writes fail with the same copy and write nothing.

No offline queue or persistence is introduced: the app is read-only offline.

**Consequences.** Every data screen reuses its existing error/retry state
instead of adding offline UI. A dead-zone request is bounded by the existing
15 s tRPC deadline. The same no-store header protects the web client from
browser HTTP caching of authenticated GETs. A later offline-write feature must
introduce an explicit queue, not remove `networkMode`.

**Alternatives rejected.** Per-screen offline banners (would have left the
paused mutation hazard); `networkMode: "online"` + cached-first UI (no
persistence exists, so there is nothing honest to show).

---

## ADR-046 — Half day is a marked day, never a present day; recent history is one bounded read

Date: 2026-10-23. Status: accepted. Extends ADR-043 (mobile staff surface); it
adds a display bucket to the existing attendance summary and reads the
authoritative `daily_attendance_status` layer.

**Context.** The register walk (2026-10-23) found that half day disappeared from
reports: `attendance_summary` had no half-day bucket, so the UI could count it in
the draft but not explain it in the year view or the student detail. The official
attendance percentage is the exam-eligibility figure and must remain an all-day
number. The same walk needed a paper-register glance at the last few marked days
without issuing one request per student.

**Decision.**

- Add `attendance_summary.days_half_day` as a display bucket. A half day counts
  toward marked days and the present-share denominator, but not toward
  `days_present`; the generated official percentage is unchanged.
- Recompute and backfill the bucket from `daily_attendance_status` only (hard
  rule 5), never from `attendance_records`.
- Expose `attendance.statusHistory` as a staff read (`attendance:read`) for one
  section across an inclusive date range capped at 45 days, scoped through the
  status table's own scope columns. It is read-only and has no student-portal
  counterpart.
- The client folds the response to the last five marked days before the selected
  date; no N+1 requests and no new report surface.
- The same bounded read also supplies the day picker's marked-day dots and one
  student's month map. Both ask for one calendar month at a time and filter to
  the addressed section/student on the client.

**Consequences.** Summary composition and the student detail can name half day
without promoting it to present. The official rate stays comparable across
schools and years. The change is one additive migration plus a bounded read. If
the school later wants half day weighted as 0.5 present for the official rate,
that is a new ADR and a new number, not a reinterpretation of this column.

**Alternatives rejected.** Reusing `days_present` for half day (would inflate the
official rate); a new materialized report table (duplicates the summary read
model); an unbounded history endpoint (a report, not a register glance).

---

## ADR-047 - The staff shell runs in the branch's current session; changing a session is an admin act, not a viewing mode

Date: 2026-10-23. Status: accepted. Supersedes the global year picker in
`docs/MOBILE_PLAN.md` §6.1; refines ADR-043 (mobile staff shell).

**Context.** The plan inherited the web console's three context switchers
(organization -> branch -> academic year) without asking whether a phone wants
all three. The owner's direction for Step 1 was explicit: "app is app - do
whatever is good for mobile". A phone is a personal working surface used in a
corridor between periods, not a desk console. A teacher's job is today's
register in the session the school is actually running. A global year picker
would (a) invite marking attendance in a closed session, (b) add a fourth piece
of shell state every screen must respect, and (c) imply the app has a
"history browsing" mode it does not have.

**Decision.**

1. The staff shell resolves **organization -> granted branch -> that branch's
   current session** (`academic.year.list`, the row flagged `isCurrent`).
   `academic.year.current` is not called: it demands the caller COVER the
   school node, so a class/section-scoped teacher gets a 403.
2. **There is no user-selectable year in the shell.** The session is a fact the
   More screen displays, not a control.
3. **Branch is selectable only when the grant covers more than one.** A single
   branch renders as a plain line with no chevron; the persisted branch id is a
   convenience, revalidated against `me.get` on every new session.
4. **Changing the current session is an administrative write** in Sessions
   management (`academic.year.setCurrent`), reviewed with a confirm, and lands
   in the next slice - not a personal viewing mode.
5. **History lives inside the surface that needs it.** A read surface that can
   look backwards (attendance calendar, reports, results) carries its own
   bounded year/period control inside that screen, defaulting to the shell's
   current session. No screen invents a second global context.

**Consequences.** Shell state is two ids, not three. Screens no longer need a
"current year != selected year" guard. Web keeps its year picker: a desk
surface, and its own ADR-adjacent choice. Branch and session *management*
(`school.create/update/deactivate`, `academic.year.*` writes) remains in the
Step 1 backlog as an admin surface, gated by permission, not by role name.

**Alternatives rejected.** A year picker in More (the web model) - wrong
affordance for a corridor, and a foot-gun for marking. Hiding the session
entirely - a teacher must be able to see which session she is marking. A
per-screen year chip everywhere - clutters the screens that never look back.

---

## ADR-048 - Mobile imports shared packages as types only; the server is the only validator

Date: 2026-10-23. Status: accepted. Supersedes ADR-043 §8 ("Validation schemas
from `@repo/contracts`").

**Context.** ADR-043 §8 assumed mobile would reuse the web's contracts the way
the web does. The Step 0 foundation spike measured the cost: importing one
runtime contract module into the native bundle pulled the schema graph in -
1616 -> 1834 modules, 4.3 -> 5.3 MB - because `@repo/contracts` is built on
`drizzle-zod` over the Drizzle schema. A phone downloads that on every cold
start; a server-side truth it cannot enforce anyway.

**Decision.** `apps/mobile` may import `@repo/contracts`, `@repo/db`,
`@repo/services` and `@repo/trpc` **only with `import type`**. The one runtime
import is `type AppRouter` from `@repo/trpc`, which erases at build time and
keeps the column-rename type chain intact. Form validation is either local UI
rules (required, lengths, equality, numeric range) or the server's answer; the
server is the only validator. Client-side formatting helpers are ported into
`apps/mobile/src/lib/` with their own unit tests (`format.ts`), never imported
from a server package. tRPC errors map to copy keys in `lib/errors.ts`, so the
server's refusal is the state the user sees.

**Consequences.** No shared validator means no drift between client and server:
the server's rejection is the contract. A helper needed on both sides is either
duplicated deliberately with tests on each side or promoted to a new
client-safe package - and that promotion needs its own measurement, not an
assumption. The bundle stays at foundation size, which is what the spike
proved.

**Alternatives rejected.** Importing contracts and tree-shaking zod (measured:
still pulls the schema graph). A `contracts/client` entry point exposing only
zod-safe schemas (real work, no consumer yet - revisit only if a third client
needs one). Validating on the client and trusting it (ADR-001: never).

---

## ADR-049 - Ledger rows carry a cash effect; offsets mirror every credit; opening balances are paid through the ledger link

Date: 2026-10-26. Status: accepted. Refines ADR-009 and hard rule 3; does not
rewrite any existing ledger row.

**Context.** The mobile fees device walk found three ledger-semantics gaps
(`.kilo/plans/2026-10-26-mobile-fees.md`, gaps 10-12). `financial_transactions`
mixes two kinds of row under one `direction`: cash that arrived or left
(`fee_payment`, `late_fee_charged`, `fee_refund`, `cheque_bounce_charge`) and
movements of what is *owed* (`opening_balance` credit, `waiver_applied` /
`concession_applied` debit). Summing credits as "Money in" counted a
carried-forward receivable as income. A bounce or reversal offset only the
principal, so the late fee frozen on a bounced cheque stayed as income. And no
write could pay an `opening_balances` row: `payment_allocations.installment_id`
is `NOT NULL`, so a carried-forward due could be shown but never collected.

**Decision.**
1. *Cash effect is derived, not rewritten.* Rows are immutable, so existing
   directions stay. `fee.ledger.list` returns each row with
   `cashEffect: "in" | "out" | "none"`: `none` for `opening_balance`,
   `concession_applied` and `waiver_applied`; otherwise `credit` -> `in`,
   `debit` -> `out`. Money in/out totals sum `in`/`out` only. New rows of the
   non-cash types keep the direction they have always had, so history and
   new rows read the same way.
2. *An offset mirrors every credit the payment wrote.* `bounce` and `reverse`
   write the principal debit (as before) **and**, when `late_fee_amount > 0`, a
   second debit of the same type for the late fee. A bounced or reversed
   payment therefore nets to zero cash, late fee included.
3. *Opening balances are paid on an ordinary receipt.* `fee.payment.record`
   accepts `openingBalanceAllocations: [{ openingBalanceId, amount }]` beside
   the installment `allocations` (either may be empty; the total must be
   positive). Inside the same transaction the balance is row-locked (after
   installments, id order), re-checked (same student, the payment's year = the
   year it was carried into, not waived, no more than still owed), its
   `paid_amount`/`status` updated, and one `opening_balance_payment` credit is
   written per portion with `reference_table = 'opening_balances'`,
   `reference_id` = the balance, `receipt_number` = the payment. **That ledger
   row is the payment <-> balance link**: it is append-only, which is exactly
   the immutability `payment_allocations` promises, and the receipt number is
   unique per school. Bounce, reverse and refund find the portions through it
   and re-open them (refunds take installments first, then portions);
   `payment.detail` returns them as `openingBalanceAllocations`. The
   `fee_payment` credit now carries the installment principal only, so the
   two credit types sum to `fee_payments.amount`.

**Consequences.** No migration: the change ships with the frozen schema and
needs no backfill, because no opening balance was ever paid before. Old
bounced payments that carried a late fee keep their one-sided late-fee credit;
the derived figures are right from this change on, and a one-off offset for
historical bounces is an accountant's correcting entry, not a code path.
`cancelPayment` still writes no row although `recordPayment` credits a
pending payment at entry; offsetting it needs a new transaction type (a
migration) and is recorded as an open gap in the plan.

**Alternatives rejected.** Rewriting `opening_balance` rows to `debit`
(violates hard rule 3, and "debit" means money out, which is just as wrong).
A nullable `opening_balance_id` on `payment_allocations` (cleaner join, but a
schema migration on a shared database for a link the ledger already holds
immutably; revisit if allocation reporting needs a single table). A separate
"collect opening balance" endpoint with its own receipt sequence (two receipts
for one counter visit; duplicates the idempotency and locking discipline).

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








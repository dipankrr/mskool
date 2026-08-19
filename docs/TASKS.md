# Tasks

Phased backlog. **Update this file when you finish a chunk** — the next agent starts here.

---

## ▶ Resume here

**Phase 1 authorization spine is in. Finish Phase 1, then start Phase 2.**

`pnpm check-types` is green across all 8 packages. What exists now: the 9 foundation
tables + the 4 authz tables, `@repo/authz` in full, and `staffProcedure` /
`studentProcedure` wired into `packages/trpc`. `school.router.ts` is the worked example
of the whole vertical slice — copy its shape.

**The schema is now live on Neon.** `drizzle/0000_rich_tenebrous.sql` — 17 tables, 33
indexes, 26 FKs, 10 enums — has been generated, reviewed, and applied. `pnpm db:check`
confirms connectivity on both endpoints; `pnpm db:verify` confirms the schema behaves.

Two things were fixed on the way in, both worth knowing about:

- **better-auth's four tables used `timestamp` without a time zone**, inherited from the
  todo-app template and in breach of hard rule 11. postgres.js writes a `Date` as UTC but
  reads a naive column back as *local* time, so `session.expires_at` was off by the
  host's offset (5h30m here) — sessions expiring early, or outliving their expiry. All of
  `user` / `session` / `account` / `verification` are now `timestamptz`. Re-running
  better-auth's generator reverts this; the file says so at the top.
- **Two CHECK constraints now enforce what `@repo/authz` had only assumed** (ADR-019):
  org-scoped grants must have `scope_id = organization_id`, and a `scope_nodes` row must
  carry the ancestry its `type` implies. `pnpm db:verify` proves each one rejects the row
  it targets and still accepts the legitimate row that most resembles it. Re-run it after
  any change to `0000_*.sql`, since drizzle-kit does not model these and will drop them
  if the migration is ever regenerated.

**The authorization spine is now proven end to end against the live database.** The seed
and the smoke test both exist and both pass:

```bash
pnpm dev            # in another terminal
pnpm db:seed        # idempotent — find-or-create, re-running changes nothing
pnpm smoke:authz    # 15 checks, all passing
```

`apps/api/scripts/seed.ts` creates one org (`demo-trust`), **two** schools (`MAIN`,
`NORTH`), and three logins: an org-scoped `org_admin`, a `principal` scoped to school A
only, and a class-scoped `class_teacher` (the one default role that holds
`academic_year:read` without `read_history`). It also seeds school A's current **and**
closed academic years, school B's current year, and one class in school A — the structure
the academic assertions below address. Two schools, not one — with a single school a
broken tenancy filter and a correct one return the same row, so the second school is the
negative control.

`apps/api/scripts/smoke-authz.ts` signs in over HTTP and asserts, mostly negatively:
org_admin sees both schools; the principal sees only school A even when addressing the org
node; the principal cannot read school B (`FORBIDDEN`); the principal cannot `school.create`
at org scope, which is `staffProcedure`'s strict check versus the permissive
`staffListProcedure` from ADR-017; and a revoked grant is refused immediately rather than
at the end of the 5-minute TTL. It restores what it changed, so it is re-runnable. It now
also proves the academic-year tenancy filter and the `read_history` gate — see Phase 2
slice 1 below.

That closes what the 54 unit tests structurally could not: `buildUserAuthCache` resolving
grants, the Redis JSON round-trip, `scopeWhere`'s SQL against real rows, and `resolveNode`.

Two things this shook out, worth knowing:

- **The seed lives in `apps/api`, not `packages/db`** (ADR-020). It needs `@repo/auth` to
  hash passwords (hard rule 9), `@repo/services` for the school + `scope_nodes`
  transaction (hard rule 12), and `@repo/authz` for the permission matrix. All three
  already depend on `@repo/db`, so seeding from inside it would invert the type chain.
- **better-auth rejects a request with no `Origin` header** (`MISSING_OR_NULL_ORIGIN`, a
  403 indistinguishable from bad credentials). Node's `fetch` omits it where a browser
  would not, so any script talking to `/api/auth/*` must set it to match `CORS_ORIGIN`.

**The school router is now dual-transport.** All five procedures carry
`.meta({ openapi })` + `.output()`, so they serve tRPC *and* REST, and appear in `/docs`:

```bash
pnpm check:openapi   # 6 endpoints, no server needed
```

`GET|POST /schools`, `GET|PATCH /schools/{id}`, `POST /schools/{id}/deactivate`, plus
`/health`. Deactivate is a POST to a sub-resource, not `DELETE /schools/{id}` — the row
survives (hard rule 2) and DELETE would imply otherwise to a REST client.

Three things worth knowing about the OpenAPI layer:

- **`.output()` is mandatory, not decoration.** `generateOpenApiDocument` throws without
  it. It is also a promised response shape: a column added to `schools` later cannot leak
  into a REST response until someone widens the schema in the router.
- **`check-types` cannot see any of this.** The generator fails at *runtime* — missing
  `.output()`, a duplicate path+method pair, a zod schema with no JSON Schema equivalent.
  A green `tsc --noEmit` says nothing about whether `/docs` loads, which is why
  `apps/api/scripts/check-openapi.ts` exists and why it exits non-zero on an empty spec.
- **`protect: true` documents, it does not enforce.** The gate is still
  `staffProcedure` / `staffListProcedure`, which run identically on both transports.

**`GET /me` now exists, and it unblocks the entire web app.** Every staff procedure
requires `organizationId` in its input, but a better-auth session carries only the user —
no org, no role, no scope. There was no legitimate way for the browser to learn which org
to name, so no staff endpoint was reachable from the UI at all. `me.router.ts` is that
missing first call: `contracts/me.contract.ts` → `identity.service.ts` → `me.router.ts`.

Three things worth knowing about it:

- **It is `protectedProcedure`, not `staffProcedure`** — deliberately. The staff builders
  require an `organizationId` and resolve a scope node from it, but this is the endpoint
  that *tells* the client which orgs it may name; gating it behind one would be circular.
  It is safe because the response derives entirely from the caller's own assignments:
  there is no input to tamper with, and a user with no roles gets `[]` rather than
  somebody else's org.
- **`identityService.getMemberships` takes an already-loaded `UserAuthCache`, not a
  userId.** The router has loaded it anyway, so re-reading would double the Redis
  round-trips on the request that runs on every page load. It is the one service that
  takes no `DataScope`, and that is not an exemption from hard rule 1 — here the scope
  *is* the return value, and the schools inside each org still come from
  `listSchools()` with scopes derived from those same assignments.
- **`permissions` is a UI hint, never a gate.** It is the union across non-expired
  assignments in that org, for deciding what to *render*. Authorization stays in `can()`.

Verified against the live API with both seeded logins, which is the part that matters:

```
org_admin  → 1 org, scopeTypes [org],    115 permissions, 2 schools (MAIN, NORTH)
principal  → 1 org, scopeTypes [school],  82 permissions, 1 school  (MAIN)
no session → 401
```

The principal seeing one school and the admin seeing two is the scope clipping from
ADR-017 working through a second, independent call path.

Do this next:

1. **Phase 2** — academic structure. `school.router.ts` plus the seed and smoke test
   together are the pattern to copy for every domain that follows: contract → service →
   thin router → OpenAPI meta → a negative assertion that proves the tenancy filter
   actually bites.
2. Minimal UI on top of `me`: app shell, school switcher. Now unblocked — self-registration
   is gone (ADR-021), and the three hardcoded `localhost:4000` are now `NEXT_PUBLIC_API_URL`.


**ADR-007's better-auth extensions are deliberately deferred** — they were the obvious
next task and were investigated, then dropped as premature. Nothing depends on them:
Phase 2's tables hang off `schools` and `organizations` and none reference `user`, so
making `email` nullable is exactly as cheap later. There is no student portal, no student
login page, and no `student_portal_access` rows, so the two conflicts found while reading
the plugin source would be resolved against an imagined feature with nothing to test them
against. ADR-007's own note says "before the portal ships", not "before Phase 2". Both
conflicts are recorded there for whoever picks it up:

- better-auth 1.6.23's default username validator is `/^[a-zA-Z0-9_.]+$/` — it **rejects
  hyphens**, so the literal `{org_slug}-{phone}` would fail on every student signup. The
  plugin accepts a custom `usernameValidator`; it also adds *two* columns, `username` and
  `displayUsername`, not one.
- `RESOURCE_ACTIONS` already has `portal_access: [read, grant, revoke]`, which covers what
  ADR-007 calls `student_portal:activate`. Adding a second resource would mean two names
  for one concept.

### Web app — known problems

Found while surveying `apps/web`, listed worst-first. The first three are now fixed:

- [x] **`/register` was open self-registration** — fixed, and it was worse than the page
      (ADR-021). Deleting the UI leaves `POST /api/auth/sign-up/email` reachable by curl,
      so the block is a middleware in `apps/api/src/server.ts` ahead of the better-auth
      handler. **Not** `emailAndPassword.disableSignUp`: better-auth checks that flag
      inside the sign-up handler, which `auth.api.signUpEmail()` also runs, so it would
      have broken `pnpm db:seed` and the future staff-invite flow along with it.
      `useAuth.register` and the login page's Register link are gone too.
- [x] **`login-from.tsx` imported from `node_modules/@repo/contracts/src/contracts/...`** —
      fixed: now `@repo/contracts`, and the file is renamed `login-form.tsx`.
- [x] **Three hardcoded `http://localhost:4000`** — fixed. `auth-client.ts`,
      `trpc/client.ts`, and `(dashboard)/layout.tsx` all read `env.NEXT_PUBLIC_API_URL`;
      the `console.log` in `env.ts` is gone.
- [ ] **`spinner.tsx` and `spinner4.tsx` both export `Spinner`**, and `loading.tsx`
      imports `Spinner4` as a default export from a file whose default is a demo wrapper.
- [ ] **`components.json` points at `src/app/global.css`; the file is `globals.css`** — the
      shadcn CLI will misfire.
- [ ] `app/pagee.tsx` is a typo'd leftover from the exam-platform template (it still says
      "Exams in this org"), unreachable because `(dashboard)/page.tsx` serves `/`. The root
      `layout.tsx` metadata still reads "Exam Platform" too.

### Tooling — known problems

- [ ] **`pnpm lint` has never run.** `eslint` is not a dependency of any package, so the
      only two packages with a `lint` script — `@repo/api` and `@repo/web` — both die with
      *"'eslint' is not recognized"*. `@repo/eslint-config` exists and exports configs
      that nothing consumes. Either add `eslint` to those two and wire the config in, or
      delete the scripts; a command in `AGENTS.md` that has never worked is worse than a
      missing one, because it gets run once and then ignored. Not urgent — `check-types`
      is the actual gate and is green — but it should not stay in this state silently.





### Authorization review — fixed, and still open

A review of `@repo/authz` found four defects. Three are fixed (ADR-017): `getDataScope`
deleted in favour of the addressed node's own scope, `getDataScopes` now clips grants to
the requested subtree, and `scopeWhere` takes explicit `ScopeColumns` plus an array of
scopes and **throws** rather than silently widening. `staffProcedure` (strict) and
`staffListProcedure` (permissive) are now separate builders.

The scope maths is now tested: **54 tests** across `packages/authz/src/scope.test.ts` and
`can.test.ts`, run with `pnpm test`. They are pure — plain objects in, booleans or
compiled SQL out, no database and no mocks. `scopeWhere` assertions compare against SQL
compiled through `PgDialect({ casing: "snake_case" })` rather than snapshotting Drizzle's
internals, so they check the parameters that would actually reach Postgres.

Verified non-vacuous by mutation: reverting the `schools` special case in `scopeCovers`
fails two tests in two files. Copy that habit — a scope test that cannot fail is worse
than none, because it looks like coverage.

Still open, in rough priority order:
- [ ] **Subject-level access is not enforced.** A `subject_teacher` scoped to a section
      can currently write marks for *every* subject in it — the Physics teacher can enter
      Chemistry marks. The scope tree has no subject axis by design, so `can()` cannot
      express this; it needs `checkSubjectAccess` against `section_teacher_assignments`
      (ADR-012). **Blocks shipping marks entry.** Requires `sections` + `subjects`, so
      Phase 2.
- [x] **CHECK constraints on `role_assignments` and `scope_nodes`** — done (ADR-019).
      Org-scoped grants must have `scope_id = organization_id`, and a scope node must
      carry the ancestry its `type` implies, so a class node can no longer yield a
      `DataScope` that spans the whole org. Hand-written per ADR-013; `pnpm db:verify`
      proves both actually reject the rows they target.
- [ ] **No `platformProcedure`.** `createOrganization` runs above tenancy and has no gate.
      Deliberately deferred: no router exposes it today, so there is nothing to attack.
      **This gate is a precondition on the first org-creation endpoint** — the service
      takes no `DataScope`, so there is no tenancy filter to fall back on.

- [ ] **`authz_audit_log` has no writer.** The table exists; nothing writes to it. Every
      grant and revoke should append a row.
- [ ] `buildUserAuthCache` is N+1 — one query per assignment, then one per org. Batch
      with `inArray`.
- [ ] `insertScopeNode` types `tx` structurally rather than as Drizzle's transaction type,
      to avoid a circular import between `@repo/authz` and `@repo/db`. Correct at the call
      site but weakly typed; revisit if a second caller needs it.
- [ ] `invalidateOrgAuthCache` re-reads assignments to find affected users. Fine at current
      scale, wasteful at 10k staff.
- [ ] Staff `organizationId` arrives in the request body. It *is* verified against the
      caller's assignments, so it is not exploitable, but subdomain or session would be a
      better source.


`SMS_PROJECT_CONTEXT.md` at the repo root is superseded by `docs/` but kept deliberately;
the owner will remove it.




---

## Phase 0 — Docs + detox

- [x] `AGENTS.md`
- [x] `docs/DECISIONS.md` — ADR-001 … ADR-014
- [x] `docs/ARCHITECTURE.md` — package boundaries, type chain, request lifecycle, env, authz
- [x] `docs/CONVENTIONS.md` — naming, Drizzle patterns, the 12 hard rules with rationale
- [x] `docs/DOMAIN.md` — the 63 tables by domain, the recurring patterns, critical flows
- [x] `docs/PRD.md` — personas, scope, deliberate non-goals
- [x] Agent pointer files: `.clinerules`, `.cursor/rules/`, `CLAUDE.md` → all point at `AGENTS.md`
- [x] Move reference material → `docs/reference/sql/` + `docs/reference/authz-prototype/`
- [x] **Detox:**
  - deleted the `todos` slice end-to-end: schema, contract, service, router, and the
    barrel exports in all three packages
  - deleted the commented-out leftovers `exam.router.ts` and `require-permission.ts`;
    replaced `seed.ts` with a Phase 1 stub
  - fixed `packages/trpc/src/router.ts` (it imported `examRouter`, which did not exist —
    this was the typecheck failure)
  - renamed the root package `exam-platform` → `mskool`; `DATABASE_URL` default now
    `…/mskool`; navbar and dashboard page de-todo'd
  - rewrote `README.md`; kept `REDIS_URL` in `.env.example`
- [x] Gate: `pnpm check-types` green (7/7 packages)

`pnpm dev` was not verified — it needs a real `.env` and a running Postgres, neither of
which exists in the repo. `SMS_PROJECT_CONTEXT.md` is kept at the owner's request.


---

## Phase 1 — Foundation + authorization

The two must land together: authz needs `organizations`/`schools` to exist, and every
later table needs `staffProcedure` to exist.

**Tables (9)** — all written, none migrated yet:

- [x] `organizations`, `schools` — `schema/organization.ts` (ADR-001)
- [x] `staff`, `guardians`, `students`, `student_guardians`, `student_relationships`,
      `previous_school_records`, `student_portal_access` — `schema/people.ts` (ADR-008)
- [ ] better-auth extensions: nullable email, username plugin, `must_change_password`
      (ADR-007)

**`@repo/authz` (4 tables)** — ported from `docs/reference/authz-prototype/` and
rewritten for better-auth sessions (not JWT) and tRPC middleware (not Express):

- [x] `scope_nodes`, `org_role_permissions`, `role_assignments`, `authz_audit_log`
- [x] `permissions.ts` — `RESOURCE_ACTIONS` as the source of truth; the `Permission`
      union is derived from it, so an invalid `resource:action` will not compile
- [x] `roles.ts` — fixed role types, scope hierarchy (ADR-011)
- [x] `can.ts` — `can()` / `getDataScopes()`, pure and synchronous (ADR-017)
- [x] `scope.ts` — `scopeCovers()`, `intersectScopes()`, `scopeWhere()` (the hard-rule-1
      query filter)
- [x] `cache.ts` — Redis auth cache, 5-min TTL, `SENSITIVE_PERMISSIONS` bypass it
- [x] `defaultPermissions.ts` — the matrix copied into a new org

**Also in this phase:**

- [x] `staffProcedure` / `staffListProcedure` / `studentProcedure` in
      `packages/trpc/src/trpc.ts` (ADR-005, ADR-017). `staffProcedure` is strict and puts
      the addressed node's `scope` on ctx; `staffListProcedure` is permissive and puts
      clipped `scopes` on ctx. `studentProcedure` has no permission gate — ownership only.
- [x] `insertScopeNode` as a transactional invariant in `createSchool` — hard rule 12
- [x] Redis auth cache with invalidation on role change
- [x] Worked vertical slice: `contracts/src/contracts/organization.contract.ts` →
      `organization.service.ts` → `school.router.ts`

- [ ] `system` context verification for webhooks (ADR-009) — deferred to Phase 4, where
      the payment webhook that needs it lands
- [ ] `authz_audit_log` is created but nothing writes to it yet; wire it up with the
      role-assignment service
- [x] First migration generated, reviewed, and applied to Neon (17 tables, 10 enums),
      plus `pnpm db:verify` asserting the ADR-019 constraints hold
- [x] Seed — `apps/api/scripts/seed.ts`, idempotent, 1 org + 2 schools + 2 grants (ADR-020)
- [x] End-to-end authz proof — `apps/api/scripts/smoke-authz.ts`, 7 checks over HTTP
      against live Postgres + Redis, covering the seams the pure tests cannot reach


---

## Phase 2 — Academic structure (15 tables)


`academic_year_templates`, `academic_years`, `terms`, `academic_calendar`, `classes`,
`sections`, `section_teacher_assignments` (ADR-012), `system_subject_catalog`, `subjects`,
`subject_name_history`, `subject_groups`, `class_subject_mappings`, `student_enrollments`,
`section_transfer_log`, `student_subject_enrollments`.

Includes the `EXCLUDE USING gist` constraints on `academic_years` as hand-written
migration SQL (ADR-013).

### Slice 1 — the spine: `academic_years`, `classes`, `sections` — DB layer done

- [x] `schema/academic.ts` + barrel export; `drizzle/0001_flippant_dragon_lord.sql`
      generated and applied to Neon.
- [x] Both `EXCLUDE` constraints hand-written into 0001 (ADR-013): no overlapping years
      per school, at most one `is_current` year per school. `CREATE EXTENSION btree_gist`
      precedes them — a gist index over `uuid` / `boolean` does not work without it.
- [x] `pnpm db:verify` extended to 22 assertions, all green. Each constraint is proven to
      reject the row it targets **and** accept the legitimate row that most resembles it
      (same dates in a different school; a second non-current year). The boundary case is
      asserted explicitly: `daterange(..., '[]')` makes a shared start/end date a
      conflict, so a rewrite to `'[)'` fails the run.
- [x] `academic_years_end_after_start` (`end_date >= start_date`) added — as a Drizzle
      `check()` in the schema, not hand-written SQL. Unlike the EXCLUDE constraints
      drizzle-kit can see this one, so it survives a migration regeneration; it landed
      as `0002_ancient_nico_minoru.sql`. The inverted-range case is asserted **by name**,
      which matters: `daterange()` inside the EXCLUDE would have refused the same row,
      so a generic "was it rejected?" assertion could have passed while our rule was
      absent. `start_date = end_date` (a single-day year) is accepted — the bound is
      `>=`, deliberately not `>`.

Two things worth knowing for whoever picks this up:

- **drizzle-kit cannot see `EXCLUDE` constraints at all.** It will not drop them on a
  diff, but a regenerated 0001 will not contain them either — the block is marked in the
  SQL and must be re-pasted. `db:verify` queries `pg_constraint` for `contype = 'x'`
  directly, so their absence fails loudly rather than silently.
- **`db:verify`'s cleanup assertion keys on the `verify-trust` slug**, not on
  `count(*) = 0`. `pnpm db:seed` legitimately leaves an org behind; asserting an empty
  table fails on any seeded database for a reason that has nothing to do with the schema.

### Slice 1 — remaining

- [x] `academic.contract.ts` — Zod schemas via drizzle-zod for all three entities.
      Written *before* the service's own input types were removed, which was the right
      order caught the wrong way round in review: the service had been exporting
      `Create*Input` derived from `$inferInsert`, a second definition of the same shape
      that would have drifted from the schema the router validates against. Contracts
      owns the vocabulary — `db → contracts → services` — and the service now imports
      from it. Notable choices: `originalEndDate` and `isCurrent` are omitted from the
      create schema (the service freezes one and `setCurrent` owns the other);
      `academicYearId` / `classId` are omitted from the section update schema, because
      moving a section between years or classes would relocate everything hanging off it
      and leave its scope node's ancestry stale; `numericOrder` allows negatives so
      Nursery/LKG/UKG sit below Class 1 instead of displacing it.

- [x] `academic.service.ts` — written, `check-types` green (8/8). CRUD for all three
      entities, every method taking a `DataScope` (hard rule 1); `createClass` and
      `createSection` insert their `scope_nodes` row in the same transaction (hard rule
      12); deactivation instead of DELETE (hard rule 2). Academic years get no scope node
      — the tree is org → school → class → section and nobody is scoped to "2025-26".

- [x] **Year visibility — now a permission (ADR-024, supersedes ADR-023).** Reading a
      closed session is gated by `academic_year:read_history`, seeded to principal,
      vice-principal, and accountant. The service no longer knows how the answer is
      reached: `YearAccess` / `yearAccessFor` are gone, and each year-scoped read takes a
      plain `includeHistory: boolean` the router computes. ADR-023's original mechanism
      keyed on "holds an org-scoped assignment", which locked the principal and accountant
      out of the history their jobs require and put an authz decision where `can()` could
      not see it — see ADR-024 for the full reversal. The `is_current` join on `sections`
      is unchanged and still load-bearing: it is what stops an `includeHistory:false`
      caller reaching a closed year's sections (and its students) with a stale id.

Three judgment calls still worth your eye, all recorded in ADR-023:

  - **`atSchoolLevel` / `atClassLevel` widen a scope before `scopeWhere`.** ADR-017 makes
    `scopeWhere` *throw* when a scope restricts a level the table cannot express, which is
    right for owned rows but breaks a class-scoped teacher merely asking which academic
    years their school runs — `academic_years` has no `class_id`, so the call throws and
    they get a 500 on a school-level reference table. The widening is justified by a
    property of the entity, not caller convenience: a year has no class dimension, so "my
    class's years" and "my school's years" are the same set. **This reasoning does not
    transfer to students, attendance, marks, or fees** — all of which have a real class
    dimension, where widening hands a class teacher the whole school.
  - **`createSection` re-reads both parents through the caller's scope.** The FKs to
    `classes` and `academic_years` never mention `school_id`, so Postgres permits a
    section in school A pointing at a class in school B — a cross-tenant link no later
    query has reason to doubt. The real fix is a composite FK (`UNIQUE (id, school_id)`
    on the parents, then `FOREIGN KEY (class_id, school_id)`), which makes it
    unrepresentable rather than merely checked; worth doing once the remaining Phase 2
    tables repeat the shape a third time.
  - **`setCurrentAcademicYear` clears before it sets, in one transaction.**
    `academic_years_one_current_excl` is not deferrable, so it is checked per statement:
    setting first collides with the outgoing year and aborts. It also verifies the target
    is in scope *before* clearing — otherwise naming another school's year would clear
    this school's flag and then fail, leaving the school with no current year.

- [x] Thin routers with OpenAPI `meta`/`output`, following `school.router.ts` —
      `academic.router.ts`, namespaced `academic.year.*` / `academic.class.*` /
      `academic.section.*`, registered in `router.ts`. 23 REST endpoints total in
      `pnpm check:openapi`, `check-types` green (8/8), 54 authz tests still pass. The
      `read_history` answer is computed **in the router** and passed to the service as
      `includeHistory` (ADR-024): `ctx.can()` for single-resource reads (strict) and
      `ctx.canWithin()` for lists (permissive) — the ADR-017 split, because a principal
      holds `read_history` at their branch, not at the org node they address to list
      years. Both helpers are bound to the resolved node on the staff ctx in `trpc.ts`.
- [x] Extended `smoke-authz.ts` with the **negative** academic assertions — 15 checks
      total, up from 9. A school-A principal lists only school A's years (never school B's)
      and gets NOT_FOUND for school B's year id **even when addressing their own school
      node** — the row-level filter biting a layer below the node gate that already 403s a
      direct school-B address. A `class_teacher` — the seed's third login, and the only
      default role holding `academic_year:read` without `read_history` — gets NOT_FOUND for
      a closed year by valid id and sees only the current year in its list, while the
      principal reads that same closed year: the non-vacuity control, proving it is the
      permission that gates and not a row nobody can read. The seed now creates the years
      this needs (school A current + closed, school B current) plus one class to scope the
      teacher to.

      Running it live surfaced a latent fixture bug and its fix: `demo-trust` predated these
      permissions, and because `createOrganization` snapshots the defaults once and never
      refreshes an existing org (ADR-011), the principal held no `read_history` and the class
      teacher no `academic_year:read` — so the gate checks failed against a stale matrix, not
      broken code. The seed now backfills the fixture's `org_role_permissions` to match
      `DEFAULT_ROLE_PERMISSIONS` on every run (insert-only; real tenants are never seeded).
      See ADR-025.


---

## Phase 3 — Attendance (6 tables)


`attendance_policies` (minus `can_mark_roles` / `can_correct_roles` — ADR-012), `periods`,
`attendance_records`, `attendance_corrections`, `daily_attendance_status`,
`attendance_summary`.

Key invariant: only `daily_attendance_status` is read downstream (hard rule 5).

---

## Phase 4 — Fees (14 tables)

`fee_heads` → `fee_structures` → `fee_structure_lines` → `student_fee_assignments` →
`fee_concessions`, `student_optional_fee_subscriptions`, `late_fee_rules`,
`fee_installments`, `opening_balances`, `fee_payments`, `payment_allocations`,
`fee_refunds`, `financial_transactions`, `receipt_number_sequences`.

Append-only ledger (hard rule 3), `SELECT … FOR UPDATE` on the receipt sequence, and the
webhook `system` context (ADR-009).

---

## Phase 5 — Exams & results (15 tables)

`grading_scales`, `grading_scale_bands`, `pass_criteria`, `exams`,
`exam_subject_schedules`, `exam_components`, `exam_eligibility`,
`student_component_results`, `student_component_result_revisions`,
`student_subject_results`, `student_term_results`, `student_final_results`,
`coscholastic_assessments`, `report_card_templates`, `published_report_cards`.

Includes the marks-≤-max and grading-scale-lock triggers (ADR-013). Student-visible
results read `published_report_cards` **only** (hard rule 8).

---

## Later

- **Homework** — `homework`, `homework_submissions` (ADR-014)
- **Phone-number-change flow** — permission + audit + session revocation. Must land
  before the student portal ships (ADR-007)
- **Year rollover** — remapping `scope_nodes` and `role_assignments` across academic years
- Notifications / WhatsApp, timetabling, admissions workflow, library, transport

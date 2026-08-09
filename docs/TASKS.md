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

Do this next:

1. Write `packages/db/src/seed.ts` — it is still the Phase 1 stub. It needs one org
   (which seeds `org_role_permissions` from `DEFAULT_ROLE_PERMISSIONS`), one school with
   its `scope_nodes` row, and one org_admin. Without that seed there is no way to log in
   and exercise any of this. Note the constraints above: the org_admin's grant must use
   `scope_id = organization_id`, and the school's node is inserted in the *same*
   transaction as the school (hard rule 12).
2. Exercise `school.create` / `school.list` against the live database as an org_admin and
   again as a school-scoped principal. That is the first end-to-end proof that
   `staffProcedure` (strict) and `staffListProcedure` (permissive) behave as ADR-017
   claims — the 54 unit tests are pure and never touch Postgres or Redis.
3. Then: better-auth extensions still owed by ADR-007 — nullable email, the username
   plugin, `must_change_password`.


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
- [ ] Seed (see "Resume here")


---

## Phase 2 — Academic structure (15 tables)


`academic_year_templates`, `academic_years`, `terms`, `academic_calendar`, `classes`,
`sections`, `section_teacher_assignments` (ADR-012), `system_subject_catalog`, `subjects`,
`subject_name_history`, `subject_groups`, `class_subject_mappings`, `student_enrollments`,
`section_transfer_log`, `student_subject_enrollments`.

Includes the `EXCLUDE USING gist` constraints on `academic_years` as hand-written
migration SQL (ADR-013).

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

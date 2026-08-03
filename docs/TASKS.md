# Tasks

Phased backlog. **Update this file when you finish a chunk** — the next agent starts here.

---

## ▶ Resume here

**Phase 0 is done. Start Phase 1 — foundation + authorization.**

The repo is now an empty, correctly-shaped shell: docs written, template slice removed,
`pnpm check-types` green across all 7 packages. `packages/db/src/schema/` contains only
`auth.ts` (better-auth's tables). There is no domain schema yet.

Start Phase 1 in this order, since each step unblocks the next:

1. `organizations` + `schools` in `packages/db/src/schema/` — nothing else can be scoped
   until the tenant exists (ADR-001).
2. The 4 authz tables + `packages/authz` ported from `docs/reference/authz-prototype/`.
3. `AuthContext` + `staffProcedure` / `studentProcedure` in `packages/trpc`, replacing the
   placeholder `protectedProcedure`. The comments in `context.ts` describe this target
   state — make them true.
4. `staff`, `students`, `guardians` and the rest of the foundation tables.

Two notes before you run anything: create `.env` from `.env.example` (nothing boots
without `DATABASE_URL` and `BETTER_AUTH_SECRET` — `createEnv()` throws at import), and
`packages/authz` does not exist as a directory yet despite being referenced in the docs.

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

**Tables (9):** `organizations`, `schools`, `staff`, `guardians`, `students`,

`student_guardians`, `student_relationships`, `previous_school_records`,
`student_portal_access` (ADR-008), plus better-auth extensions (nullable email,
username plugin, `must_change_password` — ADR-007).

**`@repo/authz` (4 tables):** `scope_nodes`, `org_role_permissions`, `role_assignments`,
`authz_audit_log`. Port `types/`, `authz/`, `policies/`, `seeds/` from
`docs/reference/authz-prototype/`, rewritten for better-auth sessions (not JWT) and
tRPC middleware (not Express).

**Also in this phase:**

- `AuthContext` discriminated union + `staffProcedure` / `studentProcedure` /
  system-context verification (ADR-005, ADR-009)
- `insertScopeNode` as a transactional invariant inside the school/class/section create
  services — hard rule 12
- Redis auth cache with invalidation on role change

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

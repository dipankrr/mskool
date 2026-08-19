# Close Phase 2 Slice 1 — negative smoke proof for academic years

## Status — IMPLEMENTED & VALIDATED (2026-08-18)

Done and proven against the live DB: `pnpm db:seed` + `pnpm smoke:authz` → **15/15** checks
(this plan estimated 13; the pre-existing suite was actually 9, not 7). `pnpm test` 54/54,
`pnpm check-types` green (8/8), `pnpm check:openapi` 23 endpoints.

The live run surfaced one thing static checks could not: `demo-trust` predated ADR-024's
permissions and — per ADR-011 — `createOrganization` never refreshes an existing org, so
the gate checks first failed against a **stale `org_role_permissions` matrix** (not broken
code). Fixed with a seed-only, insert-only backfill (`syncDefaultPermissions`); rationale
recorded in **ADR-025**.

**Coverage is real but partial.** What is proven: the academic-*year* read paths
(`list`, `byId`) — tenancy and the `read_history` gate, with a non-vacuity control. What is
NOT: sections (incl. the load-bearing `is_current` join), academic write paths, class-level
tenancy, and the production permission-backfill gap. The user chose to **log** these gaps,
not plan them now — see *Follow-up backlog* below.

## Goal

Close the last open box of Phase 2 Slice 1 (`docs/TASKS.md:433`): prove, over HTTP
against the live DB, that the **academic-year tenancy filter** and the **`read_history`
gate** actually bite — not just that the happy path returns rows.

Two assertions the checkbox demands:
1. A grant scoped to school A must **not** see school B's academic years.
2. A caller **without** `academic_year:read_history` gets `NOT_FOUND` for a non-current
   (closed) year even with a valid id.

## Key facts (verified)

- **No source changes.** `academic.service.ts`, `academic.router.ts`, and `trpc.ts`
  already implement the filter and the gate correctly. Work is confined to two files:
  - `apps/api/scripts/seed.ts`
  - `apps/api/scripts/smoke-authz.ts`
- **The gate test needs a third login.** `packages/authz/src/defaultPermissions.ts`
  shows only `class_teacher` and `subject_teacher` hold `academic_year:read` *without*
  `academic_year:read_history`. The seed's `org_admin` and `principal` both hold
  `read_history`, so neither can demonstrate the gate. Add a `class_teacher`.
- **Node addressing** (`packages/trpc/src/trpc.ts:42-83`): the addressed node is the most
  specific id in `{ organizationId, schoolId?, classId?, sectionId? }`. `staffProcedure`
  requires the caller's grant to **cover** that node.
  - A `class_teacher` scoped to a class must address its `classId`; addressing `schoolId`
    or the org node would 403 (grant does not cover it).
  - `getAcademicYearById` widens to school level (`atSchoolLevel`,
    `academic.service.ts:127`), so a class-scoped teacher can legitimately read the
    school's current year, but with `includeHistory=false` is pinned to `isCurrent=true`
    (`yearVisibilityWhere`, `academic.service.ts:69`) — a closed-year id returns nothing.
- **The seed currently creates zero academic years and no classes.** It must be extended
  before the smoke test has anything to assert against.
- **`auth.api.signUpEmail()` still works** for seeding despite the ADR-021 sign-up
  endpoint block (that block is HTTP-only; `findOrCreateUser` uses the programmatic API).

## Data the seed must create

Under the existing `demo-trust` org / schools MAIN (A) and NORTH (B). Ranges are chosen
non-overlapping to satisfy the `EXCLUDE USING gist` no-overlap constraint; only one year
per school is made current (one-`is_current`-per-school constraint).

| School | Year name | startDate | endDate | current? |
|---|---|---|---|---|
| A (MAIN) | `2024-25` | `2024-04-01` | `2025-03-31` | no (closed) |
| A (MAIN) | `2025-26` | `2025-04-01` | `2026-03-31` | **yes** |
| B (NORTH) | `2025-26` | `2025-04-01` | `2026-03-31` | yes |

Plus, in school A:
- One class: `{ name: "Class 6", numericOrder: 6 }` (its `scope_nodes` row is created by
  `academicService.createClass`).
- One login `teacher@demo-trust.test` → `staff` row (`EMP-TEACH`) → `role_assignment`
  `class_teacher` at `scopeType: "class"`, `scopeId: <classA.id>`.

## Task list

1. **Extend `apps/api/scripts/seed.ts`** (idempotent, find-or-create, no deletes):
   - Import `type DataScope` from `@repo/authz`, `academicService` from `@repo/services`,
     and `academicYears`, `classes` from `@repo/db/schema`.
   - Add constants: `TEACHER_EMAIL`, class name/order, and the three year definitions.
   - Build `const scopeA: DataScope = { organizationId: org.id, schoolId: schoolA.id,
     classId: null, sectionId: null }` and the equivalent `scopeB`.
   - Add `findOrCreateAcademicYear(scope, input)` — look up by `(schoolId, name)`; else
     `academicService.createAcademicYear(scope, input)`. Years insert with
     `isCurrent=false` by default.
   - Add `findOrCreateClass(scope, input)` — look up by `(schoolId, name)`; else
     `academicService.createClass(scope, input)`.
   - In `main()`, after schools exist: create closed year A, current year A, year B, then
     `if (!currentYearA.isCurrent) await academicService.setCurrentAcademicYear(scopeA,
     currentYearA.id)` and likewise for year B. (Guarding on `isCurrent` keeps re-runs a
     true no-op; `setCurrent` clears-then-sets in one txn per `academic.service.ts:322`.)
   - Create class A; create the teacher user + staff (`EMP-TEACH`); grant `class_teacher`
     at `("class", classA.id)` via the existing `findOrCreateAssignment`.
   - `invalidateUserAuthCache(teacherUser.id)`; extend the closing summary log.

2. **Extend `apps/api/scripts/smoke-authz.ts`** — add `academicYears`, `classes` to the
   schema import and `TEACHER_EMAIL`; sign the teacher in with the existing `signIn`.
   Look up the seeded rows and guard they exist (else throw "run `pnpm db:seed`"):
   ```ts
   const yearsA = await db.select().from(academicYears).where(eq(academicYears.schoolId, schoolA.id));
   const currentYearA = yearsA.find((y) => y.isCurrent);
   const closedYearA  = yearsA.find((y) => !y.isCurrent);
   const [yearB]  = await db.select().from(academicYears).where(eq(academicYears.schoolId, schoolB.id));
   const [classA] = await db.select().from(classes).where(eq(classes.schoolId, schoolA.id));
   ```
   Add these checks **after** the school/principal block and **before** the revocation
   block (revocation mutates the principal's grant):

   - **principal lists ONLY school A's years** — `query(principalCookie,
     "academic.year.list", { organizationId: orgId })`; expect ok, `length === 2`, every
     `schoolId === schoolA.id`, and none with `id === yearB.id`. *(cross-tenant list)*
   - **principal CANNOT read school B's year (scope filter bites)** —
     `query(principalCookie, "academic.year.byId", { organizationId: orgId, schoolId:
     schoolA.id, id: yearB.id })`; expect `!ok && code === "NOT_FOUND"`. The principal
     addresses their *own* school node (gate passes) but the foreign id is filtered out
     by `scopeWhere` at the row level — the sneaky leak the school test can't reach.
   - **class_teacher reads the current year** — `query(teacherCookie,
     "academic.year.byId", { organizationId: orgId, classId: classA.id, id:
     currentYearA.id })`; expect ok, `data.id === currentYearA.id`. *(positive control:
     class-node addressing + widening work)*
   - **class_teacher CANNOT read a closed year** — same call with
     `id: closedYearA.id`; expect `!ok && code === "NOT_FOUND"`. **The core assertion —
     history gate bites.**
   - **principal (has read_history) CAN read the same closed year** —
     `query(principalCookie, "academic.year.byId", { organizationId: orgId, schoolId:
     schoolA.id, id: closedYearA.id })`; expect ok, `data.id === closedYearA.id`.
     **Non-vacuity control:** proves the previous failure is the *permission* gate, not an
     unreadable row.
   - **class_teacher's year list omits the closed year** — `query(teacherCookie,
     "academic.year.list", { organizationId: orgId, classId: classA.id })`; expect ok,
     `length === 1`, `data[0].id === currentYearA.id`. *(list-level gate via `canWithin`)*

   Net: 7 → 13 checks.

3. **Update `docs/TASKS.md`**: tick the Slice 1 remaining box (`:433`); note the seed now
   creates the three years, a class, and a third `class_teacher` login, and update the
   smoke-check count / description.

## Validation

- `pnpm check-types` — must stay green (8/8).
- In one terminal `pnpm dev`; in another: `pnpm db:seed` then `pnpm smoke:authz` — expect
  all 13 checks pass. Re-run `pnpm db:seed` once more to confirm it stays a no-op.
- `pnpm test` — the 54 authz unit tests are untouched; run to confirm no regression.
- (`pnpm check:openapi` is unaffected — no router change — but harmless to run.)

## Risks / gotchas

- **EXCLUDE constraints are per-statement, not deferred.** Keep year ranges
  non-overlapping within a school and set only one year current; let `setCurrent` do the
  clear-then-set. Do not seed two current years in one school.
- **Idempotency:** find-or-create by `(schoolId, name)`; guard `setCurrent` on
  `isCurrent`; never delete (hard rule 2).
- **Addressing layer matters.** The principal→schoolB test must address `schoolId:
  schoolA.id` with `id: yearB.id` to exercise the *row filter* (`NOT_FOUND`). Addressing
  `schoolId: schoolB.id` instead would 403 at the node gate — a different, weaker layer.
- **Keep the non-vacuity control.** Without "principal CAN read the closed year", a
  blanket-deny bug would masquerade as a passing history gate.
- **Ordering:** place the new checks before the revocation block, which mutates and then
  restores the principal's assignment.

## Optional extension (full Slice-1 close)

Exercises the load-bearing `is_current` join in `listSections`/`getSectionById`
(`academic.service.ts:588,620`) — the enforcement point every later domain inherits:
- Seed one section under class A in **each** A-year (`academicService.createSection`,
  which also writes the section `scope_nodes` row).
- Add: class_teacher reads current section → ok; reads closed section → `NOT_FOUND`;
  section list for the closed year → empty; principal reads closed section → ok (control).

Recommend deferring unless a full slice close is wanted now; the checkbox is satisfied by
the year assertions alone.

## Follow-up backlog (deferred — to be logged in `docs/TASKS.md`)

Coverage/provisioning gaps found while reviewing the finished work. The user chose to log,
not plan, these. Paste-ready for `docs/TASKS.md` (Plan Mode cannot edit that file; an
implementation agent should copy these in). Ranked by importance.

1. **[ ] Section-level tenancy + the `is_current` join are unproven (highest).** No section
   rows are seeded and `academic.section.*` has zero smoke coverage. ADR-024 calls the
   `is_current` innerJoin in `listSections`/`getSectionById` (`academic.service.ts:588,620`)
   load-bearing — it is what stops a current-only caller reaching a closed year's sections
   (and, through them, its students/marks) with a stale id. Close it: seed one section under
   class A in **each** of school A's years, then assert — class_teacher reads the current
   section (ok); reads the closed section by id → `NOT_FOUND`; the closed-year section list
   → empty; principal reads the closed section (non-vacuity control). (This is the plan's
   "Optional extension", promoted to a tracked item.)

2. **[ ] Academic write-path negative assertions are missing.** `academic.year.create` /
   `update` / `setCurrent` have no smoke coverage. `setCurrentAcademicYear`'s
   "verify target is in scope BEFORE clearing" guard (`academic.service.ts:326`) is only
   exercised on the positive path by the seed. Add: a school-A principal cannot `setCurrent`
   school-B's year (expect `NOT_FOUND`, and school A's own current flag is unchanged), and
   `create`/`update` targeting a foreign school are refused.

3. **[ ] Class-level tenancy is unproven.** `academic.class.*` has no negative assertion
   that a school-A grant cannot list or read school-B's classes. Lower risk (classes carry
   no year/history axis) but currently untested.

4. **[ ] No permission-backfill path for existing orgs when defaults change.**
   `createOrganization` snapshots `DEFAULT_ROLE_PERMISSIONS` once (ADR-011); ADR-025's seed
   backfill fixes only the `demo-trust` fixture. A real tenant provisioned before a default
   permission is added (e.g. ADR-024's `academic_year:read_history`, or the class teacher's
   `academic_year:read`) will silently lack it, with no migration path — principals and
   accountants lose history, class teachers lose year read entirely. Latent pre-launch;
   this is a permission-*provisioning* gap, not a filter-logic bug. Decide a policy before
   onboarding real tenants: a one-off backfill migration per permission addition, an admin
   "resync role to defaults" action, or accept per-org drift and document it. Belongs with
   the open authz-provisioning items (near `authz_audit_log` writer / `platformProcedure`).

## Out of scope

Subject-level access (`checkSubjectAccess`), `platformProcedure`, the `authz_audit_log`
writer, `buildUserAuthCache` N+1 batching, web UI, and the remaining Phase 2 tables
(subjects, enrollments, etc.). These are separate backlog items in `docs/TASKS.md`.

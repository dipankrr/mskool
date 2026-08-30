# mskool — Phase 2: subjects, terms, enrollments

Five slices: **S1** subjects, **S2** the teaching-assignment layer
(`class_subject_mappings` + `section_teacher_assignments`), **S3** terms, **S4**
subject-level access + the student owner-resolver, **S5** enrollments. Each slice lands
as 4–5 small commits, one layer per commit. Tests ride with the commit that introduces
the code they cover.

No ADRs are needed to start S1/S2 (the patterns exist: `school.router.ts`, the academic
tables' denormalised tenancy columns). S4 opens with an ADR and is gated on the owner
accepting it. S5 needs S4's resolver.

Amended 2026-08-29 (owner question: "why no class/section on subjects?"): the original
four-slice plan omitted the two tables the subject domain actually needs, making the
access slice unimplementable (`checkSubjectAccess` reads `section_teacher_assignments`)
and marks entry sourceless (no answer to "which subjects does this section teach").
The three-layer model from the reference SQL is now explicit: subjects = catalogue
(once per school), class_subject_mappings = which subjects a class takes in a year,
section_teacher_assignments = who teaches what where, dated, append-on-change.

## Goal

Finish Phase 2 — subjects, the teaching-assignment layer, terms, enrollments — and close
the Phase 1 leftover "subject-level access is not enforced" (the Physics teacher can
currently enter Chemistry marks), which TASKS.md marks as **blocking marks entry**.

---

## Workflow protocol — read before starting

**One chunk per turn. The user commits, not you.**

1. Implement **exactly one** chunk. Do not begin the next one.
2. Run that chunk's **Verify** steps.
3. Tick that chunk's boxes in this file as part of the same diff.
4. Run `git status` and `git diff --stat`, and summarise what changed and why.
5. Propose the commit message from that chunk verbatim. If the chunk grew, say so and
   amend the message to match what actually landed.
6. **Stop and wait.** The user reviews the diff and commits.

**Never run** `git add`, `git commit`, `git push`, `git checkout`, or any
history-rewriting command. Never chain two chunks in one turn, even if a chunk is small.

Every chunk must leave `pnpm check-types` green across all 8 packages. If a chunk cannot
be finished cleanly, stop and report rather than leaving a broken intermediate state.

---

## Execution order — do not read this file top-to-bottom as an order

```
S1.1 ──── FIRST. The table. Everything else in S1 sits on it.      [DONE]
S1.2 ── S1.3 ── S1.4 ── S1.5 (the type chain, then tests, then docs)
S2.1 ── S2.2 ── S2.3 ── S2.4 ── S2.5   (csm + sta: the teaching-assignment layer;
                                        unblocks S4 AND the teacher-assignment UI)
S3.1 ── S3.2 ── S3.3 ── S3.4 ── S3.5   (terms; independent of S2, after it for
                                        ledger tidiness)
S4.1 ──── ADR. Owner accepts or rejects BEFORE S4.3 moves.
  ├─ S4.2 ── S4.3
  └─ S4.4 ──── deadline: before any marks-entry slice
S5.1 ── S5.2 ── S5.3 ── S5.4 ── S5.5   (LAST — needs S4.2's OwnerResolver)
```

---

## Preconditions (no diff; do once)

- [x] `pnpm check-types` green at baseline across all 8 packages.
- [x] `pnpm db:seed` idempotent and `pnpm smoke:authz` green at baseline **before the
      first migration** (re-run after every `drizzle/` change). Verified 2026-08-29:
      seed run twice cleanly; smoke all-pass against a live API.
- [x] The working-agreement rule (never commit/push yourself) is in `AGENTS.md`
      — folded into the S1.1 commit per the owner's instruction.

---

## Hard context an implementer must know

**Subjects are NOT in the scope tree.** No `scope_nodes` row on subject creation — hard
rule 12 names school/class/section only. A subject teacher's authority comes from
`section_teacher_assignments` (ADR-012), checked by `checkSubjectAccess` (S3), not by
`can()`. Do not try to encode subjects as scope nodes to "reuse" the machinery.

**Every academic table carries BOTH `organizationId` and `schoolId`.** The
denormalisation is not redundancy: `scopeWhere()` needs an `organizationId` column on
the table it filters, and hard rule 1 means every query here goes through it. Copy the
`academic.ts` header comment's rationale, don't rediscover it.

**`sections` is the deepest authorization node** and a NEW row every academic year
(same letter, different children — hard rule 6's sibling reasoning). Enrollment is
therefore year-scoped by construction: enroll the student into a *section*, which
already pins the year.

**Two kinds of uniqueness live outside Drizzle** in hand-written migration SQL
(`EXCLUDE USING` on `academic_years`): drizzle-kit does not model them and will DROP
them if the migration is ever regenerated. After ANY migration change, re-run
`pnpm db:verify` — it proves the constraints actually reject the rows they target.

**The integration fixture is tenancy-isolated by slug prefix** (`authz-itg-a/b` in
`packages/trpc/src/integration/world.ts`) and idempotent (find-or-create on natural
keys; nothing deleted — hard rule 2). New entities for S1–S4 follow the same shape.

---

## Locked decisions

| Decision | Choice |
|---|---|
| Commit cadence | One layer per commit. Tests ride with the commit that owns the code; cross-layer test/seed work is its own commit. |
| Who commits | The owner. The agent prepares messages + file lists and never touches git history. (Now in AGENTS.md.) |
| Slice order | S1 → S2 → S3 → S4. S3's resolver is a hard prerequisite for S4. |
| `checkSubjectAccess` home | Decided by S3.1's ADR. Leaning: services (it reads `section_teacher_assignments`), with an authz-side helper if a pure gate piece falls out. |
| Enrollment mutation | None, ever (hard rule 6). Promotion inserts a new row. |
| Task boundaries land in docs | Each slice ends with a TASKS.md-only commit (the `.5` chunks). |
| Drift on the commit ledger | Allowed ±2 (migration fixes, owner-requested squashes). Flag before it happens. |

---

## Slice S1 — subjects

### S1.1 · `feat(db): subjects table` — ✅ DONE (commit 1, folded with preconditions)

- [x] Add `subjects` to `packages/db/src/schema/academic.ts`:
      - `id` uuid PK defaultRandom; `organizationId` + `schoolId` denormalised
        (see hard context); FKs to `organizations` / `schools`.
      - `name` varchar(150) notNull — "Physics", "हिन्दी". Unique per school
        (`subjects_school_name_uq`), per reference `uq_subject_school_name`.
      - `shortName` varchar(20) — "Phy", printed on timetables.
      - `code` varchar(20) — the school's own subject code. Board codes (CBSE 041 etc.)
        arrive with `system_subject_catalog`, whose FK is DEFERRED until that table
        exists (the reference itself adds cross-table FKs in a later ALTER).
      - `category` pgEnum `subject_category`: `scholastic` / `coscholastic` /
        `vocational` / `language`, notNull default `scholastic` (lowercase — house enum
        values are lowercase).
      - `countsTowardResult` boolean notNull default true — DOMAIN.md: false excludes
        the subject from totals (co-scholastic, activity subjects).
      - `isGradedOnly` boolean notNull default false — no numeric marks, grade entered
        directly (Art, PE).
      - `isActive` boolean notNull default true (hard rule 2; matches `classes`).
      - `createdAt`/`updatedAt` `timestamp({ withTimezone: true })` per house pattern.
      - Indexes: unique `(schoolId, name)`; index on `organizationId` for
        `scopeWhere`-shaped filters; index on `schoolId`.
      - `subjectRelations` added (org + school), matching the file's relation pattern.
- [x] `pnpm db:generate` → `0003_lowly_sentinel.sql` — reviewed: CREATE TYPE enum,
      CREATE TABLE, 2 FKs, 3 indexes. **Purely additive; zero drops.**
- [x] Re-run `pnpm db:verify` after `pnpm db:migrate` — all 3 CHECK + 2 EXCLUDE
      constraints alive and biting; no naive timestamps; rollback clean.

**Verify** ✅ `pnpm check-types` 8/8 green; `pnpm db:verify` all green; preconditions
closed: seed idempotent on a second run, `pnpm smoke:authz` green at baseline
(live API, then stopped).

### S1.2 · `feat(contracts,services): subjects` — ✅ DONE

- [x] `packages/contracts`: `subject.contract.ts` — drizzle-zod derived, same shape as
      the academic contracts (select / create / update). `isActive` omitted from both
      input schemas: closing a subject is `subject.deactivate`, not a patch, so hard
      rule 2 is not bypassable by a generic update (same reasoning as the class
      contract). Barrel wired into `index.ts`.
- [x] `packages/services`: `subject.service.ts` — class + exported singleton, **no HTTP
      awareness**; every query takes `DataScope` as a required argument (hard rule 1).
      List takes the plural `scopes` (multi-branch grants); create/update/deactivate take
      the single resolved scope. No transaction and no `scope_nodes` row — subjects are
      not in the scope tree; duplicate names are refused by the unique index (ADR-022),
      not pre-checked. Ships `getSubjectOwnerId`, the B6 adapter, same shape as
      `getAcademicYearOwnerId`. `atSchoolLevel` + `requireSchoolId` are now EXPORTED from
      `academic.service.ts` (one definition; subjects are school-level for the same
      entity-shape reason years are). Barrel wired into `index.ts`.

**Verify** ✅ `pnpm check-types` 8/8 green; `pnpm test` green (no new unit tests this
chunk — the service's behaviour is exercised by the integration suite in S1.4); no
imports from `@repo/trpc` or better-auth anywhere in the two new files.

### S1.3 · `feat(trpc): subject router` — ✅ DONE

- [x] `packages/trpc/src/routers/subject.router.ts` — copies the YEAR router's shape
      (subjects are school-level, not scope nodes): `staffListProcedure("subject:read")`
      for the list (ADR-017 permissive), `byId` with `resolveSubjectOwner` (the B6
      adapter, `gate: "overlap"` per ADR-028), create with the B5 explicit-`schoolId`
      input, update/deactivate owner-resolved with the default COVER gate (teachers hold
      no write permissions, so the overlap question never arises on a write).
- [x] **NO `read_history` gate** — flagged as the plan asked: subjects are not
      year-scoped, so there is no history to gate. Recorded in the router's docstring;
      if the catalogue is ever year-differentiated, that is a new decision.
- [x] Permission strings — **already existed**: `subject: ["create","read","update",
      "delete"]` was in `RESOURCE_ACTIONS` from the start, and DEFAULT_ROLE_PERMISSIONS
      already grants the full set to `principal` and `subject:read` to `class_teacher`
      and `subject_teacher` (written forward-looking). **No authz changes needed.**
- [x] Every procedure carries `.meta({ openapi })` + `.output()` — 5 REST endpoints.
- [x] Wired into `router.ts` as `subject` (root level, like `school`).

**Verify** ✅ `pnpm check-types` 8/8; `pnpm test` green; `check:builders` green (no
ungated builders, no overlap-gated mutations); `check:openapi` green — 5 new
`/subjects` endpoints listed.

### S1.4 · `test: subjects in integration, smoke, and seed` — ✅ DONE

- [x] **Integration fixture (`world.ts`)** — `findOrCreateSubject` helper; four subjects
      across the three schools (A1: Mathematics + Physics, A2: Mathematics, B1:
      Mathematics) so the same-name-across-branches collision is a live row set. World
      fields exported: `subjectA1MathId`, `subjectA1PhysicsId`, `subjectA2MathId`,
      `subjectB1MathId`.
- [x] **`authz.integration.test.ts`** — 5 new tests in a `subjects — the school-level
      catalogue` block (33 total, up from 27): per-role exact lists (incl. the section
      teacher widening to school level), the sibling-branch same-named subject never
      reaches A1's list, outsider org 403, branch-boundary `byId` NOT_FOUND in the gate,
      cross-org id indistinguishable from nonexistent. Probes mirror `subject.list` /
      `subject.byId` with the same builder options as the real router.
- [x] **`seed.ts`** — `findOrCreateSubject` (idempotent, through the service); Mathematics
      + Physics in school A, the SAME-named Mathematics in school B (the negative
      control); printed in the login summary.
- [x] **`smoke-authz.ts`** — 4 direct assertions + matrix cells: principal sees A's
      subjects incl. both seeded rows, omits B's same-named subject, CANNOT read B's
      subject by id (NOT_FOUND), subject_teacher widens to her school. Matrix: `subject.list`
      for all 4 logins (clipped callers: every row schoolId === A), `subject.byId` ×
      principal on B's subject → NOT_FOUND (non-vacuity proven by the principal's
      positive list).

**Verify** ✅ `pnpm check-types` 8/8; seed idempotent (subjects "exists" on re-run);
`pnpm test:integration` 33 passed (was 27); `pnpm smoke:authz` all-pass against a live
API incl. all new subject rows (server started, then stopped).

### S1.5 · `docs: TASKS.md — slice 1 done` — ✅ DONE

- [x] "Resume here" rewritten: S1 complete summary (4 commits, key decisions), the
      verification numbers (integration 33, was 27), and the authoritative next-up order
      (S2 → S3 → S4 → S5) pointing at this plan file. The stale "Phase 2, the rest"
      paragraph and a duplicated authz-refactor line were cleaned up; the security-review
      block keeps its own heading.
- [x] The Phase-1 leftover "subject-level access is not enforced" now records its
      prerequisite as met (`sections` + `subjects` exist) and names slice S4 as its
      landing spot.

**Verify** ✅ docs-only; `pnpm check-types` 8/8 confirmed unchanged (see S1.4 run).

---

## Slice S2 — the teaching-assignment layer (csm + sta)

Two tables, one workflow: map subjects onto classes for a year, then staff the sections.
Amended into the plan 2026-08-29 — the original plan omitted both, which left the access
slice (S4) reading a table that didn't exist. Deferred from the reference on purpose:
`subject_groups` (and csm's nullable `subject_group_id` FK with it — CBSE grouping is an
exams-phase need), `system_subject_catalog` (needs a platform-seeding story; subject
codes stay school-local until then), `subject_name_history`, `student_subject_enrollments`
(auto-generated from csm; needed for electives, not the core flow).

- [x] **S2.1 `feat(db): class_subject_mappings + section_teacher_assignments`** — one
      migration (`0004_quick_blizzard.sql`), one layer. **DONE**:
      - `class_subject_mappings`: org+school denormalised; FKs to `academic_years` /
        `classes` / `subjects`; unique `(academicYearId, classId, subjectId)`
        (`class_subject_mappings_year_class_subject_uq`); `isElective` boolean default
        false (`is_elective` — the checkbox for "core subjects every child takes");
        `sequenceNumber` smallint default 0; `createdBy` (house pattern, CONVENTIONS.md).
        No scope node. `subject_group_id` deferred — no `subject_groups` table yet
        (exams-phase), the reference itself adds such cross-table FKs by later ALTER.
      - `section_teacher_assignments`: org+school denormalised; FKs to `sections` /
        `academic_years` / `user`; `role` pgEnum `teacher_assignment_role`
        (`class_teacher` / `subject_teacher` / `co_teacher` / `activity_teacher`,
        lowercase); `subjectId` uuid NULLable with a **Drizzle-modeled** CHECK
        `sta_subject_matches_role` — populated iff role = `subject_teacher`;
        `effectiveFrom` date notNull default `CURRENT_DATE`; `effectiveTo` date nullable
        (NULL = currently active). **Append-on-change** (the one sanctioned UPDATE, a
        service concern — S2.2 `endAssignment` closes + inserts; the tiny-bit partial
        index just serves "who teaches now"). Partial index
        `section_teacher_assignments_active_idx` on `(sectionId) WHERE effectiveTo IS
        NULL` (reference table 11). Both tables carry `createdAt`/`updatedAt`
        `timestamptz` (updatedAt covers the `effectiveTo` UPDATE; reference had only
        created_at). The **cross-tenant parent-smuggling** decision is deliberately a
        S2.2 service concern (scope-checked parent re-read inside the transaction).

- [x] **S2.2 `feat(contracts,services): the assignment layer`** — one service
      (`assignment.service.ts`, `assignmentService` singleton) covering both tables:
      - **Mappings**: `createClassSubjectMapping` (transaction — re-reads year/class/
        subject through the caller's scope, closing the cross-tenant-parent-smuggling
        hole the plan flagged), `listClassSubjectMappings(scopes, academicYearId,
        classId)`, `getClassSubjectMappingById`, `updateClassSubjectMapping`
        (isElective/sequenceNumber only; the year/class/subject triple is not
        patchable). **No remove-procedure** — a wrong mapping is fixed structurally,
        not by mutating a row into meaning something else (and `isElective` is a real
        flag, not a delete tombstone). Both B6 adapters (`getClassSubjectMapping OwnerId`,
        `getSectionTeacherAssignment OwnerId`) included.
      - **Assignments**: `createSectionTeacherAssignment` (transaction — verifies the
        section belongs to the caller's school AND that `academicYearId` matches the
        section's own; subject presence/absence is the database's CHECK, not re-checked);
        `listSectionTeacherAssignments` (open rows only, `isNull(effectiveTo)` — served
        by the partial index), `getSectionTeacherAssignmentById`, and **`endAssignment`
        (the one sanctioned UPDATE)** — closes the open row, optionally inserts a
        successor, atomically.
      - Contracts: `assignment.contract.ts` (mapping + assignment select/create/update
        schemas; NO assignment update schema — ending is a dedicated operation, so a
        generic PATCH cannot bypass append-on-change); wired into both barrels.
- [x] S2.3 `feat(trpc): assignment + mapping routers` — **DONE (2026-08-30)**.
      Permission namespaces: `subject_mapping.*` and `teacher_assignment.*` (see the
      sanctioned authz set below). Router at `packages/trpc/src/routers/assignment.router.ts`:
      `assignment.subjectMapping.*` (list/byId/create/update) and
      `assignment.teacherAssignment.*` (list/byId/create/end — `end` is the one
      sanctioned append-on-change UPDATE, POST to `/teacher-assignments/{id}/end`).
      Single-resource reads ask overlap (ADR-028), mutations stay strict cover, every
      procedure carries OpenAPI meta + output, no `scope_nodes` writes. Registered in
      `router.ts` under `assignment`. Verify ✅ check-types 8/8; check:openapi lists the
      8 new REST endpoints; check:builders green; unit 86+24+38; integration 33/33.
      **NOT yet covered by integration/smoke/seed — that is S2.4.**

      **Authz diff — the complete, sanctioned set (owner-reviewed 2026-08-30):**
      `RESOURCE_ACTIONS` + `subject_mapping`/`teacher_assignment` (create/read/update,
      no delete — mappings are structurally corrected, assignments are ended);
      + both in `RESOURCE_CATEGORIES.Structure`; `RESOURCE_MIN_SCOPE` +2 entries
      (advisory-only, never enforced in `can()`); `DEFAULT_ROLE_PERMISSIONS`: principal
      + both triples, class_teacher + `subject_mapping:read`, subject_teacher
      + `subject_mapping:read` + `teacher_assignment:read`; org_admin is covered via
      `ALL_PERMISSIONS`. **Nothing else.**
      A wider matrix rewrite found in the working tree was REJECTED as an unrequested
      role-policy change and removed: vice_principal gutted ~20 grants including
      `academic_year:read_history` (contradicts ADR-024's seeded list),
      class_teacher − `student:export`/`enrollment:read` with its comment replaced by
      subject_teacher's, subject_teacher widened with `attendance:update/export`,
      `marks:export`, `report_card:read`, staff_coordinator + `teacher_assignment:*`.
      If any of that policy is wanted, re-propose it as its OWN owner-approved commit
      with an ADR/decision note — never as a rider on a router chunk. No test pins
      the matrix, so a matrix change cannot be caught by the suite; treat every
      `defaultPermissions.ts` diff as policy.
- [x] S2.4 `test: the assignment layer in integration, smoke, and seed` — **DONE
      (2026-08-30)**. Integration **50** (was 33): exact per-role lists for mappings and
      open assignments; the sibling-branch and cross-org negatives; the two-layer
      refusal structure (the GATE refuses a parent the caller does not cover — the
      create input names it top-level, so the builder addresses it; the SERVICE
      re-read refuses what the gate cannot see — a smuggled subject, a year that is
      not the section's — including for an org admin whose coverage passes the gate);
      the end flow (close + successor on one transaction, double-end CONFLICT). Smoke
      all-pass live over HTTP: 9 direct assertions plus `subject_mapping` /
      `teacher_assignment` matrix cells for all four seeded roles. Seed: the
      subject_teacher persona finally has assignment rows to her name (6-A's subject
      fact + the homeroom fact), Class 6's Mathematics/Physics mappings, and a
      school-B class + section + mapping for the cross-branch denials.
      **Its first run caught two real S2.2 bugs** — see the fix commit: every parent
      re-read compiled scope columns from the WRONG table (missing-FROM-clause SQL
      error on any create), and `endAssignment`'s successor insert ran in an
      independent transaction. Both fixed; five new `SERVICE_TRANSLATIONS` entries
      word the refusals.
- [ ] S2.5 `docs: TASKS.md — slice 2 done`

---

## Slice S3 — terms

Same shape as S1. Confirmed at slice start against `docs/DOMAIN.md` + the reference
SQL: terms stand ALONE (no separate term-structure table). `terms.result_mode`
(`cumulative` | `terminal`) is what the exam computation chain reads, and
`weightage` carries each term's share of the annual result.

- [x] S3.1 `feat(db): terms table` — **DONE (2026-08-30)**. `0005_bitter_hydra.sql`,
      purely additive (enum + table + 4 FKs + 4 indexes, zero drops). org+school
      denormalised; FKs to `academic_years` / `user` (createdBy); `name` varchar(100);
      `sequenceNumber` smallint; dates; `term_result_mode` enum (lowercase house
      style) default `cumulative`; `weightage` numeric(5,2) default 100.00 — the
      year-sums-to-100 rule is a SOFT invariant (a CHECK demanding it would make
      adding the second term impossible); the term UI owns the sum. Drizzle-visible
      CHECKs: `terms_end_after_start`, `terms_weightage_range`; unique
      `(academicYearId, sequenceNumber)` — per YEAR, every year restarts at Term 1.
      **Hand-written:** `terms_dates_within_year_trg` — a term's dates must sit
      INSIDE its year's, a cross-table rule no CHECK can express. A trigger beside
      the EXCLUDE block, marked for regeneration, reporting itself via
      `USING CONSTRAINT` so `translateErrors` words it (entry added to errors.ts)
      and `db:verify` can name it. `pnpm db:verify` extended to **34** assertions:
      the trigger bites on INSERT and UPDATE, boundary dates (a term spanning the
      whole year) are accepted, the sequence key is proven per-year, and the
      weightage bounds are pinned on both sides. Verify ✅ check-types 8/8;
      db:verify all green.
- [ ] S3.2 `feat(contracts,services): terms`
- [ ] S3.3 `feat(trpc): term router` — creating a term does NOT touch `scope_nodes`.
- [ ] S3.4 `test: terms in integration, smoke, and seed`
- [ ] S3.5 `docs: TASKS.md — slice 3 done` (add `terms` to the resume-here schema line)



---

## Slice S4 — subject-level access + the student owner-resolver

- [ ] **S4.1 ADR — GATE.** `checkSubjectAccess`: where it lives (services vs authz), its
      signature, how mark-entry procedures compose it with `staffProcedure` (a second
      gate on the same context, or a new builder?), and its failure mode (FORBIDDEN vs
      NOT_FOUND — an unassigned section should ideally be indistinguishable from a
      nonexistent one). Reads `section_teacher_assignments`, which exists as of S2.
      **Owner accepts before S4.3 moves.**
- [ ] S4.2 `feat(trpc): student owner resolver` — in `trpc.ts` on the B6 pattern
      (`resolveYearOwner` is the template): owned `studentId`s from
      `student_portal_access`. Unit tests in `trpc.test.ts` — pure gate logic, no DB.
- [ ] S4.3 `feat(authz,services): checkSubjectAccess` — per the accepted ADR + unit
      tests for the pure part. ADR-012's boundary applies: `role_assignments` is the
      authorization authority; `section_teacher_assignments` records the timetable fact.
- [ ] S4.4 `test: subject-level denial in integration + smoke` — the phase-1 leftover
      closes: a `subject_teacher` scoped to one section is denied the adjacent
      section's subject, and a SubjectTeacher WITHOUT the matching assignment row is
      denied the subject inside her own section.
- [ ] S4.5 `docs: TASKS.md — slice 4 done` (tick the phase-1 leftover checkbox)

---

## Slice S5 — enrollments (LAST — needs S4.2)

- [ ] S5.1 `feat(db): student_enrollments table` — per `docs/DOMAIN.md`; year-scoped
      via the section FK; hard rule 6: the service only inserts and sets `status`, it
      never rewrites history.
- [ ] S5.2 `feat(contracts,services): enrollments` — staff track takes `DataScope`;
      the student track reads via owned `studentId` only.
- [ ] S5.3 `feat(trpc): enrollment router` — staff (`enrollment.*`) + portal
      (`portal.*`) namespaces.
- [ ] S5.4 `test: enrollments in integration, smoke, and seed`
- [ ] S5.5 `docs: TASKS.md — Phase 2 complete`

---

## Commit ledger (owner commits; agent prepares messages)

This ledger is the map; the chunks above are the work. If reality drifts (a migration
fix commit, an owner-requested squash), update the ledger and flag it in the summary.

| # | Commit | Chunk |
|---|---|---|
| 1 | `feat(db): subjects table` + AGENTS.md rule + this plan file (owner chose to fold the docs in) — **COMMITTED** | preconditions + S1.1 |
| 2 | `feat(contracts,services): subjects` | S1.2 |
| 3 | `feat(trpc): subject router` | S1.3 |
| 4 | `test: subjects in integration, smoke, and seed` | S1.4 |
| 5 | `feat(db): class_subject_mappings + section_teacher_assignments` + S1.5's docs (owner folds them, as with commit 1) | S2.1 (+ S1.5 docs folded in) |
| 7 | `feat(contracts,services): the assignment layer` | S2.2 |
| 8 | `feat(trpc): assignment + mapping routers` | S2.3 |
| 9 | `test: the assignment layer in integration, smoke, and seed` | S2.4 |
| 10 | `docs: TASKS.md — slice 2 done` | S2.5 |
| 11–15 | terms slice (same five shapes) | S3.1–S3.5 |
| 16 | ADR + `feat: checkSubjectAccess` | S4.1 + S4.3 |
| 17 | `feat(trpc): student owner resolver` | S4.2 |
| 18 | `test: subject-level denial in integration + smoke` | S4.4 |
| 19 | `docs: TASKS.md — slice 4 done` | S4.5 |
| 20–24 | enrollments slice (same five shapes) | S5.1–S5.5 |

Drift notes:
- 2026-08-29: 20 → 19 commits — the owner folds the AGENTS.md rule and this plan file
  into the S1.1 commit instead of a separate docs commit.
- 2026-08-29: 19 → ~24 commits — new slice S2 (the teaching-assignment layer). The
  original plan omitted `class_subject_mappings` and `section_teacher_assignments`,
  which left the access slice reading a table that didn't exist and marks entry with no
  data source. Renumbered: terms → S3, access → S4, enrollments → S5.
- 2026-08-30: +1 fix commit between rows 8 and 9 — S2.4's first integration run exposed
  two latent S2.2 bugs (wrong-table scope columns in every parent re-read; the
  `endAssignment` successor insert in a nested independent transaction) and the five
  error translations the new tests pin. Rows 9 onward shift by one.




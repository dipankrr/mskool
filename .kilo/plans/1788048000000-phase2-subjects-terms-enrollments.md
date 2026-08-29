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

### S1.4 · `test: subjects in integration, smoke, and seed`

- [ ] `world.ts`: subjects for both fixture orgs' schools (idempotent find-or-create on
      `(schoolId, code)`).
- [ ] `authz.integration.test.ts`: role-matrix rows for the subject endpoints + the
      cross-tenant denial — a subject in org A is indistinguishable from nonexistent to
      org B.
- [ ] `seed.ts`: subjects in school A (and B, so the smoke negative controls have
      something to be denied).
- [ ] `smoke-authz.ts`: principal lists school A's subjects but gets NOT_FOUND for
      school B's by id; class_teacher sees none of the subject-write surface.

**Verify** `pnpm test:integration` green (count grows); `pnpm smoke:authz` green (count
grows); seed idempotent on a second run.

### S1.5 · `docs: TASKS.md — slice 1 done`

- [ ] Update the "resume here" section: S1 complete, point at this plan file, note the
      permission set chosen in S1.3 and whether `read_history` was split.

**Verify** `pnpm check-types` still green (docs-only, but cheap to confirm).

---

## Slice S2 — the teaching-assignment layer (csm + sta)

Two tables, one workflow: map subjects onto classes for a year, then staff the sections.
Amended into the plan 2026-08-29 — the original plan omitted both, which left the access
slice (S4) reading a table that didn't exist. Deferred from the reference on purpose:
`subject_groups` (and csm's nullable `subject_group_id` FK with it — CBSE grouping is an
exams-phase need), `system_subject_catalog` (needs a platform-seeding story; subject
codes stay school-local until then), `subject_name_history`, `student_subject_enrollments`
(auto-generated from csm; needed for electives, not the core flow).

- [ ] **S2.1 `feat(db): class_subject_mappings + section_teacher_assignments`** — one
      migration, one layer. Full column spec written when the chunk starts; the shape:

      - `class_subject_mappings`: org+school denormalised; FKs to `academic_years` /
        `classes` / `subjects`; unique `(academicYearId, classId, subjectId)` per the
        reference `uq_csm_class_subject`; `isElective` boolean default false (true =
        not auto-assigned to every student); `sequenceNumber` smallint default 0
        (report-card display order). No scope node. **Cross-tenant parent smuggling
        applies here** (the section-service docstring's warning): a class in school B
        pointing at a subject in school A is unrepresentable only via composite FKs or a
        scope-checked parent re-read inside the transaction — decide while writing.
      - `section_teacher_assignments`: org+school denormalised; FKs to `sections` /
        `academic_years` / `user`; `role` pgEnum `teacher_assignment_role`:
        `class_teacher` / `subject_teacher` / `co_teacher` / `activity_teacher`
        (lowercase house values; the reference capitals them, we don't); `subjectId`
        uuid NULLable with a CHECK — populated iff role = `subject_teacher`;
        `effectiveFrom` date notNull default today; `effectiveTo` date nullable
        (NULL = current). **Append-on-change**: ending or replacing an assignment closes
        the row (`effectiveTo` = today) and inserts the successor — the one sanctioned
        UPDATE, documented as such. Partial index on `(sectionId) WHERE effectiveTo IS
        NULL` per the reference.

- [ ] S2.2 `feat(contracts,services): the assignment layer` — one service covering both
      tables (they are one workflow: map, then staff) or two mirroring the tables;
      decided while writing. Ending an assignment is NOT a generic patch — a dedicated
      `endAssignment` (and `reassign` = close + insert in one transaction).
- [ ] S2.3 `feat(trpc): assignment + mapping routers` — permission namespaces decided
      while writing (leaning `subject_mapping.*` and `teacher_assignment.*`); openapi
      meta + output on every procedure; no `scope_nodes` writes anywhere.
- [ ] S2.4 `test: the assignment layer in integration, smoke, and seed` — cross-tenant
      denial (org A cannot map or assign into org B's classes/sections); the seed's
      subject_teacher persona finally gets her assignment rows (she has been scoped to
      6-A with no assignment to her name since the authz plan).
- [ ] S2.5 `docs: TASKS.md — slice 2 done`

---

## Slice S3 — terms

Same shape as S1. Before S3.1, confirm against `docs/DOMAIN.md` whether the domain
models a separate term-structure table or terms alone — the migration depends on it.
Checkboxes are written when the slice starts — do not pre-tick, do not pre-write.

- [ ] S3.1 `feat(db): terms table(s)` — keyed to `academicYearId`; term dates CHECKed
      within the parent year's range (in Drizzle if expressible, else hand-written SQL
      beside the existing `EXCLUDE` block).
- [ ] S3.2 `feat(contracts,services): terms`
- [ ] S3.3 `feat(trpc): term router` — creating a term does NOT touch `scope_nodes`.
- [ ] S3.4 `test: terms in integration, smoke, and seed`
- [ ] S3.5 `docs: TASKS.md — slice 3 done`



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
| 5 | `docs: TASKS.md — slice 1 done` | S1.5 |
| 6 | `feat(db): class_subject_mappings + section_teacher_assignments` | S2.1 |
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




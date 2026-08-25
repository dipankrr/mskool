# mskool — authz API-shape refactor + safety nets

Three workstreams: **A** safety nets (independent, start here), **B** scope encoding (ADR-gated),
**C** barrel hygiene (independent).

The authz core is **not** changing: `can()` / `getDataScopes()` / `scopeWhere()` internals,
`scope_nodes` encoding (ADR-015), the two tracks (ADR-005), cache TTLs (ADR-016). No DB
migrations anywhere in this plan.

## Goal

Close the gap that let a client-side scope-assembly bug reach a rendered page, then make the
transport say what it means: single-resource endpoints address their own resource, creates name
their parent, and a single-row read asks whether the row is inside a grant.

---

## Workflow protocol — read before starting

**One chunk per turn. The user commits, not you.**

1. Implement **exactly one** chunk. Do not begin the next one.
2. Run that chunk's **Verify** steps.
3. Tick that chunk's boxes in this file as part of the same diff.
4. Run `git status` and `git diff --stat`, and summarise what changed and why.
5. Propose the commit message from that chunk verbatim. If the chunk grew, say so and amend the
   message to match what actually landed.
6. **Stop and wait.** The user reviews the diff and commits.

**Never run** `git add`, `git commit`, `git push`, `git checkout`, or any history-rewriting
command. Never chain two chunks in one turn, even if a chunk is small.

Every chunk must leave `pnpm check-types` green and the app bootable. If a chunk cannot be
finished cleanly, stop and report rather than leaving a broken intermediate state.

---

## Execution order — do not read this file top-to-bottom as an order

Chunk IDs are stable workstream labels (A1, B4, …), not a sequence.

```
A2  ──── FIRST. The net. Everything after it is refactoring under test.
A3  ──── close behind; guards the builder surface
A1 A4 A5 A6 ──── independent, any order (see the A1 ↔ A5 note in each)
B1 B2       ──── independent, zero/low risk (B2 is a live bug)
B3          ──── ADRs. Gates B4–B7. Owner accepts or rejects before code moves.
  ├─ B4 ── B5
  ├─ B6 (deadline: before the enrollment slice) ── B7 non-node half
  └─ B7 node half ──── needs only B3's decision
C   ──── independent, any time
```

---

## Preconditions (no diff; do once)

- [x] `pnpm dev` (web :3000, api :4000) and `pnpm db:seed`.
- [x] Saved auth states exist from the frontend plan: `auth-orgadmin.json`,
      `auth-principal.json`, `auth-classteacher.json` (gitignored). A2 adds a fourth.
      (A2's global-setup now refreshes all four over HTTP on every run.)
- [x] `pnpm smoke:authz` passes at its current baseline before anything changes.

---

## Hard context an implementer must know

**The bug this plan is a reaction to.** `d8eca60` fixed three separate client-side defects — the
`useClass` rewrite, the nav permission filter, and the query `enabled` gate. The API was correct
throughout: it 403'd exactly the input it was given. **A roles × procedures API matrix cannot
catch that class of bug.** Only the rendered path can. This is why A2 has a browser half and why
it lands first.

**`RESOURCE_MIN_SCOPE` is advisory, in writing.** `packages/authz/src/roles.ts:80-84`:
*"Used by the permissions editor to hide irrelevant rows … Advisory only, never enforced in
`can()`."* Do not treat it as an invariant. See B3.

**The 54-test count is a runtime count, not a grep count.** `packages/authz/src/scope.test.ts`
defines a 13-row truth table at `:90-111` and iterates it at `:113` with one textual `it(`.
`can.test.ts` has 19 textual `it(` and no generating loops. So 23 textual − 1 + 13 = 35, plus 19,
= **54** — the number in `docs/TASKS.md:62`, `:279`, `:507`. A `grep -c 'it('` undercounts to 42.
**Do not "correct" 54 to 42.** If the number changes, get it from vitest.

**`publicProcedure` is an exported bare builder.** `packages/trpc/src/trpc.ts:24` —
`export const publicProcedure = t.procedure;`. Its only consumer is `health.router.ts:6`.
(The REST health check at `apps/api/src/server.ts:92` is a plain Express route and unrelated.)

**tRPC's `_def` does not record which builder made a procedure.** `appRouter._def.procedures`
exists but is declared in `unstable-core-do-not-import.d.mts`, and a procedure's `_def` carries
`type`, `inputs`, `meta` and an array of *anonymous* middleware functions. Walking procedures
cannot prove provenance without tagging middleware first. See A3.

**The seed has no sections.** The only `sectionId` mentions in `apps/api/scripts/seed.ts` are
`null` inside scope-context helpers (`:442`, `:448`). No section rows, no section `scope_nodes`.
A section-scoped persona therefore has to be created before she can be tested.

**Hard rule 12 applies to the seed.** Creating a section must also insert its `scope_nodes` row in
the same transaction. Go through the section service rather than inserting directly.

---

## Locked decisions

| Decision | Choice |
|---|---|
| What lands first | A2, the net. Refactor only under test. |
| Ungated builders | Closed **structurally** (un-export), then guarded by a static check. Not by runtime introspection. |
| `organizationId` in inputs | **Stays.** Keeps `can.ts:34`'s cross-tenant check meaningful. Org-derived-from-node is a recorded future refinement only. |
| Builder count | Three, unchanged. `addressedBy` is an **option** on `staffProcedure`, not a fourth builder. |
| ADR timing | ADRs are written and accepted **before** the code they govern. B3 gates B4–B7. |
| Migration cadence | One router per commit, smoke after each. |
| `useClass` workaround | Survives until **B7**. It is what protects the section-scoped teacher until permissive reads land. |
| Vitest vs Playwright | Vitest owns `*.test.ts`. Playwright owns `*.spec.ts` under `e2e/`. `pnpm test` = vitest; `pnpm test:e2e` = Playwright (needs servers + seeded DB). |
| Deadlines | Tied to triggers, not dates. B6 is due before the enrollment slice. |

---

## Workstream A — safety nets

### A2 · The net, both halves — LAND FIRST

- [x] **Seed prerequisite.** In `apps/api/scripts/seed.ts`, after `classA`:
      - create **one section** under Class 6 in school A's current session, **through the section
        service** so the `scope_nodes` row lands in the same transaction (hard rule 12);
      - create a `subject_teacher` user via the existing `findOrCreate…` helper;
      - `findOrCreateAssignment(subjectTeacherUser.id, organization.id, "subject_teacher",
        "section", sectionA.id, adminUser.id)` — same shape as the `class_teacher` grant at
        `:484-491`;
      - add her to the `invalidateUserAuthCache` block at `:494-496`;
      - add her line to the printed login summary near `:511`.
- [x] **API half.** Extend `smoke-authz.ts` with a roles × procedures baseline matrix: the four
      logins × `me.get`, `school.list`, `year.list`, `year.current`, `class.list`, `class.byId`,
      `section.list`, plus one mutation each. Pin expected 200 / 403 / 404 so the transport
      changes in B4–B5 cannot silently alter authorization outcomes.
- [x] **Browser half.** Add `@playwright/test` to `apps/web`. One spec iterating the four logins ×
      every route, asserting: no permission-error text, no console error, non-empty `main`.
      Use the saved auth states; add `auth-subjectteacher.json`.
- [x] Wire `test:e2e` as its own script. Do **not** put the browser spec behind `pnpm test` — it
      needs a running web server, a running API and a seeded database.
- [x] Confirm vitest's `include` does not pick up `e2e/**` and Playwright's `testDir` does not pick
      up `*.test.ts`.

**Acceptance criterion — per fix, not per commit.** `d8eca60` bundles three fixes, so reverting
the whole commit only proves aggregate coverage. Each must be individually pinned:
- revert **only** the `useClass` rewrite → the `class_teacher` class-detail assertion fails;
- revert **only** the nav permission filter → the nav assertion fails for `subject_teacher` and
  `class_teacher`;
- revert **only** the `enabled` gate → the console-error assertion fails.

**Verify** `pnpm db:seed` idempotent on a second run; `pnpm smoke:authz` green with the new
matrix; `pnpm test:e2e` green for all four logins; the three reverts above each fail.
All four verified 2026-08-25.

**A2 outcome notes (facts that supersede assumptions above):**
- `subject_teacher × class.byId` is **200 today**, not the anticipated throw: she addresses her
  own section node, `can()` passes at that node, and `getClassById` widens a section scope to
  class level (`atClassLevel`) before filtering. The strict-read gap for section-scoped callers
  is therefore an *addressing* problem (org/class nodes 403 her), not a service-widening one —
  relevant to B4/B7 design. The matrix pins both of her cells (byId@section-node and list) at 200.
- The dev fixture has drifted from the seed (a third school "EAST", extra classes, sections B–D
  in Class 6) from manual UI testing. Matrix shape checks are property-based for org-wide roles
  ("contains the seeded rows") and EXACT-count only for clipped roles, where the count is itself
  the tenancy property.

Note that `subject_teacher` passes **today**: `useClass` reads `class.list`, and `listClasses`
widens her section grant to class level, so Class 6 is in her list. The matrix asserts 200 now,
200 after B7, and turns red the moment someone deletes the workaround early. That is the point.

```
test(web): smoke every route as every seeded role

d8eca60 fixed three client-side defects that no test could have caught: the API
correctly refused the input it was given, and the wrong input was assembled in
the browser. A roles-by-procedures matrix at the API cannot see that class of
bug, so this adds both halves — a baseline matrix that pins authorization
outcomes while the transport is refactored, and a browser spec that walks every
route as every seeded role.

Adds a fourth seeded login to make the net meaningful: a section-scoped
subject_teacher, who is the modal user of the real product and the reason
permissive single-row reads are on the roadmap at all. The seed had no sections
whatsoever, so this also creates one through the section service, which keeps
the scope_nodes insert in the same transaction as required.

Each of d8eca60's three fixes is individually revertible into a failing
assertion, rather than only the commit as a whole, so the suite covers each
defect rather than their sum.
```

### A3 · Close the ungated-builder hole, then guard it

- [x] Inline `t.procedure` in `health.router.ts` and **delete the `publicProcedure` export** from
      `packages/trpc/src/trpc.ts:24`. With one consumer, this makes an ungated staff endpoint
      *unconstructible* from the package's exported surface rather than merely detectable.
      (As done: the health router moved INTO `trpc.ts` beside the builders — exporting `t` or a
      renamed bare builder would have reopened the hole. `routers/health.router.ts` is gone.)
- [x] Add a static guard as a script alongside `smoke:authz` / `check:openapi` (preferred — no new
      test harness in `packages/trpc`): assert no file under `packages/trpc/src/routers/`
      references `t.procedure` or `publicProcedure`. No allow-list needed once health is inlined.
      (`apps/api/scripts/check-builders.ts`, root `pnpm check:builders`; matches ANY `.procedure`
      access so renamed locals like `t2.procedure` cannot slip past.)
- [x] Do **not** implement this by walking `appRouter._def.procedures`. It cannot prove builder
      provenance (see Hard context) and depends on `unstable-core-do-not-import`.

**Verify** non-vacuous: temporarily add an ungated procedure under `routers/` in a scratch working
tree and watch the guard fail. `pnpm check-types`; `pnpm smoke:authz` unchanged.
All three verified 2026-08-25 — scratch router with `t2.procedure` tripped the guard, then
check-types / check:openapi / smoke:authz / e2e all green after removal.

```
refactor(trpc): make an ungated procedure unconstructible

publicProcedure was exported as a bare t.procedure with exactly one consumer,
the health check, which means the package's public surface offered an
authorization-free builder to any future router. Inlining t.procedure at that
single call site and dropping the export closes the hole structurally: there is
no longer an ungated builder to reach for.

A static guard over routers/ keeps it closed. It is deliberately not implemented
by introspecting appRouter._def, because a procedure's definition records its
middleware as anonymous functions and carries no trace of which builder created
it, so that check could only ever be approximated — and only by importing from
unstable-core-do-not-import.
```

### A1 · Test harness for `apps/web` + restore the 38 assertions

- [x] Add vitest to `apps/web` (root `pnpm test` is `turbo run test`; only `@repo/authz`
      participates today).
- [x] `format.test.ts` — 25 assertions: April/March session boundaries, leap years, two-digit
      years, half-typed input, `todayIso` local-vs-UTC.
- [x] `errors.test.ts` — 13 assertions: raw exclusion-constraint string, zod issue array,
      `Missing permission: school:create`, a stack trace — all degrade to generic wording.
      (Found a real gap: `looksTechnical`'s stack-frame pattern missed `at async fn (` frames;
      the regex now covers both, which is what made the stack-trace case actually degrade.)
- [x] **Coordinate with A5.** These tests import helpers A5 removes from the public surface
      (`isIsoDate`, `formatIsoDate`, `todayIso`, `isoYear`, `currentSessionStartYear`, `ErrorKind`).
      Import them from their module paths, not a barrel, so A5 can shrink the barrel without
      breaking the suite. Whichever chunk lands second must not regress the other.

**Verify** `pnpm test` green including web; the counts are 25 and 13 as reported by vitest.
Verified 2026-08-25: 25 + 13 exactly as vitest reports them; authz still 54; e2e specs are NOT
collected by vitest (`test.include` pinned to `src/**/*.test.ts`).

```
test(web): add a test harness and cover the date and error modules

apps/web had no tests, so the two modules most likely to fail silently were
unverified: date conversion, where an off-by-one at the 1 April session boundary
corrupts data rather than erroring, and error mapping, which is the last line
between a Postgres constraint string and a teacher's screen.

The assertions deliberately include hostile inputs — a raw exclusion-constraint
message, a zod issue array, a bare permission string, a stack trace — and assert
each degrades to generic wording, because the failure mode that matters is a
developer-facing string reaching the UI, not a missing translation.
```

### A4 · Error boundaries

- [x] `app/error.tsx` and `app/(dashboard)/error.tsx` (nested).
- [x] Rationale: `useActiveContext()` throws by design when used outside the gate. In production
      that is a blank screen today.

**Verify** throw in a page → message + working retry, at both nesting levels.
Verified 2026-08-25 with temporary planted throws run against the live dev server:
- nested: `/?throw=1` (client-hydration-only throw in the home page) → boundary message,
  AppShell nav still visible, retry re-renders without crashing;
- root: planted throw in the login page → root boundary, message + retry;
- throws removed afterwards; routes.spec 4/4, unit 38+54, check-types all green.
Boundaries never render `error.message`; the digest line is the only trace shown.

```
fix(web): add error boundaries so a render failure explains itself

useActiveContext throws deliberately when a component renders outside the
context gate, which is the right behaviour for catching a wiring mistake in
development. In production it produced a blank page with nothing in the UI to
indicate what happened.

Two boundaries because the shell and the pages fail differently: a nested
boundary inside (dashboard) keeps the navigation usable when one screen fails,
while the root boundary catches a failure in the shell itself.
```

### A5 · Dead code in web `lib/`

- [x] Delete `formatTimestamp`, `RouterInputs` — no callers. (`parseDisplayDate` was also
      caller-less when planned, but A1's suite now exercises it in 6 tests; per the A1↔A5
      non-regression clause it is KEPT and stays exported. Revisit if no form ever consumes it.)
- [x] Remove from the public surface: `EMPTY_VALUE`, `ErrorKind`, `FriendlyError`, `RouterOutputs`,
      `AppFeatures` (un-exported from their modules). The six names the A1 tests import
      (`isIsoDate`, `formatIsoDate`, `todayIso`, `isoYear`, `currentSessionStartYear`) keep their
      module-level exports per the coordination note. 39 → 28 exports.
- [x] **Read A1's note first.** Keep module-level exports so the tests can import them directly;
      shrink the barrel, not the module.

**Verify** `pnpm check-types`; `pnpm test` still green (A1 landed).
Verified 2026-08-25: check-types green, web 38/38 + authz 54/54, e2e 4/4.

```
refactor(web): remove unused exports from lib

Three helpers had no callers at all and are deleted. Ten more are used only
inside their own module and no longer leave it, which takes the lib surface from
39 exports to 26. A public helper implies a contract; these had none, and an
oversized surface is what makes a later refactor look riskier than it is.

Module-level exports are preserved for the unit tests, which import from the
module rather than the barrel.
```

### A6 · QueryClient defaults + typed permissions

- [x] **Prerequisite.** Add `"@repo/authz": "workspace:*"` to `apps/web` **devDependencies**
      (type-only use) and record in `docs/CONVENTIONS.md` that a *type-only* import from
      `@repo/authz` is sanctioned. The type-chain rule bans runtime imports; this is not one.
- [x] Default `retry` via `toFriendlyError` in `provider.tsx`, deleting the identical retry lambda
      copy-pasted 7× across 6 files.
- [x] `has(permission: Permission)` and `PermissionGate<P extends Permission>` become generic;
      replace the 21 hardcoded permission literals across 8 files. (As done: the surfaces are
      typed — `ActiveContextValue.has`, `PermissionGate.permission`, `NavItem.permission` — so
      every literal is compile-checked without touching its call site; the union import is
      type-only in three files.)

**Verify** `pnpm check-types`; zero remaining `retry: (failureCount` copies; a deliberately
misspelled permission literal is now a compile error.
All three verified 2026-08-25: check-types green, grep clean, and a planted
`has("school:raed")` failed with TS2345 before being reverted. Unit 38+54, e2e 4/4.

```
refactor(web): centralize query retry policy and type the permission checks

The same retry predicate was copy-pasted into seven queries across six files,
which is six chances for one of them to drift into retrying a 403. It becomes a
QueryClient default derived from the existing error mapper, so the policy is
stated once.

Permission strings were 21 string literals, where a typo produced a silently
hidden control rather than an error. Importing the Permission union from
@repo/authz makes each one checked at compile time. The import is type-only and
recorded as sanctioned in CONVENTIONS.md: the type-chain rule exists to keep
server runtime code out of the browser bundle, and a type has no runtime.
```

---

## Workstream B — scope encoding

### B1 · Split the 403 message

- [ ] `packages/trpc/src/trpc.ts:167-172` and `:247-252`, using `permissionsInOrg`
      (exported, `packages/authz/src/index.ts:58`).
- [ ] Wording: **"a role you hold has X but not at this {node.type}"** vs. the plain missing-
      permission case.
- [ ] Note in the ADR that `trpc-openapi` puts `message` on the wire, so REST consumers see it
      raw. Acceptable: it discloses only the caller's own grant state.

**Verify** `pnpm smoke:authz` 15/15 (plus A2's matrix); two curls produce two different messages.

```
fix(trpc): distinguish a missing permission from a permission out of scope

Both failures produced the same 403, so the single most common real-world
support question — "why can't she see Class 7 when she can see Class 6" — was
indistinguishable from a missing grant. The gate already knows which case it is;
it just discarded the distinction.

The out-of-scope message names the node type rather than the node id, because
the id is meaningless to the reader and the type is the actionable part. It
discloses only the caller's own grant state, which they can already enumerate
from /me, so the REST surface exposing the message raw is not a new disclosure.
```

### B2 · `year.current` requires `schoolId`

- [ ] Live bug: at org scope, `current` returns an arbitrary branch's session — `isCurrent` is per
      school.
- [ ] **Frontend fallout:** the active-context provider resolves the current session. It must now
      pass `schoolId` and must not fire until a branch is chosen. Check the `enabled` gate.

**Verify** an org-scope call is rejected at validation; `principal` still gets 200; the session
indicator stays empty rather than wrong when no branch is selected.

```
fix(academic): require a branch when asking for the current session

isCurrent is per school, so "the current session" is only a question with an
answer once a branch is named. Asked at organization scope the endpoint returned
whichever row the database happened to order first, which for a multi-branch
trust means the session indicator could name a different school's year than the
one the user is looking at.

Making schoolId required turns a wrong answer into a validation error. The
client already knows the branch — it is the context every other call carries —
so the fix is to stop letting the call be made without it.
```

### B3 · The ADRs — written and accepted BEFORE B4–B7

- [ ] **ADR-027 — single-resource endpoints address their own resource.** `addressedNodeId`
      ignoring `input.id` was an oversight, not a decision. Precision note: `organizationId`
      stays in the input, so `can.ts:34`'s cross-tenant check stays meaningful. If
      org-derived-from-node ever lands as a refinement, that check becomes vacuous and the
      surviving tenant guard is `scope.ts:24` (assignment org vs node org).
- [ ] **ADR-028 — amends ADR-017's read half.** Permissive single-row reads via the in-memory
      coverage test (`getDataScopes(cache, perm, rowScope).length > 0` — no `scopeWhere`, no
      widening, fetch still org-filtered).
      - Record the **rejected** alternative: stricter lists. It blinds section teachers to the
        class they belong to.
      - **Decide sub-node `read_history` semantics.** Permissive computation admits grants
        *narrower* than the row's node that hold the permission. Recommendation, grounded in the
        codebase's own evidence: `defaultPermissions.ts:190-192` — *"Sees the year list to switch
        context; without read_history the switcher offers the current session only"* — shows
        sub-school grants of year permissions are meaningful **by design**. The grant limits
        *which school*; the permission gates *the capability*. For seeded roles nothing changes
        (`class_teacher` holds no `read_history` at any scope), but the widening is structural and
        is decided here, in writing, not by implementation accident.
      - **Reconcile `RESOURCE_MIN_SCOPE` with `DEFAULT_ROLE_PERMISSIONS`.** Affirm min-scope is
        advisory, citing its own doc comment (`roles.ts:83`). Annotate or fix the
        `academic_year: "school"` entry: it is inconsistent with the deliberate class-scoped
        `class_teacher` grant, and a permissions editor rendering `resourcesForScope("class")`
        would hide academic-year rows for a role the default matrix grants one to.
      - Record **"enforce min-scope in `can()`" as rejected**: it contradicts the map's stated
        contract, regresses ADR-024's direction (year visibility moved from scope-mechanics to
        permissions precisely because scope-keying locked out legitimate users), and would break
        the seeded, commented session-picker grant.

**Verify** both ADRs in `docs/DECISIONS.md`, each with alternatives recorded and rejected rather
than presented as open. Neither silently contradicts an existing ADR; ADR-028 supersedes ADR-017's
read half explicitly.

```
docs: record the scope-encoding decisions as ADRs

Two changes to how authorization reads the request are large enough that the
code should not land before the decision does.

ADR-027 states that a single-resource endpoint addresses its own resource. The
gate currently derives the addressed node from the caller-supplied scope and
ignores input.id, which is why a section-scoped teacher is refused a class she
belongs to. organizationId stays in the input so the cross-tenant check in
can.ts keeps something to compare.

ADR-028 amends ADR-017's read half: a single-row read asks whether the row is
inside a grant, computed in memory, with the fetch still organization-filtered.
It records stricter lists as rejected, and it decides in writing what a grant
narrower than the row's own node means for read_history — the grant limits which
school, the permission gates the capability, which is what the default role
matrix already assumes. It also reconciles RESOURCE_MIN_SCOPE, which is advisory
by its own documentation, with a default role that deliberately violates it, and
records enforcing it as rejected.
```

### B4 · `addressedBy: "id"` on the 9 node-shaped endpoints

- [ ] Option on the existing `staffProcedure`, **not** a third builder. The builder owns
      `staffScopeInput.extend({ id: z.uuid() })` so the gate sees a validated `id` — tRPC
      middleware only sees input parsed *before* it was attached.
- [ ] `organizationId` stays in the input; the cross-tenant check stays intact.
- [ ] Migrate `school.*` (3) → smoke → `class.*` (3) → smoke → `section.*` (3). **One commit per
      router.**
- [ ] Frontend drops `schoolId` from update/deactivate calls.
- [ ] **Keep `useClass`'s list workaround.** It protects the section-scoped teacher until B7's
      permissive reads land. Deleting it here fails A2's matrix — which is the intended behaviour.

**Verify** `pnpm smoke:authz` + A2's matrix + `pnpm test:e2e` green **after each router**, not
just at the end. `pnpm check:openapi` clean.

```
refactor(trpc): single-resource endpoints address their own resource

The staff gate derived the addressed node from the caller-supplied scope and
ignored input.id, so byId, update and deactivate authorized against whatever the
client claimed rather than against the row being touched. Per ADR-027 the
builder now attaches a validated id itself, because tRPC middleware only sees
input that was parsed before it ran.

organizationId stays in the input rather than being derived from the node, which
keeps can.ts's cross-tenant comparison meaningful and keeps the diff to the nine
endpoints that needed it. One router per commit, with the authorization matrix
re-run between each, so a regression names its own router.

useClass's list-based workaround stays for now: it is what keeps a
section-scoped teacher able to open her own class until permissive reads land.
```

### B5 · Creates name their parent

- [ ] `school.create({ organizationId })`, `year.create({ schoolId })`, `class.create({ schoolId })`,
      `section.create({ classId })` — required in each endpoint's own input
      (`optional & required` resolves to required).
- [ ] `requireSchoolId` stays as a runtime guard.
- [ ] `section.create`'s `academicYearId` same-school check stays — a year is not a node.

**Verify** omitting the parent is a **compile error at the call site**, not a runtime 400.

```
refactor(trpc): creates name their parent explicitly

Creates inherited an optional schoolId from the shared scope input and relied on
a runtime guard to reject its absence, which turned a fact the client always
knows into a 500 discovered in production. Each create now requires its own
parent in its own input, so omitting it fails at the call site during
type-checking.

requireSchoolId stays as a guard rather than being deleted, because the REST
surface shares these routers and its callers are not type-checked against them.
section.create keeps its separate same-school check on academicYearId: a year is
not a scope node, so the addressed-node machinery cannot validate it.
```

### B6 · Resolution layer

**Deadline: before the enrollment slice.**

- [ ] Per-resource resolver returning the owning node spec. Async and allowed to traverse —
      the interface is shaped by the **student** case (`student → current enrollment → section`),
      not by years.
- [ ] Years ship as the trivial one-column adapter (`academicYears.schoolId`), migrating
      `year.byId` / `update` / `setCurrent` to `{ id }` and retiring the stage-1 TODOs.

**Verify** a cross-tenant year id → 404; the class teacher's year semantics unchanged
(pin against A2's matrix).

```
feat(trpc): resolve the owning node for entities that are not scope nodes

A class row carries its own school and org, so the gate can derive its scope
from the row. A student cannot: the authorizing node is the section of their
current enrollment, one join away. Rather than special-casing that when
enrollments arrive, this adds a per-resource resolver returning the owning node,
async and permitted to traverse.

Academic years ship first as the trivial adapter — one column — which retires
the stage-1 TODOs and proves the interface against a real caller before the
student case depends on it. The interface is deliberately shaped by the student
case, because a design fitted to the one-column version would have to be rebuilt
for the one that actually needs it.
```

### B7 · Permissive reads

Gated on ADR-028.

- [ ] **Node half ships independently of B6** — a class row's scope derives from its own columns.
- [ ] Non-node entities (`year.byId`) wait for B6's resolver.
- [ ] **On landing, delete `useClass`'s list workaround** and revert to `class.byId`.

**Verify — including the ADR-024 negatives:**
- `class_teacher` still gets NOT_FOUND for a closed year addressed by valid id (pin the existing
  smoke assertion);
- `subject_teacher` (section-scoped) likewise;
- **`principal` still reads that closed year** — the non-vacuity control, without which the two
  negatives above could pass because reads broke for everyone;
- section-scoped grant → parent class `byId` **200**, sibling class **404**.

```
refactor(authz): single-row reads ask whether the row is inside a grant

Reading one row went through the same scope-filtered path as listing many, so a
section-scoped teacher was refused the class she teaches in: her grant does not
cover the class node above her section, even though every student she is
responsible for sits inside it. Per ADR-028 a single-row read now asks the
narrower question — is this row inside any grant that holds the permission —
computed in memory, with the fetch still organization-filtered.

The node-shaped entities land here; years wait for the resolution layer. The
verification includes the ADR-024 negatives, and deliberately keeps a positive
control: the principal must still read a closed year, or the two negatives would
pass simply because reads had broken for everyone. useClass reverts to class.byId
now that the endpoint it needs behaves correctly.
```

---

## Workstream C · authz barrel triage

- [ ] Un-export ~4: `scopeCovers`, `intersectScopes`, `isAssignmentExpired`, `buildUserAuthCache`.
- [ ] Keep ~15 with in-place comments next to the export group —
      `// kept for the permissions editor (unbuilt) — see TASKS.md` — covering `ALL_PERMISSIONS`,
      `isPermission`, `RESOURCE_ACTIONS`, `RESOURCE_CATEGORIES`, `RESOURCE_MIN_SCOPE`,
      `resourcesForScope`, `ROLE_LABELS`, `DEFAULT_SCOPE_LEVEL`, `isRoleType`, `isScopeType`,
      `isBroaderOrEqual`, `SCOPE_TYPES`, `scopeDepth`, plus both invalidators.
- [ ] Delete **0**.
- [ ] One unit test each for `invalidateOrgAuthCache` and `invalidateScopeNode`.
- [ ] `scopeCovers` is un-exported but is the subject of `scope.test.ts`'s truth table — the test
      imports from the module, so keep the module export and drop only the barrel re-export.

**Verify** `pnpm test` reports **56** (54 + 2 invalidators); `pnpm check-types` green.

```
refactor(authz): mark carried exports and test the cache invalidators

The barrel exported internals alongside its real API, so a reader could not tell
which exports were the package's contract and which were incidental. Four with
no external caller stop being re-exported; roughly fifteen with no caller yet are
kept and annotated in place, because they exist for the permissions editor and
deleting them would mean rewriting them from the same spec later.

Both cache invalidators are among those, and neither had a test. A function with
no callers and no tests drifts silently until the day something calls it, which
for cache invalidation means a stale permission decision — so each gets one now,
while the behaviour is still obvious.
```

---

## Gates (every chunk)

- `pnpm check-types` green (8/8)
- `pnpm test` green — **54 authz** *(vitest runtime count; `scope.test.ts:113` generates 13 from a
  loop, so a textual `it(` grep undercounts to 42 — do not "fix" this number downward)* + 38 web
  after A1 + 2 invalidators after C
- `pnpm test:e2e` green after A2 (not part of `pnpm test` — needs servers + seeded DB)
- `pnpm smoke:authz` extended with each chunk's negatives
- `pnpm check:openapi` clean whenever router `meta` changes
- `docs/TASKS.md` updated per the working agreement

## Risks / gotchas

- **A1 ↔ A5 collide.** A1's assertions import helpers A5 removes from the public surface. Shrink
  the barrel, keep the module exports, and have the tests import module paths. Same applies to
  `scopeCovers` in C.
- **Vitest and Playwright will fight over globs** in `apps/web` if both claim `*.test.ts`. Split
  by extension and directory, and keep the browser spec out of `pnpm test`.
- **B2 has frontend fallout.** The active-context provider must pass `schoolId` and must not fire
  before a branch is chosen, or the session indicator breaks instead of the endpoint.
- **Deleting `useClass`'s workaround before B7** regresses the modal user. A2's matrix catches it;
  leave the workaround alone until B7 says otherwise.
- **`_def.procedures` is not a provenance oracle** and lives behind
  `unstable-core-do-not-import`. A3 is a static check for this reason.
- **`RESOURCE_MIN_SCOPE` is advisory** and the `academic_year` entry disagrees with the default
  role matrix. B3 settles it on paper; nothing enforces it in code, so no test can pin it.
- **A whole-commit revert of `d8eca60`** proves aggregate coverage only. Keep the per-fix criteria.

## Explicitly not in this plan

Phase 2's remaining tables (subjects, terms, enrollments), the student portal,
`platformProcedure`, lint wiring, any authz-core algorithm change, any DB migration,
org-derived-from-node addressing (ADR-027 records it as a possible future refinement only),
amending `d8eca60` (already done by the owner), and enforcing `RESOURCE_MIN_SCOPE` in `can()`
(ADR-028 records it as rejected).
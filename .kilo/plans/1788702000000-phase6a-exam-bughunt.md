# Phase 6a — Exam/Result Bug Hunt & Hardening

Branch: `feature/phase5-exams` (unchanged; commits by the agent, never pushed).
Owner constraints for this phase: **2–3 commits total** (detector+fixes / engine
locks+journeys / UI-UX pass), keep documenting as I go, **do not wait out the
sign-in rate limiter — remove it locally for testing and restore it before the
final commit** (the limiter edit itself is never committed).

## Why this phase exists

The owner found core-flow bugs by clicking ("can't even create a new Exam")
that every existing gate was green through. Root cause analysis (verified by
HTTP probes, 2026-09-07):

- `exam.exam.create` 400s: the create contract demands `weightageInTerm`
  (the custom `pct100` override replaced drizzle-zod's derived
  default-carrying shape), and the create dialog never sends it.
- `exam.schedules.save` / `exam.components.save` (and, by the same
  pattern, likely every `resolveOwner` mutation in the exam router that
  names its input `examId`/`scheduleId` instead of `id`): the
  staffProcedure builder attaches an id-addressed `id` field for
  resolveOwner procedures (ADR-027); the router's `.input()` then MERGES
  its own object which lacks `id` → the builder's validation requires it
  → 400 before authorization even runs.

**The ecosystem hole:** integration tests call services directly (bypass
router input parsing); smoke:authz tests authorization (not happy paths);
e2e walks route mounts + two flows, never the exam dialogs; property tests
check pure math. NOTHING sends a real UI-shaped payload through the real
router. That is the class of every owner-found bug: contract ↔ router ↔
UI payload mismatches, only visible end-to-end.

## Chunks

- [ ] **P0a — Detector (the point of the phase):**
  1. Router conformance suite: every `exam.*` + `portalAccess.*` +
     `assignment.*` + new-slice procedures called through tRPC
     `createCaller` against real Postgres with UI-shaped payloads
     (scopeArgs spread, same field names the hooks send). Happy path +
     worded refusals per mutation.
  2. Minimal-payload sweep: enumerate procedures from the router shape,
     derive minimal valid inputs from the Zod schemas, probe over HTTP;
     every 4xx on a schema-valid payload is an inventory line.
  3. **Bug inventory doc committed before fixes** (findings doc: exact
     request/response evidence per bug).
- [ ] **P0b — Kill the inventory (Commit 1):** contract defaults where the
  DB has them (`weightageInTerm` optional w/ service-side default; keep
  the field VISIBLE in the dialog, prefilled 100 — it changes term math),
  rename router inputs to the ADR-027 `id` pattern, fix UI payloads,
  grade-only entry UI in the marks grid (owner-approved scope: letter
  grade for graded-only subjects + term-grade areas are Commit 1;
  the missing `subjectTypeId` picker on the mapping dialog too — noted
  as a defect last turn). Nothing marked fixed without its conformance
  test passing. Run the sweep again → inventory empty.
- [ ] **P1 — Engine locks (Commit 2):** golden-case math validation (one
  fixture class, hand-computed: exactly-at-pass, pass-minus-one, grace
  edges, absent vs exempt, weighted rollups, annual weighted vs
  last-term, all-gradedOnly GPA branch) + state-machine/invariant sweep
  (full transition matrix, publication freezes/versions/is_current/
  ledger-before-mark, idempotency: double compute/publish/re-seed,
  concurrency through the router) + the four browser journeys e2e
  (principal full lifecycle, subject-teacher marks, class-teacher
  verification, parent phone→change→card) as the permanent regression
  gate.
- [ ] **P2 — UI/UX pass (Commit 3):** both skills actually loaded
  (`frontend-product-ux-skill` for workflow/state defects,
  `frontend-design` for the visual layer — never opened during S1–S5).
  Written defect list per screen first; exam-detail redesign to the
  owner's eyeball BEFORE applying across screens (owner said commit by
  self — the eyeball stays as a review artifact in the findings doc with
  screenshots described; proceed autonomously per the latest
  instruction).

## Verify gates

Same as always (check-types 8/8, unit, lint, builders, openapi) PLUS the
new conformance suite and the sweep script must be green, e2e journeys
green, smoke:authz green. Rate limiter RESTORED and proven restored
(sign-in limiter reachable → 429 on the 21st attempt is NOT re-proven
(unnecessary limiter-testing risk); restoration verified by code
inspection + general request still working).

## Work log (append as I go — the documentation the owner asked for)

- (created) Plan written; limiter removal + detector next.
- Limiter removed locally (server.ts, `RATE-LIMIT-RESTORE` marker; never to
  be committed) — confirmed off: 25 sign-in attempts → 401, not 429.
- Detector built: `exam-conformance.integration.test.ts` — every exam.*
  procedure through `createCaller` with UI-shaped payloads against real
  Postgres. Fixture lessons: scope-node entities (school/class/section/
  year/term) must go through the SERVICES (hard rule 12) or resolveNode
  403s; a fresh org needs the default permission matrix synced or every
  can() answers no.
- **BUG-2 confirmed and fixed** (row-key omissions: examId/scheduleId).
- **BUG-3 confirmed and fixed** (db.select inside tx → tx.select; the
  save-returns-empty race).
- **BUG-4 confirmed and fixed** (exam-domain SERVICE_TRANSLATIONS — the
  worded-gates-turned-500 class; ~25 deliberate throws now worded).
- **BUG-5 confirmed and fixed** (subjectTypeId picker on the mapping
  dialog).
- **BUG-1 confirmed fixed** by the create-payload tests (with and without
  weightageInTerm; DB default applies).
- HTTP walk on a fresh exam: **15/15 green** (full lifecycle, publish,
  cards). Conformance suite: **5/5 green**.
- Walk corrections that were probe/suite bugs, NOT app bugs: exam list is
  GET; components.list/readiness/versions/classSet are GET-with-?input=;
  coverage requires ALL counted subjects scheduled; verification requires
  EVERY roster student × EVERY component entered (a class-wide schedule's
  cohort includes unsectioned students); a second counting exam in a full
  term is correctly refused (use a mock to walk past).
- Findings doc: `.kilo/plans/phase6a-bug-inventory.md` (BUG-1..5 with
  root causes + evidence).
- Self-inflicted detour logged honestly: a sed-style step-logger injection
  mangled the suite file; repaired via file scripts; lesson — never
  regex-edit code from the shell, use the Edit tool.
- Commit 1 next: all of the above + gates.

